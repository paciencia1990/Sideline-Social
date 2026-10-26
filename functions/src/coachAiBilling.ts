import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
import * as firebaseFunctions from 'firebase-functions/v1';
import { permanentAccountFunctions, requireAccountCapability } from './permanentAuth';
import { requireCoachAiRuntimeEnabled } from './coachAiRuntime';
import { billingDocumentId, coachAiMonthlyWindow, parseBillingWebhook, verifyRevenueCatWebhook, type BillingEnvironment, type VerifiedBillingSnapshot } from './coachAiBillingCore';
import { COACH_AI_INCLUDED_RESPONSES_PER_MONTH, resolveCoachAiPaidAccess, type VerifiedCoachAiSubscription } from './coachAiSubscriptionCore';
import { lookupRevenueCatV2, parseRevenueCatV2Config, revenueCatRuntimeIdentities, coachAiRuntimeIdentity, REVENUECAT_V2_PROJECT_ID, REVENUECAT_VERIFICATION_SECRET, type RevenueCatV2Config } from './coachAiRevenueCatV2';
import { assertCoachAiWebhookAttemptActive, coachAiWebhookMode, coachAiWebhookSecrets, COACH_AI_WEBHOOK_DEADLINE_MS, REVENUECAT_WEBHOOK_AUTH_SECRET, REVENUECAT_WEBHOOK_SIGNING_SECRET, verifyCoachAiWebhookAuthorization } from './coachAiWebhookCore';
import { billingEnrollmentRef, enrollCoachAiBilling } from './coachAiBillingEnrollment';
import { COACH_AI_REVIEW_SANDBOX_PATH, coachAiReviewSandboxAllows, isListedCoachAiReviewer } from './coachAiReviewSandbox';

const functions = permanentAccountFunctions(firebaseFunctions, 'app');
const billingFunctions = functions.region('us-central1').runWith({
  secrets: [REVENUECAT_VERIFICATION_SECRET], serviceAccount: coachAiRuntimeIdentity('reader'),
  timeoutSeconds: 30, memory: '256MB', enforceAppCheck: true,
});
const PROJECT_ID = 'ec5f2a61';
export type CoachAiBillingConfig = RevenueCatV2Config & { enabled: true; appIds: string[] };

async function readBaseCoachAiBillingConfig() {
  if (process.env.COACH_AI_PAID_ENABLED !== 'true' || process.env.REVENUECAT_PROJECT_ID !== PROJECT_ID
    || process.env.REVENUECAT_API_V2_PROJECT_ID !== REVENUECAT_V2_PROJECT_ID || !revenueCatRuntimeIdentities()) return null;
  const environment = process.env.COACH_AI_BILLING_ENVIRONMENT;
  if (environment !== 'production' && environment !== 'sandbox') return null;
  const config = await getFirestore().doc('coachAiInternalConfig/billing').get();
  const data = config.data();
  if (data?.enabled !== true || data.environment !== environment || data.projectId !== PROJECT_ID
    || data.restorePolicy !== 'keep_original' || data.salesCountry !== 'US' || data.storeConnectionsVerified !== true
    || data.allowance !== COACH_AI_INCLUDED_RESPONSES_PER_MONTH
    || !Array.isArray(data.appIds) || data.appIds.length !== 2
    || data.appIds.some((value: unknown) => typeof value !== 'string' || !/^app[a-zA-Z0-9]+$/.test(value))) return null;
  const provider = parseRevenueCatV2Config(data, environment, data.appIds);
  return provider ? { config: { ...provider, enabled: true as const, appIds: data.appIds as string[] }, data } : null;
}

// The caller cannot submit an environment. A dedicated server claim AND an
// expiring server allowlist are required to use review sandbox during launch.
// No-context reads are for the internal gateway's global availability check.
export async function readCoachAiBillingConfig(context?: firebaseFunctions.https.CallableContext): Promise<CoachAiBillingConfig | null> {
  const base = await readBaseCoachAiBillingConfig();
  if (!base || !context || base.config.environment === 'sandbox') return base?.config ?? null;
  if (!context.auth) return null;
  const { uid, token } = context.auth;
  const policy = (await getFirestore().doc(COACH_AI_REVIEW_SANDBOX_PATH).get()).data();
  if (token.aiCoachBillingTester !== true && !isListedCoachAiReviewer(policy, uid)) return base.config;
  if (process.env.COACH_AI_REVIEW_SANDBOX_ENABLED !== 'true' || token.aiCoachBillingTester !== true
    || token.aiCoachTester === true || !coachAiReviewSandboxAllows(policy, [uid], Date.now())) {
    throw new firebaseFunctions.https.HttpsError('permission-denied', 'Billing review access is unavailable.', { reason: 'billing_review_unavailable' });
  }
  const provider = parseRevenueCatV2Config(base.data, 'sandbox', base.config.appIds);
  return provider ? { ...provider, enabled: true, appIds: base.config.appIds } : null;
}

