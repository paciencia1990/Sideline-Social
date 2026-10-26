'use strict';
// Actual paid handler + read-version transactions, fake verification/provider.
// This fixture has no network, emulator, compiled output or live credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSourceLoader, root } = require('./coach-ai-test-loader.cjs');
const { createMemoryFirestore } = require('./coach-ai-memory-firestore.cjs');
const out = process.env.COACH_AI_RETENTION_RESULT_DIR;
assert.ok(out, 'Explicit local result directory required');
fs.mkdirSync(out, { recursive: true });
const report = { cases: [], automaticRetries: 0, networkCalls: 0, builds: 0, liveWrites: 0 };
fs.writeFileSync(path.join(out, 'attempt-1.json'), JSON.stringify({ startedAt: new Date().toISOString(), scope: 'offline paid-response retention fixture' }), { flag: 'wx' });
const save = () => fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
const originalNow = Date.now, originalFetch = global.fetch;
const http = require('node:http'), https = require('node:https');
const originalRequests = [http.request, http.get, https.request, https.get];
const blockNetwork = () => { report.networkCalls++; throw Error('retention_fixture_network_forbidden'); };
global.fetch = blockNetwork;
http.request = http.get = https.request = https.get = blockNetwork;
const DAY = 86400000, FRIDAY = Date.parse('2026-10-30T20:00:00Z');
class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }

