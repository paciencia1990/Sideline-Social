import { createHash } from 'node:crypto';

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
import { permanentAccountFunctions } from './permanentAuth';

const functions = permanentAccountFunctions(firebaseFunctions, 'communication');
const coachHelpFunctions = functions.region('us-central1').runWith({
  secrets: ['COACH_AI_API_KEY', 'COACH_AI_ENDPOINT'],
  timeoutSeconds: 30,
  memory: '256MB',
});

const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const REQUEST_RETENTION_MS = 24 * 60 * 60 * 1000;
const REQUEST_LEASE_MS = 25_000;
const PROVIDER_ATTEMPT_TIMEOUT_MS = 9_000;
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
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in is required.', { reason: 'auth_required' });
  }

  if (!serverTestingEnabled()) {
    throw new functions.https.HttpsError('failed-precondition', 'AI Coach testing is disabled.', { reason: 'server_testing_disabled' });
  }
  if (context.auth?.token.aiCoachTester !== true) {
    throw new functions.https.HttpsError('permission-denied', 'This account is not an authorized AI Coach tester.', { reason: 'tester_entitlement_required' });
  }

  const profile = await admin.firestore().collection('users').doc(uid).get();
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

  const firestore = admin.firestore();
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
      completedAt: FieldValue.serverTimestamp(),
      leaseUntil: FieldValue.delete(),
      lastFailureReason: FieldValue.delete(),
    }, { merge: true });
    functions.logger.info('coach_ai_help_completed', {
      uid,
      requestId: request.clientRequestId,
      stage: safetyEscalation ? 'local_safety_response' : 'provider_response',
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
      uid,
      requestId: request.clientRequestId,
      stage: 'provider_request',
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

      const windowStart = rateSnapshot.data()?.windowStart?.toMillis?.() ?? 0;
      const withinWindow = now - windowStart < RATE_LIMIT_WINDOW_MS;
      const count = withinWindow ? Number(rateSnapshot.data()?.count ?? 0) : 0;
      if (count >= RATE_LIMIT_MAX) throw new Error('rate_limited');

      transaction.set(rateRef, {
        windowStart: Timestamp.fromMillis(withinWindow ? windowStart : now),
        count: count + 1,
        updatedAt: FieldValue.serverTimestamp(),
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
  const apiKey = process.env.COACH_AI_API_KEY?.trim();
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
      if (!response.ok) throw new Error(`provider_status_${response.status}`);
      const declaredLength = Number(response.headers.get('content-length') ?? 0);
      if (declaredLength > PROVIDER_MAX_RESPONSE_BYTES) throw new Error('provider_response_too_large');
      const body = await response.text();
      if (Buffer.byteLength(body, 'utf8') > PROVIDER_MAX_RESPONSE_BYTES) throw new Error('provider_response_too_large');
      const payload = JSON.parse(body) as { result?: unknown } | unknown;
      const candidate = payload && typeof payload === 'object' && 'result' in payload ? payload.result : payload;
      return validateCoachHelpResult(candidate, request.category);
    } catch (error) {
      const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'provider_error';
      if (attempt < PROVIDER_MAX_ATTEMPTS && isTransientProviderError(error)) continue;
      throw new functions.https.HttpsError('unavailable', 'Coach assistance is unavailable right now.', { reason });
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new functions.https.HttpsError('unavailable', 'Coach assistance is unavailable right now.', { reason: 'provider_error' });
}

function isTransientProviderError(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError' || error instanceof TypeError) return true;
  const statusMatch = /^provider_status_(\d+)$/.exec(error.message);
  if (!statusMatch) return false;
  const status = Number(statusMatch[1]);
  return status === 408 || status === 429 || status >= 500;
}

function sanitizedFailureReason(error: unknown) {
  if (error instanceof functions.https.HttpsError) {
    const details = error.details;
    if (details && typeof details === 'object' && 'reason' in details) return String(details.reason).slice(0, 80);
    return error.code;
  }
  return 'internal';
}