// Called only after bearer and raw-body HMAC verification. The signed event's
// environment must match an enabled server route; verification never falls
// back to another environment after a failed or missing subscription lookup.
export async function readCoachAiBillingWebhookScope(body: unknown) {
  const base = await readBaseCoachAiBillingConfig();
  if (!base) return null;
  const eventData = body != null && typeof body === 'object' && 'event' in body ? body.event : null;
  const reviewSandbox = base.config.environment === 'production' && eventData != null
    && typeof eventData === 'object' && 'environment' in eventData && eventData.environment === 'SANDBOX';
  const environment = reviewSandbox ? 'sandbox' : base.config.environment;
  const event = parseBillingWebhook(body, environment, base.config.appIds);
  if (reviewSandbox) {
    if (process.env.COACH_AI_REVIEW_SANDBOX_ENABLED !== 'true') throw new Error('webhook_scope_mismatch');
    const policy = (await getFirestore().doc(COACH_AI_REVIEW_SANDBOX_PATH).get()).data();
    // Check every TRANSFER participant, not only a retained or active account.
    // A TEST has no customer identities and still requires the active policy.
    if (!coachAiReviewSandboxAllows(policy, event.uids, Date.now())) throw new Error('webhook_scope_mismatch');
  }
  const provider = parseRevenueCatV2Config(base.data, environment, base.config.appIds);
  if (!provider) throw new Error('webhook_scope_mismatch');
  return { config: { ...provider, enabled: true as const, appIds: base.config.appIds }, event };
}

export async function requirePaidCoachContext(uid: string, context: firebaseFunctions.https.CallableContext, config: CoachAiBillingConfig) {
  await requireAccountCapability(uid, 'communication');
  if (!context.app) throw new firebaseFunctions.https.HttpsError('failed-precondition', 'App verification is required.', { reason: 'app_check_required' });
  if (config.environment === 'sandbox' && (context.auth?.token.aiCoachBillingTester !== true || context.auth?.token.aiCoachTester === true)) {
    throw new firebaseFunctions.https.HttpsError('permission-denied', 'A dedicated billing test account is required.', { reason: 'billing_tester_required' });
  }
  const profile = await getFirestore().doc(`users/${uid}`).get();
  if (!profile.exists || profile.data()?.adultEligibilityConfirmed !== true || profile.data()?.activeMode !== 'coach') {
    throw new firebaseFunctions.https.HttpsError('permission-denied', 'Adult Coach Mode is required.', { reason: 'adult_coach_mode_required' });
  }
  if ((await billingEnrollmentRef(uid).get()).data()?.state === 'deleting') {
    throw new firebaseFunctions.https.HttpsError('permission-denied', 'Account deletion is in progress.', { reason: 'account_deleting' });
  }
}

export const prepareCoachAiBilling = billingFunctions.https.onCall(async (data, context) => {
  if (data == null || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length) {
    throw new firebaseFunctions.https.HttpsError('invalid-argument', 'No enrollment data is accepted.');
  }
  const uid = context.auth!.uid;
  const config = await readCoachAiBillingConfig(context);
  if (!config || !await requireCoachAiRuntimeEnabled(getFirestore())) {
    throw new firebaseFunctions.https.HttpsError('failed-precondition', 'Billing is unavailable.', { reason: 'billing_unavailable' });
  }
  await requirePaidCoachContext(uid, context, config);
  await enrollCoachAiBilling(uid, config.environment);
  return { userId: uid, prepared: true };
});

// Read the same fence that deletion writes. A concurrent deletion must either
// invalidate this transaction or observe its committed records in cleanup.
async function canRetainBillingIdentity(transaction: FirebaseFirestore.Transaction, uid: string) {
  const [profile, enrollment, deletion] = await Promise.all([
    transaction.get(getFirestore().doc(`users/${uid}`)),
    transaction.get(billingEnrollmentRef(uid)),
    transaction.get(getFirestore().doc(`coachAiBillingDeletionQueue/${createHash('sha256').update(uid).digest('hex')}`)),
  ]);
  return profile.exists && enrollment.data()?.state !== 'deleting' && !deletion.exists;
}

