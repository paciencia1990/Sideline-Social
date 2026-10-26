'use strict';
// One offline run. No network, emulator, emitted build, or cloud credentials.
const assert = require('node:assert/strict'), fs = require('node:fs'), crypto = require('node:crypto'), Module = require('node:module');
const { createSourceLoader, root } = require('./coach-ai-test-loader.cjs');
const { createMemoryFirestore } = require('./coach-ai-memory-firestore.cjs');
const fixture = require('./coach-ai-revenuecat-v2-fixture.cjs');
const out = process.env.COACH_AI_MAINTENANCE_RESULT_DIR;
assert.ok(out); assert.ok(process.env.COACH_AI_FOCUSED_PACKAGE);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(out + '/started.json', '{}', { flag: 'wx' });
const runtime = Module.createRequire(process.env.COACH_AI_FOCUSED_PACKAGE + '/package.json');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const reviewId = '12345678-1234-1234-1234-123456789abc';
const request = { actor: 'fixture-primary', reviewId };
const results = { cases: [], networkCalls: 0, automaticRetries: 0, liveWrites: 0, builds: 0 };
global.fetch = async () => { results.networkCalls++; throw Error('network_forbidden'); };
const save = () => fs.writeFileSync(out + '/result.json', JSON.stringify(results, null, 2) + '\n');
fixture.installFixtureEnvironment();
Object.assign(process.env, { COACH_AI_PAID_ENABLED: 'true', COACH_AI_BILLING_ENVIRONMENT: 'sandbox',
  COACH_AI_WEBHOOK_MODE: 'signed', REVENUECAT_WEBHOOK_AUTH_TOKEN: 'a1'.repeat(32),
  REVENUECAT_WEBHOOK_SIGNING_SECRET: 'offline-signature-key-never-real'.repeat(2) });
