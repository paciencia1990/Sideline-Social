'use strict';
// Fictional state, in-memory TS, mocked native/provider/storage only.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { createSourceLoader, root } = require('./coach-ai-test-loader.cjs');
const out = path.join(root, 'docs/coach-ai-consolidated-purchase-recovery-local-20261023');
const group = process.argv[2];
if (!['core', 'adapter', 'backend'].includes(group)) throw Error('focused_group_required');
fs.mkdirSync(out, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
save(group + '-attempt', { at: new Date().toISOString(), offline: true, agentRetries: 0 });
const cases = [];
async function test(name, fn) { await fn(); cases.push(name); }
const source = createSourceLoader();
const { createCoachAiPurchaseController, inspectCoachAiPurchaseRecord, classifyCoachAiPurchaseError } = source('utils/coachAiPurchaseCore.ts');
const clock = 1_792_800_000_000;
const hash = (uid, raw) => crypto.createHash('sha256').update(uid + '\n' + raw).digest('hex');
const legacy = JSON.stringify({ plan: 'monthly', createdAt: clock - 10_000 });
function fixture() {
  const state = { identity: 'fixture_a:0', raw: null, enabled: true, entitled: false, native: 0, restores: 0, checks: 0,
    setupError: null, nativeError: null, verifyError: false, restoreError: null, restoreOwns: false, fingerprintError: false,
    beforeNativeError: null, nativeHook: null, writeHook: null, decisionHook: null, diagnostics: [] };
  const publish = value => state.diagnostics.push(value);
  const controller = createCoachAiPurchaseController({
    identity: () => state.identity, now: () => clock, newAttemptId: () => 'purchase-' + crypto.randomUUID(),
    verify: async uid => { state.checks++; if (state.verifyError) throw Error('fixture_network'); return { userId: uid, enabled: state.enabled, entitled: state.entitled }; },
    restore: async () => { state.restores++; if (state.restoreError) throw state.restoreError; if (state.restoreOwns) state.entitled = true; return state.restoreOwns; },
    purchase: async (_uid, _product, invoke, stage) => {
      stage('account_preparation'); if (state.setupError) throw state.setupError;
      await invoke(async () => { state.native++; assert.equal(JSON.parse(state.raw).version, 2); if (state.nativeHook) await state.nativeHook(); if (state.nativeError) throw state.nativeError; state.entitled = true; },
        () => { if (state.beforeNativeError) throw state.beforeNativeError; });
    },
    read: async () => state.raw,
    write: async (_uid, expected, raw) => { if (state.raw !== expected) return false; if (state.writeHook) return state.writeHook(raw); state.raw = raw; return true; },
    remove: async (_uid, expected) => { if (state.raw !== expected) return false; state.raw = null; return true; },
    fingerprint: async (uid, raw) => { if (state.fingerprintError) throw Error('fixture_hash'); return hash(uid, raw); },
    decision: async (uid, markerFingerprint, reviewReference) => {
      const value = { userId: uid, markerFingerprint, reviewReference, outcome: 'cancelled_or_not_started', expiresAtMs: clock + 60_000 };
      return state.decisionHook ? state.decisionHook(value) : value;
    },
  });
  return { state, controller, publish };
}
async function coreCases() {
  await test('local_inspection_works_while_billing_off_without_server_or_sdk', async () => {
    const f = fixture(); f.state.enabled = false; f.state.raw = legacy;
    const result = await f.controller.inspect('fixture_a');
    assert.equal(result.record.schema, 'legacy'); assert.equal(result.phase, 'recovery_required'); assert.equal(result.record.ageMs, 10_000);
    assert.equal(f.state.checks, 0); assert.equal(f.state.restores, 0); assert.equal(f.state.native, 0);
    assert.ok(!JSON.stringify(result).includes('fixture_a'));
  });
  await test('invalid_and_future_records_never_become_empty_or_expire', () => {
    for (const raw of ['', '{bad', JSON.stringify({ plan: 'monthly', createdAt: clock + 1 }), JSON.stringify({ version: 3, plan: 'monthly', createdAt: clock - 1 })]) {
      assert.equal(inspectCoachAiPurchaseRecord(raw, clock).schema, 'invalid'); assert.equal(inspectCoachAiPurchaseRecord(raw, clock).present, true);
    }
    assert.equal(inspectCoachAiPurchaseRecord(legacy, clock + 1e12).present, true);
  });
  await test('pre_native_setup_failure_does_not_save_intent_or_restore', async () => {
    const f = fixture(); f.state.setupError = { code: '23', message: 'PRIVATE' };
    await assert.rejects(f.controller.buy('fixture_a', {}, 'monthly', f.publish), e => e.kind === 'checkout_not_started');
    assert.equal(f.state.raw, null); assert.equal(f.state.native, 0); assert.equal(f.state.restores, 0);
    assert.equal(f.state.diagnostics.at(-1).nativeInvokedThisOperation, false); assert.ok(!JSON.stringify(f.state.diagnostics).includes('PRIVATE'));
  });
  await test('final_guard_failure_cleans_only_new_exact_record_before_native', async () => {
    const f = fixture(); f.state.beforeNativeError = Error('fixture_guard');
    await assert.rejects(f.controller.buy('fixture_a', {}, 'monthly'), e => e.kind === 'checkout_not_started');
    assert.equal(f.state.raw, null); assert.equal(f.state.native, 0);
  });
  await test('hash_failure_after_save_cleans_pre_native_intent', async () => {
    const f = fixture(); f.state.fingerprintError = true;
    await assert.rejects(f.controller.buy('fixture_a', {}, 'monthly'), e => e.kind === 'checkout_not_started');
    assert.equal(f.state.raw, null); assert.equal(f.state.native, 0);
  });
  await test('ambiguous_storage_write_does_not_start_native_or_erase_other_record', async () => {
    const f = fixture(); f.state.writeHook = raw => { f.state.raw = raw; throw Error('fixture_storage'); };
    await assert.rejects(f.controller.buy('fixture_a', {}, 'monthly'));
    assert.equal(f.state.native, 0); assert.ok(f.state.raw); assert.equal(JSON.parse(f.state.raw).state, 'checkout_started');
  });
  await test('normal_buy_uses_native_once_no_restore_then_server_confirmation', async () => {
    const f = fixture(); assert.equal((await f.controller.buy('fixture_a', {}, 'monthly', f.publish)).entitled, true);
    assert.equal(f.state.native, 1); assert.equal(f.state.restores, 0); assert.equal(f.state.raw, null); assert.equal(f.state.diagnostics.at(-1).phase, 'confirmed');
  });
  await test('documented_cancellation_and_noncharge_errors_release_only_current_intent', async () => {
    for (const code of ['1', '3', '4', '5', '18', '23', '24']) {
      const f = fixture(); f.state.nativeError = { code };
      await assert.rejects(f.controller.buy('fixture_a', {}, 'monthly'), e => e.kind === (code === '1' ? 'cancelled' : 'rejected'));
      assert.equal(f.state.native, 1); assert.equal(f.state.raw, null);
    }
    assert.equal(classifyCoachAiPurchaseError({ code: '20', userCancelled: true }).kind, 'payment_pending');
  });
  await test('pending_owned_inprogress_network_store_and_unknown_keep_protection', async () => {
    for (const [code, kind, state] of [['20', 'payment_pending', 'payment_pending'], ['6', 'ownership_conflict', 'ownership_conflict'], ['7', 'ownership_conflict', 'ownership_conflict'], ['13', 'ownership_conflict', 'ownership_conflict'], ['15', 'confirmation_pending', 'uncertain'], ['2', 'confirmation_pending', 'uncertain'], ['10', 'confirmation_pending', 'uncertain'], ['0', 'confirmation_pending', 'uncertain']]) {
      const f = fixture(); f.state.nativeError = { code };
      await assert.rejects(f.controller.buy('fixture_a', {}, 'monthly'), e => e.kind === kind);
      assert.equal(JSON.parse(f.state.raw).state, state); assert.equal(f.state.native, 1);
      await assert.rejects(f.controller.buy('fixture_a', {}, 'monthly'), e => e.kind === 'recovery_required'); assert.equal(f.state.native, 1);
    }
  });
  await test('server_delay_remains_recoverable_then_positive_status_clears', async () => {
    const f = fixture(); f.state.nativeHook = () => { f.state.verifyError = true; };
    await assert.rejects(f.controller.buy('fixture_a', {}, 'monthly'), e => e.kind === 'confirmation_pending');
    assert.equal(JSON.parse(f.state.raw).state, 'verification_pending');
    f.state.verifyError = false; assert.equal((await f.controller.checkStatus('fixture_a')).entitled, true); assert.equal(f.state.raw, null); assert.equal(f.state.native, 1);
  });
  await test('legacy_empty_status_and_restore_cannot_clear_or_buy_again', async () => {
    const f = fixture(); f.state.raw = legacy;
    assert.equal((await f.controller.checkStatus('fixture_a')).entitled, false); assert.equal(f.state.raw, legacy);
    await assert.rejects(f.controller.restore('fixture_a'), e => e.kind === 'recovery_required'); assert.equal(f.state.raw, legacy);
    await assert.rejects(f.controller.buy('fixture_a', {}, 'monthly'), e => e.kind === 'recovery_required'); assert.equal(f.state.native, 0);
    f.state.restoreOwns = true; assert.equal((await f.controller.restore('fixture_a')).entitled, true); assert.equal(f.state.raw, null);
  });
  await test('restore_cancellation_pending_and_owner_errors_remain_specific_and_retain_legacy', async () => {
    for (const [code, kind] of [['1', 'cancelled'], ['20', 'payment_pending'], ['13', 'ownership_conflict']]) {
      const f = fixture(); f.state.raw = legacy; f.state.restoreError = { code };
      await assert.rejects(f.controller.restore('fixture_a'), e => e.kind === kind); assert.equal(f.state.raw, legacy);
    }
  });
  await test('reviewed_exact_sandbox_resolution_never_purchases_or_restores', async () => {
    const f = fixture(); f.state.raw = legacy; f.state.enabled = false;
    assert.equal((await f.controller.resolve('fixture_a', 'review_fixture_01')).phase, 'resolved');
    assert.equal(f.state.raw, null); assert.equal(f.state.native, 0); assert.equal(f.state.restores, 0); assert.equal(f.state.checks, 0);
  });
  await test('invalid_expired_wrong_owner_fingerprint_or_changed_record_cannot_release', async () => {
    for (const patch of [{ userId: 'fixture_other' }, { markerFingerprint: 'f'.repeat(64) }, { expiresAtMs: clock }, { outcome: 'unknown' }]) {
      const f = fixture(); f.state.raw = legacy; f.state.decisionHook = value => ({ ...value, ...patch });
      await assert.rejects(f.controller.resolve('fixture_a', 'review_fixture_01')); assert.equal(f.state.raw, legacy);
    }
    const f = fixture(); f.state.raw = legacy; f.state.decisionHook = value => { f.state.raw = 'newer_attempt'; return value; };
    await assert.rejects(f.controller.resolve('fixture_a', 'review_fixture_01')); assert.equal(f.state.raw, 'newer_attempt');
  });
  await test('identity_epoch_change_after_native_preserves_old_owner_record', async () => {
    const f = fixture(); f.state.nativeHook = () => { f.state.identity = 'fixture_a:2'; };
    await assert.rejects(f.controller.buy('fixture_a', {}, 'monthly'), e => e.kind === 'account_changed'); assert.ok(f.state.raw); assert.equal(f.state.native, 1);
  });
  await test('concurrent_operations_never_open_a_second_checkout', async () => {
    const f = fixture(); let release; const gate = new Promise(resolve => { release = resolve; }); f.state.nativeHook = () => gate;
    const operation = f.controller.buy('fixture_a', {}, 'monthly');
    await assert.rejects(f.controller.buy('fixture_a', {}, 'yearly'), e => e.kind === 'busy'); release(); await operation; assert.equal(f.state.native, 1);
  });
}

function adapterFixture() {
  const state = { uid: 'adapter_a', enabled: true, entitled: false, country: 'US', prepareError: false, storeOwned: false,
    nativeError: null, nativeHook: null, native: 0, restores: 0, sdkReads: 0, calls: [], storage: new Map(), snapshots: [] };
  const auth = { currentUser: { uid: state.uid } }; let listener, sdkUid;
  process.env.EXPO_PUBLIC_COACH_AI_BILLING_ENABLED = 'true'; process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = 'goog_fixture_public_not_live';
  process.env.EXPO_PUBLIC_COACH_AI_BILLING_INFO_LOGGING = 'true';
  const sdk = { LOG_LEVEL: { ERROR: 'ERROR', INFO: 'INFO' }, setLogLevel: async () => {}, configure: ({ appUserID }) => { sdkUid = appUserID; },
    getAppUserID: async () => sdkUid, logIn: async uid => { sdkUid = uid; }, getStorefront: async () => ({ countryCode: state.country }),
    getCustomerInfo: async () => { state.sdkReads++; return { entitlements: { active: state.storeOwned ? { coach_ai: {} } : {} } }; },
    restorePurchases: async () => { state.restores++; return { entitlements: { active: {} } }; },
    purchasePackage: async () => { state.native++; assert.ok(state.storage.has('sidelineSocial.coachAiPurchasePending.v1.' + sdkUid)); if (state.nativeHook) state.nativeHook(); if (state.nativeError) throw state.nativeError; state.entitled = true; },
  };
  const load = createSourceLoader({
    '@react-native-async-storage/async-storage': { getItem: async key => state.storage.get(key) ?? null, setItem: async (key, value) => { state.storage.set(key, value); }, removeItem: async key => { state.storage.delete(key); } },
    'expo-constants': { __esModule: true, default: { executionEnvironment: 'standalone' }, ExecutionEnvironment: { StoreClient: 'storeClient' } },
    'expo-crypto': { randomUUID: crypto.randomUUID, CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: async (_algorithm, value) => crypto.createHash('sha256').update(value).digest('hex') },
    'react-native': { Platform: { OS: 'android' } }, 'firebase/auth': { onAuthStateChanged: (_auth, callback) => { listener = callback; return () => {}; } },
    '@/config/firebase': { auth, functions: {} }, 'react-native-purchases': { default: sdk },
    'firebase/functions': { httpsCallable: (_functions, name) => async data => {
      state.calls.push(name);
      if (name === 'prepareCoachAiBilling') { if (state.prepareError) throw { code: 'functions/unavailable' }; return { data: { userId: auth.currentUser.uid, prepared: true } }; }
      if (name === 'getCoachAiPurchaseRecoveryDecision') return { data: { userId: auth.currentUser.uid, ...data, outcome: 'cancelled_or_not_started', expiresAtMs: Date.now() + 60_000 } };
      assert.equal(name, 'getCoachAiBillingStatus'); assert.deepEqual(data, {});
      return { data: { userId: auth.currentUser.uid, enabled: state.enabled, entitled: state.entitled, remaining: state.entitled ? 30 : 0, limit: 30, pending: 0, plan: null, resetsAtMs: null, accessUntilMs: null, store: null, autoRenews: false } };
    } },
  });
  const service = load('services/coachAiBillingService.ts');
  const pkg = { identifier: '$rc_monthly', product: { identifier: 'coach_ai:monthly', currencyCode: 'USD', price: 2.99, subscriptionPeriod: 'P1M', defaultOption: { isBasePlan: true } } };
  return { state, service, pkg, switch(uid) { state.uid = uid; auth.currentUser = { uid }; listener(auth.currentUser); } };
}
async function adapterCases() {
  await test('actual_adapter_preparation_and_storefront_fail_before_marker', async () => {
    for (const patch of [{ prepareError: true }, { country: 'CA' }]) {
      const f = adapterFixture(); Object.assign(f.state, patch);
      await assert.rejects(f.service.purchaseCoachAi('adapter_a', 'monthly', f.pkg));
      assert.equal(f.state.storage.size, 0); assert.equal(f.state.native, 0); assert.equal(f.state.restores, 0);
    }
  });
  await test('actual_adapter_no_implicit_restore_or_sync_and_no_duplicate_status_refresh', async () => {
    const f = adapterFixture(); let notifications = 0;
    f.service.subscribeCoachAiBilling(status => { assert.equal(status.entitled, true); notifications++; });
    assert.equal((await f.service.purchaseCoachAi('adapter_a', 'monthly', f.pkg)).entitled, true);
    assert.equal(f.state.native, 1); assert.equal(f.state.restores, 0); assert.equal(f.state.storage.size, 0); assert.equal(notifications, 1);
    assert.deepEqual(f.state.calls, ['getCoachAiBillingStatus', 'prepareCoachAiBilling', 'getCoachAiBillingStatus']);
  });
  await test('actual_adapter_existing_owner_guard_never_enters_checkout', async () => {
    const f = adapterFixture(); f.state.storeOwned = true;
    await assert.rejects(f.service.purchaseCoachAi('adapter_a', 'monthly', f.pkg), e => e.kind === 'ownership_conflict'); assert.equal(f.state.native, 0); assert.equal(f.state.storage.size, 0);
  });
  await test('actual_adapter_billing_off_inspector_reads_legacy_without_cloud_or_sdk', async () => {
    const f = adapterFixture(); f.state.enabled = false; f.state.storage.set('sidelineSocial.coachAiPurchasePending.v1.adapter_a', JSON.stringify({ plan: 'monthly', createdAt: Date.now() - 10_000 }));
    assert.equal((await f.service.inspectCoachAiPurchase('adapter_a')).record.schema, 'legacy'); assert.equal(f.state.calls.length, 0); assert.equal(f.state.sdkReads, 0);
  });
  await test('actual_adapter_review_uses_only_exact_server_decision_and_no_entitlement', async () => {
    const f = adapterFixture(); f.state.storage.set('sidelineSocial.coachAiPurchasePending.v1.adapter_a', JSON.stringify({ plan: 'monthly', createdAt: Date.now() - 10_000 }));
    assert.equal((await f.service.resolveReviewedCoachAiPurchase('adapter_a', 'review_fixture_01')).phase, 'resolved');
    assert.deepEqual(f.state.calls, ['getCoachAiPurchaseRecoveryDecision']); assert.equal(f.state.native, 0); assert.equal(f.state.entitled, false); assert.equal(f.state.storage.size, 0);
  });
  await test('actual_adapter_account_switch_after_native_never_clears_original_attempt', async () => {
    const f = adapterFixture(); f.state.nativeHook = () => f.switch('adapter_b');
    await assert.rejects(f.service.purchaseCoachAi('adapter_a', 'monthly', f.pkg), e => e.kind === 'account_changed');
    assert.ok(f.state.storage.has('sidelineSocial.coachAiPurchasePending.v1.adapter_a'));
  });
}

function reviewedInput() {
  return { request: { reviewReference: 'review_fixture_01', markerFingerprint: 'a'.repeat(64) }, uid: 'buyer_fixture', nowMs: clock, appVerified: true,
    callerClaims: { aiCoachBillingTester: true }, billingConfig: { enabled: false, environment: 'sandbox', projectId: 'ec5f2a61', apiProjectId: 'projec5f2a61', v2SandboxTestingApproved: true, restorePolicy: 'keep_original', salesCountry: 'US' },
    profile: { adultEligibilityConfirmed: true, activeMode: 'coach' }, enrollment: { userId: 'buyer_fixture', state: 'enrolled', lastEnvironment: 'sandbox' }, deletionExists: false, buyerStanding: null,
    review: { userId: 'buyer_fixture', environment: 'sandbox', markerFingerprint: 'a'.repeat(64), decision: 'cancelled_or_not_started', reviewReference: 'review_fixture_01', reviewedAtMs: clock - 1_000, expiresAtMs: clock + 60_000, reviewerUid: 'staff_fixture', storeReconciled: true, providerReconciled: true, approved: true },
    reviewer: { uid: 'staff_fixture', disabled: false, emailVerified: true, claims: { moderationRole: 'moderator', moderationRoleVersion: 1 }, directory: { active: true, role: 'moderator', roleVersion: 1 }, standing: null } };
}
async function backendCases() {
  const { validateCoachAiPurchaseRecoveryDecision: validate, readCoachAiPurchaseRecoveryRequest: request } = source('functions/src/coachAiPurchaseRecoveryCore.ts');
  await test('sandbox_review_can_be_read_with_master_off_without_granting_access', () => {
    const value = validate(reviewedInput()); assert.deepEqual(Object.keys(value).sort(), ['expiresAtMs', 'markerFingerprint', 'outcome', 'reviewReference', 'userId']); assert.equal(value.outcome, 'cancelled_or_not_started');
  });
  await test('client_cannot_add_approval_fields_to_a_request', () => {
    assert.throws(() => request({ ...reviewedInput().request, approved: true })); assert.throws(() => request({ reviewReference: '../unsafe', markerFingerprint: 'a'.repeat(64) }));
  });
  await test('sandbox_identity_exact_record_review_expiry_and_staff_checks_fail_closed', () => {
    const mutations = [
      x => { x.appVerified = false; }, x => { x.callerClaims.aiCoachBillingTester = false; }, x => { x.callerClaims.aiCoachTester = true; },
      x => { x.billingConfig.environment = 'production'; }, x => { x.profile.activeMode = 'parent'; }, x => { x.profile.adultEligibilityConfirmed = false; },
      x => { x.deletionExists = true; }, x => { x.enrollment.state = 'deleting'; }, x => { x.buyerStanding = { status: 'permanently_banned' }; },
      x => { x.review.userId = 'other_buyer'; }, x => { x.review.markerFingerprint = 'b'.repeat(64); }, x => { x.review.environment = 'production'; },
      x => { x.review.decision = 'no_active_entitlement'; }, x => { x.review.approved = false; }, x => { x.review.storeReconciled = false; }, x => { x.review.providerReconciled = false; },
      x => { x.review.expiresAtMs = clock; }, x => { x.review.reviewedAtMs = clock + 1; }, x => { x.review.expiresAtMs = clock + 86_400_000; },
      x => { x.reviewer.disabled = true; }, x => { x.reviewer.emailVerified = false; }, x => { x.reviewer.directory.active = false; },
      x => { x.reviewer.claims.moderationRoleVersion = 2; }, x => { x.reviewer.uid = 'other_staff'; }, x => { x.review.reviewerUid = 'buyer_fixture'; },
    ];
    for (const mutate of mutations) { const value = reviewedInput(); mutate(value); assert.throws(() => validate(value)); }
  });
  await test('callable_is_read_only_appcheck_single_attempt_and_no_provider_or_secret', async () => {
    const input = reviewedInput(); let options, dbRuns = 0, authReads = 0; const reads = [];
    process.env.GCLOUD_PROJECT = 'sideline-social-staging-2026'; process.env.REVENUECAT_PROJECT_ID = 'ec5f2a61'; process.env.REVENUECAT_API_V2_PROJECT_ID = 'projec5f2a61';
    const key = crypto.createHash('sha256').update(input.uid).digest('hex');
    const docs = new Map([['coachAiPurchaseRecoveryReviews/review_fixture_01', { ...input.review, reviewedAtMs: Date.now() - 1000, expiresAtMs: Date.now() + 60_000 }], ['coachAiInternalConfig/billing', input.billingConfig], ['users/' + input.uid, input.profile], ['coachAiBillingEnrollments/' + key, input.enrollment], ['moderatorDirectory/staff_fixture', input.reviewer.directory]]);
    const snapshot = name => ({ exists: docs.has(name), data: () => docs.get(name) });
    const transaction = { get: async ref => { reads.push(ref); return snapshot(ref); }, getAll: async (...refs) => refs.map(ref => { reads.push(ref); return snapshot(ref); }) };
    const loader = createSourceLoader({
      './permanentAuth': { permanentAccountFunctions: () => ({ region: () => ({ runWith: value => { options = value; return { https: { onCall: handler => handler } }; } }) }) },
      './coachAiRevenueCatV2': { coachAiRuntimeIdentity: () => 'reader_fixture' },
      'firebase-functions/v1': { https: { HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } } } },
      'firebase-admin/firestore': { getFirestore: () => ({ doc: name => name, runTransaction: async (fn, config) => { dbRuns++; assert.deepEqual(config, { maxAttempts: 1 }); return fn(transaction); } }) },
      'firebase-admin/auth': { getAuth: () => ({ getUser: async uid => { authReads++; assert.equal(uid, 'staff_fixture'); return { uid, disabled: false, emailVerified: true, customClaims: input.reviewer.claims }; } }) },
    });
    const handler = loader('functions/src/coachAiPurchaseRecovery.ts').getCoachAiPurchaseRecoveryDecision;
    const result = await handler(input.request, { auth: { uid: input.uid, token: input.callerClaims }, app: { appId: 'fixture' } });
    assert.equal(result.userId, input.uid); assert.equal(options.enforceAppCheck, true); assert.equal(options.secrets, undefined); assert.equal(dbRuns, 1); assert.equal(authReads, 1); assert.equal(reads.length, 8);
    assert.equal(transaction.set, undefined); assert.equal(transaction.update, undefined); assert.equal(transaction.delete, undefined);
  });
}
async function main() {
  if (group === 'core') await coreCases(); else if (group === 'adapter') await adapterCases(); else await backendCases();
}
main().then(() => { const result = { status: 'PASSED', group, groups: cases.length, cases, networkRequests: 0, deviceCommands: 0, builds: 0, agentRetries: 0 }; save(group + '-result', result); console.log(JSON.stringify(result)); })
  .catch(error => { const result = { status: 'STOPPED_NO_RETRY', group, passed: cases, error: String(error.stack || error) }; save(group + '-result', result); console.error(JSON.stringify(result)); process.exitCode = 1; });
