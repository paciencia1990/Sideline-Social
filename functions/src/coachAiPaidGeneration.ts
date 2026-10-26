import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
import * as firebaseFunctions from 'firebase-functions/v1';
import { permanentAccountFunctions } from './permanentAuth';
import { requireVerifiedCoachAiSubscription } from './coachAiBilling';
import { billingDocumentId, billingRequestId, coachAiMonthlyWindow } from './coachAiBillingCore';
import { COACH_AI_INCLUDED_RESPONSES_PER_MONTH, reserveCoachAiPaidGuide, finishCoachAiPaidGuide, type CoachAiUsageLedger } from './coachAiSubscriptionCore';
import { REVENUECAT_VERIFICATION_SECRET, coachAiRuntimeIdentity } from './coachAiRevenueCatV2';
import { createCoachHelpSafetyResult, isCoachHelpSafetySensitive, validateCoachHelpRequest, validateCoachHelpResult, type ValidatedCoachHelpResult } from './coachResourceHelpCore';
import { requestProviderResult } from './coachResourceHelp';

const functions = permanentAccountFunctions(firebaseFunctions, 'communication');
const paidFunctions = functions.region('us-central1').runWith({
  secrets: [REVENUECAT_VERIFICATION_SECRET, 'COACH_AI_API_KEY', 'COACH_AI_ENDPOINT'],
  serviceAccount: coachAiRuntimeIdentity('generator'),
  timeoutSeconds: 60, memory: '256MB', enforceAppCheck: true,
});
const COMPLETED_RESPONSE_RETENTION_MS = 24 * 60 * 60 * 1000;