async function setup() {
  const memory = createMemoryFirestore(), db = memory.db;
  const Timestamp = memory.overrides['firebase-admin/firestore'].Timestamp;
  const base = createSourceLoader({ ...memory.overrides, 'firebase-functions/v1': runtime('firebase-functions/v1') });
  const v2 = base('functions/src/coachAiRevenueCatV2.ts');
  let erasures = 0, lookups = 0, authorized = true, now = Date.now(), calls = 0;
  const modules = createSourceLoader({ ...memory.overrides, 'firebase-functions/v1': runtime('firebase-functions/v1'),
    './coachAiRevenueCatV2': { ...v2, requestRevenueCatV2Erasure: async () => { erasures++; return 'deletion_requested'; },
      lookupRevenueCatV2: async () => { lookups++; return { checkedAtMs: Date.now(), subscription: null, originalPurchaseAtMs: null, customerExists: false }; } } });
  const maintenance = modules('functions/src/coachAiBillingMaintenance.ts');
  const deletion = modules('functions/src/coachAiBillingDeletion.ts');
  const enrollment = modules('functions/src/coachAiBillingEnrollment.ts');
  const billing = modules('functions/src/coachAiBilling.ts');
  const core = modules('functions/src/coachAiBillingCore.ts');
  const flags = { authAbsent: true, ordinaryCleanupComplete: true, vendor: 'absent', aliasesReconciled: true,
    sdkWorkSettled: true, holdsClear: true, backupsClear: true, identityReuseBlocked: true, relatedWorkClear: true };
  let proofOverride = {};
  const service = maintenance.createCoachAiBillingMaintenance({ db, now: () => now,
    authorize: async () => { if (!authorized) throw Error('denied'); return 'primary'; },
    inspect: async scope => { calls++; return { ...scope, checkedAtMs: now, ...flags, ...proofOverride }; } });
  const fence = uid => db.doc('coachAiBillingEnrollments/' + hash(uid));
  const queue = uid => db.doc('coachAiBillingDeletionQueue/' + hash(uid));
  const event = id => db.doc('coachAiBillingEvents/' + hash('sandbox:' + id));
  const close = (uid = 'gone') => service.close({ ...request, uid });
  const expire = (uid = 'gone') => service.expireCleanup({ ...request, key: hash(uid) });
  const expireEvent = id => service.expireEvent({ ...request, key: event(id).id });
  async function seed(uid = 'gone', buyer = true) {
    await fence(uid).set({ state: 'deleting', vendorCleanupRequired: buyer, fencedAt: Timestamp.fromMillis(now - 10000),
      localCleanupCompletedAt: Timestamp.fromMillis(now - 5000), accidentalLegacyEmail: 'must-remove@example.invalid' });
    if (buyer) await queue(uid).set({ userId: uid, status: 'deletion_requested', requiresCompletionCheck: true, protocolVersion: 2,
      accidentalResponse: { customer_id: uid } });
  }
  async function send(id, uids) {
    await db.doc('coachAiInternalConfig/billing').set(fixture.configuration('sandbox'));
    const rawBody = Buffer.from(JSON.stringify({ event: { id, type: uids.length > 1 ? 'TRANSFER' : 'EXPIRATION',
      app_id: fixture.appIds[0], environment: 'SANDBOX', app_user_id: uids[0], transferred_from: uids.slice(0, 1), transferred_to: uids.slice(1) } }));
    const t = String(Math.floor(Date.now() / 1000));
    const signature = 't=' + t + ',v1=' + crypto.createHmac('sha256', process.env.REVENUECAT_WEBHOOK_SIGNING_SECRET).update(t + '.').update(rawBody).digest('hex');
    const response = { set() {}, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await billing.coachAiRevenueCatWebhook({ method: 'POST', rawBody, get: name => name === 'authorization'
      ? 'Bearer ' + process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN : signature }, response);
    return response;
  }
  // Interleave one external write just before commit, with no callback retry.
  function conflict(action) {
    const original = db.runTransaction.bind(db); let attempts = 0;
    db.runTransaction = (callback, options) => original(async tx => {
      attempts++; const answer = await callback(tx); await action(); return answer;
    }, options);
    return () => assert.equal(attempts, 1);
  }
  return { db, Timestamp, maintenance, deletion, enrollment, core, flags, service, seed, fence, queue, event, close, expire, expireEvent, send, conflict,
    advance: ms => { now += ms; }, deny: () => { authorized = false; }, proof: value => { proofOverride = value; },
    counts: () => ({ erasures, lookups, calls }), day90: maintenance.BILLING_RETENTION_MS };
}
async function test(name, fn) { results.currentCase = name; save(); await fn(); results.cases.push({ name, status: 'PASS' }); save(); console.log(name); }
async function main() {
  await test('buyer_closure_scrubs_legacy_fields_and_is_idempotent', async () => {
    const f = await setup(); await f.seed(); assert.equal((await f.close()).status, 'closed');
    const q = (await f.queue('gone').get()).data(), fence = (await f.fence('gone').get()).data();
    assert.deepEqual(Object.keys(q).sort(), ['status','protocolVersion','requiresCompletionCheck','vendorOutcome','closedAt','retentionDueAt','reviewerRole','reviewId'].sort());
    assert.equal(JSON.stringify([q,fence]).includes('gone'), false);
    assert.equal(fence.accidentalLegacyEmail, undefined);
    assert.equal(q.retentionDueAt.toMillis() - q.closedAt.toMillis(), f.day90);
    const original = JSON.stringify(q);
    assert.equal((await f.close()).status, 'already_closed');
    assert.equal(JSON.stringify((await f.queue('gone').get()).data()), original);
    assert.equal(f.counts().erasures, 0);
  });
  await test('nonbuyer_requires_completed_local_cleanup_and_no_vendor_history', async () => {
    const f = await setup(); await f.seed('gone', false); f.flags.vendor = 'not_required';
    assert.equal((await f.close()).status, 'closed'); assert.equal(f.counts().erasures, 0);
    const g = await setup(); await g.seed('gone', false); await g.queue('gone').set({ userId:'gone',status:'needs_review' });
    g.flags.vendor = 'not_required'; assert.equal((await g.close()).reason, 'vendor_completion_unverified');
  });
  await test('partial_deletion_without_completion_marker_is_retained', async () => {
    const f = await setup(); await f.seed();
    await f.fence('gone').set({ state:'deleting', vendorCleanupRequired:true });
    assert.equal((await f.close()).reason, 'local_cleanup_incomplete');
    assert.equal((await f.queue('gone').get()).data().userId, 'gone');
  });
  await test('completion_marker_refuses_profile_and_records_only_after_cleanup', async () => {
    const f = await setup(); await f.fence('gone').set({ state:'deleting',vendorCleanupRequired:false });
    await f.db.doc('users/gone').set({ name:'Fixture' });
    await assert.rejects(f.deletion.recordCoachAiLocalDeletionComplete('gone'), /blocked/);
    assert.equal((await f.fence('gone').get()).data().localCleanupCompletedAt, undefined);
    await f.db.doc('users/gone').delete();
    await f.deletion.recordCoachAiLocalDeletionComplete('gone');
    assert.ok((await f.fence('gone').get()).data().localCleanupCompletedAt);
  });
  await test('unknown_vendor_outcome_and_acknowledgement_alone_do_not_close', async () => {
    const f = await setup(); await f.seed(); f.flags.vendor = 'unknown';
    assert.equal((await f.close()).reason, 'vendor_completion_unverified');
    assert.equal((await f.queue('gone').get()).data().status, 'deletion_requested');
    assert.equal(f.counts().erasures, 0);
  });
  await test('auth_alias_sdk_and_hold_guards_fail_closed', async () => {
    for (const [flag,reason] of [['authAbsent','local_cleanup_incomplete'],['ordinaryCleanupComplete','local_cleanup_incomplete'],
      ['aliasesReconciled','reconciliation_incomplete'],['sdkWorkSettled','reconciliation_incomplete'],['holdsClear','retention_hold']]) {
      const f = await setup(); await f.seed(); f.flags[flag] = false;
      assert.equal((await f.close()).reason, reason);
    }
  });
  await test('remaining_data_and_orphaned_windows_block_closure', async () => {
    for (const path of ['users/gone','publicUserProfiles/gone','coachAiPaidRequests/request',
      'coachAiBillingAccounts/sandbox_' + hash('gone') + '/windows/orphan']) {
      const f = await setup(); await f.seed(); await f.db.doc(path).set({userId:'gone'});
      assert.equal((await f.close()).reason,'local_cleanup_incomplete');
    }
  });
  await test('unauthorized_and_stale_or_mismatched_reviews_write_nothing', async () => {
    const f = await setup(); await f.seed(); f.deny(); await assert.rejects(f.close(), /denied/); assert.equal(f.counts().calls,0);
    for (const override of [{checkedAtMs:1},{revision:'different'},{key:hash('other')},{operation:'expire_event'}]) {
      const g = await setup(); await g.seed(); g.proof(override);
      await assert.rejects(g.close(), /stale/); assert.equal((await g.fence('gone').get()).data().retentionException,undefined);
    }
  });
  await test('operator_check_failure_does_not_retry_or_mutate', async () => {
    const f = await setup(); await f.seed(); let calls = 0;
    const service = f.maintenance.createCoachAiBillingMaintenance({db:f.db,now:Date.now,
      authorize:async()=> 'primary',inspect:async()=>{calls++;throw Error('provider_unavailable');}});
    await assert.rejects(service.close({...request,uid:'gone'}),/provider_unavailable/);
    assert.equal(calls,1); assert.equal((await f.queue('gone').get()).data().userId,'gone');
  });
  await test('closure_conflict_preserves_identifiers_and_never_retries', async () => {
    const f = await setup(); await f.seed(); const once = f.conflict(()=>f.queue('gone').update({status:'needs_review'}));
    await assert.rejects(f.close(),/aborted/); once();
    assert.equal((await f.queue('gone').get()).data().userId,'gone');
    assert.equal((await f.fence('gone').get()).data().closedAt,undefined);
  });
  await test('query_phantom_blocks_closure', async () => {
    const f = await setup(); await f.seed();
    const once = f.conflict(()=>f.db.doc('coachAiPaidRequests/late').set({userId:'gone'}));
    await assert.rejects(f.close(),/aborted/); once(); assert.equal((await f.queue('gone').get()).data().userId,'gone');
  });
  await test('expiry_uses_closure_not_original_age_and_removes_pair_atomically', async () => {
    const f = await setup(); await f.seed(); await f.close(); f.advance(f.day90-1);
    assert.equal((await f.expire()).status,'not_due'); f.advance(1);
    assert.equal((await f.expire()).status,'expired');
    assert.equal((await f.fence('gone').get()).exists,false); assert.equal((await f.queue('gone').get()).exists,false);
    assert.equal((await f.expire()).status,'absent'); assert.equal(f.counts().erasures,0);
  });
  await test('unresolved_and_inconsistent_pair_never_expire', async () => {
    const f = await setup(); await f.seed(); f.advance(f.day90*2); assert.equal((await f.expire()).reason,'closure_unverified');
    const g = await setup(); await g.seed(); await g.close(); await g.queue('gone').delete(); g.advance(g.day90);
    assert.equal((await g.expire()).reason,'closure_unverified'); assert.equal((await g.fence('gone').get()).exists,true);
  });
  await test('backups_holds_identity_reuse_and_pending_work_retain_receipts', async () => {
    for (const [flag,reason] of [['backupsClear','backup_dependency'],['holdsClear','retention_hold'],
      ['identityReuseBlocked','identity_reuse_unverified'],['relatedWorkClear','reconciliation_incomplete']]) {
      const f = await setup(); await f.seed(); await f.close(); f.advance(f.day90); f.flags[flag]=false;
      assert.equal((await f.expire()).reason,reason);
      const note=(await f.fence('gone').get()).data().retentionException;
      assert.equal(note.owner,'primary'); assert.equal(note.nextReviewAt.toMillis()-note.reviewedAt.toMillis(),7*86400000);
    }
  });
  await test('restored_profile_or_billing_residue_blocks_expiry', async () => {
    for (const path of ['users/gone','coachAiBillingAccounts/sandbox_'+hash('gone'),'coachAiBillingEvents/legacy']) {
      const f = await setup(); await f.seed(); await f.close(); f.advance(f.day90);
      await f.db.doc(path).set(path.endsWith('/legacy')?{userIds:['gone']}:{});
      assert.equal((await f.expire()).reason,'local_records_remain');
    }
  });
  await test('expiry_inventory_overflow_is_not_partial_success', async () => {
    const f=await setup();await f.seed();await f.close();f.advance(f.day90);
    for(let i=0;i<501;i++)await f.db.doc('users/other'+i).set({});
    assert.equal((await f.expire()).reason,'inventory_limit');assert.equal((await f.queue('gone').get()).exists,true);
  });
  await test('concurrent_hold_prevents_half_expired_pair', async () => {
    const f=await setup();await f.seed();await f.close();f.advance(f.day90);
    const once=f.conflict(()=>f.fence('gone').update({retentionHold:true}));
    await assert.rejects(f.expire(),/aborted/);once();
    assert.equal((await f.queue('gone').get()).exists,true);assert.equal((await f.fence('gone').get()).exists,true);
  });
  await test('failed_or_held_events_are_not_expired', async () => {
    const f=await setup();await f.event('pending').set({status:'needs_review',attemptState:'processing',userIds:[]});
    assert.equal((await f.expireEvent('pending')).reason,'event_unresolved');
    await f.send('held',['gone']);f.advance(f.day90+1000);await f.event('held').update({retentionHold:true});
    assert.equal((await f.expireEvent('held')).reason,'retention_hold');
  });
  await test('late_notification_after_pair_expiry_cannot_recreate_account_or_send_erasure', async () => {
    const f=await setup();await f.seed();await f.close();f.advance(f.day90);await f.expire();
    await f.send('late',['gone']);assert.deepEqual((await f.event('late').get()).data().userIds,[]);
    assert.equal(f.counts().lookups,0);assert.equal(f.counts().erasures,0);
    await assert.rejects(f.enrollment.enrollCoachAiBilling('gone','sandbox'));
    assert.equal((await f.db.doc('coachAiBillingAccounts/'+f.core.billingDocumentId('sandbox','gone')).get()).exists,false);
  });
  await test('expired_transfer_receipt_reconciles_only_active_user_without_quota_reset', async () => {
    const f=await setup();await f.db.doc('users/active').set({});
    await f.db.doc('coachAiBillingEnrollments/'+hash('active')).set({state:'enrolled',userId:'active'});
    const usage=f.db.doc('coachAiBillingAccounts/'+f.core.billingDocumentId('sandbox','active')+'/windows/test');
    await usage.set({fulfilled:12,reserved:1});
    await f.send('transfer',['gone','active']);assert.equal(f.counts().lookups,1);
    assert.deepEqual((await f.event('transfer').get()).data().userIds,['active']);
    f.advance(f.day90+1000);assert.equal((await f.expireEvent('transfer')).status,'expired');
    await f.send('transfer',['gone','active']);assert.equal(f.counts().lookups,2);
    assert.deepEqual((await usage.get()).data(),{fulfilled:12,reserved:1});
    assert.deepEqual((await f.event('transfer').get()).data().userIds,['active']);
    assert.equal((await f.send('transfer',['gone','active'])).body.duplicate,true);
    assert.equal(f.counts().lookups,2);
  });
  await test('event_expiry_conflicts_with_concurrent_participant_deletion', async () => {
    const f=await setup();await f.db.doc('users/active').set({});await f.send('race',['active']);f.advance(f.day90+1000);
    const once=f.conflict(()=>f.fence('active').set({state:'deleting'}));
    await assert.rejects(f.expireEvent('race'),/aborted/);once();assert.equal((await f.event('race').get()).exists,true);
  });
  assert.equal(results.networkCalls,0);results.passed=true;
  results.sourceHashes=Object.fromEntries(['coachAiBillingMaintenance.ts','coachAiBillingDeletion.ts','accountDeletion.ts','coachAiBilling.ts']
    .map(name=>[name,hash(fs.readFileSync(root+'/functions/src/'+name))]));
  save();console.log(JSON.stringify({passed:true,cases:results.cases.length,networkCalls:0}));
}
main().catch(error=>{results.passed=false;results.failure={case:results.currentCase,message:error.message};save();console.error(JSON.stringify(results.failure));process.exitCode=1;});
