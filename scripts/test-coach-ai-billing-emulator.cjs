'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createSourceLoader, root } = require('./coach-ai-test-loader.cjs');
const v2Fixture = require('./coach-ai-revenuecat-v2-fixture.cjs');
const project = process.env.GCLOUD_PROJECT;
assert.equal(project, 'demo-sideline-coach-billing', 'Never run against a live project');
const memory = process.env.COACH_AI_LOCAL_MEMORY_FIXTURE === 'true' ? require('./coach-ai-memory-firestore.cjs').createMemoryFirestore() : null;
if (!memory) assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^(127\.0\.0\.1|localhost):8097$/);
const admin = memory?.admin ?? require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: project });
const db = admin.firestore();
const load = createSourceLoader(memory?.overrides);
const realNow = Date.now;
let clock = realNow(); Date.now = () => clock;
const uid = 'billing_fixture_coach';
const context = { auth: { uid, token: { firebase: { sign_in_provider: 'password' } } }, app: { appId: 'fixture_app_check' } };
let sandbox = false, revoked = false, yearly = false, providerFailure = false, deleteFailure = false, providerCalls = 0, apiCalls = 0, deletes = 0, hold = null;
const originalPurchase = clock - 20 * 86400000;
v2Fixture.installFixtureEnvironment();
process.env.COACH_AI_BILLING_ENVIRONMENT = 'production';
process.env.REVENUECAT_WEBHOOK_SIGNING_SECRET = 'fixture-signature-key-never-real'.repeat(2);
process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN = 'a1'.repeat(32);
process.env.COACH_AI_WEBHOOK_MODE = 'signed';
process.env.COACH_AI_ENDPOINT = 'https://fixture.invalid/coach';
process.env.COACH_AI_API_KEY = 'fixture-shared-secret-never-real-'.repeat(2);
const realFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  if (String(url).startsWith(`https://api.revenuecat.com/v2/projects/${v2Fixture.projectId}/`)) {
    const target = new URL(String(url));
    const customerId = decodeURIComponent(target.pathname.match(/\/customers\/([^/]+)/)?.[1] ?? uid);
    if (options.method === 'DELETE') {
      assert.equal(options.headers.authorization, `Bearer ${process.env.REVENUECAT_ERASURE_KEY}`);
      deletes++; return new Response(JSON.stringify({ object: 'customer', id: customerId, deleted_at: clock }), { status: deleteFailure ? 503 : 200 });
    }
    assert.equal(options.method, 'GET'); assert.equal(options.headers.authorization, `Bearer ${process.env.REVENUECAT_VERIFICATION_KEY}`); apiCalls++;
    const value = v2Fixture.fixtures(customerId, clock, { yearly, sandbox, revoked, startsAt: originalPurchase + (yearly ? 86400000 : 0), expiry: clock + 400 * 86400000 });
    let body;
    if (target.pathname.endsWith(`/customers/${customerId}`)) body = value.customer;
    else if (target.pathname.endsWith('/subscriptions') && target.pathname.includes('/customers/')) body = v2Fixture.list([value.subscription]);
    else if (target.pathname.endsWith('/subscriptions/subfixturecoachai')) body = value.subscription;
    else if (target.pathname.endsWith('/active_entitlements')) body = value.active;
    else throw Error('Unexpected v2 fixture endpoint');
    return new Response(JSON.stringify(body));
  }
  if (url === process.env.COACH_AI_ENDPOINT) {
    providerCalls++;
    if (hold) await hold;
    if (providerFailure) return new Response(JSON.stringify({ error: { code: 'provider_temporarily_unavailable', retryable: true } }), { status: 503 });
    return new Response(JSON.stringify({ result: { resultType: 'talking_points', title: 'A simple team routine', body: 'Start with a short warm-up and offer encouraging feedback.', canSendAsAnnouncement: false } }));
  }
  if (/^http:\/\/(127\.0\.0\.1|localhost):/.test(String(url))) return realFetch(url, options);
  throw new Error('Blocked unexpected external network request');
};
const billing = load('functions/src/coachAiBilling.ts');
const generate = load('functions/src/coachAiPaidGeneration.ts').generatePaidCoachResourceHelp;
const core = load('functions/src/coachAiBillingCore.ts');
const deletion = load('functions/src/coachAiBillingDeletion.ts');
const request = (id, extra = {}) => ({ category: 'other', situation: 'Help build an encouraging team routine.', locale: 'en', clientRequestId: id, ...extra });
const reason = value => error => error.details?.reason === value;
const call = (id, extra) => generate.run(request(id, extra), context);
function account() { return db.doc(`coachAiBillingAccounts/${core.billingDocumentId('production', uid)}`); }
function window() { return account().collection('windows').doc(core.coachAiMonthlyWindow(originalPurchase, clock).id); }
async function ledger() { return (await window().get()).data(); }
async function resetUsage(fulfilled = 0) {
  const current = core.coachAiMonthlyWindow(originalPurchase, clock);
  await window().set({ accountUid: uid, userId: uid, windowId: current.id, limit: 30, fulfilled, reserved: 0 });
}
async function webhook(event) {
  const rawBody = Buffer.from(JSON.stringify({ event }));
  const timestamp = String(Math.floor(clock / 1000));
  const signature = `t=${timestamp},v1=${crypto.createHmac('sha256', process.env.REVENUECAT_WEBHOOK_SIGNING_SECRET).update(`${timestamp}.`).update(rawBody).digest('hex')}`;
  const request = { method: 'POST', rawBody, body: { event }, get: name => name === 'authorization' ? `Bearer ${process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN}` : signature };
  const reply = { statusCode: 0, body: null, set() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  await billing.coachAiRevenueCatWebhook(request, reply);
  return reply;
}
async function run() {
  await db.doc(`users/${uid}`).set({ adultEligibilityConfirmed: true, activeMode: 'coach' });
  await db.doc('coachAiInternalConfig/runtime').set({ enabled: true });
  assert.equal((await billing.getCoachAiBillingStatus.run({}, context)).enabled, false); assert.equal(apiCalls, 0);
  await assert.rejects(billing.getCoachAiBillingStatus.run({ customerInfo: { entitled: true } }, context), reason('invalid_billing_request'));
  process.env.COACH_AI_PAID_ENABLED = 'true';
  await db.doc('coachAiInternalConfig/billing').set({ enabled: true, environment: 'production', projectId: 'ec5f2a61', allowance: 30,
    restorePolicy: 'keep_original', salesCountry: 'US', storeConnectionsVerified: true, appIds: v2Fixture.appIds });
  assert.equal((await billing.getCoachAiBillingStatus.run({}, context)).enabled, false); assert.equal(apiCalls, 0, 'Legacy configuration cannot activate the v2 route');
  await db.doc('coachAiInternalConfig/billing').set({ ...v2Fixture.configuration(), runtimeSecretIsolationVerified: false });
  assert.equal((await billing.getCoachAiBillingStatus.run({}, context)).enabled, false); assert.equal(apiCalls, 0);
  await db.doc('coachAiInternalConfig/billing').set(v2Fixture.configuration());
  assert.deepEqual(billing.getCoachAiBillingStatus.__endpoint.secretEnvironmentVariables.map(value => value.key), ['REVENUECAT_VERIFICATION_KEY']);
  assert.equal(billing.getCoachAiBillingStatus.__endpoint.serviceAccountEmail, process.env.COACH_AI_BILLING_READER_SERVICE_ACCOUNT);
  assert.equal(generate.__endpoint.serviceAccountEmail, process.env.COACH_AI_BILLING_GENERATOR_SERVICE_ACCOUNT);
  assert.equal(billing.coachAiRevenueCatWebhook.__endpoint.serviceAccountEmail, process.env.COACH_AI_BILLING_WEBHOOK_SERVICE_ACCOUNT);
  assert.deepEqual(generate.__endpoint.secretEnvironmentVariables.map(value => value.key), ['REVENUECAT_VERIFICATION_KEY', 'COACH_AI_API_KEY', 'COACH_AI_ENDPOINT']);
  assert.deepEqual(billing.coachAiRevenueCatWebhook.__endpoint.secretEnvironmentVariables.map(value => value.key), ['REVENUECAT_WEBHOOK_AUTH_TOKEN', 'REVENUECAT_WEBHOOK_SIGNING_SECRET', 'REVENUECAT_VERIFICATION_KEY']);
  const runtimeNames = ['READER','GENERATOR','WEBHOOK','ERASURE'].map(role => `COACH_AI_BILLING_${role}_SERVICE_ACCOUNT`);
  const originalWebhookRuntime = process.env.COACH_AI_BILLING_WEBHOOK_SERVICE_ACCOUNT;
  process.env.COACH_AI_BILLING_WEBHOOK_SERVICE_ACCOUNT = process.env.COACH_AI_BILLING_GENERATOR_SERVICE_ACCOUNT;
  assert.equal((await billing.getCoachAiBillingStatus.run({}, context)).enabled, false);
  assert.equal(apiCalls, 0, 'Shared runtime identities must deny billing before accessing RevenueCat');
  process.env.COACH_AI_BILLING_WEBHOOK_SERVICE_ACCOUNT = originalWebhookRuntime;
  assert.equal(new Set(runtimeNames.map(name => process.env[name])).size, 4);
  assert.equal(generate.__endpoint.secretEnvironmentVariables.some(value => value.key === 'REVENUECAT_ERASURE_KEY'), false);
  await assert.rejects(generate.run(request('unauthenticated_fixture'), {}), e => e.code === 'unauthenticated');
  await assert.rejects(generate.run(request('appcheck_fixture'), { auth: context.auth }), reason('app_check_required'));
  await db.doc(`users/${uid}`).update({ activeMode: 'parent' }); await assert.rejects(call('parent_fixture'), reason('adult_coach_mode_required'));
  await db.doc(`users/${uid}`).update({ activeMode: 'coach' });
  process.env.COACH_AI_BILLING_ENVIRONMENT = 'sandbox'; sandbox = true;
  await db.doc('coachAiInternalConfig/billing').set({ ...v2Fixture.configuration('sandbox'), v2StoreLifecycleVerified: false });
  const beforeSandbox = apiCalls;
  await assert.rejects(billing.getCoachAiBillingStatus.run({}, context), reason('billing_tester_required')); assert.equal(apiCalls, beforeSandbox);
  const sandboxTester = { ...context, auth: { ...context.auth, token: { ...context.auth.token, aiCoachBillingTester: true } } };
  const freeTester = { ...context, auth: { ...context.auth, token: { ...context.auth.token, aiCoachTester: true } } };
  const dualTester = { ...sandboxTester, auth: { ...sandboxTester.auth, token: { ...sandboxTester.auth.token, aiCoachTester: true } } };
  await assert.rejects(billing.prepareCoachAiBilling.run({}, freeTester), reason('billing_tester_required'));
  await assert.rejects(billing.prepareCoachAiBilling.run({}, dualTester), reason('billing_tester_required'));
  assert.deepEqual(await billing.prepareCoachAiBilling.run({}, sandboxTester), { userId: uid, prepared: true });
  assert.equal((await billing.getCoachAiBillingStatus.run({}, sandboxTester)).entitled, true);
  process.env.COACH_AI_BILLING_ENVIRONMENT = 'production'; sandbox = false;
  await db.doc('coachAiInternalConfig/billing').set(v2Fixture.configuration());
  await db.doc(`accountStanding/${uid}`).set({ messagingRestricted: true }); await assert.rejects(call('restricted_fixture'), reason('messaging_restricted'));
  await db.doc(`accountStanding/${uid}`).delete();
  const status = await billing.getCoachAiBillingStatus.run({}, context); assert.equal(status.userId, uid); assert.equal(status.remaining, 30);
  assert.ok(status.accessUntilMs > clock + 300000, 'Public paid-through date is not the five-minute verification lease');
  const accountSnapshot = (await account().get()).data();
  await account().update({ checkedAtMs: clock + 1 });
  await assert.rejects(billing.getCoachAiBillingStatus.run({}, context), reason('billing_verification_unavailable'));
  await account().set(accountSnapshot);
  await account().update({ userId: 'another_stored_account' });
  await assert.rejects(billing.getCoachAiBillingStatus.run({}, context), reason('billing_verification_unavailable'));
  await account().set(accountSnapshot);
  for (let i = 0; i < 30; i++) await call(`response_fixture_${i}`);
  assert.equal((await ledger()).fulfilled, 30); assert.equal((await ledger()).reserved, 0); assert.equal(providerCalls, 30);
  await assert.rejects(call('response_fixture_31'), reason('coach_ai_allowance_exhausted')); assert.equal(providerCalls, 30);
  await call('response_fixture_0'); assert.equal(providerCalls, 30); assert.equal((await ledger()).fulfilled, 30, 'Duplicate completed IDs consume once');
  await call('safety_fixture', { situation: 'A child is in immediate danger and needs emergency help.' }); assert.equal(providerCalls, 30); assert.equal((await ledger()).fulfilled, 30, 'Local safety output remains uncharged at limit');
  await resetUsage(); providerFailure = true; const callsBeforeFailure = providerCalls;
  await assert.rejects(call('failure_fixture')); assert.equal(providerCalls, callsBeforeFailure + 1, 'Retryable upstream errors cause exactly one attempt'); assert.equal((await ledger()).fulfilled, 0); assert.equal((await ledger()).reserved, 0); providerFailure = false;
  await call('failure_fixture'); assert.equal((await ledger()).fulfilled, 1, 'Explicit manual retry may succeed after known provider failure');
  await resetUsage(29);
  const beforeConcurrent = providerCalls;
  const concurrent = await Promise.allSettled([call('concurrent_fixture_a'), call('concurrent_fixture_b')]);
  const succeeded = concurrent.filter(v => v.status === 'fulfilled').length;
  assert.ok(succeeded <= 1, 'Single-attempt transaction contention can reject both; never fulfill both at the last slot');
  assert.ok((await ledger()).fulfilled + (await ledger()).reserved <= 30);
  assert.ok(providerCalls <= beforeConcurrent + 1, 'At most one AI request obtains the last allowance slot');
  if (succeeded === 0) {
    for (const outcome of concurrent) {
      const error = outcome.reason;
      assert.ok([10, 'aborted', 'resource-exhausted', 'unavailable'].includes(error.code), `Unexpected concurrent failure: ${error.code}/${error.details?.reason}`);
    }
    const firstReceipt = await db.doc(`coachAiPaidRequests/${core.billingRequestId('production', uid, 'concurrent_fixture_a')}`).get();
    const secondReceipt = await db.doc(`coachAiPaidRequests/${core.billingRequestId('production', uid, 'concurrent_fixture_b')}`).get();
    const manualId = secondReceipt.data()?.status === 'processing' ? 'concurrent_fixture_b' : 'concurrent_fixture_a';
    assert.ok(firstReceipt.data()?.status !== 'completed' && secondReceipt.data()?.status !== 'completed');
    // Simulate exactly one explicit USER recovery action after both requests
    // return. The implementation never invokes this recovery automatically.
    await call(manualId);
  }
  assert.equal((await ledger()).fulfilled, 30); assert.equal((await ledger()).reserved, 0); assert.equal(providerCalls, beforeConcurrent + 1);
  if (memory) {
    await resetUsage(29);
    const ordinary = db.runTransaction.bind(db); let conflicts = 2;
    db.runTransaction = (fn, options) => ordinary(transaction => {
      const set = transaction.set.bind(transaction);
      transaction.set = (ref, value, ...rest) => {
        if (conflicts > 0 && ref.path.startsWith('coachAiBillingVerificationRates/')) { conflicts--; const error = Error('fixture contention'); error.code = 10; throw error; }
        return set(ref, value, ...rest);
      };
      return fn(transaction);
    }, options);
    const before = providerCalls;
    const rejected = await Promise.allSettled([call('rejected_concurrent_a'), call('rejected_concurrent_b')]);
    assert.equal(rejected.filter(v => v.status === 'rejected').length, 2); assert.equal(providerCalls, before);
    db.runTransaction = ordinary;
    await call('rejected_concurrent_a'); // One explicit simulated user recovery.
    assert.equal(providerCalls, before + 1); assert.equal((await ledger()).fulfilled, 30);
  }
  await resetUsage();
  let release; hold = new Promise(resolve => { release = resolve; });
  const beforeHeld = providerCalls; const active = call('held_fixture');
  for (let i = 0; providerCalls === beforeHeld && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(providerCalls, beforeHeld + 1);
  await assert.rejects(call('held_fixture'), reason('request_in_progress')); assert.equal(providerCalls, beforeHeld + 1);
  release(); hold = null; await active; assert.equal((await ledger()).fulfilled, 1);
  // Inject a local transaction failure after the response is persisted, before
  // fulfillment. A manual retry must recover that response, never generate again.
  const runTransaction = db.runTransaction.bind(db); let injected = false;
  db.runTransaction = (fn, options) => runTransaction(transaction => {
    const update = transaction.update.bind(transaction);
    transaction.update = (ref, value, ...rest) => {
      if (!injected && ref.path.startsWith('coachAiPaidRequests/') && value.status === 'completed') { injected = true; throw new Error('fixture finalization interruption'); }
      return update(ref, value, ...rest);
    };
    return fn(transaction);
  }, options);
  const beforeRecovery = providerCalls;
  await assert.rejects(call('recovery_fixture')); db.runTransaction = runTransaction;
  assert.equal(injected, true); assert.equal((await ledger()).reserved, 1);
  await call('recovery_fixture'); assert.equal(providerCalls, beforeRecovery + 1); assert.equal((await ledger()).reserved, 0); assert.equal((await ledger()).fulfilled, 2);
  const anchorBefore = (await account().get()).data().anchorMs; yearly = true; clock += 1000;
  assert.equal((await billing.getCoachAiBillingStatus.run({}, context)).plan, 'yearly'); assert.equal((await account().get()).data().anchorMs, anchorBefore); assert.equal((await ledger()).fulfilled, 2);
  revoked = true; clock += 1000; await assert.rejects(call('refunded_fixture'), reason('paid_entitlement_required')); revoked = false;
  sandbox = true; clock += 1000; await assert.rejects(billing.getCoachAiBillingStatus.run({}, context), reason('billing_verification_unavailable')); sandbox = false;
  clock += 1000; await billing.getCoachAiBillingStatus.run({}, context);
  const event = { id: 'webhook_fixture', type: 'RENEWAL', app_id: 'appfixtureios', environment: 'PRODUCTION', app_user_id: uid };
  const beforeWebhook = apiCalls; assert.equal((await webhook(event)).statusCode, 200); assert.equal(apiCalls, beforeWebhook + 4);
  assert.equal((await webhook(event)).body.duplicate, true); assert.equal(apiCalls, beforeWebhook + 4);
  await db.doc('coachAiInternalConfig/runtime').update({ enabled: false }); await assert.rejects(call('disabled_fixture'), reason('billing_unavailable')); await db.doc('coachAiInternalConfig/runtime').update({ enabled: true });
  // Security Rules: authenticated mobile clients cannot read or alter billing,
  // usage, idempotency or erasure records, including account subcollections.
  if (!memory) {
  const rulesTesting = require('@firebase/rules-unit-testing');
  const client = require('firebase/firestore');
  const environment = await rulesTesting.initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port: 8097, rules: fs.readFileSync(root + '/firestore.rules', 'utf8') } });
  const clients = [environment.authenticatedContext(uid).firestore(), environment.unauthenticatedContext().firestore()];
  for (const path of [account().path, window().path, 'coachAiBillingEnrollments/client_fixture', 'coachAiPaidRequests/client_fixture', 'coachAiBillingEvents/client_fixture', 'coachAiBillingRateLimits/client_fixture', 'coachAiBillingVerificationRates/client_fixture', 'coachAiBillingDeletionQueue/client_fixture', 'coachAiInternalConfig/billing']) {
    if (!(await db.doc(path).get()).exists) await db.doc(path).set({ fixture: true });
    for (const mobile of clients) {
    await rulesTesting.assertFails(client.getDoc(client.doc(mobile, path)));
    await rulesTesting.assertFails(client.setDoc(client.doc(mobile, path), { entitled: true, fulfilled: 0 }));
    await rulesTesting.assertFails(client.updateDoc(client.doc(mobile, path), { entitled: true }));
    await rulesTesting.assertFails(client.deleteDoc(client.doc(mobile, path)));
    }
  }
  for (const mobile of clients) await rulesTesting.assertFails(client.getDocs(client.collection(mobile, 'coachAiBillingEnrollments')));
  await environment.cleanup();
  }
  deleteFailure = true; await deletion.deleteCoachAiBillingData(uid); assert.equal(deletes, 1); await deletion.deleteCoachAiBillingData(uid); assert.equal(deletes, 1, 'Deletion failure is queued; no automatic repeated vendor write');
  const marker = await db.doc(`coachAiBillingDeletionQueue/${crypto.createHash('sha256').update(uid).digest('hex')}`).get(); assert.equal(marker.data().status, 'needs_review'); assert.equal((await account().get()).exists, false);
  await assert.rejects(billing.getCoachAiBillingStatus.run({}, context), reason('account_deleting'));
  console.log(`${memory ? 'Local read-version transaction fixture (Rules/emulator still unverified)' : 'Real isolated Firestore transactions and Rules'}: 30-response cap, cross-device concurrency, deduplication, failures/safety, recovery, plan changes, refunds, App Check/context gates, webhook replay and single-attempt erasure passed.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { Date.now = realNow; global.fetch = realFetch; await admin.app().delete(); });
