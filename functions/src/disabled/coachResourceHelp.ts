/**
 * ISOLATED / NOT EXPORTED
 *
 * This unfinished Coach AI provider implementation is retained for future
 * development. Nothing in the active Functions entry graph may import it.
 * See docs/coach-ai-backend-enablement.md before re-enabling it.
 */
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
} from '../coachResourceHelpCore';
import { permanentAccountFunctions } from '../permanentAuth';

const functions = permanentAccountFunctions(firebaseFunctions);
const coachHelpFunctions = functions.region('us-central1').runWith({
  secrets: ['COACH_AI_API_KEY', 'COACH_AI_ENDPOINT'],
  timeoutSeconds: 30,
  memory: '256MB',
});
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const PROVIDER_ATTEMPT_TIMEOUT_MS = 9_000;
const PROVIDER_MAX_ATTEMPTS = 2;

export const generateCoachResourceHelp = coachHelpFunctions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in is required.', { reason: 'auth_required' });

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
  const existing = await requestRef.get();
  if (existing.exists) {
    if (existing.data()?.fingerprint !== fingerprint) {
      throw new functions.https.HttpsError('already-exists', 'This request identifier was already used.', { reason: 'request_id_conflict' });
    }
    const priorResult = existing.data()?.result;
    if (priorResult) return priorResult;
  }

  await enforceRateLimit(firestore, uid);

  let result;
  if (isCoachHelpSafetySensitive(request)) {
    result = createCoachHelpSafetyResult(request.locale);
  } else {
    result = await requestProviderResult(request);
  }

  await requestRef.set({
    userId: uid,
    clientRequestId: request.clientRequestId,
    category: request.category,
    locale: request.locale,
    fingerprint,
    result,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  functions.logger.info('coach_ai_help_completed', {
    category: request.category,
    resultType: result.resultType,
    safetyEscalation: isCoachHelpSafetySensitive(request),
  });
  return result;
});

async function enforceRateLimit(firestore: FirebaseFirestore.Firestore, uid: string) {
  const ref = firestore.collection('coachAiRateLimits').doc(uid);
  try {
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const now = Date.now();
      const windowStart = snapshot.data()?.windowStart?.toMillis?.() ?? 0;
      const withinWindow = now - windowStart < RATE_LIMIT_WINDOW_MS;
      const count = withinWindow ? Number(snapshot.data()?.count ?? 0) : 0;
      if (count >= RATE_LIMIT_MAX) throw new Error('rate_limited');
      transaction.set(ref, {
        windowStart: Timestamp.fromMillis(withinWindow ? windowStart : now),
        count: count + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'rate_limited') {
      throw new functions.https.HttpsError('resource-exhausted', 'Please wait before requesting more help.', { reason: 'rate_limited' });
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
        headers: { 'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ request }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`provider_status_${response.status}`);
      const payload = await response.json() as { result?: unknown } | unknown;
      const candidate = payload && typeof payload === 'object' && 'result' in payload ? payload.result : payload;
      return validateCoachHelpResult(candidate, request.category);
    } catch (error) {
      const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'provider_error';
      if (attempt < PROVIDER_MAX_ATTEMPTS && isTransientProviderError(error)) continue;
      functions.logger.warn('coach_ai_help_failed', { category: request.category, reason });
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