async function setup() {
  const memory = createMemoryFirestore(), db = memory.db;
  const state = { clock: FRIDAY, providerCalls: 0, transactionCalls: 0, finalizationCalls: 0, persistenceCalls: 0,
    finalFault: null, persistFault: null, providerFailure: false, afterProvider: null, afterPersist: null };
  Date.now = () => state.clock;
  const uid = 'retention_fixture_coach', id = 'retention_fixture_request';
  const anchorMs = Date.parse('2026-10-01T00:00:00Z');
  const core = createSourceLoader()('functions/src/coachAiBillingCore.ts');
  const accountRef = db.doc('coachAiBillingAccounts/' + core.billingDocumentId('sandbox', uid));
  const profileRef = db.doc('users/' + uid);
  const resultRef = db.doc(`coachAiRequests/${uid}_${id}`);
  const receiptRef = db.doc('coachAiPaidRequests/' + core.billingRequestId('sandbox', uid, id));
  const queueRef = db.doc('coachAiBillingDeletionQueue/' + crypto.createHash('sha256').update(uid).digest('hex'));
  const originalWindow = accountRef.collection('windows').doc(core.coachAiMonthlyWindow(anchorMs, state.clock).id);
  await profileRef.set({ adultEligibilityConfirmed: true, activeMode: 'coach' });
  await accountRef.set({ userId: uid, anchorMs });
  const functions = { https: { HttpsError, onCall: handler => ({ run: handler }) },
    region() { return this; }, runWith() { return this; }, logger: { error() {} } };
  const response = { resultType: 'talking_points', title: 'Encouraging team routine',
    body: 'Start with a short warm-up and offer encouraging feedback.', canSendAsAnnouncement: false };
  const load = createSourceLoader({ ...memory.overrides,
    'firebase-functions/v1': functions,
    './permanentAuth': { permanentAccountFunctions: () => functions },
    './coachAiBilling': { requireVerifiedCoachAiSubscription: async () => ({ config: { environment: 'sandbox' }, account: { accountRef, anchorMs } }) },
    './coachAiRevenueCatV2': { REVENUECAT_VERIFICATION_SECRET: 'fixture_verification_reference', coachAiRuntimeIdentity: () => 'fixture_generator_identity' },
    './coachResourceHelp': { requestProviderResult: async (_request, attempts) => {
      assert.equal(attempts, 1); state.providerCalls++;
      if (state.providerFailure) throw Error('fixture_provider_failure');
      if (state.afterProvider) { const hook = state.afterProvider; state.afterProvider = null; await hook(); }
      return response;
    } },
  });
  const handler = load('functions/src/coachAiPaidGeneration.ts').generatePaidCoachResourceHelp;
  const originalTransaction = db.runTransaction.bind(db);
  db.runTransaction = async (callback, options) => {
    state.transactionCalls++;
    assert.equal(options.maxAttempts, 1);
    let finalization = false, persistence = false, finalFault, persistFault;
    const value = await originalTransaction(async tx => {
      const update = tx.update.bind(tx), create = tx.create.bind(tx);
      tx.update = (ref, data) => { if (ref.path === receiptRef.path && data.status === 'completed') finalization = true; return update(ref, data); };
      tx.create = (ref, data) => { if (ref.path === resultRef.path) persistence = true; return create(ref, data); };
      const answer = await callback(tx);
      if (finalization) {
        state.finalizationCalls++; finalFault = state.finalFault; state.finalFault = null;
        if (finalFault === 'before') throw Error('fixture_finalization_before_commit');
        if (finalFault === 'conflict') await profileRef.update({ fixtureConflict: state.clock });
      }
      if (persistence) {
        state.persistenceCalls++; persistFault = state.persistFault; state.persistFault = null;
        if (persistFault === 'before') throw Error('fixture_persistence_before_commit');
      }
      return answer;
    }, options);
    if (persistence && state.afterPersist) { const hook = state.afterPersist; state.afterPersist = null; await hook(); }
    if (persistFault === 'after') throw Error('fixture_persistence_response_lost');
    if (finalFault === 'after') throw Error('fixture_finalization_response_lost');
    return value;
  };
  const request = { category: 'other', situation: 'Help build an encouraging team routine.', locale: 'en', clientRequestId: id };
  const context = { auth: { uid }, app: { appId: 'fixture_app_check' } };
  return { db, state, response, resultRef, receiptRef, originalWindow, profileRef, queueRef,
    call: changes => handler.run({ ...request, ...changes }, context),
    currentWindow: () => accountRef.collection('windows').doc(core.coachAiMonthlyWindow(anchorMs, state.clock).id),
    result: async () => (await resultRef.get()).data(), receipt: async () => (await receiptRef.get()).data(),
    usage: async () => (await originalWindow.get()).data(),
    sweepDueTtl: async () => {
      const rows = await db.collection('coachAiRequests').get(); let removed = 0;
      for (const row of rows.docs) if (row.data().expiresAt?.toMillis() <= state.clock) { await row.ref.delete(); removed++; }
      return removed;
    },
  };
}
async function pending(f, fault = 'before') {
  f.state.finalFault = fault;
  await assert.rejects(f.call());
  const data = await f.result();
  assert.equal(data.status, 'generated');
  assert.equal(Object.hasOwn(data, 'expiresAt'), false, 'Unresolved response has no TTL');
  assert.equal((await f.receipt()).status, 'processing');
  assert.equal((await f.usage()).reserved, 1);
  assert.equal((await f.usage()).fulfilled, 0);
  assert.equal(f.state.providerCalls, 1);
  assert.equal(f.state.finalizationCalls, 1, 'No automatic finalization retry');
}
async function test(name, execute) {
  report.currentCase = name; save(); await execute();
  report.cases.push({ name, status: 'PASS' }); save(); console.log(JSON.stringify({ passed: name }));
}
async function main() {
  await test('normal_completion_sets_24h_ttl_atomically', async () => {
    const f = await setup(); assert.deepEqual(await f.call(), f.response);
    assert.equal((await f.result()).status, 'completed');
    assert.equal((await f.result()).expiresAt.toMillis(), f.state.clock + DAY);
    assert.equal((await f.receipt()).status, 'completed');
    assert.equal((await f.usage()).fulfilled, 1); assert.equal((await f.usage()).reserved, 0);
    assert.equal(f.state.providerCalls, 1); assert.equal(f.state.transactionCalls, 3);
  });
  await test('finalization_abort_keeps_response_and_reservation_without_ttl', async () => {
    const f = await setup(); await pending(f, 'conflict'); assert.equal(f.state.transactionCalls, 3);
  });
  await test('weekend_month_rollover_recovers_original_window_without_regeneration', async () => {
    const f = await setup(); await pending(f); f.state.clock += 3 * DAY;
    assert.notEqual(f.currentWindow().path, f.originalWindow.path);
    assert.equal(await f.sweepDueTtl(), 0); assert.ok(await f.result());
    assert.deepEqual(await f.call(), f.response);
    assert.equal(f.state.providerCalls, 1); assert.equal(f.state.persistenceCalls, 1);
    assert.equal((await f.usage()).fulfilled, 1); assert.equal((await f.usage()).reserved, 0);
    assert.equal((await f.currentWindow().get()).exists, false, 'Recovery charges the original pinned window');
    assert.equal((await f.result()).expiresAt.toMillis(), f.state.clock + DAY);
  });
  await test('explicit_recovery_failure_still_retains_then_charges_once', async () => {
    const f = await setup(); await pending(f); f.state.clock += 4 * DAY;
    f.state.finalFault = 'before'; await assert.rejects(f.call());
    assert.equal(Object.hasOwn(await f.result(), 'expiresAt'), false);
    assert.equal((await f.usage()).reserved, 1); assert.equal(f.state.providerCalls, 1);
    assert.deepEqual(await f.call(), f.response); assert.equal((await f.usage()).fulfilled, 1);
    assert.equal((await f.usage()).reserved, 0); assert.equal(f.state.providerCalls, 1);
  });
  await test('legacy_pending_expiry_removed_before_another_failed_finalization', async () => {
    const f = await setup(); await pending(f);
    await f.resultRef.update({ expiresAt: memoryTimestamp(f.state.clock + 1000) });
    f.state.finalFault = 'before'; await assert.rejects(f.call());
    assert.equal(Object.hasOwn(await f.result(), 'expiresAt'), false);
    f.state.clock += 3 * DAY; assert.equal(await f.sweepDueTtl(), 0);
    await f.call(); assert.equal((await f.usage()).fulfilled, 1); assert.equal(f.state.providerCalls, 1);
  });
  await test('lost_finalization_reply_and_duplicate_read_do_not_double_charge_or_extend_ttl', async () => {
    const f = await setup(); f.state.finalFault = 'after'; await assert.rejects(f.call());
    const expires = (await f.result()).expiresAt.toMillis();
    assert.equal((await f.receipt()).status, 'completed'); assert.equal((await f.usage()).fulfilled, 1);
    f.state.clock += 3600000; assert.deepEqual(await f.call(), f.response);
    assert.equal((await f.result()).expiresAt.toMillis(), expires);
    assert.equal((await f.usage()).fulfilled, 1); assert.equal(f.state.providerCalls, 1); assert.equal(f.state.finalizationCalls, 1);
  });
  await test('concurrent_explicit_recovery_charges_once_without_regeneration', async () => {
    const f = await setup(); await pending(f); f.state.clock += 3 * DAY;
    const outcomes = await Promise.allSettled([f.call(), f.call()]);
    assert.ok(outcomes.some(value => value.status === 'fulfilled'));
    assert.equal(f.state.providerCalls, 1); assert.equal((await f.usage()).fulfilled, 1);
    assert.equal((await f.usage()).reserved, 0); assert.equal((await f.receipt()).status, 'completed');
    assert.equal((await f.result()).expiresAt.toMillis(), f.state.clock + DAY);
  });
  await test('completed_cache_expires_without_regeneration_or_second_charge', async () => {
    const f = await setup(); await f.call(); f.state.clock += DAY + 1;
    assert.equal(await f.sweepDueTtl(), 1);
    await assert.rejects(f.call(), error => error.details?.reason === 'response_no_longer_cached');
    assert.equal(f.state.providerCalls, 1); assert.equal((await f.usage()).fulfilled, 1); assert.equal((await f.usage()).reserved, 0);
  });
  await test('provider_failure_releases_slot_without_retry_or_cache', async () => {
    const f = await setup(); f.state.providerFailure = true; await assert.rejects(f.call());
    assert.equal(f.state.providerCalls, 1); assert.equal(await f.result(), undefined);
    assert.equal((await f.receipt()).status, 'failed'); assert.equal((await f.usage()).fulfilled, 0); assert.equal((await f.usage()).reserved, 0);
  });
  await test('safety_response_recovers_after_weekend_without_paid_usage', async () => {
    const f = await setup(); const safety = { situation: 'A child is in immediate danger and needs emergency help.' };
    f.state.finalFault = 'before'; await assert.rejects(f.call(safety));
    assert.equal(Object.hasOwn(await f.result(), 'expiresAt'), false);
    f.state.clock += 3 * DAY; assert.equal(await f.sweepDueTtl(), 0); await f.call(safety);
    assert.equal(f.state.providerCalls, 0); assert.equal((await f.usage()).fulfilled, 0); assert.equal((await f.usage()).reserved, 0);
    assert.equal((await f.result()).expiresAt.toMillis(), f.state.clock + DAY);
  });
  await test('lost_persistence_reply_reconciles_existing_response_without_resend', async () => {
    const f = await setup(); f.state.persistFault = 'after'; assert.deepEqual(await f.call(), f.response);
    assert.equal(f.state.persistenceCalls, 1); assert.equal(f.state.providerCalls, 1); assert.equal((await f.usage()).fulfilled, 1);
    assert.equal((await f.result()).expiresAt.toMillis(), f.state.clock + DAY);
  });
  await test('missing_result_after_failed_persistence_stops_without_regeneration', async () => {
    const f = await setup(); f.state.persistFault = 'before'; await assert.rejects(f.call());
    assert.equal(await f.result(), undefined); f.state.clock += 3 * DAY;
    await assert.rejects(f.call(), error => error.details?.reason === 'request_outcome_unknown');
    assert.equal(f.state.providerCalls, 1); assert.equal((await f.usage()).reserved, 1); assert.equal((await f.usage()).fulfilled, 0);
  });
  await test('mismatched_request_cannot_clear_legacy_expiry_or_charge', async () => {
    const f = await setup(); await pending(f); const expiry = memoryTimestamp(f.state.clock + DAY);
    await f.resultRef.update({ expiresAt: expiry });
    await assert.rejects(f.call({ situation: 'This is a different request under the same identifier.' }), error => error.details?.reason === 'request_id_conflict');
    assert.equal((await f.result()).expiresAt.toMillis(), expiry.toMillis()); assert.equal(f.state.providerCalls, 1); assert.equal((await f.usage()).fulfilled, 0);
  });
  await test('deletion_before_persistence_prevents_response_recreation', async () => {
    const f = await setup(); f.state.afterProvider = async () => { await f.queueRef.set({ status: 'processing' }); await f.profileRef.delete(); };
    await assert.rejects(f.call()); assert.equal(await f.result(), undefined); assert.equal(f.state.providerCalls, 1); assert.equal((await f.usage()).fulfilled, 0);
    await assert.rejects(f.call()); assert.equal(f.state.providerCalls, 1);
  });
  await test('deletion_after_persistence_blocks_finalization_and_recovery', async () => {
    const f = await setup(); f.state.afterPersist = async () => { await f.queueRef.set({ status: 'processing' }); await f.profileRef.delete(); };
    await assert.rejects(f.call()); assert.equal(Object.hasOwn(await f.result(), 'expiresAt'), false);
    assert.equal((await f.usage()).fulfilled, 0); assert.equal((await f.receipt()).status, 'processing');
    await assert.rejects(f.call()); assert.equal(f.state.providerCalls, 1); assert.equal((await f.usage()).fulfilled, 0);
  });
  report.passed = true; report.completedAt = new Date().toISOString();
  report.sourceSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'functions/src/coachAiPaidGeneration.ts'))).digest('hex');
  save(); console.log(JSON.stringify({ passed: report.cases.length, networkCalls: report.networkCalls, builds: 0, automaticRetries: 0 }));
}
// Use the fixture's actual Timestamp constructor, never a plain timestamp-shaped
// object (the fixture clones it and the production code must still see toMillis).
function memoryTimestamp(ms) { return createMemoryFirestore().overrides['firebase-admin/firestore'].Timestamp.fromMillis(ms); }
main().catch(error => { report.failed = true; report.error = error.stack; save(); console.error(error); process.exitCode = 1; }).finally(() => {
  Date.now = originalNow; global.fetch = originalFetch;
  [http.request, http.get, https.request, https.get] = originalRequests;
});
