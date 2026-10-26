'use strict';
// Offline fixtures only: no SDK, listeners, provider, credentials or live data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createSourceLoader,root} = require('./coach-ai-test-loader.cjs');
const {createInventoryReader} = require('../internal/coach-ai-cleanup/observer/firestore.cjs');
const core = createSourceLoader()('functions/src/coachAiCleanupQueueMonitor.ts');
const NOW = Date.parse('2026-10-16T19:30:00Z');
const PROJECT = 'sideline-social-staging-2026';
const inventory = rows => ({fences:[],queue:[],events:[],reviews:[],paidRequests:rows});
const receipt = patch => ({id:'a'.repeat(64),data:{status:'processing',startedAt:NOW-100000,leaseUntilMs:NOW-30000,...patch}});
const cases = [];
async function test(name,body) {await body();cases.push(name);}
async function main() {
  await test('live_generation_lease_does_not_raise_a_stalled_alarm',()=>{
    const result=core.summarizeCleanupQueue(inventory([receipt({startedAt:NOW-1000,leaseUntilMs:NOW+69000})]),NOW);
    assert.equal(result.health,'healthy');assert.equal(result.counts.stalledGeneration,0);
  });
  await test('expired_generation_lease_is_attention_without_content_or_identity',()=>{
    const row=receipt({userId:'private_fixture_uid',result:'private_fixture_response',prompt:'private_fixture_prompt'});
    const result=core.summarizeCleanupQueue(inventory([row]),NOW);
    assert.equal(result.health,'attention');assert.equal(result.counts.stalledGeneration,1);
    assert.ok(!JSON.stringify(result).includes('private_fixture'));
    assert.equal(row.data.status,'processing');assert.equal(row.data.leaseUntilMs,NOW-30000);
  });
  await test('completed_and_failed_receipts_do_not_raise_stalled_alarms',()=>{
    const result=core.summarizeCleanupQueue(inventory([receipt({status:'completed',leaseUntilMs:0}),receipt({status:'failed',leaseUntilMs:0})]),NOW);
    assert.equal(result.health,'healthy');assert.equal(result.counts.stalledGeneration,0);
  });
  await test('missing_future_or_implausible_generation_dates_fail_closed',()=>{
    for(const patch of [{startedAt:null},{startedAt:NOW+1000},{leaseUntilMs:null},{leaseUntilMs:NOW-200000},{leaseUntilMs:NOW+600000},{status:'unexpected'}]){
      const result=core.summarizeCleanupQueue(inventory([receipt(patch)]),NOW);
      assert.equal(result.health,'unknown');assert.ok(result.counts.malformed>0);
    }
  });
  await test('original_request_age_preserves_weekday_review_and_escalation',()=>{
    const old=Date.parse('2026-10-05T13:00:00Z');
    const result=core.summarizeCleanupQueue(inventory([receipt({startedAt:old,leaseUntilMs:old+70000})]),NOW);
    assert.equal(result.counts.stalledGeneration,1);assert.equal(result.counts.overdueReview,1);assert.equal(result.counts.technicalEscalation,1);
  });
  await test('overflow_and_read_failure_are_unknown_without_retry',async()=>{
    assert.equal(core.summarizeCleanupQueue(inventory(Array.from({length:501},()=>receipt({}))),NOW).reason,'inventory_limit');
    let calls=0;const monitor=core.createCleanupQueueMonitor(async()=>{calls++;throw Error('private_fixture_error');},()=>NOW);
    const result=await monitor();assert.equal(calls,1);assert.equal(result.health,'unknown');assert.equal(result.counts,null);
    assert.ok(!JSON.stringify(result).includes('private_fixture'));
  });
  await test('admin_reader_projects_metadata_and_filters_only_processing_requests',async()=>{
    const reads=[];
    const db={projectId:'demo-pre-candidate',collection(name){
      const record={name,where:null,fields:null,limit:null};reads.push(record);
      const query={where(...filter){record.where=filter;return query;},select(...fields){record.fields=fields;return query;},limit(limit){record.limit=limit;return query;},async get(){return {docs:[]};}};
      return query;
    }};
    const result=await core.readCleanupInventory(db);
    assert.deepEqual(Object.keys(result),Object.keys(core.CLEANUP_COLLECTIONS));assert.equal(reads.length,5);
    const paid=reads.find(r=>r.name==='coachAiPaidRequests');assert.deepEqual(paid.where,['status','==','processing']);assert.equal(paid.limit,501);
    for(const read of reads)assert.ok(!read.fields.some(f=>['userId','clientRequestId','fingerprint','result','prompt','windowPath'].includes(f)));
  });
  await test('rest_reader_filters_processing_projects_metadata_and_performs_no_writes',async()=>{
    const calls=[];const key='b'.repeat(64);
    const reader=createInventoryReader({projectId:PROJECT,core,budget:{check(){}},getAccessToken:async()=>'synthetic_fixture_token',send:async(url,options)=>{
      calls.push({url,options});const query=options.body.structuredQuery;
      return {status:200,value:query.from[0].collectionId==='coachAiPaidRequests'?[{document:{name:`projects/${PROJECT}/databases/(default)/documents/coachAiPaidRequests/${key}`,fields:{status:{stringValue:'processing'},startedAt:{timestampValue:new Date(NOW-100000).toISOString()},leaseUntilMs:{integerValue:String(NOW-30000)}}}}]:[{readTime:new Date(NOW).toISOString()}]};
    }});
    const result=core.summarizeCleanupQueue(await reader(),NOW);
    assert.equal(calls.length,5);assert.equal(result.counts.stalledGeneration,1);
    assert.ok(calls.every(c=>c.url.endsWith(':runQuery')&&c.options.method==='POST'));
    const query=calls.at(-1).options.body.structuredQuery;
    assert.deepEqual(query.where,{fieldFilter:{field:{fieldPath:'status'},op:'EQUAL',value:{stringValue:'processing'}}});
    assert.ok(!JSON.stringify(result).includes(key));
  });
  await test('mobile_archive_excludes_operations_and_credentials_preserves_required_source',()=>{
    const ignore=require('ignore')().add(fs.readFileSync(path.join(root,'.easignore'),'utf8'));
    for(const name of ['docs/receipt.json','internal/coach-ai-cleanup/index.html','scripts/operations/operator.cjs','.private/secret.txt','.codex/session.json','Private token helper.html','Keys/SubscriptionKey_fixture.p8','keys/upload.jks','keys/private.pem','keys/service-account-fixture.json','credentials.json','functions/.env.production','nested/.env.local'])assert.equal(ignore.ignores(name),true,name);
    for(const name of ['app/coach/resources/subscription.tsx','content/coachAiBillingTranslations.ts','config/firebaseNativeConfig.js','package-lock.json','eas.json','android/app/build.gradle','android/app/debug.keystore','assets/icon.png'])assert.equal(ignore.ignores(name),false,name);
  });
  await test('english_and_spanish_subscription_messages_have_the_same_keys',()=>{
    const messages=createSourceLoader()('content/coachAiBillingTranslations.ts').coachAiBillingTranslations;
    assert.deepEqual(Object.keys(messages.en).sort(),Object.keys(messages.es).sort());
    assert.ok(messages.en.savedGuides&&messages.es.savedGuides&&messages.en.billingPrivacy&&messages.es.billingPrivacy);
  });
  console.log(JSON.stringify({passed:true,cases:cases.length,names:cases,liveRequests:0,builds:0,deployments:0,agentRetries:0}));
}
main().catch(error=>{console.error(JSON.stringify({passed:false,completed:cases,message:error.message}));process.exitCode=1;});
