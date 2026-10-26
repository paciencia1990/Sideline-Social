'use strict';
// Actual feedback handler and auth/standing wrapper, in-memory Firestore,
// synthetic ownership receipts, and a stub for the unchanged moderation intake.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http'), https = require('node:https');
const { createSourceLoader } = require('./coach-ai-test-loader.cjs');
const { createMemoryFirestore } = require('./coach-ai-memory-firestore.cjs');
const originals = [global.fetch, http.request, http.get, https.request, https.get];
let networkAttempts = 0;
function forbidden() { networkAttempts++; throw Error('focused_fixture_network_forbidden'); }
global.fetch = http.request = http.get = https.request = https.get = forbidden;
const environmentNames = ['COACH_AI_TESTING_ENABLED', 'FUNCTIONS_EMULATOR', 'COACH_AI_PAID_ENABLED'];
const previousEnvironment = Object.fromEntries(environmentNames.map(name => [name, process.env[name]]));
for (const name of environmentNames) process.env[name] = 'false';
class HttpsError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}
const cases = [];
async function test(name, fn) { await fn(); cases.push(name); }
async function fixture(environment = 'sandbox') {
  const memory = createMemoryFirestore(), db = memory.db, ingestions = [], logs = [];
  const sdk = { https: { HttpsError, onCall: handler => ({ run: handler }) },
    region() { return this; }, runWith() { return this; },
    logger: { info: (...values) => logs.push(values) } };
  const load = createSourceLoader({ ...memory.overrides, 'firebase-functions/v1': sdk,
    './moderationReportsCore': { coachAiModerationIngestionEnabled: () => true },
    './moderationReports': { createCoachAiUnsafeModerationReport: async input => {
      ingestions.push(input); return { receiptNumber: 'synthetic_receipt' };
    } },
  });
  const core = load('functions/src/coachAiBillingCore.ts');
  const handler = load('functions/src/coachAiFeedback.ts').submitCoachAiFeedback;
  const uid = 'synthetic_feedback_coach', requestId = 'synthetic_saved_guide';
  const profile = db.doc('users/' + uid);
  const cache = db.doc(`coachAiRequests/${uid}_${requestId}`);
  const feedback = db.doc(`coachAiFeedback/${uid}_${requestId}`);
  const rate = db.doc('coachAiFeedbackRateLimits/' + uid);
  const enrollment = db.doc('coachAiBillingEnrollments/' + crypto.createHash('sha256').update(uid).digest('hex'));
  const receipt = (env = environment, user = uid, id = requestId) => db.doc('coachAiPaidRequests/' + core.billingRequestId(env, user, id));
  const receiptData = { userId: uid, environment, clientRequestId: requestId,
    status: 'completed', billable: true, fingerprint: 'a'.repeat(64) };
  await profile.set({ adultEligibilityConfirmed: true, activeMode: 'coach' });
  await db.doc('coachAiInternalConfig/runtime').set({ enabled: false });
  const context = { auth: { uid, token: { firebase: { sign_in_provider: 'password' } } }, app: { appId: 'synthetic_app_check' } };
  const data = { requestId, rating: 'down', reason: 'unsafe' };
  return { db, uid, requestId, profile, cache, feedback, rate, enrollment, receipt,
    receiptData, context, data, ingestions, logs,
    seedReceipt: changes => receipt().set({ ...receiptData, ...changes }),
    call: (input = data, auth = context) => handler.run(input, auth),
  };
}
async function noFeedback(f) {
  assert.equal((await f.feedback.get()).exists, false);
  assert.equal((await f.rate.get()).exists, false);
  assert.equal(f.ingestions.length, 0);
}
async function run() {
  await test('paid_saved_output_reports_after_actual_cache_removal_in_either_environment', async () => {
    for (const environment of ['sandbox', 'production']) {
      const f = await fixture(environment); await f.seedReceipt();
      await f.cache.set({ userId: f.uid, status: 'completed', paid: true, result: { title: 'synthetic_private_guide_text' } });
      await f.cache.delete();
      const before = (await f.receipt().get()).data();
      const response = await f.call();
      assert.equal(response.saved, true); assert.equal(response.reviewStatus, 'needs_review');
      assert.equal(response.moderationReceiptNumber, 'synthetic_receipt');
      assert.equal((await f.cache.get()).exists, false, 'Reporting does not recreate cached text');
      assert.deepEqual((await f.receipt().get()).data(), before, 'Reporting does not mutate billing/usage proof');
      const record = (await f.feedback.get()).data();
      assert.equal(record.sourceRecordType, 'paid_receipt'); assert.equal(record.responseCacheAvailable, false);
      assert.equal(record.category, 'unknown'); assert.equal(record.locale, 'unknown');
      assert.equal(f.ingestions.length, 1); assert.equal(f.ingestions[0].reporterUserId, f.uid);
      assert.equal(Object.hasOwn(f.ingestions[0].requestData, 'result'), false);
      assert.equal(Object.hasOwn(f.ingestions[0].requestData, 'fingerprint'), false);
      assert.ok(!JSON.stringify([record, f.logs]).includes('synthetic_private_guide_text'));
      assert.ok(!JSON.stringify(f.logs).includes(f.uid));
    }
  });
  await test('receipt_fallback_requires_app_check_and_never_trusts_client_ownership_fields', async () => {
    const f = await fixture(); await f.seedReceipt();
    await assert.rejects(f.call(f.data, { auth: f.context.auth }), e => e.code === 'permission-denied');
    await noFeedback(f);
    await assert.rejects(f.call({ ...f.data, paid: true }), e => e.code === 'invalid-argument');
    await noFeedback(f);
  });
  await test('another_accounts_receipt_cannot_authorize_feedback', async () => {
    const f = await fixture();
    await f.receipt('sandbox', 'synthetic_other_coach').set({ ...f.receiptData, userId: 'synthetic_other_coach' });
    await assert.rejects(f.call(), e => e.code === 'not-found'); await noFeedback(f);
  });
  await test('unfinished_failed_or_malformed_receipts_never_authorize_fallback', async () => {
    for (const patch of [{ status: 'processing' }, { status: 'failed' }, { userId: 'other' },
      { environment: 'production' }, { clientRequestId: 'different_request' },
      { fingerprint: 'bad' }, { billable: undefined }]) {
      const f = await fixture(); await f.seedReceipt(patch);
      await assert.rejects(f.call(), e => e.code === 'not-found'); await noFeedback(f);
    }
  });
  await test('ambiguous_same_request_across_environments_is_not_guessed', async () => {
    const f = await fixture(); await f.seedReceipt();
    await f.receipt('production').set({ ...f.receiptData, environment: 'production' });
    await assert.rejects(f.call(), e => e.code === 'not-found'); await noFeedback(f);
  });
  await test('an_existing_conflicting_cache_cannot_be_masked_by_a_valid_receipt', async () => {
    for (const patch of [{ userId: 'other' }, { status: 'generated' }]) {
      const f = await fixture(); await f.seedReceipt();
      await f.cache.set({ userId: f.uid, status: 'completed', paid: true, category: 'other', locale: 'en', ...patch });
      await assert.rejects(f.call(), e => e.code === 'not-found'); await noFeedback(f);
    }
  });
  await test('existing_cached_paid_and_complimentary_feedback_paths_are_preserved', async () => {
    for (const paid of [true, false]) {
      const f = await fixture();
      if (!paid) {
        process.env.COACH_AI_TESTING_ENABLED = 'true';
        await f.db.doc('coachAiInternalConfig/runtime').set({ enabled: true });
        f.context.auth.token.aiCoachTester = true;
      }
      await f.cache.set({ userId: f.uid, status: 'completed', paid, category: 'other', locale: 'es', result: { title: 'Synthetic output' } });
      assert.equal((await f.call()).saved, true);
      const record = (await f.feedback.get()).data();
      assert.equal(record.sourceRecordType, 'response_cache'); assert.equal(record.locale, 'es');
      process.env.COACH_AI_TESTING_ENABLED = 'false';
    }
  });
  await test('report_updates_keep_one_rate_slot_and_new_reports_still_obey_the_limit', async () => {
    const f = await fixture(); await f.seedReceipt(); await f.call();
    assert.equal((await f.rate.get()).data().count, 1);
    await f.call({ ...f.data, comment: 'Please review this saved guide.' });
    assert.equal((await f.rate.get()).data().count, 1);
    const Timestamp = require('./coach-ai-memory-firestore.cjs').createMemoryFirestore().overrides['firebase-admin/firestore'].Timestamp;
    await f.rate.set({ requestTimes: Array.from({ length: 30 }, () => Timestamp.now()), count: 30 });
    const nextId = 'synthetic_second_guide';
    await f.receipt('sandbox', f.uid, nextId).set({ ...f.receiptData, clientRequestId: nextId });
    await assert.rejects(f.call({ ...f.data, requestId: nextId }), e => e.code === 'resource-exhausted');
    assert.equal((await f.rate.get()).data().count, 30);
    assert.equal(f.ingestions.length, 2, 'Only the two explicit existing-report submissions reach intake');
  });
  await test('deletion_fence_or_missing_profile_blocks_feedback_recreation', async () => {
    const f = await fixture(); await f.seedReceipt();
    await f.enrollment.set({ state: 'deleting' });
    await assert.rejects(f.call(), e => e.code === 'permission-denied'); await noFeedback(f);
    await f.profile.delete();
    await assert.rejects(f.call(), e => e.code === 'permission-denied'); await noFeedback(f);
  });
  await test('deletion_racing_a_feedback_commit_aborts_once_without_recreating_records', async () => {
    const f = await fixture(); await f.seedReceipt();
    const original = f.db.runTransaction.bind(f.db); let transactions = 0;
    f.db.runTransaction = (work, options) => {
      transactions++;
      return original(async tx => { const value = await work(tx); await f.profile.delete(); return value; }, options);
    };
    await assert.rejects(f.call(), e => e.code === 10);
    assert.equal(transactions, 1); await noFeedback(f);
  });
  await test('permanent_auth_and_existing_standing_controls_remain_enforced', async () => {
    const f = await fixture(); await f.seedReceipt();
    await assert.rejects(f.call(f.data, { app: f.context.app }), e => e.code === 'unauthenticated');
    await assert.rejects(f.call(f.data, { ...f.context, auth: { uid: f.uid, token: { firebase: { sign_in_provider: 'anonymous' } } } }), e => e.code === 'permission-denied');
    await f.db.doc('accountStanding/' + f.uid).set({ messagingRestricted: true });
    await assert.rejects(f.call(), e => e.details?.reason === 'messaging_restricted');
    await noFeedback(f);
  });
  assert.equal(networkAttempts, 0);
  console.log(JSON.stringify({ passed: true, cases: cases.length, names: cases,
    networkAttempts, providerCalls: 0, liveWrites: 0, builds: 0, deployments: 0, automaticRetries: 0 }));
}
run().catch(error => { console.error(JSON.stringify({ passed: false, completedCases: cases, message: error.message })); process.exitCode = 1; })
  .finally(() => {
    [global.fetch, http.request, http.get, https.request, https.get] = originals;
    for (const name of environmentNames) {
      if (previousEnvironment[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnvironment[name];
    }
  });
