'use strict';
// Focused local fixtures for the new bootstrap/observer only. Every network,
// credential, listener and log destination is injected; no build or live calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const {generateKeyPairSync, sign} = require('node:crypto');
const {createSourceLoader} = require('./coach-ai-test-loader.cjs');
const {readConsoleConfig, readObserverConfig, PROJECT, SCHEDULER} = require('../internal/coach-ai-cleanup/host/config.cjs');
const {prepareCleanupHost, startCleanupHost} = require('../internal/coach-ai-cleanup/host/bootstrap.cjs');
const {createObserverHost, scheduleSlot} = require('../internal/coach-ai-cleanup/observer/server.cjs');
const {createSchedulerVerifier, JWKS} = require('../internal/coach-ai-cleanup/observer/auth.cjs');
const {createInventoryReader} = require('../internal/coach-ai-cleanup/observer/firestore.cjs');
const {createBudget} = require('../internal/coach-ai-cleanup/host/transport.cjs');
const root = path.resolve(__dirname, '..'), out = process.argv[2];
assert.ok(out, 'exclusive evidence directory required');
fs.mkdirSync(out, {recursive:true});
fs.writeFileSync(path.join(out, 'attempt-1.json'), JSON.stringify({startedAt:new Date().toISOString(), automaticRetries:0}), {flag:'wx'});
const result = {passed:false, cases:[], liveRequests:0, realListeners:0, builds:0, deployments:0, automaticRetries:0};
const core = createSourceLoader()('functions/src/coachAiCleanupQueueMonitor.ts');
const NOW = Date.parse('2026-10-15T13:07:00Z'), SLOT = '2026-10-15T13:00:00Z';
const AUDIENCE = 'https://coach-ai-cleanup-observer-fixture.us-central1.run.app', SUBJECT = '123456789012345678901';
const keys = generateKeyPairSync('rsa', {modulusLength:2048});
const jwk = {...keys.publicKey.export({format:'jwk'}), kid:'fixture-key', alg:'RS256', use:'sig'};
function jwt(claims = {}, header = {}, privateKey = keys.privateKey) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = encode({alg:'RS256',kid:jwk.kid,...header});
  const payload = encode({iss:'https://accounts.google.com',aud:AUDIENCE,email:SCHEDULER,email_verified:true,sub:SUBJECT,iat:Math.floor(NOW/1000)-60,exp:Math.floor(NOW/1000)+3540,...claims});
  const data = head + '.' + payload;
  return 'Bearer ' + data + '.' + sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url');
}
function headers(mode = 'health', time = SLOT) {
  return {'content-type':'application/json', authorization:jwt(), 'x-cloudscheduler':'true',
    'x-cloudscheduler-jobname':`projects/${PROJECT}/locations/us-central1/jobs/coach-ai-cleanup-${mode}`, 'x-cloudscheduler-scheduletime':time};
}
async function invoke(handler, {url='/observe',method='POST',body={mode:'health'},head=headers(),rawHeaders=[]} = {}) {
  const req = new PassThrough();
  Object.assign(req,{url,method,headers:head,rawHeaders,complete:true});
  const res = new EventEmitter();
  Object.assign(res,{writableEnded:false,writeHead(status,values){this.status=status;this.headers=values;},end(value){this.body=value;this.writableEnded=true;}});
  const pending = handler(req,res); req.end(typeof body === 'string' ? body : JSON.stringify(body)); await pending;
  return {status:res.status,body:JSON.parse(res.body),headers:res.headers};
}
let currentCase;
async function test(name, action) {currentCase=name;await action();result.cases.push({name,status:'PASS'});}
function counts(values = {}) {return {pendingCleanup:0,pendingEvents:0,held:0,overdueReview:0,technicalEscalation:0,dueReceipts:0,dueReviews:0,overdueExceptions:0,inconsistent:0,malformed:0,stalledGeneration:0,...values};}
function healthy() {return {health:'healthy',reason:'scan_complete',counts:counts()};}
function hostFixture({scan=async()=>healthy(), authenticate=async()=>true, log}={}) {
  const logs=[];let scans=0,auths=0;
  const handler=createObserverHost({enabled:true,now:()=>NOW,log:log|| (v=>logs.push(v)),createRuntime:()=>({authenticate:async token=>{auths++;return authenticate(token);},scan:async()=>{scans++;return scan();}})});
  return {handler,logs,scans:()=>scans,auths:()=>auths};
}
function fakeNetwork(reply, calls) {
  return (url, options, callback) => {
    const req = new EventEmitter();req.destroy=()=>{};
    req.end=bytes=>{const item={url:url.href,method:options.method,headers:options.headers,body:bytes?JSON.parse(bytes.toString()):undefined};calls.push(item);
      queueMicrotask(()=>{
        const answer=reply(item);if(answer.error){req.emit('error',Error('synthetic_failure'));return;}
        const res=new EventEmitter();Object.assign(res,{statusCode:answer.status??200,headers:answer.headers??{}});callback(res);
        res.emit('data',Buffer.from(JSON.stringify(answer.value)));res.emit('end');
      });};
    return req;
  };
}
function observerEnv() {return {CLEANUP_OBSERVER_ENABLED:'true',CLEANUP_OBSERVER_AUDIENCE:AUDIENCE,CLEANUP_SCHEDULER_SUBJECT_ID:SUBJECT};}
async function main() {
  await test('disabled_startup_loads_no_backend_credentials_or_data',async()=>{
    let loads=0;const load=()=>{loads++;throw Error('must_not_load');};
    const consoleApp=prepareCleanupHost('console',{CLEANUP_ORIGIN:'https://fixture.invalid'},{load});
    assert.equal((await invoke(consoleApp.handler,{url:'/healthz',method:'GET'})).status,200);
    assert.equal((await invoke(consoleApp.handler,{url:'/internal/coach-ai-cleanup',body:{action:'list'}})).status,503);
    const observer=prepareCleanupHost('observer',{}, {load});
    assert.equal((await invoke(observer.handler)).status,503);assert.equal(loads,0);
  });
  await test('startup_rejects_wrong_project_origin_flags_pins_and_role',async()=>{
    for(const patch of [{CLEANUP_PROJECT_ID:'other-project'},{GOOGLE_CLOUD_PROJECT:'other-project'},{CLEANUP_READS_ENABLED:'1'},
      {CLEANUP_MUTATIONS_ENABLED:'true'},{CLEANUP_OBSERVER_ENABLED:'true'},{CLEANUP_ORIGIN:'https://fixture.invalid/'},
      {CLEANUP_ORIGIN:'https://user@fixture.invalid'},{PORT:'0'},{PORT:'8080junk'},{K_SERVICE:'coach-ai-cleanup-observer'},
      {CLEANUP_READS_ENABLED:'true'}]) assert.throws(()=>readConsoleConfig({CLEANUP_ORIGIN:'https://fixture.invalid',...patch}));
    for(const patch of [{CLEANUP_READS_ENABLED:'true'},{CLEANUP_OBSERVER_AUDIENCE:'https://fixture.invalid'},
      {CLEANUP_SCHEDULER_SUBJECT_ID:''},{CLEANUP_OBSERVER_ENABLED:'TRUE'}]) assert.throws(()=>readObserverConfig({...observerEnv(),...patch}));
    assert.throws(()=>prepareCleanupHost('unknown',{}));
  });
  await test('console_bootstrap_wires_only_explicit_read_config_and_private_key',async()=>{
    let loaded=0,captured;
    const env={CLEANUP_ORIGIN:'https://fixture.invalid',CLEANUP_READS_ENABLED:'true',CLEANUP_PRIMARY_UID:'primary',CLEANUP_BACKUP_UID:'backup',REVENUECAT_VERIFICATION_KEY:'synthetic-private-value'};
    const prepared=prepareCleanupHost('console',env,{load:kind=>{assert.equal(kind,'console');loaded++;return {Timestamp:class{},createAdapter:options=>{captured=options;return async()=>({status:200,body:{records:[]}});}};}});
    const answer=await invoke(prepared.handler,{url:'/internal/coach-ai-cleanup',body:{action:'list'},head:{...headers(),origin:env.CLEANUP_ORIGIN}});
    assert.equal(answer.status,200);assert.equal(loaded,1);assert.deepEqual(captured.operatorPins,{primaryUid:'primary',backupUid:'backup'});
    assert.equal(captured.verificationKey(),'synthetic-private-value');assert.ok(!JSON.stringify(answer).includes('synthetic-private-value'));
    assert.equal((await invoke(prepared.handler,{url:'/internal/coach-ai-cleanup',body:{action:'execute'},head:{...headers(),origin:env.CLEANUP_ORIGIN}})).status,403);
  });
  await test('listener_uses_cloud_run_contract_and_does_not_retry_failure',async()=>{
    const attempts=[];let config;
    const serverFactory=(options,handler)=>{config=options;assert.equal(typeof handler,'function');const server=new EventEmitter();server.listen=(port,address,done)=>{attempts.push({port,address});done();};return server;};
    await startCleanupHost('observer',{PORT:'8123'},{serverFactory});
    assert.deepEqual(attempts,[{port:8123,address:'0.0.0.0'}]);assert.equal(config.requestTimeout,30000);assert.equal(config.maxHeaderSize,16384);
    let failures=0;
    await assert.rejects(startCleanupHost('observer',{}, {serverFactory:()=>{const server=new EventEmitter();server.listen=()=>{failures++;server.emit('error',Error('private_detail'));};return server;}}),/cleanup_listener_stopped/);
    assert.equal(failures,1);
  });
  await test('oidc_accepts_exact_signed_scheduler_identity_and_audience',async()=>{
    const budget=createBudget({now:()=>NOW});let calls=0;
    try {const verify=createSchedulerVerifier({audience:AUDIENCE,email:SCHEDULER,subject:SUBJECT,budget,now:()=>NOW,send:async url=>{calls++;assert.equal(url,JWKS);return {status:200,value:{keys:[jwk]}};}});
      assert.equal(await verify(jwt()),true);assert.equal(calls,1);
    }finally{budget.close();}
  });
  await test('oidc_denies_foreign_expired_forged_or_unverified_tokens',async()=>{
    let calls=0;const budget=createBudget({now:()=>NOW});
    try {const verify=createSchedulerVerifier({audience:AUDIENCE,email:SCHEDULER,subject:SUBJECT,budget,now:()=>NOW,send:async()=>{calls++;return {status:200,value:{keys:[jwk]}};}});
      for(const claims of [{iss:'https://attacker.invalid'},{aud:'https://other.run.app'},{aud:[AUDIENCE]},
        {sub:'987654321'},{email:'other@example.com'},{email_verified:false},{exp:Math.floor(NOW/1000)},
        {iat:Math.floor(NOW/1000)+120},{nbf:Math.floor(NOW/1000)+120}]) await assert.rejects(verify(jwt(claims)));
      await assert.rejects(verify(jwt({}, {alg:'none'})));assert.equal(calls,0);
      const forged=jwt();await assert.rejects(verify(forged.slice(0,forged.lastIndexOf('.')+1)+Buffer.alloc(256).toString('base64url')));assert.equal(calls,1);
    }finally{budget.close();}
  });
  await test('oidc_key_fetch_failure_is_not_refreshed_or_retried',async()=>{
    const budget=createBudget({now:()=>NOW});let calls=0;
    try {const verify=createSchedulerVerifier({audience:AUDIENCE,email:SCHEDULER,subject:SUBJECT,budget,now:()=>NOW,send:async()=>{calls++;throw Error('private_failure');}});
      await assert.rejects(verify(jwt()));await assert.rejects(verify(jwt()));assert.equal(calls,1);
    }finally{budget.close();}
  });
  await test('schedule_uses_original_eastern_slot_including_dst_and_delay',async()=>{
    const delayed=scheduleSlot('notice',headers('notice'),NOW);assert.equal(delayed.key,'notice:2026-10-15T13:00:00.000Z');
    const winter='2026-11-02T14:00:00Z';assert.ok(scheduleSlot('notice',headers('notice',winter),Date.parse(winter)+3*60000));
    for(const time of ['2026-10-17T13:00:00Z','2026-10-15T13:01:00Z','2026-10-15T13:00:01Z','2026-10-15T13:10:00Z']) assert.throws(()=>scheduleSlot('notice',headers('notice',time),Date.parse(time)+1000));
    assert.throws(()=>scheduleSlot('health',headers(),Date.parse(SLOT)+16*60000));
    assert.throws(()=>scheduleSlot('health',headers(),Date.parse(SLOT)-1));
    assert.throws(()=>scheduleSlot('notice',headers('health'),NOW));
  });
  await test('request_bounds_auth_and_schedule_fail_before_data_scan',async()=>{
    const fixture=hostFixture();
    assert.equal((await invoke(fixture.handler,{head:{...headers(),cookie:'unexpected'}})).status,403);
    assert.equal((await invoke(fixture.handler,{head:{...headers(),'x-serverless-authorization':'Bearer stripped'}})).status,403);
    assert.equal((await invoke(fixture.handler,{rawHeaders:['Authorization','x','Authorization','y']})).status,403);
    assert.equal((await invoke(fixture.handler,{body:'x'.repeat(257)})).status,413);
    assert.equal((await invoke(fixture.handler,{body:'{'})).status,400);
    assert.equal((await invoke(fixture.handler,{body:{mode:'health',repair:true}})).status,400);
    assert.equal((await invoke(fixture.handler,{head:{...headers(),'x-cloudscheduler-jobname':'other'}})).status,400);
    assert.equal(fixture.scans(),0);
    assert.deepEqual(fixture.logs.map(v=>v.reason),['invalid_json','invalid_observer_mode','job_name_mismatch']);
    assert.ok(fixture.logs.every(v=>v.component==='coach_ai_cleanup_observer_rejection'
      && Object.keys(v).every(k=>['schema','component','reason','jobNameStatus','schedulerFlagStatus'].includes(k))));
    assert.equal(fixture.logs[2].jobNameStatus,'mismatch');assert.equal(fixture.logs[2].schedulerFlagStatus,'match');
    const denied=hostFixture({authenticate:async()=>{throw Error('private_token');}});
    assert.equal((await invoke(denied.handler)).status,403);assert.equal(denied.scans(),0);
  });
  await test('full_observer_path_performs_only_five_projected_queries_and_logs_counts',async()=>{
    const calls=[],logs=[];
    const requestImpl=fakeNetwork(item=>{
      if(item.url===JWKS)return {value:{keys:[jwk]}};
      if(item.url.includes('metadata.google.internal'))return {headers:{'metadata-flavor':'Google'},value:{access_token:'fake-access',token_type:'Bearer',expires_in:3600}};
      return {value:[{readTime:'2026-10-15T13:07:00Z'}]};
    },calls);
    const prepared=prepareCleanupHost('observer',observerEnv(),{load:kind=>{assert.equal(kind,'observer');return core;},requestImpl,log:v=>logs.push(v),now:()=>NOW});
    assert.deepEqual((await invoke(prepared.handler)).body,{status:'healthy'});
    assert.equal(calls.length,7);assert.equal(calls.filter(c=>c.url.includes('metadata.google.internal')).length,1);
    const reads=calls.filter(c=>c.url.includes('firestore.googleapis.com'));assert.equal(reads.length,5);
    assert.deepEqual(reads.map(c=>c.body.structuredQuery.from[0].collectionId),['coachAiBillingEnrollments','coachAiBillingDeletionQueue','coachAiBillingEvents','items','coachAiPaidRequests']);
    for(const item of reads){assert.equal(item.method,'POST');assert.ok(item.url.endsWith(':runQuery'));assert.equal(item.body.structuredQuery.limit,501);assert.deepEqual(item.body.structuredQuery.select.fields,core.CLEANUP_FIELDS.map(fieldPath=>({fieldPath})));}
    assert.equal(logs.length,1);assert.equal(logs[0].health,'healthy');assert.equal(logs[0].noticeWindow,false);assert.equal(logs[0].delayedMs,7*60000);
    const text=JSON.stringify(logs);assert.ok(!text.includes('fake-access')&&!text.includes(SUBJECT)&&!text.includes(SCHEDULER));
  });
  await test('attention_logs_only_allowlisted_counts_and_delayed_notice_slot',async()=>{
    const fixture=hostFixture({scan:async()=>({...healthy(),health:'attention',counts:{...counts({pendingCleanup:1}),privateUid:'never-log'},records:[{uid:'never-log'}]})});
    assert.equal((await invoke(fixture.handler,{body:{mode:'notice'},head:headers('notice')})).status,200);
    assert.equal(fixture.logs[0].noticeWindow,true);assert.equal(fixture.logs[0].counts.pendingCleanup,1);
    assert.ok(!JSON.stringify(fixture.logs).includes('never-log'));
  });
  await test('duplicate_success_and_failed_slots_never_rescan_or_relog',async()=>{
    const fixture=hostFixture();await invoke(fixture.handler);
    assert.equal((await invoke(fixture.handler)).body.outcome,'complete');assert.equal(fixture.scans(),1);assert.equal(fixture.logs.length,1);
    const failed=hostFixture({scan:async()=>{throw Error('private_uid');}});
    assert.equal((await invoke(failed.handler)).status,503);assert.equal((await invoke(failed.handler)).status,409);
    assert.equal(failed.scans(),1);assert.equal(failed.logs.length,1);assert.equal(failed.logs[0].health,'unknown');assert.ok(!JSON.stringify(failed.logs).includes('private_uid'));
  });
  await test('concurrent_requests_do_not_overlap_or_retry_a_blocked_slot',async()=>{
    let release,started;const ready=new Promise(resolve=>{started=resolve;});
    const fixture=hostFixture({scan:()=>new Promise(resolve=>{release=()=>resolve(healthy());started();})});
    const first=invoke(fixture.handler);await ready;
    assert.equal((await invoke(fixture.handler)).status,409);
    assert.equal((await invoke(fixture.handler,{body:{mode:'notice'},head:headers('notice')})).status,409);
    release();assert.equal((await first).status,200);
    assert.equal((await invoke(fixture.handler,{body:{mode:'notice'},head:headers('notice')})).status,409);assert.equal(fixture.scans(),1);
  });
  await test('unknown_inventory_and_invalid_healthy_snapshots_never_emit_healthy',async()=>{
    for(const snapshot of [{health:'unknown',reason:'inventory_limit',counts:null},
      {...healthy(),counts:counts({inconsistent:1})},{...healthy(),counts:null}]) {
      const fixture=hostFixture({scan:async()=>snapshot});assert.equal((await invoke(fixture.handler)).status,503);
      assert.ok(fixture.logs.every(v=>v.health==='unknown'));
    }
  });
  await test('failed_firestore_read_stops_once_without_auth_vendor_or_write_calls',async()=>{
    const calls=[],logs=[];const requestImpl=fakeNetwork(item=>item.url===JWKS?{value:{keys:[jwk]}}:
      item.url.includes('metadata.google.internal')?{headers:{'metadata-flavor':'Google'},value:{access_token:'fake-access',token_type:'Bearer',expires_in:3600}}:{error:true},calls);
    const prepared=prepareCleanupHost('observer',observerEnv(),{load:()=>core,requestImpl,log:v=>logs.push(v),now:()=>NOW});
    assert.equal((await invoke(prepared.handler)).status,503);assert.equal(calls.length,3);assert.equal(logs[0].reason,'read_or_validation_failed');
    assert.equal((await invoke(prepared.handler)).status,409);assert.equal(calls.length,4); // Only a new request's public-key authentication.
    assert.ok(calls.every(c=>c.url===JWKS||c.url.includes('metadata.google.internal')||c.url.endsWith(':runQuery')));
  });
  await test('reader_rejects_scope_drift_malformed_rows_extra_fields_and_foreign_documents',async()=>{
    const budget=createBudget({now:()=>NOW});
    try {
      assert.throws(()=>createInventoryReader({projectId:PROJECT,core:{...core,CLEANUP_COLLECTIONS:{...core.CLEANUP_COLLECTIONS,other:'users'}},budget}));
      assert.throws(()=>createInventoryReader({projectId:'other-project',core,budget}));
      const prefix=`projects/${PROJECT}/databases/(default)/documents/coachAiBillingEnrollments/`;
      for(const value of [[{error:{message:'redacted'}}],[{}],[{document:{name:'projects/other/documents/users/id',fields:{}}}],
        [{document:{name:prefix+'id',fields:{uid:{stringValue:'private'}}}}]]) {
        let reads=0;const read=createInventoryReader({projectId:PROJECT,core,budget,getAccessToken:async()=>'fake',send:async()=>{reads++;return {status:200,value};}});
        await assert.rejects(read());assert.equal(reads,1);
      }
    }finally{budget.close();}
  });
  await test('observer_decodes_timestamps_and_reports_pending_cleanup_without_identifiers',async()=>{
    const budget=createBudget({now:()=>NOW}),prefix=`projects/${PROJECT}/databases/(default)/documents/`,id='a'.repeat(64);
    try {
      const read=createInventoryReader({projectId:PROJECT,core,budget,getAccessToken:async()=>'fake',send:async(_url,options)=>{
        const collection=options.body.structuredQuery.from[0].collectionId;
        return {status:200,value:collection==='coachAiBillingEnrollments'?[{document:{name:prefix+collection+'/'+id,fields:{state:{stringValue:'deleting'},vendorCleanupRequired:{booleanValue:false},fencedAt:{timestampValue:'2026-10-15T12:00:00.123456789Z'}}}}]:[{readTime:'2026-10-15T13:07:00Z'}]};
      }});
      const snapshot=await core.createCleanupQueueMonitor(read,()=>NOW)();assert.equal(snapshot.health,'attention');assert.equal(snapshot.counts.pendingCleanup,1);
      assert.ok(!JSON.stringify(snapshot).includes(id));
    }finally{budget.close();}
  });
  await test('deadline_or_logging_failure_stops_without_another_scan_or_log_attempt',async()=>{
    let time=NOW,scans=0;const logs=[];
    const handler=createObserverHost({enabled:true,now:()=>time,log:v=>logs.push(v),createRuntime:()=>({authenticate:async()=>true,scan:async()=>{scans++;time+=25001;return healthy();}})});
    assert.equal((await invoke(handler)).status,503);assert.equal(scans,1);assert.equal(logs[0].health,'unknown');
    let attempts=0;const failed=hostFixture({log:()=>{attempts++;throw Error('private_log_detail');}});
    assert.equal((await invoke(failed.handler)).status,503);assert.equal((await invoke(failed.handler)).status,409);assert.equal(attempts,1);assert.equal(failed.scans(),1);
  });
  result.passed=true;
}
main().catch(error=>{result.failure='focused_fixture_stopped';result.failedCase=currentCase;result.fixtureError=String(error.message).slice(0,1200);process.exitCode=1;}).finally(()=>{
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2),{flag:'wx'});
  process.stdout.write(JSON.stringify({passed:result.passed,cases:result.cases.length,evidence:path.join(out,'result.json')})+'\n');
});
