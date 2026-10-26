import { createHash, timingSafeEqual } from 'node:crypto';

export const REVENUECAT_WEBHOOK_AUTH_SECRET = 'REVENUECAT_WEBHOOK_AUTH_TOKEN';
export const REVENUECAT_WEBHOOK_SIGNING_SECRET = 'REVENUECAT_WEBHOOK_SIGNING_SECRET';
export const COACH_AI_WEBHOOK_DEADLINE_MS = 45_000;

/** The owner generates this 256-bit token privately; no credential is bundled. */
export function verifyCoachAiWebhookAuthorization(header: string | undefined, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token) || typeof header !== 'string' || header.length > 256) return false;
  return timingSafeEqual(createHash('sha256').update(header).digest(),
    createHash('sha256').update(`Bearer ${token}`).digest());
}

export function coachAiWebhookMode(environment: NodeJS.ProcessEnv = process.env) {
  const mode = environment.COACH_AI_WEBHOOK_MODE ?? 'signed';
  if (mode === 'bootstrap') return environment.COACH_AI_PAID_ENABLED === 'false' ? 'bootstrap' : null;
  return mode === 'signed' ? 'signed' : null;
}

/** Bootstrap never binds purchase credentials or enters the billing processor. */
export function coachAiWebhookSecrets(verificationSecret: string, environment: NodeJS.ProcessEnv = process.env) {
  return environment.COACH_AI_WEBHOOK_MODE === 'bootstrap'
    ? [REVENUECAT_WEBHOOK_AUTH_SECRET]
    : [REVENUECAT_WEBHOOK_AUTH_SECRET, REVENUECAT_WEBHOOK_SIGNING_SECRET, verificationSecret];
}

export function assertCoachAiWebhookAttemptActive(signal?: AbortSignal) {
  signal?.throwIfAborted();
}
