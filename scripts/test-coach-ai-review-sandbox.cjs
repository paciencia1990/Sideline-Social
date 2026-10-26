'use strict';
// Actual billing callables/webhook with in-memory Firestore and a fake provider.
// No SDK purchase, external request, retry, emitted build or live configuration.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createHash, createHmac } = require('node:crypto');
const http = require('node:http'), https = require('node:https');
const { createSourceLoader, root } = require('./coach-ai-test-loader.cjs');
const { createMemoryFirestore } = require('./coach-ai-memory-firestore.cjs');
const catalog = require('./coach-ai-revenuecat-v2-fixture.cjs');
const prefix = path.join(root, 'docs/coach-ai-review-sandbox');
fs.writeFileSync(prefix + '-focused-attempt-20261016.json', JSON.stringify({ at: new Date().toISOString(), attempts: 1,
  networkRequests: 0, builds: 0, deployments: 0 }) + '\n', { flag: 'wx' });
let networkAttempts = 0;
function forbidden() { networkAttempts++; throw Error('review_fixture_network_forbidden'); }
global.fetch = http.request = http.get = https.request = https.get = forbidden;
const token = 'aa'.repeat(32), signing = 'synthetic_hmac_only_not_a_real_secret'.repeat(2);
const reviewer = 'synthetic_review_coach', other = 'synthetic_customer_coach';
const hash = value => createHash('sha256').update(value).digest('hex');
class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
const reason = expected => error => error.details?.reason === expected;
const cases = [];
async function test(name, fn) { await fn(); cases.push(name); }
function reviewPolicy(changes = {}) {
  return { enabled: true, projectId: 'ec5f2a61', environment: 'sandbox', startsAtMs: Date.now() - 60_000,
    expiresAtMs: Date.now() + 86400000, reviewerUidHashes: [hash(reviewer)], ...changes };
}
async function fixture(environment = 'production') {
  catalog.installFixtureEnvironment();
  Object.assign(process.env, { COACH_AI_WEBHOOK_MODE: 'signed', COACH_AI_PAID_ENABLED: 'true',
    COACH_AI_BILLING_ENVIRONMENT: environment, COACH_AI_REVIEW_SANDBOX_ENABLED: 'true',
    REVENUECAT_WEBHOOK_AUTH_TOKEN: token, REVENUECAT_WEBHOOK_SIGNING_SECRET: signing });
  const memory = createMemoryFirestore(), db = memory.db, calls = [], logs = [];
  await db.doc('coachAiInternalConfig/billing').set(catalog.configuration(environment));
  await db.doc('coachAiInternalConfig/runtime').set({ enabled: true });
  const policy = db.doc('coachAiInternalConfig/reviewSandbox'); await policy.set(reviewPolicy());
  for (const uid of [reviewer, other]) await db.doc(`users/${uid}`).set({ activeMode: 'coach', adultEligibilityConfirmed: true });
  const sdk = { https: { HttpsError, onCall: handler => ({ run: handler }), onRequest: handler => handler },
    region() { return this; }, runWith() { return this; }, logger: { error: (...v) => logs.push(v) } };
  const overrides = { ...memory.overrides, 'firebase-functions/v1': sdk };
  const provider = createSourceLoader(overrides)('functions/src/coachAiRevenueCatV2.ts');
  const settings = { failLookup: false, hasSubscription: true };
  const lookupRevenueCatV2 = async (uid, config) => {
    calls.push({ uid, environment: config.environment });
    if (settings.failLookup) throw Error('synthetic_provider_failure');
    const now = Date.now();
    return { checkedAtMs: now, customerExists: true, originalPurchaseAtMs: now - 86400000,
      subscription: settings.hasSubscription ? { accountUid: uid, entitlementId: 'coach_ai',
        productId: 'com.sidelinesocial.coachai.monthly', store: 'app_store', environment: config.environment,
        status: 'active', verifiedAtMs: now, accessUntilMs: now + 300000, paidThroughMs: now + 86400000, autoRenews: true } : null };
  };
  const load = createSourceLoader({ ...overrides, './coachAiRevenueCatV2': { ...provider, lookupRevenueCatV2 } });
  const billing = load('functions/src/coachAiBilling.ts');
  const core = load('functions/src/coachAiBillingCore.ts');
  const context = (uid = reviewer, claims = { aiCoachBillingTester: true }) => ({ auth: { uid,
    token: { firebase: { sign_in_provider: 'password' }, ...claims } }, app: { appId: 'synthetic_app_check' } });
  const account = (env, uid = reviewer) => db.doc('coachAiBillingAccounts/' + core.billingDocumentId(env, uid));
  const enrollment = (uid = reviewer) => db.doc('coachAiBillingEnrollments/' + hash(uid));
  const eventRef = (id, env = 'sandbox') => db.doc('coachAiBillingEvents/' + hash(env + ':' + id));
  async function deliver(event = {}, headers = {}) {
    const body = { event: { id: 'synthetic_review_event', type: 'RENEWAL', environment: 'SANDBOX',
      app_id: catalog.appIds[0], app_user_id: reviewer, ...event } };
    const rawBody = Buffer.from(JSON.stringify(body)), timestamp = String(Math.floor(Date.now() / 1000));
    const signed = `t=${timestamp},v1=${createHmac('sha256', signing).update(`${timestamp}.`).update(rawBody).digest('hex')}`;
    const allHeaders = { authorization: 'Bearer ' + token, 'x-revenuecat-webhook-signature': signed, ...headers };
    const response = { statusCode: null, body: null, set() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
    await billing.coachAiRevenueCatWebhook({ method: 'POST', rawBody, get: name => allHeaders[name] }, response);
    return response;
  }
  return { db, policy, billing, core, context, calls, settings, account, enrollment, eventRef, deliver, logs };
}
async function run() {
  await test('ordinary_customers_remain_production_and_internal_gateway_keeps_base_scope', async () => {
    const f = await fixture();
    assert.equal((await f.billing.readCoachAiBillingConfig()).environment, 'production');
    assert.equal((await f.billing.getCoachAiBillingStatus.run({}, f.context(other, {}))).entitled, true);
    assert.deepEqual(f.calls, [{ uid: other, environment: 'production' }]);
    assert.equal((await f.account('sandbox', other).get()).exists, false);
  });
  await test('review_enrollment_status_and_generation_guard_all_select_sandbox', async () => {
    const f = await fixture();
    assert.equal((await f.billing.prepareCoachAiBilling.run({}, f.context())).prepared, true);
    assert.equal((await f.enrollment().get()).data().lastEnvironment, 'sandbox');
    assert.equal((await f.billing.getCoachAiBillingStatus.run({}, f.context())).entitled, true);
    assert.equal((await f.billing.requireVerifiedCoachAiSubscription(reviewer, f.context())).config.environment, 'sandbox');
    assert.ok(f.calls.length === 2 && f.calls.every(call => call.environment === 'sandbox'));
    assert.equal((await f.account('production').get()).exists, false);
  });
  await test('claim_and_allowlist_are_both_required_and_free_beta_claim_cannot_replace_purchase', async () => {
    for (const [uid, claims] of [[reviewer, {}], [reviewer, { aiCoachBillingTester: true, aiCoachTester: true }],
      [other, { aiCoachBillingTester: true }]]) {
      const f = await fixture();
      await assert.rejects(f.billing.prepareCoachAiBilling.run({}, f.context(uid, claims)), reason('billing_review_unavailable'));
      assert.equal(f.calls.length, 0); assert.equal((await f.enrollment(uid).get()).exists, false);
    }
  });
  await test('review_route_is_off_by_default_without_sending_test_accounts_to_real_billing', async () => {
    for (const value of [undefined, 'false']) {
      const f = await fixture();
      if (value === undefined) delete process.env.COACH_AI_REVIEW_SANDBOX_ENABLED; else process.env.COACH_AI_REVIEW_SANDBOX_ENABLED = value;
      await assert.rejects(f.billing.getCoachAiBillingStatus.run({}, f.context()), reason('billing_review_unavailable'));
      assert.equal(f.calls.length, 0);
      assert.equal((await f.billing.readCoachAiBillingConfig(f.context(other, {}))).environment, 'production');
    }
  });
  await test('invalid_expired_future_or_oversized_review_policies_fail_closed', async () => {
    const now = Date.now();
    for (const changes of [{ enabled: false }, { environment: 'production' }, { projectId: 'other' },
      { expiresAtMs: now - 1 }, { startsAtMs: now + 86400000 },
      { startsAtMs: now - 60000, expiresAtMs: now + 31 * 86400000 },
      { reviewerUidHashes: [] }, { reviewerUidHashes: [hash(reviewer), hash(reviewer)] },
      { reviewerUidHashes: ['malformed'] }, { startsAtMs: 'today' }]) {
      const f = await fixture(); await f.policy.set(reviewPolicy(changes));
      await assert.rejects(f.billing.prepareCoachAiBilling.run({}, f.context()), reason('billing_review_unavailable'));
      assert.equal(f.calls.length, 0);
    }
  });
  await test('review_still_requires_native_product_mapping_and_sandbox_attestation', async () => {
    const f = await fixture();
    await f.db.doc('coachAiInternalConfig/billing').update({ v2SandboxTestingApproved: false });
    assert.equal((await f.billing.getCoachAiBillingStatus.run({}, f.context())).enabled, false);
    assert.equal(f.calls.length, 0);
    assert.equal((await f.billing.readCoachAiBillingConfig(f.context(other, {}))).environment, 'production');
  });
  await test('app_check_adult_coach_standing_and_deletion_fences_remain_required', async () => {
    for (const variant of ['app_check', 'parent', 'minor', 'suspended', 'deleting', 'deletion_queue']) {
      const f = await fixture(), context = f.context();
      if (variant === 'app_check') delete context.app;
      if (variant === 'parent') await f.db.doc('users/' + reviewer).update({ activeMode: 'parent' });
      if (variant === 'minor') await f.db.doc('users/' + reviewer).update({ adultEligibilityConfirmed: false });
      if (variant === 'suspended') await f.db.doc('accountStanding/' + reviewer).set({ status: 'suspended' });
      if (variant === 'deleting') await f.enrollment().set({ userId: reviewer, state: 'deleting' });
      if (variant === 'deletion_queue') await f.db.doc('coachAiBillingDeletionQueue/' + hash(reviewer)).set({ status: 'pending' });
      await assert.rejects(f.billing.getCoachAiBillingStatus.run({}, context)); assert.equal(f.calls.length, 0);
    }
  });
  await test('client_payload_cannot_choose_an_environment', async () => {
    const f = await fixture();
    for (const handler of [f.billing.prepareCoachAiBilling, f.billing.getCoachAiBillingStatus]) {
      await assert.rejects(handler.run({ environment: 'sandbox' }, f.context(other, {})), error => error.code === 'invalid-argument');
    }
    assert.equal(f.calls.length, 0);
  });
  await test('missing_subscription_or_provider_failure_never_triggers_other_environment_lookup', async () => {
    for (const failure of [false, true]) {
      const f = await fixture(); f.settings.failLookup = failure; f.settings.hasSubscription = false;
      await assert.rejects(f.billing.requireVerifiedCoachAiSubscription(reviewer, f.context()),
        reason(failure ? 'billing_verification_unavailable' : 'paid_entitlement_required'));
      assert.deepEqual(f.calls, [{ uid: reviewer, environment: 'sandbox' }]);
    }
  });
  await test('sandbox_and_production_usage_windows_do_not_mix', async () => {
    const f = await fixture(), anchorMs = Date.now() - 86400000;
    for (const [environment, fulfilled] of [['sandbox', 7], ['production', 29]]) {
      await f.account(environment).set({ userId: reviewer, environment, anchorMs });
      const window = f.core.coachAiMonthlyWindow(anchorMs, Date.now());
      await f.account(environment).collection('windows').doc(window.id).set({ accountUid: reviewer, windowId: window.id, limit: 30, fulfilled, reserved: 0 });
    }
    assert.equal((await f.billing.getCoachAiBillingStatus.run({}, f.context())).remaining, 23);
    const production = (await f.account('production').get()).data(); assert.equal(production.anchorMs, anchorMs);
  });
  await test('signed_sandbox_notifications_reconcile_only_reviewers_and_duplicate_events_do_not_replay', async () => {
    const f = await fixture(); assert.deepEqual((await f.deliver()).body, { received: true });
    assert.deepEqual(f.calls, [{ uid: reviewer, environment: 'sandbox' }]);
    assert.equal((await f.eventRef('synthetic_review_event').get()).data().status, 'completed');
    assert.equal((await f.account('production').get()).exists, false);
    assert.equal((await f.deliver()).body.duplicate, true); assert.equal(f.calls.length, 1);
    assert.ok(!JSON.stringify(f.logs).includes(reviewer));
  });
  await test('mixed_transfer_foreign_app_and_unlisted_notification_are_rejected_before_claim_or_provider_read', async () => {
    for (const event of [{ app_user_id: other }, { app_id: 'appforeign' },
      { type: 'TRANSFER', transferred_from: [reviewer], transferred_to: [other] }]) {
      const f = await fixture(); assert.equal((await f.deliver(event)).body.ignored, true);
      assert.equal(f.calls.length, 0); assert.equal((await f.eventRef('synthetic_review_event').get()).exists, false);
    }
  });
  await test('signature_disable_expiry_and_deleted_account_cannot_bypass_sandbox_scope', async () => {
    for (const variant of ['signature', 'disabled', 'expired', 'deleted']) {
      const f = await fixture();
      if (variant === 'disabled') delete process.env.COACH_AI_REVIEW_SANDBOX_ENABLED;
      if (variant === 'expired') await f.policy.update({ expiresAtMs: Date.now() - 1 });
      if (variant === 'deleted') await f.db.doc('users/' + reviewer).delete();
      const response = await f.deliver({}, variant === 'signature' ? { 'x-revenuecat-webhook-signature': undefined } : {});
      if (variant === 'signature') assert.equal(response.statusCode, 401);
      else if (variant !== 'deleted') assert.equal(response.body.ignored, true);
      assert.equal(f.calls.length, 0); assert.equal((await f.account('sandbox').get()).exists, false);
    }
  });
  await test('production_notifications_and_existing_sandbox_only_beta_remain_supported', async () => {
    let f = await fixture(); await f.deliver({ environment: 'PRODUCTION', app_user_id: other });
    assert.deepEqual(f.calls, [{ uid: other, environment: 'production' }]);
    f = await fixture('sandbox'); delete process.env.COACH_AI_REVIEW_SANDBOX_ENABLED; await f.policy.delete();
    assert.equal((await f.billing.getCoachAiBillingStatus.run({}, f.context())).entitled, true);
    assert.deepEqual(f.calls, [{ uid: reviewer, environment: 'sandbox' }]);
    await assert.rejects(f.billing.prepareCoachAiBilling.run({}, f.context(other, {})), reason('billing_tester_required'));
  });
  await test('global_disable_wins_over_review_access_and_test_event_never_reads_a_customer', async () => {
    let f = await fixture(); process.env.COACH_AI_PAID_ENABLED = 'false';
    assert.equal((await f.billing.getCoachAiBillingStatus.run({}, f.context())).enabled, false);
    assert.equal((await f.deliver()).body.disabled, true); assert.equal(f.calls.length, 0);
    f = await fixture(); assert.deepEqual((await f.deliver({ type: 'TEST' })).body, { received: true }); assert.equal(f.calls.length, 0);
  });
  assert.equal(networkAttempts, 0);
}
run().then(() => {
  const result = { passed: true, cases: cases.length, caseNames: cases, networkAttempts, providerNetworkRequests: 0,
    liveWrites: 0, builds: 0, deployments: 0, agentRetries: 0, nativeAcceptance: false };
  fs.writeFileSync(prefix + '-focused-result-20261016.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(result));
}).catch(error => {
  const result = { passed: false, completedCases: cases, networkAttempts, error: error.message, stack: error.stack };
  fs.writeFileSync(prefix + '-focused-result-20261016.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.error(JSON.stringify(result)); process.exitCode = 1;
});
