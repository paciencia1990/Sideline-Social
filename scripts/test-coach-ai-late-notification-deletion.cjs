'use strict';
// In-memory read-version transactions and fake provider responses; no network.
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),Module=require('node:module');
const {createSourceLoader,root}=require('./coach-ai-test-loader.cjs');
const {createMemoryFirestore}=require('./coach-ai-memory-firestore.cjs');
const fixture=require('./coach-ai-revenuecat-v2-fixture.cjs');
const out=process.env.COACH_AI_FOCUSED_RESULT_DIR;
assert.ok(out,'Explicit result directory required');
const prepared=Module.createRequire(process.env.COACH_AI_FOCUSED_PACKAGE+'/package.json');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const result={cases:[],automaticRetries:0,networkCalls:0,builds:0,liveWrites:0};
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/focused-started.json','{}',{flag:'wx'});
const save=()=>fs.writeFileSync(out+'/focused-result.json',JSON.stringify(result,null,2)+'\n');
global.fetch=async()=>{result.networkCalls++;throw Error('network_forbidden');};
fixture.installFixtureEnvironment();
Object.assign(process.env,{COACH_AI_PAID_ENABLED:'true',COACH_AI_BILLING_ENVIRONMENT:'sandbox',COACH_AI_WEBHOOK_MODE:'signed',REVENUECAT_WEBHOOK_AUTH_TOKEN:'a1'.repeat(32),REVENUECAT_WEBHOOK_SIGNING_SECRET:'offline-signature-key-never-real'.repeat(2)});
async function setup(options={}){
 const memory=createMemoryFirestore(),db=memory.db,calls=[];
 const overrides={...memory.overrides,'firebase-functions/v1':prepared('firebase-functions/v1')};
 const base=createSourceLoader(overrides),v2=base('functions/src/coachAiRevenueCatV2.ts'),webhookCore=base('functions/src/coachAiWebhookCore.ts');
 const modules=createSourceLoader({...overrides,'./coachAiRevenueCatV2':{...v2,
  requestRevenueCatV2Erasure:async()=> 'deletion_requested',
  lookupRevenueCatV2:async uid=>{calls.push(uid);if(options.providerFailure)throw Error('fake_provider_failure');if(options.deadline)await new Promise(r=>setTimeout(r,50));return{checkedAtMs:Date.now(),subscription:null,originalPurchaseAtMs:null,customerExists:false};}},
  ...(options.deadline?{'./coachAiWebhookCore':{...webhookCore,COACH_AI_WEBHOOK_DEADLINE_MS:10}}:{})});
 const billing=modules('functions/src/coachAiBilling.ts'),deletion=modules('functions/src/coachAiBillingDeletion.ts'),core=modules('functions/src/coachAiBillingCore.ts');
 await db.doc('coachAiInternalConfig/billing').set(fixture.configuration('sandbox'));
 const fence=uid=>db.doc('coachAiBillingEnrollments/'+hash(uid));
 const queue=uid=>db.doc('coachAiBillingDeletionQueue/'+hash(uid));
 const event=id=>db.doc('coachAiBillingEvents/'+hash('sandbox:'+id));
 const seed=uid=>db.doc('users/'+uid).set({displayName:'Fixture'});
 async function send(id,uids=['person'],badAuth=false){
  const rawBody=Buffer.from(JSON.stringify({event:{id,type:uids.length>1?'TRANSFER':'EXPIRATION',app_id:fixture.appIds[0],environment:'SANDBOX',app_user_id:uids[0],transferred_from:uids.slice(0,1),transferred_to:uids.slice(1)}}));
  const t=String(Math.floor(Date.now()/1000)),signature='t='+t+',v1='+crypto.createHmac('sha256',process.env.REVENUECAT_WEBHOOK_SIGNING_SECRET).update(t+'.').update(rawBody).digest('hex');
  const res={code:0,body:null,set(){},status(c){this.code=c;return this;},json(v){this.body=v;return this;}};
  await billing.coachAiRevenueCatWebhook({method:'POST',rawBody,get:n=>n==='authorization'?(badAuth?'invalid':'Bearer '+process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN):signature},res);return res;
 }
 // Inject one scheduling interleaving; the transaction callback is never retried.
 function interleave(prefix,when,action){
  const original=db.runTransaction.bind(db);let fired=false;
  db.runTransaction=async(callback,opts)=>{
   let matched=false;
   const answer=await original(async tx=>{
    for(const method of ['create','set']){const originalWrite=tx[method].bind(tx);tx[method]=(ref,...args)=>{if(ref.path.startsWith(prefix))matched=true;return originalWrite(ref,...args);};}
    const value=await callback(tx);
    if(matched&&!fired&&when==='beforeCommit'){fired=true;await action();}
    return value;
   },opts);
   if(matched&&!fired&&when==='afterCommit'){fired=true;await action();}
   return answer;
  };
  return()=>assert.equal(fired,true);
 }
 return{db,calls,billing,deletion,core,fence,queue,event,seed,send,interleave};
}
async function test(name,fn){result.currentCase=name;save();await fn();result.cases.push({name,status:'PASS'});save();console.log(JSON.stringify({passed:name}));}
async function main(){
 await test('late_notification_after_deletion_keeps_receipt_without_uid',async()=>{
  const f=await setup();await f.fence('gone').set({state:'deleting',vendorCleanupRequired:false});
  assert.deepEqual((await f.send('late',['gone'])).body,{received:true});assert.deepEqual((await f.event('late').get()).data().userIds,[]);assert.deepEqual(f.calls,[]);
 });
 await test('missing_profile_deleting_profile_and_legacy_queue_are_excluded',async()=>{
  const f=await setup();await f.seed('deleting');await f.fence('deleting').set({state:'deleting'});await f.seed('legacy');await f.queue('legacy').set({status:'processing'});
  await f.send('unavailable',['absent','deleting','legacy']);assert.deepEqual((await f.event('unavailable').get()).data().userIds,[]);assert.deepEqual(f.calls,[]);
 });
 await test('active_notification_then_deletion_cleans_existing_event_and_rate',async()=>{
  const f=await setup();await f.seed('active');await f.send('early',['active']);assert.deepEqual(f.calls,['active']);assert.deepEqual((await f.event('early').get()).data().userIds,['active']);
  await f.deletion.deleteCoachAiBillingData('active');assert.deepEqual((await f.event('early').get()).data().userIds,[]);
  assert.equal((await f.db.doc('coachAiBillingVerificationRates/'+f.core.billingDocumentId('sandbox','active')).get()).exists,false);
 });
 await test('deletion_wins_event_claim_conflict_without_repeating_transaction',async()=>{
  const f=await setup();await f.seed('racing');const hit=f.interleave('coachAiBillingEvents/','beforeCommit',()=>f.deletion.deleteCoachAiBillingData('racing'));
  assert.equal((await f.send('conflict',['racing'])).body.needsReview,true);hit();assert.equal((await f.event('conflict').get()).exists,false);assert.deepEqual(f.calls,[]);
 });
 await test('deletion_after_claim_does_not_restore_uid_on_completion',async()=>{
  const f=await setup();await f.seed('racing');const hit=f.interleave('coachAiBillingEvents/','afterCommit',()=>f.deletion.deleteCoachAiBillingData('racing'));
  assert.deepEqual((await f.send('after_claim',['racing'])).body,{received:true});hit();assert.deepEqual((await f.event('after_claim').get()).data().userIds,[]);assert.deepEqual(f.calls,[]);
 });
 await test('mixed_transfer_preserves_only_active_participants_and_deduplication',async()=>{
  const f=await setup();await f.seed('active');await f.fence('gone').set({state:'deleting'});
  await f.send('transfer',['gone','active']);assert.deepEqual(f.calls,['active']);assert.deepEqual((await f.event('transfer').get()).data().userIds,['active']);
  assert.equal((await f.send('transfer',['gone','active'])).body.duplicate,true);assert.deepEqual(f.calls,['active']);
 });
 await test('transfer_deletion_after_claim_still_reconciles_other_user',async()=>{
  const f=await setup();await f.seed('departing');await f.seed('remaining');
  const hit=f.interleave('coachAiBillingEvents/','afterCommit',()=>f.deletion.deleteCoachAiBillingData('departing'));
  assert.deepEqual((await f.send('transfer_race',['departing','remaining'])).body,{received:true});hit();
  assert.deepEqual(f.calls,['remaining']);assert.deepEqual((await f.event('transfer_race').get()).data().userIds,['remaining']);
 });
 await test('deletion_wins_rate_write_conflict_without_reintroducing_uid',async()=>{
  const f=await setup();await f.seed('rate_race');const hit=f.interleave('coachAiBillingVerificationRates/','beforeCommit',()=>f.deletion.deleteCoachAiBillingData('rate_race'));
  assert.equal((await f.send('rate_conflict',['rate_race'])).body.needsReview,true);hit();assert.deepEqual(f.calls,[]);
  assert.equal((await f.db.doc('coachAiBillingVerificationRates/'+f.core.billingDocumentId('sandbox','rate_race')).get()).exists,false);
  assert.deepEqual((await f.event('rate_conflict').get()).data().userIds,[]);
 });
 await test('provider_failure_retains_review_state_and_duplicate_does_not_replay',async()=>{
  const f=await setup({providerFailure:true});await f.seed('active');
  assert.equal((await f.send('failure',['active'])).body.needsReview,true);assert.equal((await f.event('failure').get()).data().status,'needs_review');
  assert.equal((await f.send('failure',['active'])).body.duplicate,true);assert.deepEqual(f.calls,['active']);
 });
 await test('deadline_preserves_review_record_and_stops_late_completion',async()=>{
  const f=await setup({deadline:true});await f.seed('active');
  assert.equal((await f.send('deadline',['active'])).body.needsReview,true);const record=(await f.event('deadline').get()).data();assert.equal(record.status,'needs_review');assert.equal(record.completedAt,undefined);
  assert.equal((await f.db.doc('coachAiBillingAccounts/'+f.core.billingDocumentId('sandbox','active')).get()).exists,false);
  assert.equal((await f.send('deadline',['active'])).body.duplicate,true);assert.deepEqual(f.calls,['active']);
 });
 await test('invalid_authentication_writes_no_event',async()=>{
  const f=await setup();await f.seed('active');assert.equal((await f.send('bad',['active'],true)).code,401);assert.equal((await f.event('bad').get()).exists,false);assert.deepEqual(f.calls,[]);
 });
 result.passed=true;result.sourceSha256=hash(fs.readFileSync(root+'/functions/src/coachAiBilling.ts'));result.completedAt=new Date().toISOString();assert.equal(result.networkCalls,0);save();console.log(JSON.stringify({passed:true,cases:result.cases.length,networkCalls:0}));
}
main().catch(e=>{result.passed=false;result.failure={case:result.currentCase,message:e.message};save();console.error(JSON.stringify(result.failure));process.exitCode=1;});

