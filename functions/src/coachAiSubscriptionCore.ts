/**
 * Paid-access policy used by the separate billing path. Inputs come from a server-authenticated RevenueCat
 * lookup/verified store adapter, never from SDK CustomerInfo or callable data.
 */
export type CoachAiPaidPlan = 'monthly' | 'yearly';
export type CoachAiBillingStore = 'app_store' | 'play_store';
export type CoachAiBillingEnvironment = 'production' | 'sandbox';
export type CoachAiSubscriptionStatus =
  | 'active' | 'grace_period' | 'pending' | 'billing_hold' | 'paused' | 'expired' | 'revoked';

// Apple drafts are saved. Google subscription/base-plan identifiers are prepared
// for creation; neither catalog entry nor this policy activates paid access.
export const COACH_AI_REVENUECAT_ENTITLEMENT = 'coach_ai';
// Owner-approved service allowance shared by monthly/yearly payment options.
// Enforced by the verified entitlement and transactional usage service.
// Existing beta quota is intentionally untouched.
export const COACH_AI_INCLUDED_RESPONSES_PER_MONTH = 30;
export const COACH_AI_PRODUCT_CATALOG = Object.freeze({
  app_store: Object.freeze({
    monthly: 'com.sidelinesocial.coachai.monthly',
    yearly: 'com.sidelinesocial.coachai.yearly',
  }),
  play_store: Object.freeze({
    monthly: 'coach_ai:monthly',
    yearly: 'coach_ai:yearly',
  }),
});

export type VerifiedCoachAiSubscription = Readonly<{
  accountUid: string;
  entitlementId: string;
  productId: string;
  store: CoachAiBillingStore;
  environment: CoachAiBillingEnvironment;
  status: CoachAiSubscriptionStatus;
  verifiedAtMs: number;
  // A v2 snapshot uses this as a bounded access-verification lease.
  accessUntilMs: number;
  // Actual paid-through date for display, never inferred from a grace lease.
  paidThroughMs?: number | null;
  // Cancellation changes this value without cutting short paid access.
  autoRenews: boolean;
}>;

type PaidAccessDecision = Readonly<{
  entitled: boolean;
  plan: CoachAiPaidPlan | null;
  reason: 'allowed' | 'disabled' | 'context' | 'unverified' | 'account_mismatch'
    | 'wrong_product' | 'wrong_environment' | 'stale' | 'inactive';
}>;

export function resolveCoachAiPaidAccess({
  paidEnabled, accountUid, adultEligible, activeMode, accountStanding,
  environment, subscription, nowMs, maxVerificationAgeMs,
}: {
  paidEnabled: boolean;
  accountUid: string | null;
  adultEligible: boolean;
  activeMode: 'parent' | 'coach' | null;
  accountStanding: 'active' | 'messagingRestricted' | 'suspended' | 'banned' | null;
  environment: CoachAiBillingEnvironment;
  subscription: VerifiedCoachAiSubscription | null;
  nowMs: number;
  maxVerificationAgeMs: number;
}): PaidAccessDecision {
  const denied = (reason: PaidAccessDecision['reason']): PaidAccessDecision => ({ entitled: false, plan: null, reason });
  if (paidEnabled !== true) return denied('disabled');
  if (!accountUid || adultEligible !== true || activeMode !== 'coach' || accountStanding !== 'active') return denied('context');
  if (!subscription) return denied('unverified');
  if (subscription.accountUid !== accountUid) return denied('account_mismatch');
  if (subscription.entitlementId !== COACH_AI_REVENUECAT_ENTITLEMENT) return denied('wrong_product');
  const catalog = COACH_AI_PRODUCT_CATALOG[subscription.store];
  const plan = catalog && (Object.keys(catalog) as CoachAiPaidPlan[]).find((key) => catalog[key] === subscription.productId);
  if (!plan) return denied('wrong_product');
  if (!['production', 'sandbox'].includes(environment) || subscription.environment !== environment) return denied('wrong_environment');
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0
    || !Number.isSafeInteger(maxVerificationAgeMs) || maxVerificationAgeMs <= 0
    || !Number.isSafeInteger(subscription.verifiedAtMs) || subscription.verifiedAtMs <= 0
    || subscription.verifiedAtMs > nowMs || nowMs - subscription.verifiedAtMs > maxVerificationAgeMs) return denied('stale');
  if (!Number.isSafeInteger(subscription.accessUntilMs) || subscription.accessUntilMs <= nowMs
    || !['active', 'grace_period'].includes(subscription.status)) return denied('inactive');
  return { entitled: true, plan, reason: 'allowed' };
}

/** Use inside a transaction; stale notifications trigger a fresh server lookup. */
export function canReplaceVerifiedSubscription(
  current: VerifiedCoachAiSubscription | null,
  candidate: VerifiedCoachAiSubscription,
) {
  if (!Number.isSafeInteger(candidate.verifiedAtMs) || candidate.verifiedAtMs <= 0) return false;
  if (!current) return true;
  return candidate.accountUid === current.accountUid
    && candidate.environment === current.environment
    && candidate.verifiedAtMs > current.verifiedAtMs;
}

/**
 * Server-owned fulfilled guide ledger for a window from the verified adapter's
 * pinned purchase anchor. Windows are computed lazily; no reset scheduler runs.
 * Run in a Firestore transaction with a separate immutable per-request record;
 * request idempotency records must outlive the billing window and retries.
 */
export type CoachAiUsageLedger = Readonly<{
  accountUid: string;
  windowId: string;
  limit: number;
  fulfilled: number;
  reserved: number;
}>;

export function reserveCoachAiPaidGuide(ledger: CoachAiUsageLedger): CoachAiUsageLedger {
  validateLedger(ledger);
  if (ledger.fulfilled + ledger.reserved >= ledger.limit) throw new Error('coach_ai_allowance_exhausted');
  return { ...ledger, reserved: ledger.reserved + 1 };
}

export function finishCoachAiPaidGuide(
  ledger: CoachAiUsageLedger,
  outcome: 'fulfilled' | 'failed' | 'local_safety',
): CoachAiUsageLedger {
  validateLedger(ledger);
  if (!['fulfilled', 'failed', 'local_safety'].includes(outcome)) throw new Error('invalid_usage_outcome');
  if (ledger.reserved < 1) throw new Error('usage_reservation_missing');
  return {
    ...ledger,
    reserved: ledger.reserved - 1,
    fulfilled: ledger.fulfilled + (outcome === 'fulfilled' ? 1 : 0),
  };
}

function validateLedger(ledger: CoachAiUsageLedger) {
  if (!ledger.accountUid || !ledger.windowId
    || !Number.isSafeInteger(ledger.limit) || ledger.limit <= 0
    || !Number.isSafeInteger(ledger.fulfilled) || ledger.fulfilled < 0
    || !Number.isSafeInteger(ledger.reserved) || ledger.reserved < 0
    || ledger.fulfilled + ledger.reserved > ledger.limit) throw new Error('invalid_usage_ledger');
}
