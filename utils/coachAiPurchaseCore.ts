import type { CoachAiBillingPlan, CoachAiBillingStatus } from '../types/coachAiBilling';

export type CoachAiPurchaseErrorKind = 'busy' | 'account_changed' | 'cancelled' | 'rejected' | 'payment_pending'
  | 'ownership_conflict' | 'confirmation_pending' | 'recovery_required' | 'checkout_not_started' | 'unavailable' | 'product_unavailable';
export class CoachAiPurchaseError extends Error {
  constructor(readonly kind: CoachAiPurchaseErrorKind) { super(`coach_ai_purchase_${kind}`); }
}
export type CoachAiPurchasePhase = 'idle' | 'inspecting' | 'preparing' | 'sdk_setup' | 'account_preparation' | 'sdk_identity' | 'storefront' | 'ownership_check' | 'server_verification' | 'reading_review' | 'checkout_started' | 'payment_pending'
  | 'verification_pending' | 'uncertain' | 'ownership_conflict' | 'recovery_required' | 'cancelled' | 'rejected' | 'confirmed' | 'not_started' | 'resolved';
export type CoachAiPurchaseRecord = {
  version: 2; attemptId: string; plan: CoachAiBillingPlan; createdAt: number;
  state: 'checkout_started' | 'payment_pending' | 'verification_pending' | 'uncertain' | 'ownership_conflict';
};
export type CoachAiPurchaseInspection = {
  present: boolean; schema: 'none' | 'legacy' | 'v2' | 'invalid'; plan: CoachAiBillingPlan | null;
  ageMs: number | null; state: CoachAiPurchasePhase; attemptId: string | null;
};
export type CoachAiPurchaseDiagnostic = {
  version: 1; operation: 'inspect' | 'buy' | 'restore' | 'check' | 'resolve'; correlationId: string;
  phase: CoachAiPurchasePhase; nativeInvokedThisOperation: boolean; providerCode: string | null;
  record: CoachAiPurchaseInspection; markerFingerprint: string | null;
};
export type CoachAiPurchaseRecoveryDecision = {
  userId: string; markerFingerprint: string; outcome: 'cancelled_or_not_started'; reviewReference: string; expiresAtMs: number;
};
const recordStates = ['checkout_started', 'payment_pending', 'verification_pending', 'uncertain', 'ownership_conflict'] as const;
function isPlan(value: unknown): value is CoachAiBillingPlan { return value === 'monthly' || value === 'yearly'; }
function safeTime(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0; }
export function inspectCoachAiPurchaseRecord(raw: string | null, nowMs: number): CoachAiPurchaseInspection {
  const empty: CoachAiPurchaseInspection = { present: false, schema: 'none', plan: null, ageMs: null, state: 'idle', attemptId: null };
  if (raw === null) return empty;
  const invalid: CoachAiPurchaseInspection = { ...empty, present: true, schema: 'invalid', state: 'recovery_required' };
  if (!raw || raw.length > 2048) return invalid;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !isPlan(value.plan) || !safeTime(value.createdAt) || value.createdAt > nowMs) return invalid;
    const base = { ...invalid, plan: value.plan, ageMs: nowMs - value.createdAt };
    if (value.version === undefined) return { ...base, schema: 'legacy' };
    if (value.version !== 2 || typeof value.attemptId !== 'string' || !/^purchase-[a-z0-9-]{1,64}$/.test(value.attemptId)
      || !recordStates.includes(value.state)) return invalid;
    return { ...base, schema: 'v2', state: value.state, attemptId: value.attemptId };
  } catch { return invalid; }
}
export function classifyCoachAiPurchaseError(error: unknown): { kind: CoachAiPurchaseErrorKind; providerCode: string | null; terminal: boolean } {
  const object = error && typeof error === 'object' ? error as { code?: unknown; userCancelled?: unknown } : {};
  const code = typeof object.code === 'number' ? String(object.code) : object.code;
  const safe = typeof code === 'string' && /^(0|[1-4]?[0-9])$/.test(code) ? code : null;
  if (safe === '1' || object.userCancelled === true && safe === null) return { kind: 'cancelled', providerCode: safe, terminal: true };
  if (safe === '20') return { kind: 'payment_pending', providerCode: safe, terminal: false };
  if (safe === '6' || safe === '7' || safe === '13') return { kind: 'ownership_conflict', providerCode: safe, terminal: false };
  // Only explicit documented noncharge failures are terminal. Network, store,
  // unknown and in-progress results after invocation remain unresolved.
  if (safe && ['3', '4', '5', '18', '23', '24'].includes(safe)) return { kind: 'rejected', providerCode: safe, terminal: true };
  return { kind: 'confirmation_pending', providerCode: safe, terminal: false };
}

