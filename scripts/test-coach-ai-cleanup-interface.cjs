'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const {createSourceLoader,root}=require('./coach-ai-test-loader.cjs');
const {createMemoryFirestore}=require('./coach-ai-memory-firestore.cjs');
const client=require('../internal/coach-ai-cleanup/client.js');
const out=process.env.COACH_AI_INTERFACE_RESULT_DIR;assert.ok(out);fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'/started.json','{}',{flag:'wx'});
const runtime=Module.createRequire(process.env.COACH_AI_FOCUSED_PACKAGE+'/package.json');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const result={passed:false,cases:[],liveRequests:0,builds:0,automaticRetries:0};
const save=()=>fs.writeFileSync(out+'/result.json',JSON.stringify(result,null,2));
global.fetch=async()=>{result.liveRequests++;throw Error('unexpected_live_fetch');};
const facts={ordinaryCleanupComplete:true,aliasesReconciled:true,sdkWorkSettled:true,holdsClear:true,backupsClear:true,identityReuseBlocked:true,relatedWorkClear:true};
async function setup(){
 const memory=createMemoryFirestore(),db=memory.db;db.projectId='demo-sideline-cleanup-interface';
 const T=memory.overrides['firebase-admin/firestore'].Timestamp,now=Date.parse('2026-10-15T20:00:00Z');
 const load=createSourceLoader({...memory.overrides,'firebase-functions/v1':runtime('firebase-functions/v1')});
 let revoked=false,pinUid='primary',fetches=0;
 const auth={app:{options:{projectId:db.projectId}},verifyIdToken:async(token,check)=>{
  assert.equal(check,true);if(token!=='fixture-token'||revoked)throw Error('fixture_revoked');
  return {uid:pinUid,email:'info@joinsidelinesocial.com',email_verified:true,auth_time:Math.floor(now/1000),firebase:{sign_in_second_factor:'totp'}};
 },getUser:async uid=>{if(uid===pinUid)return {uid,email:'info@joinsidelinesocial.com',emailVerified:true,disabled:false};throw Object.assign(Error('not_found'),{code:'auth/user-not-found'});},listUsers:async()=>({users:[]})};
 const pins={primaryUid:'primary',backupUid:'backup'};
 const options={db,auth,operatorPins:pins,now:()=>now,verificationKey:()=> 'sk_fake_only',fetcher:async()=>{fetches++;throw Error('unexpected_provider');}};
 const workflow=load('functions/src/coachAiCleanupOperatorWorkflow.ts').createCoachAiCleanupOperatorWorkflow(options);
 const adapter=load('functions/src/coachAiCleanupInterface.ts').createCoachAiCleanupInterface({...options,origin:'https://internal.example.invalid'});
 const monitor=load('functions/src/coachAiCleanupQueueMonitor.ts');
 await db.doc('coachAiInternalConfig/cleanupOperators').set({enabled:true,primaryUid:'primary',backupUid:'backup'});
 const uid='deleted-fixture',key=hash(uid);
 await db.doc('coachAiBillingEnrollments/'+key).set({state:'deleting',vendorCleanupRequired:false,fencedAt:T.fromMillis(now-86400000),localCleanupCompletedAt:T.fromMillis(now-10000),privateText:'NEVER_EXPOSE',userId:uid});
 const request=(body,extra={})=>adapter({method:'POST',origin:'https://internal.example.invalid',contentType:'application/json',authorization:'Bearer fixture-token',body,...extra});
 return {db,T,now,load,workflow,options,pins,monitor,key,uid,request,revoked:()=>{revoked=true;},changeUid:v=>{pinUid=v;},fetches:()=>fetches};
}
async function test(name,fn){result.current=name;save();await fn();result.cases.push({name,passed:true});save();console.log(name);}
async function main(){
 await test('transport_requires_exact_origin_post_json_and_session',async()=>{
  const f=await setup();for(const extra of [{method:'GET'},{origin:'https://evil.invalid'},{contentType:'text/plain'},{authorization:''}])assert.ok((await f.request({action:'list'},extra)).status>=400);
  assert.equal((await f.request({action:'list',collection:'users'})).status,409);
 });
 await test('immutable_pins_cannot_be_widened_by_mutating_options_or_database',async()=>{
  const f=await setup();f.pins.primaryUid='attacker';f.changeUid('attacker');
  await f.db.doc('coachAiInternalConfig/cleanupOperators').update({primaryUid:'attacker'});
  assert.ok((await f.request({action:'list'})).status>=400);
  const create=f.load('functions/src/coachAiCleanupOperatorWorkflow.ts').createCoachAiCleanupOperatorWorkflow;
  assert.throws(()=>create({...f.options,operatorPins:{primaryUid:'same',backupUid:'same'}}),/pins_required/);
  assert.throws(()=>create({...f.options,operatorPins:undefined}),/pins_required/);
 });
 await test('list_and_detail_redact_identifiers_provider_payloads_and_unknown_strings',async()=>{
  const f=await setup(),list=await f.request({action:'list'}),detail=await f.request({action:'detail',kind:'fences',key:f.key});
  assert.equal(list.status,200);assert.equal(detail.status,200);
  for(const body of [list.body,detail.body]){const text=JSON.stringify(body);assert.ok(!text.includes('NEVER_EXPOSE'));assert.ok(!text.includes(f.uid));assert.ok(!text.includes('fixture-token'));}
  assert.equal(list.headers['Cache-Control'],'no-store');
  assert.equal((await f.request({action:'detail',kind:'users',key:f.key})).status,409);
 });
 await test('authenticated_nonbuyer_review_closes_once_without_vendor_request',async()=>{
  const f=await setup();const d=(await f.request({action:'draft',operation:'close',key:f.key})).body.draft;
  assert.equal((await f.request({action:'approve',draft:d,facts})).body.status,'approved');
  const target={operation:'close',key:f.key,reviewId:d.reviewId,uid:f.uid};
  assert.equal((await f.request({action:'execute',target})).body.status,'closed');
  assert.equal((await f.request({action:'execute',target})).status,409);assert.equal(f.fetches(),0);
  assert.equal((await f.request({action:'detail',kind:'fences',key:f.key,reviewId:d.reviewId})).body.review.status,'consumed');
 });
 await test('server_rejects_stale_revision_and_unconfirmed_expiry',async()=>{
  const f=await setup();const d=(await f.request({action:'draft',operation:'close',key:f.key})).body.draft;
  await f.db.doc('coachAiBillingEnrollments/'+f.key).update({legalHold:true});
  assert.equal((await f.request({action:'approve',draft:d,facts})).body.error,'cleanup_review_stale');
  assert.equal((await f.request({action:'execute',target:{operation:'expire_cleanup',key:f.key,reviewId:d.reviewId}})).body.error,'cleanup_confirmation_required');
 });
 await test('revocation_before_commit_aborts_atomic_writes_without_retry',async()=>{
  const f=await setup(),d=await f.workflow.draft('fixture-token','close',f.key);await f.workflow.approve('fixture-token',d,facts);
  const original=f.db.runTransaction.bind(f.db);let attempts=0;
  f.db.runTransaction=(fn,options)=>original(tx=>{attempts++;const set=tx.set.bind(tx);tx.set=(ref,value,...args)=>{if(ref.path.startsWith('coachAiBillingDeletionQueue/'))f.revoked();return set(ref,value,...args);};return fn(tx);},options);
  await assert.rejects(f.workflow.execute('fixture-token',{operation:'close',key:f.key,reviewId:d.reviewId,uid:f.uid}));
  assert.equal(attempts,1);assert.equal((await f.db.doc('coachAiBillingDeletionQueue/'+f.key).get()).exists,false);
  assert.equal((await f.db.doc('coachAiInternalConfig/cleanupReviews/items/'+d.reviewId).get()).data().status,'approved');
 });
 await test('monitor_never_writes_and_projects_only_nonidentifying_fields',async()=>{
  const f=await setup();const inv=await f.monitor.readCleanupInventory(f.db);
  assert.ok(!JSON.stringify(inv).includes(f.uid));assert.ok(!JSON.stringify(inv).includes('NEVER_EXPOSE'));
  const summary=await f.monitor.createCleanupQueueMonitor(()=>Promise.resolve(inv),()=>f.now)();
  assert.equal(summary.counts.pendingCleanup,1);assert.ok(!JSON.stringify(summary).includes(f.key));assert.ok(!JSON.stringify(summary).includes('primary'));
  assert.equal((await f.db.doc('coachAiBillingEnrollments/'+f.key).get()).data().state,'deleting');
 });
 await test('monitor_read_failure_overflow_and_malformed_are_unknown_not_healthy',async()=>{
  const f=await setup();let calls=0;const summary=await f.monitor.createCleanupQueueMonitor(async()=>{calls++;throw Error('private provider body');},()=>f.now)();
  assert.equal(calls,1);assert.equal(summary.health,'unknown');assert.equal(summary.counts,null);assert.ok(!JSON.stringify(summary).includes('private'));
  const inv={fences:[],queue:[],events:[],reviews:[],paidRequests:[]};inv.fences=Array.from({length:501},()=>({id:'x',data:{}}));assert.equal(f.monitor.summarizeCleanupQueue(inv,f.now).reason,'inventory_limit');
  inv.fences=[{id:'x',data:{state:'deleting',vendorCleanupRequired:false}}];assert.equal(f.monitor.summarizeCleanupQueue(inv,f.now).health,'unknown');
 });
 await test('monitor_uses_original_age_skips_enrolled_and_identifies_due_held_or_orphaned_records',async()=>{
  const f=await setup(),T=f.T,old=f.now-100*86400000;
  const inv={fences:[{id:'active',data:{state:'enrolled'}},{id:'pending',data:{state:'deleting',vendorCleanupRequired:true,fencedAt:T.fromMillis(f.now)}},{id:'closed',data:{state:'deleting',closedAt:T.fromMillis(old),retentionDueAt:T.fromMillis(old+90*86400000)}}],
   queue:[{id:'pending',data:{status:'needs_review',createdAt:T.fromMillis(old),updatedAt:T.fromMillis(f.now)}},{id:'closed',data:{status:'closed',closedAt:T.fromMillis(old),retentionDueAt:T.fromMillis(old+90*86400000)}}],events:[],reviews:[],paidRequests:[]};
  let s=f.monitor.summarizeCleanupQueue(inv,f.now);assert.equal(s.counts.pendingCleanup,1);assert.equal(s.counts.overdueReview,1);assert.equal(s.counts.technicalEscalation,1);assert.equal(s.counts.dueReceipts,1);
  inv.queue[1].data.legalHold=true;s=f.monitor.summarizeCleanupQueue(inv,f.now);assert.equal(s.counts.dueReceipts,0);assert.equal(s.counts.held,1);
  inv.queue.push({id:'orphan',data:{status:'closed'}});assert.equal(f.monitor.summarizeCleanupQueue(inv,f.now).health,'unknown');
 });
 await test('weekday_schedule_handles_weekends_and_both_DST_offsets',async()=>{
  const f=await setup(),m=f.monitor;
  assert.equal(m.cleanupNoticeWindow(Date.parse('2026-10-16T13:00:00Z')),true);
  assert.equal(m.cleanupNoticeWindow(Date.parse('2026-11-02T14:00:00Z')),true);
  assert.equal(m.cleanupNoticeWindow(Date.parse('2026-11-01T14:00:00Z')),false);
  assert.equal(m.cleanupNoticeWindow(Date.parse('2026-11-02T14:01:00Z')),false);
  const friday=Date.parse('2026-10-30T19:00:00Z');
  assert.equal(m.cleanupReviewOverdue(friday,Date.parse('2026-11-02T20:59:00Z')),false);
  assert.equal(m.cleanupReviewOverdue(friday,Date.parse('2026-11-02T21:00:00Z')),true);
  assert.equal(m.cleanupReviewOverdue(Date.parse('2026-11-01T14:00:00Z'),Date.parse('2026-11-02T21:00:00Z')),true);
 });
 await test('client_double_click_single_attempt_and_ambiguous_outcome_require_reconciliation',async()=>{
  let release,calls=0;const control=client.createController(async()=>{calls++;await new Promise(r=>release=r);throw Error('timeout');});
  const pending=control.call('execute',{target:{reviewId:'one'}});await assert.rejects(control.call('execute',{target:{reviewId:'one'}}),/in_progress/);
  release();await assert.rejects(pending,/unclear/);assert.equal(calls,1);assert.throws(()=>control.beginNewReview(),/reconcile/);
  await assert.rejects(control.call('approve',{draft:{reviewId:'two'}}),/reconcile/);assert.equal(calls,1);
 });
 await test('successful_mutation_cannot_be_replayed_and_reconciliation_is_read_only',async()=>{
  let calls=0;const control=client.createController(async()=>{calls++;return {status:'closed'};});
  await control.call('execute',{target:{reviewId:'one'}});await assert.rejects(control.call('execute',{target:{reviewId:'one'}}),/already_attempted/);assert.equal(calls,1);
  const uncertain=client.createController(async action=>{if(action==='execute')throw Error('timeout');return {};});
  await assert.rejects(uncertain.call('execute',{target:{reviewId:'one'}}));await uncertain.call('detail',{key:'hash'});uncertain.beginNewReview();assert.equal(uncertain.state.uncertain,false);
  await assert.rejects(uncertain.call('execute',{target:{reviewId:'one'}}),/already_attempted/);
 });
 await test('browser_transport_sends_one_same_origin_post_without_credentials_in_url',async()=>{
  let calls=0;const send=client.createTransport({origin:'https://internal.example.invalid',getToken:async()=> 'fixture-token',fetch:async(url,options)=>{calls++;assert.equal(url,'https://internal.example.invalid/internal/coach-ai-cleanup');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer fixture-token');return {ok:true,json:async()=>({records:[]})};}});
  await send('list',{});assert.equal(calls,1);
 });
 assert.equal(result.liveRequests,0);result.passed=true;save();console.log(JSON.stringify({passed:true,cases:result.cases.length}));
}
main().catch(error=>{result.error={case:result.current,message:error.message};save();console.error(JSON.stringify(result.error));process.exitCode=1;});
