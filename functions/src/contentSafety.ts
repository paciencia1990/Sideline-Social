import * as functions from 'firebase-functions';

const BLOCKED_CONTENT_PATTERNS = [
  /\bkill\s+(?:yourself|urself|your\s*self)\b/iu,
  /\bgo\s+die\b/iu,
  /\b(?:child|minor|kid)\s+(?:porn|nudes?)\b/iu,
  /\b(?:send|share|post)\s+(?:your|a)\s+(?:home\s+)?address\b/iu,
] as const;

export function assertUserContentAllowed(...values: unknown[]) {
  const text = values
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!text) return;
  if (BLOCKED_CONTENT_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'This content cannot be posted. Revise it and try again.',
      { reason: 'content_not_allowed' },
    );
  }
}
