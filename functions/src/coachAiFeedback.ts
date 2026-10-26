import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';

import { getApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as firebaseFunctions from 'firebase-functions/v1';

import { validateCoachAiFeedback } from './coachAiFeedbackCore';
import { requireCoachAiRuntimeEnabled } from './coachAiRuntime';
import { coachAiModerationIngestionEnabled } from './moderationReportsCore';
import { createCoachAiUnsafeModerationReport } from './moderationReports';
import { permanentAccountFunctions } from './permanentAuth';
import { billingRequestId } from './coachAiBillingCore';
import { billingEnrollmentRef } from './coachAiBillingEnrollment';

const functions = permanentAccountFunctions(firebaseFunctions, 'communication');
const feedbackFunctions = functions.region('us-central1').runWith({
  timeoutSeconds: 30, memory: '256MB',
  serviceAccount: 'coach-ai-feedback@sideline-social-staging-2026.iam.gserviceaccount.com',
});
const FEEDBACK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_RETENTION_MS = 48 * 60 * 60 * 1000;
const RATE_LIMIT_MAX = 30;

export const submitCoachAiFeedback = feedbackFunctions.https.onCall(async (data, context) => {
  const correlationId = randomUUID();
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in is required.', { reason: 'auth_required' });
  const firestore = getFirestore();
  const testerAllowed = serverTestingEnabled() && context.auth?.token.aiCoachTester === true
    && await requireCoachAiRuntimeEnabled(firestore);
  const profile = await firestore.collection('users').doc(uid).get();
  if (profile.data()?.adultEligibilityConfirmed !== true || profile.data()?.activeMode !== 'coach') {
    throw new functions.https.HttpsError('permission-denied', 'Adult Coach Mode is required.', { reason: 'adult_coach_mode_required' });
  }

  let feedback;
  try {
    feedback = validateCoachAiFeedback(data);
  } catch (error) {
    throw new functions.https.HttpsError('invalid-argument', 'The feedback could not be validated.', {
      reason: error instanceof Error ? error.message : 'invalid_feedback',
    });
  }

  const requestRef = firestore.collection('coachAiRequests').doc(`${uid}_${feedback.requestId}`);
  const feedbackRef = firestore.collection('coachAiFeedback').doc(`${uid}_${feedback.requestId}`);
  const rateRef = firestore.collection('coachAiFeedbackRateLimits').doc(uid);
  const now = Date.now();
  let unsafeReportData: FirebaseFirestore.DocumentData | null = null;
  try {
    const metadata = await firestore.runTransaction(async (transaction) => {
      const [requestSnapshot, existingFeedback, rateSnapshot, currentProfile, enrollment] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(feedbackRef),
        transaction.get(rateRef),
        transaction.get(profile.ref),
        transaction.get(billingEnrollmentRef(uid)),
      ]);
      if (!currentProfile.exists || currentProfile.data()?.adultEligibilityConfirmed !== true
        || currentProfile.data()?.activeMode !== 'coach' || enrollment.data()?.state === 'deleting') {
        throw new functions.https.HttpsError('permission-denied', 'Account is unavailable.', { reason: 'account_deleting' });
      }
      let requestData = requestSnapshot.data();
      if (!requestSnapshot.exists) {
        // Completed paid ownership receipts outlive the short-lived text cache.
        // These exact server-only lookups never recreate the response or trust
        // client-supplied ownership, environment, category or generated text.
        const receipts = await Promise.all((['sandbox', 'production'] as const).map(async environment => ({
          environment,
          snapshot: await transaction.get(firestore.doc(`coachAiPaidRequests/${billingRequestId(environment, uid, feedback.requestId)}`)),
        })));
        const present = receipts.filter(entry => entry.snapshot.exists);
        if (present.length !== 1) throw new Error('request_not_found');
        const { environment, snapshot } = present[0];
        const receipt = snapshot.data();
        if (receipt?.status !== 'completed' || receipt.userId !== uid
          || receipt.environment !== environment || receipt.clientRequestId !== feedback.requestId
          || typeof receipt.billable !== 'boolean' || typeof receipt.fingerprint !== 'string'
          || !/^[a-f0-9]{64}$/.test(receipt.fingerprint)) throw new Error('request_not_found');
        requestData = {
          userId: uid, status: 'completed', paid: true,
          // Older receipts intentionally contain no content/category metadata.
          category: 'unknown', locale: 'unknown', modelIdentifier: 'unknown',
        };
      } else if (requestData?.status !== 'completed' || requestData?.userId !== uid) {
        throw new Error('request_not_found');
      }
      // An expired subscription never prevents reporting its own saved output.
      // Paid records are server-owned; a client cannot assert this exemption.
      if (!testerAllowed && !(context.app && requestData.paid === true)) {
        throw new functions.https.HttpsError('permission-denied', 'Coach AI feedback access is unavailable.', { reason: 'tester_entitlement_required' });
      }
      const requestTimes = readRollingTimes(rateSnapshot.data(), now);
      if (!existingFeedback.exists && requestTimes.length >= RATE_LIMIT_MAX) throw new Error('feedback_rate_limited');
      const nextTimes = existingFeedback.exists ? requestTimes : [...requestTimes, now];
      if (!existingFeedback.exists) {
        transaction.set(rateRef, {
          userId: uid,
          requestTimes: nextTimes.map((value) => Timestamp.fromMillis(value)),
          count: nextTimes.length,
          updatedAt: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromMillis(now + RATE_LIMIT_RETENTION_MS),
        });
      }
      const record = {
        requestId: feedback.requestId,
        testerUid: uid,
        rating: feedback.rating,
        ...(feedback.reason ? { reason: feedback.reason } : { reason: FieldValue.delete() }),
        ...(feedback.comment ? { comment: feedback.comment } : { comment: FieldValue.delete() }),
        category: requestData.category,
        locale: requestData.locale,
        modelIdentifier: typeof requestData.modelIdentifier === 'string'
          ? requestData.modelIdentifier.slice(0, 80)
          : 'unknown',
        sourceRecordType: requestSnapshot.exists ? 'response_cache' : 'paid_receipt',
        responseCacheAvailable: requestSnapshot.exists,
        reviewStatus: feedback.reason === 'unsafe' ? 'needs_review' : 'received',
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(now + FEEDBACK_RETENTION_MS),
        ...(existingFeedback.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      };
      transaction.set(feedbackRef, record, { merge: true });
      if (feedback.reason === 'unsafe') unsafeReportData = requestData;
      return { category: requestData.category, locale: requestData.locale, reviewStatus: record.reviewStatus };
    }, { maxAttempts: 1 });
    const moderationReceipt = unsafeReportData && coachAiModerationIngestionEnabled(process.env)
      ? await createCoachAiUnsafeModerationReport({
          comment: feedback.comment ?? null,
          requestData: unsafeReportData,
          requestId: feedback.requestId,
          reporterUserId: uid,
        })
      : null;
    functions.logger.info('coach_ai_feedback_saved', { correlationId, ...metadata, outcome: 'saved' });
    return {
      saved: true,
      reviewStatus: metadata.reviewStatus,
      moderationReceiptNumber: moderationReceipt?.receiptNumber ?? null,
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'request_not_found') {
      throw new functions.https.HttpsError('not-found', 'The related Coach AI request is unavailable.', { reason: 'request_not_found' });
    }
    if (error instanceof Error && error.message === 'feedback_rate_limited') {
      throw new functions.https.HttpsError('resource-exhausted', 'Please wait before sending more feedback.', { reason: 'feedback_rate_limited' });
    }
    throw error;
  }
});

function serverTestingEnabled() {
  return process.env.COACH_AI_TESTING_ENABLED === 'true' || process.env.FUNCTIONS_EMULATOR === 'true';
}

function readRollingTimes(data: FirebaseFirestore.DocumentData | undefined, now: number) {
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  if (!Array.isArray(data?.requestTimes)) return [];
  return data.requestTimes
    .map((value: unknown) => value instanceof Timestamp ? value.toMillis() : 0)
    .filter((value: number) => value > cutoff && value <= now)
    .sort((left: number, right: number) => left - right)
    .slice(-RATE_LIMIT_MAX);
}