/** One operation at a time; no automatic checkout, restore, or recovery retries. */
export function createCoachAiPurchaseController<Package>(deps: {
  identity: () => string | null;
  verify: (uid: string) => Promise<CoachAiBillingStatus>;
  restore: (uid: string, stage: (phase: CoachAiPurchasePhase) => void) => Promise<boolean>;
  purchase: (uid: string, product: Package, invoke: (nativeCall: () => Promise<void>, beforeNative?: () => void) => Promise<void>, stage: (phase: CoachAiPurchasePhase) => void) => Promise<void>;
  read: (uid: string) => Promise<string | null>;
  write: (uid: string, expected: string | null, raw: string) => Promise<boolean>;
  remove: (uid: string, expected: string) => Promise<boolean>;
  fingerprint: (uid: string, raw: string) => Promise<string>;
  decision: (uid: string, fingerprint: string, reviewReference: string) => Promise<CoachAiPurchaseRecoveryDecision>;
  newAttemptId: () => string;
  now?: () => number;
}) {
  let busy = false, sequence = 0;
  const now = deps.now ?? Date.now;
  function check(uid: string, session: string | null) {
    if (!session || session.split(':')[0] !== uid || deps.identity() !== session) throw new CoachAiPurchaseError('account_changed');
  }
  async function run(operation: CoachAiPurchaseDiagnostic['operation'], uid: string, product?: Package, plan?: CoachAiBillingPlan,
    publish?: (value: CoachAiPurchaseDiagnostic) => void, reviewReference?: string): Promise<CoachAiBillingStatus | CoachAiPurchaseDiagnostic> {
    if (busy) throw new CoachAiPurchaseError('busy');
    busy = true;
    const session = deps.identity();
    let raw: string | null = null, createdHere = false, boundaryUsed = false;
    const id = `purchase-${now().toString(36)}-${(++sequence).toString(36)}`;
    const diagnostic: CoachAiPurchaseDiagnostic = { version: 1, operation, correlationId: id, phase: 'inspecting', nativeInvokedThisOperation: false,
      providerCode: null, record: inspectCoachAiPurchaseRecord(null, now()), markerFingerprint: null };
    const snapshot = () => ({ ...diagnostic, record: { ...diagnostic.record } });
    const emit = (phase: CoachAiPurchasePhase) => {
      diagnostic.phase = phase;
      try { publish?.(snapshot()); } catch { /* observers cannot change transaction outcomes */ }
    };
    async function loadRecord() {
      check(uid, session); raw = await deps.read(uid); check(uid, session);
      diagnostic.record = inspectCoachAiPurchaseRecord(raw, now());
      diagnostic.markerFingerprint = raw === null ? null : await deps.fingerprint(uid, raw);
      check(uid, session);
    }
    async function save(record: CoachAiPurchaseRecord) {
      check(uid, session);
      const encoded = JSON.stringify(record);
      if (!await deps.write(uid, raw, encoded)) throw new CoachAiPurchaseError('recovery_required');
      raw = encoded; check(uid, session);
      diagnostic.record = inspectCoachAiPurchaseRecord(raw, now());
      diagnostic.markerFingerprint = await deps.fingerprint(uid, raw); check(uid, session);
    }
    async function clear() {
      check(uid, session);
      if (raw !== null && !await deps.remove(uid, raw)) throw new CoachAiPurchaseError('recovery_required');
      raw = null; check(uid, session);
      diagnostic.record = inspectCoachAiPurchaseRecord(null, now()); diagnostic.markerFingerprint = null;
    }
    async function verified() { check(uid, session); emit('server_verification'); const status = await deps.verify(uid); check(uid, session); return status; }
    try {
      await loadRecord(); emit(diagnostic.record.present ? diagnostic.record.state : 'idle');
      if (operation === 'inspect') return snapshot(); // No server/SDK call, even with billing off.
      if (operation === 'resolve') {
        if (raw === null || !reviewReference || !/^[A-Za-z0-9_-]{8,128}$/.test(reviewReference)) throw new CoachAiPurchaseError('recovery_required');
        const fingerprint = diagnostic.markerFingerprint!;
        emit('reading_review');
        const decision = await deps.decision(uid, fingerprint, reviewReference); check(uid, session);
        if (decision.userId !== uid || decision.markerFingerprint !== fingerprint || decision.reviewReference !== reviewReference
          || decision.outcome !== 'cancelled_or_not_started' || !safeTime(decision.expiresAtMs) || decision.expiresAtMs <= now()
          || decision.expiresAtMs > now() + 86_400_000) throw new CoachAiPurchaseError('recovery_required');
        await clear(); emit('resolved'); return snapshot(); // Never starts another operation.
      }
      emit('preparing');
      const initial = await verified();
      if (!initial.enabled) throw new CoachAiPurchaseError('unavailable');
      if (initial.entitled) { await clear(); emit('confirmed'); return initial; }
      if (operation === 'check') { emit(diagnostic.record.present ? diagnostic.record.state : 'idle'); return initial; }
      if (operation === 'restore') {
        const storeHasAccess = await deps.restore(uid, emit); check(uid, session);
        const restored = await verified();
        if (restored.entitled) { await clear(); emit('confirmed'); return restored; }
        emit(diagnostic.record.present ? diagnostic.record.state : storeHasAccess ? 'verification_pending' : 'idle');
        if (raw !== null) throw new CoachAiPurchaseError('recovery_required');
        if (storeHasAccess) throw new CoachAiPurchaseError('confirmation_pending');
        return restored; // Empty restore never proves cancellation or clears an old record.
      }
      if (raw !== null) { emit(diagnostic.record.state); throw new CoachAiPurchaseError('recovery_required'); }
      if (!product || !plan) throw new CoachAiPurchaseError('product_unavailable');
      // Adapter completes setup/identity/storefront/ownership checks BEFORE this
      // callback. The controller saves the intent and invokes native immediately.
      await deps.purchase(uid, product, async (nativeCall, beforeNative) => {
        check(uid, session);
        if (boundaryUsed) throw new CoachAiPurchaseError('confirmation_pending');
        boundaryUsed = true;
        const attemptId = deps.newAttemptId();
        if (!/^purchase-[a-z0-9-]{1,64}$/.test(attemptId)) throw new CoachAiPurchaseError('checkout_not_started');
        createdHere = true;
        await save({ version: 2, attemptId, plan, createdAt: now(), state: 'checkout_started' });
        beforeNative?.(); check(uid, session);
        diagnostic.nativeInvokedThisOperation = true; emit('checkout_started');
        try { await nativeCall(); }
        catch (error) {
          check(uid, session);
          const category = classifyCoachAiPurchaseError(error); diagnostic.providerCode = category.providerCode;
          if (category.terminal) { await clear(); emit(category.kind === 'cancelled' ? 'cancelled' : 'rejected'); }
          else {
            const state = category.kind === 'payment_pending' ? 'payment_pending' : category.kind === 'ownership_conflict' ? 'ownership_conflict' : 'uncertain';
            const previous = JSON.parse(raw!) as CoachAiPurchaseRecord;
            await save({ ...previous, state }); emit(state);
          }
          throw new CoachAiPurchaseError(category.kind);
        }
      }, emit);
      check(uid, session);
      if (!diagnostic.nativeInvokedThisOperation) throw new CoachAiPurchaseError('checkout_not_started');
      const previous = JSON.parse(raw!) as CoachAiPurchaseRecord;
      await save({ ...previous, state: 'verification_pending' }); emit('verification_pending');
      const confirmed = await verified();
      if (!confirmed.entitled) throw new CoachAiPurchaseError('confirmation_pending');
      await clear(); emit('confirmed'); return confirmed;
    } catch (error) {
      diagnostic.providerCode ??= classifyCoachAiPurchaseError(error).providerCode;
      // A known failure before the native boundary cannot be a new store charge.
      // Remove only this operation's exact record, and only in the same session.
      if (createdHere && !diagnostic.nativeInvokedThisOperation && deps.identity() === session) await clear();
      if (error instanceof CoachAiPurchaseError && error.kind === 'account_changed' || deps.identity() !== session) {
        emit(diagnostic.nativeInvokedThisOperation ? 'uncertain' : 'not_started'); throw new CoachAiPurchaseError('account_changed');
      }
      if (!(error instanceof CoachAiPurchaseError) && operation === 'restore') {
        const category = classifyCoachAiPurchaseError(error);
        emit(category.kind === 'cancelled' ? 'cancelled' : category.kind === 'ownership_conflict' ? 'ownership_conflict'
          : category.kind === 'payment_pending' ? 'payment_pending' : diagnostic.record.present ? 'recovery_required' : 'not_started');
        throw new CoachAiPurchaseError(category.kind);
      }
      if (error instanceof CoachAiPurchaseError) {
        if (error.kind === 'ownership_conflict') emit('ownership_conflict');
        else if (error.kind === 'recovery_required') emit('recovery_required');
        else if (error.kind === 'confirmation_pending' && operation === 'restore') emit('verification_pending');
        else if (!diagnostic.nativeInvokedThisOperation) emit(diagnostic.record.present ? 'recovery_required' : 'not_started');
        throw error;
      }
      emit(diagnostic.nativeInvokedThisOperation ? 'verification_pending' : diagnostic.record.present ? 'recovery_required' : 'not_started');
      throw new CoachAiPurchaseError(diagnostic.nativeInvokedThisOperation ? 'confirmation_pending' : operation === 'buy' ? 'checkout_not_started' : 'unavailable');
    } finally { busy = false; }
  }
  return {
    buy: (uid: string, product: Package, plan: CoachAiBillingPlan, publish?: (value: CoachAiPurchaseDiagnostic) => void) => run('buy', uid, product, plan, publish) as Promise<CoachAiBillingStatus>,
    restore: (uid: string, publish?: (value: CoachAiPurchaseDiagnostic) => void) => run('restore', uid, undefined, undefined, publish) as Promise<CoachAiBillingStatus>,
    checkStatus: (uid: string, publish?: (value: CoachAiPurchaseDiagnostic) => void) => run('check', uid, undefined, undefined, publish) as Promise<CoachAiBillingStatus>,
    inspect: (uid: string, publish?: (value: CoachAiPurchaseDiagnostic) => void) => run('inspect', uid, undefined, undefined, publish) as Promise<CoachAiPurchaseDiagnostic>,
    resolve: (uid: string, reviewReference: string, publish?: (value: CoachAiPurchaseDiagnostic) => void) => run('resolve', uid, undefined, undefined, publish, reviewReference) as Promise<CoachAiPurchaseDiagnostic>,
  };
}

