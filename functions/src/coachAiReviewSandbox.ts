import { createHash } from 'node:crypto';

export const COACH_AI_REVIEW_SANDBOX_PATH = 'coachAiInternalConfig/reviewSandbox';
const MAX_REVIEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function identityHash(uid: string) {
  return createHash('sha256').update(uid).digest('hex');
}

// Listed review identities remain quarantined from real billing after expiry
// or disablement. Removing their claim alone must not select production.
export function isListedCoachAiReviewer(value: unknown, uid: string) {
  const hashes = record(value)?.reviewerUidHashes;
  return Array.isArray(hashes) && hashes.includes(identityHash(uid));
}

/** Server-owned, short-lived scope; no client or signed event can extend it. */
export function coachAiReviewSandboxAllows(value: unknown, uids: string[], nowMs: number) {
  const data = record(value);
  if (!data || data.enabled !== true || data.projectId !== 'ec5f2a61' || data.environment !== 'sandbox'
    || !Number.isSafeInteger(nowMs) || nowMs <= 0
    || !Number.isSafeInteger(data.startsAtMs) || !Number.isSafeInteger(data.expiresAtMs)) return false;
  const startsAtMs = Number(data.startsAtMs), expiresAtMs = Number(data.expiresAtMs);
  const hashes = data.reviewerUidHashes;
  if (startsAtMs <= 0 || startsAtMs > nowMs || expiresAtMs <= nowMs
    || expiresAtMs <= startsAtMs || expiresAtMs - startsAtMs > MAX_REVIEW_WINDOW_MS
    || !Array.isArray(hashes) || hashes.length < 1 || hashes.length > 4
    || hashes.some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))
    || new Set(hashes).size !== hashes.length) return false;
  return uids.every(uid => /^[A-Za-z0-9_-]{1,128}$/.test(uid) && hashes.includes(identityHash(uid)));
}
