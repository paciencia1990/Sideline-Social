import { createHash, randomUUID } from 'node:crypto';

import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as firebaseFunctions from 'firebase-functions';
import {
  createCoachHelpSafetyResult,
  isCoachHelpSafetySensitive,
  validateCoachHelpRequest,
  validateCoachHelpResult,
  type ValidatedCoachHelpRequest,
  type ValidatedCoachHelpResult,
} from './coachResourceHelpCore';
import { normalizeCoachAiSharedSecret } from './coachAiClaudeGatewayCore';
import { requireCoachAiRuntimeEnabled } from './coachAiRuntime';
import { permanentAccountFunctions } from './permanentAuth';

const functions = permanentAccountFunctions(firebaseFunctions, 'communication');
const coachHelpFunctions = functions.region('us-central1').runWith({
  secrets: ['COACH_AI_API_KEY', 'COACH_AI_ENDPOINT'],
  timeoutSeconds: 60,
  memory: '256MB',
});

const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_RETENTION_MS = 48 * 60 * 60 * 1000;
const REQUEST_RETENTION_MS = 24 * 60 * 60 * 1000;
const REQUEST_LEASE_MS = 70_000;
const PROVIDER_ATTEMPT_TIMEOUT_MS = 22_000;
const PROVIDER_MAX_ATTEMPTS = 2;
const PROVIDER_MAX_RESPONSE_BYTES = 128_000;

type Reservation =
  | { result: ValidatedCoachHelpResult; reserved: false }
  | { reserved: true };

/**
 * Development/test backend only. Production remains closed unless the exact
 * server flag is enabled and an administrator grants the tester custom claim.
 */
export const generateCoachResourceHelp = coachHelpFunctions.https.onCall(async (data, context) => {
  const startedAt = Date.now();
  const correlationId = randomUUID();
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in is required.', { reason: 'auth_required' });
  }

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

  let request: ValidatedCoachHelpRequest;
  try {
    request = validateCoachHelpRequest(data);
  } catch (error) {
    throw new functions.https.HttpsError('invalid-argument', 'The request could not be validated.', {
      reason: error instanceof Error ? error.message : 'invalid_request',
    });
  }

  const requestRef = firestore.collection('coachAiRequests').doc(`${uid}_${request.clientRequestId}`);
  const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const reservation = await reserveRequest(firestore, requestRef, uid, request, fingerprint);
  if (!reservation.reserved) return reservation.result;

  const modelIdentifier = process.env.COACH_AI_MODEL_ID?.trim() || 'provider-managed';
  try {
    const safetyEscalation = isCoachHelpSafetySensitive(request);
    const result = safetyEscalation
      ? createCoachHelpSafetyResult(request.locale)
      : await requestProviderResult(request);

    await requestRef.set({
      status: 'completed',
      result,
      modelIdentifier: safetyEscalation ? 'local-safety' : modelIdentifier,
      completedAt: FieldValue.serverTimestamp(),
      leaseUntil: FieldValue.delete(),
      lastFailureReason: FieldValue.delete(),
    }, { merge: true });
    functions.logger.info('coach_ai_help_completed', {
      correlationId,
      stage: safetyEscalation ? 'local_safety_response' : 'provider_response',
      category: request.category,
      locale: request.locale,
      durationMs: Date.now() - startedAt,
      modelIdentifier: safetyEscalation ? 'local-safety' : modelIdentifier,
      outcome: 'completed',
    });
    return result;
  } catch (error) {
    const reason = sanitizedFailureReason(error);
    await requestRef.set({
      status: 'failed',
      failedAt: FieldValue.serverTimestamp(),
      leaseUntil: FieldValue.delete(),
      lastFailureReason: reason,
    }, { merge: true }).catch(() => undefined);
    functions.logger.warn('coach_ai_help_failed', {
      correlationId,
      stage: 'provider_request',
      category: request.category,
      locale: request.locale,
      durationMs: Date.now() - startedAt,
      modelIdentifier,
      outcome: reason,
    });
    throw error;
  }
});

function serverTestingEnabled() {
  return process.env.COACH_AI_TESTING_ENABLED === 'true' || process.env.FUNCTIONS_EMULATOR === 'true';
}