export async function verifyCoachAiSubscription(uid: string, config: CoachAiBillingConfig, signal?: AbortSignal) {
  assertCoachAiWebhookAttemptActive(signal);
  const deletionRef = getFirestore().doc(`coachAiBillingDeletionQueue/${createHash('sha256').update(uid).digest('hex')}`);
  if ((await deletionRef.get()).exists || (await billingEnrollmentRef(uid).get()).data()?.state === 'deleting') throw new firebaseFunctions.https.HttpsError('permission-denied', 'Account deletion is in progress.', { reason: 'account_deleting' });
  assertCoachAiWebhookAttemptActive(signal);
  const key = process.env[REVENUECAT_VERIFICATION_SECRET]?.trim();
  if (!key || !key.startsWith('sk_')) throw new firebaseFunctions.https.HttpsError('failed-precondition', 'Purchases are not configured.', { reason: 'billing_unavailable' });
  const rateRef = getFirestore().doc(`coachAiBillingVerificationRates/${billingDocumentId(config.environment, uid)}`);
  await getFirestore().runTransaction(async (transaction) => {
    const [rate, retainIdentity] = await Promise.all([
      transaction.get(rateRef), canRetainBillingIdentity(transaction, uid),
    ]);
    assertCoachAiWebhookAttemptActive(signal);
    if (!retainIdentity) throw new firebaseFunctions.https.HttpsError('permission-denied', 'Account is unavailable.', { reason: 'account_deleting' });
    const now = Date.now();
    const times: number[] = Array.isArray(rate.data()?.times) ? rate.data()!.times.filter((value: unknown) => typeof value === 'number' && value > now - 3600000 && value <= now) : [];
    if (times.length >= 120) throw new firebaseFunctions.https.HttpsError('resource-exhausted', 'Purchase status checks are temporarily limited.', { reason: 'rate_limited' });
    transaction.set(rateRef, { userId: uid, times: [...times, now], expiresAt: new Date(now + 2 * 3600000) });
  }, { maxAttempts: 1 }).catch(billingTransactionFailure);
  assertCoachAiWebhookAttemptActive(signal);
  let snapshot: VerifiedBillingSnapshot;
  try {
    snapshot = await lookupRevenueCatV2(uid, config, key, { signal });
  } catch (error) {
    const reason = error instanceof Error && error.message === 'billing_account_mismatch' ? 'billing_account_mismatch' : 'billing_verification_unavailable';
    throw new firebaseFunctions.https.HttpsError(reason === 'billing_account_mismatch' ? 'permission-denied' : 'unavailable', 'Purchase verification is unavailable.', { reason });
  }
  assertCoachAiWebhookAttemptActive(signal);
  const accountRef = getFirestore().doc(`coachAiBillingAccounts/${billingDocumentId(config.environment, uid)}`);
  const saved = await getFirestore().runTransaction(async (transaction) => {
    const [existing, profile, deletion, enrollment] = await Promise.all([transaction.get(accountRef), transaction.get(getFirestore().doc(`users/${uid}`)), transaction.get(deletionRef), transaction.get(billingEnrollmentRef(uid))]);
    assertCoachAiWebhookAttemptActive(signal);
    if (!profile.exists || deletion.exists || enrollment.data()?.state === 'deleting') throw new firebaseFunctions.https.HttpsError('permission-denied', 'Account is unavailable.', { reason: 'account_deleting' });
    const data = existing.data();
    if (existing.exists && (data?.userId !== uid || data.environment !== config.environment)) {
      throw new firebaseFunctions.https.HttpsError('unavailable', 'Stored purchase identity could not be verified.', { reason: 'billing_verification_unavailable' });
    }
    // Never fall back to an older active entitlement when a fresh lookup fails
    // or is superseded. Equal-time identical lookups are safe to share.
    const fingerprint = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    if (data?.protocolVersion === 2 && typeof data.checkedAtMs === 'number'
      && (data.checkedAtMs > snapshot.checkedAtMs || data.checkedAtMs === snapshot.checkedAtMs && data.verificationFingerprint !== fingerprint)) {
      throw new firebaseFunctions.https.HttpsError('unavailable', 'Purchase status changed during verification.', { reason: 'billing_verification_unavailable' });
    }
    const anchorMs = typeof data?.anchorMs === 'number' ? data.anchorMs : snapshot.originalPurchaseAtMs;
    if (anchorMs != null && (!Number.isSafeInteger(anchorMs) || anchorMs <= 0 || anchorMs > Date.now())) {
      throw new firebaseFunctions.https.HttpsError('unavailable', 'Usage verification is unavailable.', { reason: 'billing_verification_unavailable' });
    }
    const next = { userId: uid, environment: config.environment, checkedAtMs: snapshot.checkedAtMs,
      protocolVersion: 2, verificationFingerprint: fingerprint, vendorCustomerExists: snapshot.customerExists,
      subscription: snapshot.subscription, anchorMs, updatedAt: FieldValue.serverTimestamp() };
    transaction.set(accountRef, next);
    return next;
  }, { maxAttempts: 1 }).catch(billingTransactionFailure);
  assertCoachAiWebhookAttemptActive(signal);
  return { ...saved, accountRef, subscription: (saved.subscription ?? null) as VerifiedCoachAiSubscription | null,
    anchorMs: typeof saved.anchorMs === 'number' ? saved.anchorMs : null };
}

