/**
 * A recovery disposition is a separately reviewed server record, not evidence
 * inferred from an empty entitlement. This validator neither approves a review
 * nor grants access. A caller may apply only this exact, still-valid sandbox
 * disposition to the local marker with the matching fingerprint.
 */
export const COACH_AI_PURCHASE_RECOVERY_PROJECT = 'sideline-social-staging-2026';
export const COACH_AI_PURCHASE_RECOVERY_RC_PROJECT = 'ec5f2a61';
export const COACH_AI_PURCHASE_RECOVERY_RC_API_PROJECT = 'projec5f2a61';
export const COACH_AI_PURCHASE_RECOVERY_MAX_REVIEW_AGE_MS = 24 * 60 * 60 * 1000;

export type CoachAiPurchaseRecoveryRequest = {
  reviewReference: string;
  markerFingerprint: string;
};
export type CoachAiPurchaseRecoveryDecision = CoachAiPurchaseRecoveryRequest & {
  userId: string;
  outcome: 'cancelled_or_not_started';
  expiresAtMs: number;
};
type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue : null;
}
function id(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function unavailable(): never { throw new Error('purchase_recovery_review_unavailable'); }

export function readCoachAiPurchaseRecoveryRequest(value: unknown): CoachAiPurchaseRecoveryRequest {
  const data = record(value);
  if (!data || Object.keys(data).length !== 2
    || typeof data.reviewReference !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(data.reviewReference)
    || typeof data.markerFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(data.markerFingerprint)) {
    throw new Error('purchase_recovery_request_invalid');
  }
  return { reviewReference: data.reviewReference, markerFingerprint: data.markerFingerprint };
}

/** Missing standing is the existing active default; unknown restrictions fail closed. */
function standingAllows(value: unknown) {
  if (value == null) return true;
  const standing = record(value);
  return standing?.status === 'active' && standing.messagingRestricted !== true;
}

export function validateCoachAiPurchaseRecoveryDecision(input: {
  request: unknown;
  uid: string;
  nowMs: number;
  appVerified: boolean;
  callerClaims: unknown;
  billingConfig: unknown;
  profile: unknown;
  enrollment: unknown;
  deletionExists: boolean;
  buyerStanding: unknown;
  review: unknown;
  reviewer: {
    uid: string;
    disabled: boolean;
    emailVerified: boolean;
    claims: unknown;
    directory: unknown;
    standing: unknown;
  };
}): CoachAiPurchaseRecoveryDecision {
  const request = readCoachAiPurchaseRecoveryRequest(input.request);
  const claims = record(input.callerClaims);
  const config = record(input.billingConfig);
  const profile = record(input.profile);
  const enrollment = record(input.enrollment);
  const review = record(input.review);
  if (!id(input.uid) || !Number.isSafeInteger(input.nowMs) || input.nowMs <= 0
    || !input.appVerified || claims?.aiCoachBillingTester !== true || claims.aiCoachTester === true
    || config?.environment !== 'sandbox' || config.projectId !== COACH_AI_PURCHASE_RECOVERY_RC_PROJECT
    || config.apiProjectId !== COACH_AI_PURCHASE_RECOVERY_RC_API_PROJECT
    || config.v2SandboxTestingApproved !== true || config.restorePolicy !== 'keep_original'
    || config.salesCountry !== 'US'
    || profile?.adultEligibilityConfirmed !== true || profile.activeMode !== 'coach'
    || !standingAllows(input.buyerStanding) || input.deletionExists
    || enrollment?.userId !== input.uid || enrollment.state !== 'enrolled'
    || enrollment.lastEnvironment !== 'sandbox'
    || review?.userId !== input.uid || review.environment !== 'sandbox'
    || review.reviewReference !== request.reviewReference || review.markerFingerprint !== request.markerFingerprint
    || review.decision !== 'cancelled_or_not_started' || review.approved !== true
    || review.storeReconciled !== true || review.providerReconciled !== true
    || !id(review.reviewerUid) || review.reviewerUid === input.uid
    || !Number.isSafeInteger(review.reviewedAtMs) || Number(review.reviewedAtMs) <= 0
    || Number(review.reviewedAtMs) > input.nowMs
    || !Number.isSafeInteger(review.expiresAtMs) || Number(review.expiresAtMs) <= input.nowMs
    || Number(review.expiresAtMs) <= Number(review.reviewedAtMs)
    || Number(review.expiresAtMs) - Number(review.reviewedAtMs) > COACH_AI_PURCHASE_RECOVERY_MAX_REVIEW_AGE_MS) unavailable();

  const reviewer = input.reviewer;
  const reviewerClaims = record(reviewer.claims);
  const directory = record(reviewer.directory);
  if (reviewer.uid !== review.reviewerUid || reviewer.disabled !== false || reviewer.emailVerified !== true
    || !standingAllows(reviewer.standing) || directory?.active !== true
    || !['moderator', 'moderationLead'].includes(String(directory.role))
    || !Number.isSafeInteger(directory.roleVersion) || Number(directory.roleVersion) <= 0
    || reviewerClaims?.moderationRole !== directory.role
    || reviewerClaims?.moderationRoleVersion !== directory.roleVersion) unavailable();

  // Do not return the reviewer, the private review document, or any provider
  // receipt/token. This is an exact-record disposition, never a blank unlock.
  return { userId: input.uid, ...request, outcome: 'cancelled_or_not_started', expiresAtMs: Number(review.expiresAtMs) };
}