/** One explicit generation attempt; minimal idempotency receipts survive quota resets. */
export const generatePaidCoachResourceHelp = paidFunctions.https.onCall(async (data, context) => {
  const uid = context.auth!.uid;
  let request;
  try { request = validateCoachHelpRequest(data); }
  catch { throw new functions.https.HttpsError('invalid-argument', 'The request could not be validated.'); }
  const { config, account } = await requireVerifiedCoachAiSubscription(uid, context);
  const firestore = getFirestore();
  const profileRef = firestore.doc(`users/${uid}`);
  const deletionRef = firestore.doc(`coachAiBillingDeletionQueue/${createHash('sha256').update(uid).digest('hex')}`);
  const window = coachAiMonthlyWindow(account.anchorMs!, Date.now());
  const windowRef = account.accountRef.collection('windows').doc(window.id);
  const receiptRef = firestore.doc(`coachAiPaidRequests/${billingRequestId(config.environment, uid, request.clientRequestId)}`);
  const resultRef = firestore.doc(`coachAiRequests/${uid}_${request.clientRequestId}`);
  const rateRef = firestore.doc(`coachAiBillingRateLimits/${billingDocumentId(config.environment, uid)}`);
  const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const localSafety = isCoachHelpSafetySensitive(request);
  const attemptId = randomUUID();
  let reserved;
  try {
    reserved = await firestore.runTransaction(async (transaction) => {
      const [receipt, cached, usage, rate, profile, deletion] = await Promise.all([
        transaction.get(receiptRef), transaction.get(resultRef), transaction.get(windowRef), transaction.get(rateRef),
        transaction.get(profileRef), transaction.get(deletionRef),
      ]);
      if (!profile.exists || deletion.exists) throw new Error('account_deleting');
      const prior = receipt.data();
      if (cached.exists && (cached.data()?.userId !== uid || cached.data()?.billingEnvironment !== config.environment || cached.data()?.fingerprint !== fingerprint || !prior)) throw new Error('request_id_conflict');
      if (prior && (prior.userId !== uid || prior.environment !== config.environment || prior.fingerprint !== fingerprint)) throw new Error('request_id_conflict');
      if (prior?.status === 'completed') {
        if (!cached.exists || cached.data()?.fingerprint !== fingerprint || !cached.data()?.result) throw new Error('response_no_longer_cached');
        return { action: 'cached' as const, result: validateCoachHelpResult(cached.data()!.result, request.category) };
      }
      if (prior?.status === 'processing') {
        if (cached.data()?.fingerprint === fingerprint && cached.data()?.result) {
          // An explicit recovery may encounter a response written by the older
          // flow. Remove its premature TTL before attempting finalization again.
          if (cached.data()?.expiresAt != null) transaction.update(resultRef, { expiresAt: FieldValue.delete() });
          return { action: 'complete' as const };
        }
        throw new Error((prior.leaseUntilMs ?? 0) > Date.now() ? 'request_in_progress' : 'request_outcome_unknown');
      }
      const times: number[] = Array.isArray(rate.data()?.times) ? rate.data()!.times.filter((value: unknown) => typeof value === 'number' && value > Date.now() - 3600000) : [];
      if (times.length >= 60) throw new Error('rate_limited');
      const ledger = readLedger(usage.data(), uid, window.id);
      const next = localSafety ? ledger : reserveCoachAiPaidGuide(ledger);
      if (!localSafety && ledger.reserved >= 3) throw new Error('request_in_progress');
      transaction.set(windowRef, { ...next, userId: uid, startsAtMs: window.startsAtMs, resetsAtMs: window.resetsAtMs });
      transaction.set(rateRef, { userId: uid, times: [...times, Date.now()], expiresAt: Timestamp.fromMillis(Date.now() + 2 * 3600000) });
      transaction.set(receiptRef, { userId: uid, environment: config.environment, clientRequestId: request.clientRequestId,
        fingerprint, status: 'processing', billable: !localSafety, windowPath: windowRef.path,
        attemptId, leaseUntilMs: Date.now() + 70_000, startedAt: FieldValue.serverTimestamp() });
      return { action: 'generate' as const };
    }, { maxAttempts: 1 });
  } catch (error) { throw paidRequestError(error); }
  if (reserved.action === 'cached') return reserved.result;

  if (reserved.action === 'generate') {
    let result: ValidatedCoachHelpResult;
    try {
      result = localSafety ? createCoachHelpSafetyResult(request.locale) : await requestProviderResult(request, 1);
    } catch (providerError) {
      // Release only this attempt's slot; nothing counts as a fulfilled response.
      try {
        await firestore.runTransaction(async (transaction) => {
          const receipt = await transaction.get(receiptRef);
          const prior = receipt.data();
          if (prior?.status !== 'processing' || prior.attemptId !== attemptId) return;
          const usage = await transaction.get(windowRef);
          const ledger = readLedger(usage.data(), uid, window.id);
          transaction.set(windowRef, localSafety ? ledger : finishCoachAiPaidGuide(ledger, 'failed'), { merge: true });
          transaction.update(receiptRef, { status: 'failed', leaseUntilMs: 0, failedAt: FieldValue.serverTimestamp() });
        }, { maxAttempts: 1 });
      } catch { functions.logger.error('coach_ai_paid_reservation_needs_review', { correlationId: randomUUID() }); }
      throw providerError;
    }
    try {
      // Persist the generated response before charging the allowance. A manual
      // retry reconciles this cache without contacting the AI provider again.
      // Unresolved results must survive the normal completed-response TTL.
      await firestore.runTransaction(async (transaction) => {
        const [profile, deletion, receipt] = await Promise.all([transaction.get(profileRef), transaction.get(deletionRef), transaction.get(receiptRef)]);
        if (!profile.exists || deletion.exists || receipt.data()?.attemptId !== attemptId || receipt.data()?.status !== 'processing') throw new Error('account_deleting');
        transaction.create(resultRef, { userId: uid, clientRequestId: request.clientRequestId, category: request.category,
          locale: request.locale, fingerprint, result, status: 'generated', paid: true, billingEnvironment: config.environment,
          modelIdentifier: localSafety ? 'local-safety' : process.env.COACH_AI_MODEL_ID?.trim() || 'provider-managed',
          createdAt: FieldValue.serverTimestamp() });
      }, { maxAttempts: 1 });
    } catch {
      const cached = await resultRef.get();
      if (cached.data()?.userId !== uid || cached.data()?.billingEnvironment !== config.environment || cached.data()?.fingerprint !== fingerprint || !cached.data()?.result) throw paidRequestError(new Error('request_outcome_unknown'));
    }
  }

  try {
    return await firestore.runTransaction(async (transaction) => {
      const [receipt, cached, profile, deletion] = await Promise.all([transaction.get(receiptRef), transaction.get(resultRef), transaction.get(profileRef), transaction.get(deletionRef)]);
      if (!profile.exists || deletion.exists) throw new Error('account_deleting');
      const prior = receipt.data();
      if (!prior || prior.userId !== uid || prior.environment !== config.environment || prior.fingerprint !== fingerprint || cached.data()?.userId !== uid || cached.data()?.billingEnvironment !== config.environment || cached.data()?.fingerprint !== fingerprint) throw new Error('request_id_conflict');
      const result = validateCoachHelpResult(cached.data()?.result, request.category);
      if (prior.status === 'completed') return result;
      if (prior.status !== 'processing' || typeof prior.windowPath !== 'string') throw new Error('request_outcome_unknown');
      const chargedWindowRef = firestore.doc(prior.windowPath);
      // Internal path must belong to this exact account and environment.
      if (!prior.windowPath.startsWith(`${account.accountRef.path}/windows/`)) throw new Error('request_id_conflict');
      const usage = await transaction.get(chargedWindowRef);
      const ledger = readLedger(usage.data(), uid, chargedWindowRef.id);
      if (prior.billable === true) transaction.set(chargedWindowRef, finishCoachAiPaidGuide(ledger, 'fulfilled'), { merge: true });
      transaction.update(receiptRef, { status: 'completed', leaseUntilMs: 0, completedAt: FieldValue.serverTimestamp() });
      // Start retention atomically with quota/receipt completion, never while
      // an uncertain reservation still needs this response for reconciliation.
      transaction.update(resultRef, { status: 'completed', completedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + COMPLETED_RESPONSE_RETENTION_MS) });
      return result;
    }, { maxAttempts: 1 });
  } catch (error) { throw paidRequestError(error); }
});

function readLedger(data: FirebaseFirestore.DocumentData | undefined, uid: string, windowId: string): CoachAiUsageLedger {
  if (data && (data.accountUid !== uid || data.windowId !== windowId || data.limit !== 30)) throw new Error('invalid_usage_ledger');
  return { accountUid: uid, windowId, limit: COACH_AI_INCLUDED_RESPONSES_PER_MONTH,
    fulfilled: data?.fulfilled ?? 0, reserved: data?.reserved ?? 0 };
}
function paidRequestError(error: unknown) {
  const reason = error instanceof Error ? error.message : 'billing_confirmation_pending';
  const code = ['coach_ai_allowance_exhausted', 'rate_limited'].includes(reason) ? 'resource-exhausted'
    : reason === 'request_id_conflict' ? 'already-exists' : 'unavailable';
  const allowed = ['coach_ai_allowance_exhausted', 'rate_limited', 'request_id_conflict', 'request_in_progress', 'request_outcome_unknown', 'response_no_longer_cached'];
  return new functions.https.HttpsError(code, 'Coach AI could not complete this request.', { reason: allowed.includes(reason) ? reason : 'billing_confirmation_pending' });
}