async function reserveRequest(
  firestore: FirebaseFirestore.Firestore,
  requestRef: FirebaseFirestore.DocumentReference,
  uid: string,
  request: ValidatedCoachHelpRequest,
  fingerprint: string,
): Promise<Reservation> {
  const rateRef = firestore.collection('coachAiRateLimits').doc(uid);
  try {
    return await firestore.runTransaction(async (transaction) => {
      const [existing, rateSnapshot] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(rateRef),
      ]);
      const now = Date.now();
      const existingData = existing.data();
      if (existing.exists) {
        if (existingData?.fingerprint !== fingerprint) throw new Error('request_id_conflict');
        if (existingData?.result) return { result: existingData.result as ValidatedCoachHelpResult, reserved: false };
        const leaseUntil = existingData?.leaseUntil?.toMillis?.() ?? 0;
        if (leaseUntil > now) throw new Error('request_in_progress');
        transaction.set(requestRef, {
          status: 'processing',
          leaseUntil: Timestamp.fromMillis(now + REQUEST_LEASE_MS),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return { reserved: true };
      }

      const requestTimes = readRollingRequestTimes(rateSnapshot.data(), now);
      if (requestTimes.length >= RATE_LIMIT_MAX) throw new Error('rate_limited');
      const nextRequestTimes = [...requestTimes, now];

      transaction.set(rateRef, {
        userId: uid,
        windowStart: Timestamp.fromMillis(nextRequestTimes[0]),
        requestTimes: nextRequestTimes.map((value) => Timestamp.fromMillis(value)),
        count: nextRequestTimes.length,
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(now + RATE_LIMIT_RETENTION_MS),
      });
      transaction.set(requestRef, {
        userId: uid,
        clientRequestId: request.clientRequestId,
        category: request.category,
        locale: request.locale,
        fingerprint,
        status: 'processing',
        leaseUntil: Timestamp.fromMillis(now + REQUEST_LEASE_MS),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(now + REQUEST_RETENTION_MS),
      });
      return { reserved: true };
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'reservation_failed';
    if (reason === 'rate_limited') {
      throw new functions.https.HttpsError('resource-exhausted', 'Please wait before requesting more help.', { reason });
    }
    if (reason === 'request_id_conflict') {
      throw new functions.https.HttpsError('already-exists', 'This request identifier was already used.', { reason });
    }
    if (reason === 'request_in_progress') {
      throw new functions.https.HttpsError('aborted', 'This request is already being processed.', { reason });
    }
    throw error;
  }
}

async function requestProviderResult(request: ValidatedCoachHelpRequest) {
  const endpoint = process.env.COACH_AI_ENDPOINT?.trim();
  const apiKey = normalizeCoachAiSharedSecret(process.env.COACH_AI_API_KEY ?? '');
  if (!endpoint || !apiKey || !endpoint.startsWith('https://')) {
    throw new functions.https.HttpsError('failed-precondition', 'Coach assistance is not configured.', { reason: 'provider_unavailable' });
  }

  for (let attempt = 1; attempt <= PROVIDER_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_ATTEMPT_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ request }),
        signal: controller.signal,
      });
      const declaredLength = Number(response.headers.get('content-length') ?? 0);
      if (declaredLength > PROVIDER_MAX_RESPONSE_BYTES) throw new Error('provider_response_too_large');
      const body = await response.text();
      if (Buffer.byteLength(body, 'utf8') > PROVIDER_MAX_RESPONSE_BYTES) throw new Error('provider_response_too_large');
      if (!response.ok) throw readGatewayFailure(response.status, body, response.headers.get('retry-after'));
      const payload = JSON.parse(body) as { result?: unknown } | unknown;
      const candidate = payload && typeof payload === 'object' && 'result' in payload ? payload.result : payload;
      return validateCoachHelpResult(candidate, request.category);
    } catch (error) {
      const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'provider_error';
      if (attempt < PROVIDER_MAX_ATTEMPTS && isTransientProviderError(error)) {
        const delayMs = error instanceof GatewayProviderError ? error.retryAfterSeconds * 1000 : 0;
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      if (error instanceof GatewayProviderError && error.configurationFailure) {
        throw new functions.https.HttpsError('failed-precondition', 'Coach assistance is not configured.', { reason: error.code });
      }
      throw new functions.https.HttpsError('unavailable', 'Coach assistance is unavailable right now.', {
        reason: error instanceof GatewayProviderError ? error.code : reason,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new functions.https.HttpsError('unavailable', 'Coach assistance is unavailable right now.', { reason: 'provider_error' });
}

function isTransientProviderError(error: unknown) {
  if (error instanceof GatewayProviderError) return error.retryable;
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError' || error instanceof TypeError) return true;
  return false;
}

class GatewayProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds: number,
    readonly configurationFailure: boolean,
  ) {
    super(code);
    this.name = 'GatewayProviderError';
  }
}

function readGatewayFailure(status: number, body: string, retryAfterHeader: string | null) {
  let code = 'provider_error';
  let retryable = status === 408 || status === 409 || status === 429 || status >= 500;
  let retryAfterSeconds = cappedRetryAfter(retryAfterHeader);
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; retryable?: unknown; retryAfterSeconds?: unknown } };
    if (typeof parsed.error?.code === 'string' && /^[a-z0-9_]{1,80}$/.test(parsed.error.code)) code = parsed.error.code;
    if (typeof parsed.error?.retryable === 'boolean') retryable = parsed.error.retryable;
    if (typeof parsed.error?.retryAfterSeconds === 'number') retryAfterSeconds = Math.min(2, Math.max(0, Math.ceil(parsed.error.retryAfterSeconds)));
  } catch {
    // The gateway body is deliberately not surfaced. Status-only classification remains safe.
  }
  const configurationFailure = status === 401 || status === 424;
  return new GatewayProviderError(code, retryable && !configurationFailure, retryAfterSeconds, configurationFailure);
}

function cappedRetryAfter(value: string | null) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(2, Math.ceil(seconds)) : 0;
}

function readRollingRequestTimes(data: FirebaseFirestore.DocumentData | undefined, now: number) {
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const stored = Array.isArray(data?.requestTimes)
    ? data.requestTimes
      .map((value: unknown) => value instanceof Timestamp ? value.toMillis() : 0)
      .filter((value: number) => value > cutoff && value <= now)
      .sort((left: number, right: number) => left - right)
      .slice(-RATE_LIMIT_MAX)
    : [];
  if (stored.length > 0) return stored;

  // Preserve a legacy fixed-window record conservatively during migration.
  const legacyWindowStart = data?.windowStart instanceof Timestamp ? data.windowStart.toMillis() : 0;
  const legacyCountValue = data?.count;
  const legacyCount = Number.isInteger(legacyCountValue)
    ? Math.max(0, Math.min(RATE_LIMIT_MAX, Number(legacyCountValue)))
    : 0;
  if (legacyWindowStart > cutoff && legacyWindowStart <= now && legacyCount > 0) {
    return Array.from({ length: legacyCount }, () => legacyWindowStart);
  }
  return [];
}

function sanitizedFailureReason(error: unknown) {
  if (error instanceof functions.https.HttpsError) {
    const details = error.details;
    if (details && typeof details === 'object' && 'reason' in details) return String(details.reason).slice(0, 80);
    return error.code;
  }
  return 'internal';
}