function billingTransactionFailure(error: unknown): never {
  if (error instanceof firebaseFunctions.https.HttpsError) throw error;
  throw new firebaseFunctions.https.HttpsError('unavailable', 'Purchase status could not be verified.', { reason: 'billing_verification_unavailable' });
}

export async function requireVerifiedCoachAiSubscription(uid: string, context: firebaseFunctions.https.CallableContext) {
  const config = await readCoachAiBillingConfig(context);
  if (!config || !await requireCoachAiRuntimeEnabled(getFirestore())) {
    throw new firebaseFunctions.https.HttpsError('failed-precondition', 'Paid Coach AI is not available.', { reason: 'billing_unavailable' });
  }
  await requirePaidCoachContext(uid, context, config);
  const account = await verifyCoachAiSubscription(uid, config);
  const decision = resolveCoachAiPaidAccess({ paidEnabled: true, accountUid: uid, adultEligible: true,
    activeMode: 'coach', accountStanding: 'active', environment: config.environment,
    subscription: account.subscription, nowMs: Date.now(), maxVerificationAgeMs: 300_000 });
  if (!decision.entitled || !account.anchorMs) throw new firebaseFunctions.https.HttpsError('permission-denied', 'An active Coach AI subscription is required.', { reason: 'paid_entitlement_required' });
  return { config, account, decision };
}

export const getCoachAiBillingStatus = billingFunctions.https.onCall(async (data, context) => {
  if (data == null || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length) {
    throw new firebaseFunctions.https.HttpsError('invalid-argument', 'No purchase data is accepted.', { reason: 'invalid_billing_request' });
  }
  const uid = context.auth!.uid;
  const config = await readCoachAiBillingConfig(context);
  const disabled = { userId: uid, enabled: false, entitled: false, plan: null, remaining: 0, pending: 0, limit: 30, resetsAtMs: null, accessUntilMs: null, store: null, autoRenews: false };
  if (!config || !await requireCoachAiRuntimeEnabled(getFirestore())) return disabled;
  await requirePaidCoachContext(uid, context, config);
  const account = await verifyCoachAiSubscription(uid, config);
  const decision = resolveCoachAiPaidAccess({ paidEnabled: true, accountUid: uid, adultEligible: true,
    activeMode: 'coach', accountStanding: 'active', environment: config.environment,
    subscription: account.subscription, nowMs: Date.now(), maxVerificationAgeMs: 300_000 });
  const window = account.anchorMs ? coachAiMonthlyWindow(account.anchorMs, Date.now()) : null;
  const usage = window ? (await account.accountRef.collection('windows').doc(window.id).get()).data() : null;
  const fulfilled = Number(usage?.fulfilled ?? 0);
  const pending = Number(usage?.reserved ?? 0);
  if (!Number.isSafeInteger(fulfilled) || !Number.isSafeInteger(pending) || fulfilled < 0 || pending < 0 || fulfilled + pending > 30
    || usage && (usage.accountUid !== uid || usage.windowId !== window?.id || usage.limit !== 30)) {
    throw new firebaseFunctions.https.HttpsError('unavailable', 'Usage verification is unavailable.', { reason: 'billing_confirmation_pending' });
  }
  return { userId: uid, enabled: true, entitled: decision.entitled, plan: decision.plan,
    remaining: decision.entitled ? Math.max(0, 30 - fulfilled - pending) : 0,
    pending, limit: 30, resetsAtMs: window?.resetsAtMs ?? null,
    accessUntilMs: account.subscription?.paidThroughMs ?? null,
    store: account.subscription?.store ?? null, autoRenews: account.subscription?.autoRenews ?? false };
});