type CoachAiStoreProduct = {
  identifier: string; currencyCode: string; price: number; subscriptionPeriod: string | null;
  introPrice?: unknown; installmentsInfo?: unknown;
  defaultOption?: { isBasePlan: boolean; installmentsInfo?: unknown } | null;
};
export function coachAiProductRejection(product: CoachAiStoreProduct, plan: CoachAiBillingPlan, platform: 'ios' | 'android') {
  const id = platform === 'ios' ? `com.sidelinesocial.coachai.${plan}` : `coach_ai:${plan}`;
  if (product.identifier !== id) return 'product_id';
  if (product.currencyCode !== 'USD') return 'currency';
  if (!Number.isFinite(product.price) || Math.round(product.price * 100) !== (plan === 'monthly' ? 299 : 2499)) return 'price';
  if (product.subscriptionPeriod !== (plan === 'monthly' ? 'P1M' : 'P1Y')) return 'period';
  if (product.introPrice != null) return 'intro_price';
  if (product.installmentsInfo != null || platform === 'android' && product.defaultOption?.installmentsInfo != null) return 'installments';
  if (platform === 'android' && product.defaultOption?.isBasePlan !== true) return 'base_plan';
  return null;
}
export function isApprovedCoachAiProduct(product: CoachAiStoreProduct, plan: CoachAiBillingPlan, platform: 'ios' | 'android') {
  return coachAiProductRejection(product, plan, platform) === null;
}
