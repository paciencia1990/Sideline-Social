import { CoachAiPurchaseError } from './coachAiPurchaseCore';

export type BillingStage = 'billing_status' | 'sdk_setup' | 'prepare' | 'sdk_identity' | 'storefront' | 'offerings' | 'monthly' | 'yearly' | 'screen';
export type BillingReason = 'ok' | 'billing_disabled' | 'invalid_status' | 'sdk_unavailable' | 'preparation_rejected'
  | 'storefront_unknown' | 'storefront_unsupported' | 'offering_missing' | 'package_missing'
  | 'product_id' | 'currency' | 'price' | 'period' | 'intro_price' | 'installments' | 'base_plan'
  | 'no_plans' | 'partial_plans' | 'account_changed' | 'navigation_cancelled' | 'request_failed';
export type BillingDiagnostic = {
  version: 1; attemptId: string; startedAt: string; finishedAt: string | null;
  outcome: 'running' | 'ready' | 'partial' | 'failed' | 'cancelled';
  stage: BillingStage; reason: BillingReason;
  steps: { stage: BillingStage; reason: BillingReason; at: string; providerCode?: string }[];
};

let sequence = 0;
// Never retain messages, details, user IDs, credentials, receipts or provider objects.
export function safeBillingErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'unknown';
  const code = error.code;
  if (typeof code === 'string' && [
    'functions/unauthenticated', 'functions/permission-denied', 'functions/failed-precondition',
    'functions/unavailable', 'functions/deadline-exceeded', 'functions/resource-exhausted',
    'functions/internal', 'functions/invalid-argument', 'functions/not-found', 'functions/aborted',
  ].includes(code)) return code;
  // RevenueCat's numeric error enum. Arbitrary strings and payloads are excluded.
  if ((typeof code === 'string' && /^(0|[1-4]?[0-9])$/.test(code))
    || (typeof code === 'number' && Number.isInteger(code) && code >= 0 && code < 50)) return `sdk_${code}`;
  return 'unknown';
}
export class BillingDiagnosticFault extends Error {
  constructor(readonly reason: BillingReason) { super(reason); }
}
export class CoachAiBillingDiagnosticError extends CoachAiPurchaseError {
  constructor(readonly diagnostic: BillingDiagnostic) {
    super(diagnostic.reason === 'account_changed' ? 'account_changed' : diagnostic.stage === 'billing_status' ? 'unavailable' : 'product_unavailable');
  }
}
export function createBillingDiagnostic(stage: BillingStage, publish?: (value: BillingDiagnostic) => void) {
  const startedAt = new Date().toISOString();
  const value: BillingDiagnostic = {
    version: 1, attemptId: `plans-${Date.now().toString(36)}-${(++sequence).toString(36)}`,
    startedAt, finishedAt: null, outcome: 'running', stage, reason: 'ok', steps: [],
  };
  const snapshot = (): BillingDiagnostic => ({ ...value, steps: value.steps.map(step => ({ ...step })) });
  function emit() { publish?.(snapshot()); }
  function record(reason: BillingReason, providerCode?: string) {
    value.reason = reason;
    value.steps.push({ stage: value.stage, reason, at: new Date().toISOString(), ...(providerCode ? { providerCode } : {}) });
  }
  return {
    snapshot,
    enter(next: BillingStage) { value.stage = next; emit(); },
    pass(reason: BillingReason = 'ok') { record(reason); emit(); },
    finish(outcome: BillingDiagnostic['outcome'], reason: BillingReason) {
      value.outcome = outcome; value.finishedAt = new Date().toISOString(); record(reason); emit(); return snapshot();
    },
    fail(error: unknown) {
      const reason = error instanceof BillingDiagnosticFault ? error.reason
        : error instanceof CoachAiPurchaseError && error.kind === 'account_changed' ? 'account_changed'
          : error instanceof CoachAiPurchaseError && error.kind === 'unavailable' && value.stage === 'sdk_setup' ? 'sdk_unavailable' : 'request_failed';
      value.outcome = reason === 'account_changed' || reason === 'navigation_cancelled' ? 'cancelled' : 'failed';
      value.finishedAt = new Date().toISOString(); record(reason, safeBillingErrorCode(error)); emit();
      return new CoachAiBillingDiagnosticError(snapshot());
    },
  };
}
export type BillingRecorder = ReturnType<typeof createBillingDiagnostic>;

export function billingDiagnosticMessage(value: BillingDiagnostic): string | null {
  if (value.outcome === 'running' || value.outcome === 'ready') return null;
  if (value.outcome === 'cancelled') return 'cancelled';
  if (value.reason === 'storefront_unknown') return 'storefront_unknown';
  if (value.reason === 'storefront_unsupported') return 'storefront_unsupported';
  if (value.outcome === 'partial') return 'partial';
  if (value.stage === 'billing_status') return 'status';
  if (value.stage === 'prepare') return 'prepare';
  if (value.stage === 'sdk_setup' || value.stage === 'sdk_identity') return 'app_setup';
  if (value.reason === 'offering_missing') return 'offering_missing';
  if (value.stage === 'screen') return 'plan_mismatch';
  return 'store_request';
}
