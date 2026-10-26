'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),Module=require('node:module');
const {createSourceLoader,root}=require('./coach-ai-test-loader.cjs');
const {createMemoryFirestore}=require('./coach-ai-memory-firestore.cjs');
const out=process.env.COACH_AI_OPERATOR_RESULT_DIR;assert.ok(out);
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/started.json','{}',{flag:'wx'});
const runtime=Module.createRequire(process.env.COACH_AI_FOCUSED_PACKAGE+'/package.json');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const project='demo-sideline-coach-billing',results={cases:[],automaticRetries:0,liveRequests:0,builds:0};
const facts={ordinaryCleanupComplete:true,aliasesReconciled:true,sdkWorkSettled:true,holdsClear:true,backupsClear:true,identityReuseBlocked:true,relatedWorkClear:true};
const save=()=>fs.writeFileSync(out+'/result.json',JSON.stringify(results,null,2)+'\n');
global.fetch=async()=>{results.liveRequests++;throw Error('network_forbidden');};
async function setup(){
 const memory=createMemoryFirestore(),db=memory.db;db.projectId=project;
 const T=memory.overrides['firebase-admin/firestore'].Timestamp;
 const loader=createSourceLoader({...memory.overrides,'firebase-functions/v1':runtime('firebase-functions/v1')});
 const source=loader('functions/src/coachAiCleanupOperatorWorkflow.ts');
 let now=Date.now(),httpMode='absent',authMode='absent',revoked=false,overflow=false,httpCalls=0;
 const token={uid:'operator',email:'info@joinsidelinesocial.com',email_verified:true,auth_time:Math.floor(now/1000),firebase:{sign_in_second_factor:'totp'}};
 const user={uid:'operator',email:'info@joinsidelinesocial.com',emailVerified:true,disabled:false};
 const auth={app:{options:{projectId:project}},verifyIdToken:async(value,checkRevoked)=>{assert.equal(checkRevoked,true);if(revoked||value!=='fake-operator-token')throw Error('token_rejected');return token;},
  getUser:async uid=>{if(uid==='operator')return user;if(authMode==='absent')throw Object.assign(Error('missing'),{code:'auth/user-not-found'});if(authMode==='error')throw Error('auth_unavailable');return {uid};},
  listUsers:async()=>({users:authMode==='present'?[user,{uid:'gone'}]:[user],...(overflow?{pageToken:'more'}:{})})};
 const fetcher=async(url,options)=>{
  httpCalls++;assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  const path='/v2/projects/projec5f2a61/customers';
  if(httpMode==='503')return new Response('{}',{status:503});
  if(httpMode==='403')return new Response('{}',{status:403});
  if(httpMode==='probe404')return new Response(JSON.stringify({object:'error',type:'resource_missing'}),{status:404});
  if(String(url).endsWith('?limit=1'))return new Response(JSON.stringify({object:'list',items:[],url:path,next_page:null}),{status:200});
  if(httpMode==='present')return new Response(JSON.stringify({object:'customer',id:'gone',project_id:'projec5f2a61'}),{status:200});
  if(httpMode==='mismatch')return new Response(JSON.stringify({object:'customer',id:'wrong',project_id:'projec5f2a61'}),{status:200});
  if(httpMode==='bad404')return new Response(JSON.stringify({object:'error',type:'resource_missing',param:'project_id'}),{status:404});
  return new Response(JSON.stringify({object:'error',type:'resource_missing',param:'customer_id'}),{status:404});
 };
 const workflow=source.createCoachAiCleanupOperatorWorkflow({db,auth,operatorPins:{primaryUid:'operator',backupUid:'backup'},now:()=>now,fetcher,verificationKey:()=> 'sk_offline_fake_fixture_only'});
 await db.doc('coachAiInternalConfig/cleanupOperators').set({enabled:true,primaryUid:'operator',backupUid:'backup'});
 const fence=db.doc('coachAiBillingEnrollments/'+hash('gone')),queue=db.doc('coachAiBillingDeletionQueue/'+hash('gone'));
 const review=id=>db.doc('coachAiInternalConfig/cleanupReviews/items/'+id);
 async function seed(buyer=true){await fence.set({state:'deleting',vendorCleanupRequired:buyer,localCleanupCompletedAt:T.fromMillis(now-10000)});if(buyer)await queue.set({userId:'gone',status:'deletion_requested'});}
 const draft=operation=>workflow.draft('fake-operator-token',operation,hash('gone'));
 const approve=(d,values=facts)=>workflow.approve('fake-operator-token',d,values);
 const execute=(d,extra={})=>workflow.execute('fake-operator-token',{operation:d.operation,key:d.key,reviewId:d.reviewId,...(d.operation==='close'?{uid:'gone'}:{}),...extra});
 return{db,T,workflow,token,user,fence,queue,review,seed,draft,approve,execute,source,auth,
  revision:loader('functions/src/coachAiBillingMaintenance.ts').billingCleanupRevision,
  http:mode=>{httpMode=mode;},authMode:mode=>{authMode=mode;},revoke:()=>{revoked=true;},overflow:()=>{overflow=true;},
  advance:ms=>{now+=ms;token.auth_time=Math.floor(now/1000);},calls:()=>httpCalls};
}
async function test(name,fn){results.currentCase=name;save();await fn();results.cases.push({name,status:'PASS'});save();console.log(name);}
async function main(){
 await test('recent_mfa_pinned_operator_closes_with_positive_project_probe_and_consumes_review',async()=>{
  const f=await setup();await f.seed();const d=await f.draft('close');await f.approve(d);assert.equal((await f.execute(d)).status,'closed');assert.equal(f.calls(),2);
  const receipt=(await f.review(d.reviewId).get()).data();assert.equal(receipt.status,'consumed');assert.equal(receipt.reviewerUid,undefined);assert.equal(receipt.facts,undefined);
  assert.equal((await f.queue.get()).data().userId,undefined);
  await assert.rejects(f.execute(d),/unapproved/);assert.equal(f.calls(),2);
 });
 await test('missing_mfa_stale_login_unverified_disabled_and_unpinned_operators_are_denied',async()=>{
  for(const condition of ['mfa','stale','unverified','disabled','unpinned','revoked']){
   const f=await setup();
   if(condition==='mfa')delete f.token.firebase.sign_in_second_factor;
   if(condition==='stale')f.token.auth_time-=901;
   if(condition==='unverified')f.user.emailVerified=false;
   if(condition==='disabled')f.user.disabled=true;
   if(condition==='unpinned')await f.db.doc('coachAiInternalConfig/cleanupOperators').update({primaryUid:'another'});
   if(condition==='revoked')f.revoke();
   await assert.rejects(f.draft('close'));assert.equal(f.calls(),0);
  }
 });
 await test('project_mismatch_is_rejected_before_data_access',async()=>{
  const f=await setup();f.auth.app.options.projectId='other';
  assert.throws(()=>f.source.createCoachAiCleanupOperatorWorkflow({db:f.db,auth:f.auth,verificationKey:()=>''}),/project_mismatch/);
 });
 await test('unapproved_or_client_supplied_facts_cannot_execute',async()=>{
  const f=await setup();await f.seed();const d=await f.draft('close');
  await assert.rejects(f.execute(d),/unapproved/);await f.approve(d);
  await assert.rejects(f.execute(d,{authAbsent:true}),/invalid_cleanup_target/);assert.equal(f.calls(),0);
 });
 await test('changed_record_invalidates_approval',async()=>{
  const f=await setup();await f.seed();const d=await f.draft('close');await f.queue.update({status:'needs_review'});
  await assert.rejects(f.approve(d),/stale/);assert.equal((await f.review(d.reviewId).get()).exists,false);
 });
 await test('old_review_requires_new_explicit_approval',async()=>{
  const f=await setup();await f.seed();const d=await f.draft('close');await f.approve(d);f.advance(900001);
  await assert.rejects(f.execute(d),/unapproved/);assert.equal(f.calls(),0);
  assert.equal(await f.workflow.expireReview('fake-operator-token',d.reviewId),'expired');
 });
 await test('service_permission_project_and_malformed_404_fail_without_retry',async()=>{
  for(const mode of ['503','403','probe404','bad404','mismatch']){
   const f=await setup();await f.seed();const d=await f.draft('close');await f.approve(d);f.http(mode);
   await assert.rejects(f.execute(d));assert.equal(f.calls(),['bad404','mismatch'].includes(mode)?2:1);
   assert.equal((await f.queue.get()).data().userId,'gone');assert.equal((await f.review(d.reviewId).get()).data().status,'approved');
  }
 });
 await test('existing_vendor_customer_is_retained',async()=>{
  const f=await setup();await f.seed();const d=await f.draft('close');await f.approve(d);f.http('present');
  assert.equal((await f.execute(d)).reason,'vendor_completion_unverified');assert.equal((await f.review(d.reviewId).get()).data().result,'retained');
 });
 await test('actual_auth_existence_and_auth_error_cannot_be_overridden_by_attestation',async()=>{
  for(const mode of ['present','error']){
   const f=await setup();await f.seed();const d=await f.draft('close');await f.approve(d);f.authMode(mode);
   if(mode==='error')await assert.rejects(f.execute(d),/auth_check/);
   else assert.equal((await f.execute(d)).reason,'local_cleanup_incomplete');
   assert.equal((await f.queue.get()).data().userId,'gone');
  }
 });
 await test('nonbuyer_has_no_provider_request',async()=>{
  const f=await setup();await f.seed(false);const d=await f.draft('close');await f.approve(d);assert.equal((await f.execute(d)).status,'closed');assert.equal(f.calls(),0);
 });
 await test('human_hold_blocks_closure_and_review_is_consumed',async()=>{
  const f=await setup();await f.seed();const d=await f.draft('close');await f.approve(d,{...facts,holdsClear:false});
  assert.equal((await f.execute(d)).reason,'retention_hold');assert.equal((await f.review(d.reviewId).get()).data().status,'consumed');
 });
 await test('hash_only_expiry_checks_auth_inventory_and_retains_on_overflow',async()=>{
  const f=await setup();await f.seed(false);const d=await f.draft('close');await f.approve(d);await f.execute(d);f.advance(90*86400000);
  const expiry=await f.draft('expire_cleanup');await f.approve(expiry);f.overflow();
  await assert.rejects(f.execute(expiry),/inventory_limit/);assert.equal((await f.queue.get()).exists,true);
 });
 await test('atomic_review_consumption_conflicts_with_revocation',async()=>{
  const f=await setup();await f.seed();const d=await f.draft('close');await f.approve(d);
  const original=f.db.runTransaction.bind(f.db);let attempts=0;
  f.db.runTransaction=(fn,opts)=>original(async tx=>{attempts++;const result=await fn(tx);await f.review(d.reviewId).update({status:'revoked'});return result;},opts);
  await assert.rejects(f.execute(d),/aborted/);assert.equal(attempts,1);
  assert.equal((await f.queue.get()).data().userId,'gone');assert.equal((await f.review(d.reviewId).get()).data().status,'revoked');
 });
 await test('audit_expiry_waits_for_target_cleanup_and_hold_clearance',async()=>{
  const f=await setup();await f.seed(false);const d=await f.draft('close');await f.approve(d);await f.execute(d);f.advance(90*86400000);
  assert.equal(await f.workflow.expireReview('fake-operator-token',d.reviewId),'retained');
  const e=await f.draft('expire_cleanup');await f.approve(e);assert.equal((await f.execute(e)).status,'expired');
  await f.review(d.reviewId).update({retentionHold:true});assert.equal(await f.workflow.expireReview('fake-operator-token',d.reviewId),'retained');
  await f.review(d.reviewId).update({retentionHold:false});
  const current=(await f.review(d.reviewId).get()).data();
  assert.equal(await f.workflow.expireReview('fake-operator-token',d.reviewId,{expectedRevision:f.revision([current]),backupsClear:true}),'expired');
 });
 assert.equal(results.liveRequests,0);results.passed=true;save();console.log(JSON.stringify({passed:true,cases:results.cases.length}));
}
main().catch(error=>{results.passed=false;results.failure={case:results.currentCase,message:error.message};save();console.error(JSON.stringify(results.failure));process.exitCode=1;});
