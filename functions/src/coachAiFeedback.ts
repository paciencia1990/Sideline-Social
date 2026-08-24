import { randomUUID } from 'node:crypto';

import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as firebaseFunctions from 'firebase-functions';

import { validateCoachAiFeedback } from './coachAiFeedbackCore';
import { requireCoachAiRuntimeEnabled } from './coachAiRuntime';
import { coachAiModerationIngestionEnabled } from './moderationReportsCore';
import { createCoachAiUnsafeModerationReport } from './moderationReports';
import { permanentAccountFunctions } from './permanentAuth';

const functions = permanentAccountFunctions(firebaseFunctions, 'communication');
const feedbackFunctions = functions.region('us-central1').runWith({ timeoutSeconds: 30, memory: '256MB' });
const FEEDBACK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_RETENTION_MS = 48 * 60 * 60 * 1000;
const RATE_LIMIT_MAX = 30;

export const submitCoachAiFeedback = feedbackFunctions.https.onCall(async (data, context) => {
  const correlationId = randomUUID();
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in is required.', { reason: 'auth_required' });
  if (!serverTestingEnabled()) {
    throw new functions.https.HttpsError('failed-precondition', 'AI Coach testing is disabled.', { reason: 'server_testing_disabled' });
  }
  const firestore = admin.firestore();
  if (!await requireCoachAiRuntimeEnabled(firestore)) {
    throw new functions.https.HttpsError('failed-precondition', 'AI Coach is temporarily unavailable.', { reason: 'coach_ai_disabled' });
  }
  if (context.auth?.token.aiCoachTester !== true) {
    throw new functions.https.HttpsError('permission-denied', 'This account is not an authorized AI Coach tester.', { reason: 'tester_entitlement_required' });
  }
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
      const [requestSnapshot, existingFeedback, rateSnapshot] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(feedbackRef),
        transaction.get(rateRef),
      ]);
      const requestData = requestSnapshot.data();
      if (!requestSnapshot.exists || requestData?.status !== 'completed' || requestData?.userId !== uid) {
        throw new Error('request_not_found');
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
        reviewStatus: feedback.reason === 'unsafe' ? 'needs_review' : 'received',
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(now + FEEDBACK_RETENTION_MS),
        ...(existingFeedback.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      };
      transaction.set(feedbackRef, record, { merge: true });
      if (feedback.reason === 'unsafe') unsafeReportData = requestData;
      return { category: requestData.category, locale: requestData.locale, reviewStatus: record.reviewStatus };
    });
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