// Setup mode is secret-authenticated and cannot process billing. Signed mode
// requires both the bearer token and raw-body HMAC, with no fallback. One
// durable claim guards reconciliation; errors/deadlines need manual review.
export const coachAiRevenueCatWebhook = firebaseFunctions.region('us-central1').runWith({
  secrets: coachAiWebhookSecrets(REVENUECAT_VERIFICATION_SECRET),
  serviceAccount: coachAiRuntimeIdentity('webhook'), timeoutSeconds: 60, memory: '256MB',
}).https.onRequest(async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const mode = coachAiWebhookMode();
  if (request.method !== 'POST' || !mode || !Buffer.isBuffer(request.rawBody) || request.rawBody.length > 128 * 1024
    || !verifyCoachAiWebhookAuthorization(request.get('authorization'), process.env[REVENUECAT_WEBHOOK_AUTH_SECRET] ?? '')
    || mode === 'signed' && !verifyRevenueCatWebhook(request.rawBody, request.get('x-revenuecat-webhook-signature'), process.env[REVENUECAT_WEBHOOK_SIGNING_SECRET] ?? '', Date.now())) {
    response.status(401).json({ received: false }); return;
  }
  if (mode === 'bootstrap' || process.env.COACH_AI_PAID_ENABLED !== 'true') {
    response.status(200).json({ received: true, disabled: true }); return;
  }
  const attempt = new AbortController();
  let replied = false;
  const reply = (body: Record<string, boolean>) => {
    if (!replied) { replied = true; response.status(200).json(body); }
  };
  let eventRef: ReturnType<ReturnType<typeof getFirestore>['doc']> | undefined;
  let claimed = false;
  const reportReview = () => firebaseFunctions.logger.error('coach_ai_billing_webhook_needs_review', {
    correlationId: randomUUID(), claimed, ...(eventRef ? { eventKey: eventRef.id } : {}),
  });
  const deadline = setTimeout(() => {
    attempt.abort(new Error('billing_webhook_deadline'));
    reportReview();
    reply({ received: true, needsReview: true });
  }, COACH_AI_WEBHOOK_DEADLINE_MS);
  try {
    let scope;
    try { scope = await readCoachAiBillingWebhookScope(JSON.parse(request.rawBody.toString('utf8'))); }
    catch { reportReview(); reply({ received: true, ignored: true, needsReview: true }); return; }
    assertCoachAiWebhookAttemptActive(attempt.signal);
    if (!scope) { reply({ received: true, disabled: true }); return; }
    const { config, event } = scope;
    eventRef = getFirestore().doc(`coachAiBillingEvents/${createHash('sha256').update(`${config.environment}:${event.id}`).digest('hex')}`);
    const target = eventRef;
    const retainedUids = await getFirestore().runTransaction(async (transaction) => {
      const previous = await transaction.get(target);
      assertCoachAiWebhookAttemptActive(attempt.signal);
      if (previous.exists) return null;
      const retainIdentity = await Promise.all(event.uids.map(uid => canRetainBillingIdentity(transaction, uid)));
      assertCoachAiWebhookAttemptActive(attempt.signal);
      const userIds = event.uids.filter((_, index) => retainIdentity[index]);
      // A timeout/crash leaves a review record, even if the claim commits after
      // its HTTP acknowledgement. No duplicate delivery restarts this attempt.
      transaction.create(target, { eventId: event.id, type: event.type, environment: config.environment,
        status: 'needs_review', attemptState: 'processing', userIds, receivedAt: FieldValue.serverTimestamp() });
      return userIds;
    }, { maxAttempts: 1 });
    claimed = retainedUids !== null;
    assertCoachAiWebhookAttemptActive(attempt.signal);
    if (retainedUids === null) { reply({ received: true, duplicate: true }); return; }
    for (const uid of retainedUids) {
      assertCoachAiWebhookAttemptActive(attempt.signal);
      try {
        await verifyCoachAiSubscription(uid, config, attempt.signal);
      } catch (error) {
        // Deletion may start after the event claim. Its cleanup removes this
        // UID; keep reconciling other active participants in transfer events.
        if (!(error instanceof firebaseFunctions.https.HttpsError)
          || !error.details || typeof error.details !== 'object'
          || !('reason' in error.details) || error.details.reason !== 'account_deleting') throw error;
      }
    }
    assertCoachAiWebhookAttemptActive(attempt.signal);
    await target.update({ status: 'completed', attemptState: 'completed', completedAt: FieldValue.serverTimestamp() });
    assertCoachAiWebhookAttemptActive(attempt.signal);
    reply({ received: true });
  } catch {
    if (!replied) reportReview();
    reply({ received: true, needsReview: true });
  } finally { clearTimeout(deadline); }
});
