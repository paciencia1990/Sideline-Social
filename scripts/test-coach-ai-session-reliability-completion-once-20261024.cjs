'use strict';
// New behavior only. Every credential/process/network/timer dependency is fake.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),out=path.join(root,'docs/coach-ai-session-reliability-local-20261024/offline-completion-v1');
if(process.env.SIDELINE_SESSION_RELIABILITY_OFFLINE_COMPLETION_APPROVED!=='once') throw Error('fresh_offline_completion_approval_required');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'offline-attempt.json'),JSON.stringify({at:new Date().toISOString(),offline:true,attempts:1})+'\n',{flag:'wx'});
const oldLoad=Module._load;
Module._load=function(name,...rest){
  if (['node:child_process','child_process','node:https','https','node:http','http','node:net','net','node:tls','tls','node:dgram','dgram'].includes(name)) throw Error('offline_external_dependency_denied');
  return oldLoad.call(this,name,...rest);
};
global.fetch=()=>{throw Error('offline_network_denied');};
const {createCredentialLease,providerFailure}=require('./operations/coach-ai-session-credential.cjs');
const {createSessionSupervisor}=require('./operations/coach-ai-session-supervisor.cjs');
const {createReviewedPhaseExecutor}=require('./operations/coach-ai-reviewed-phase-executor.cjs');
const MIN=60000,T=Date.UTC(2026,9,24,15),TOKEN='fictional_token_abcdefghijklmnopqrstuvwxyz';
const passed=[];
function auth(options={}) {
  let t=T,calls=0,command,run;
  const lease=createCredentialLease({account:'fictional@example.invalid',approved:()=>options.approved!==false,
    now:()=>t,environment:{},spawnSync:(...args)=>{
      calls++;command=args;
      run=options.run || {status:0,stdout:JSON.stringify({credential:{access_token:TOKEN,
        token_expiry:options.missingExpiry?undefined:new Date(T+(options.minutes??60)*MIN).toISOString().replace('.000Z','Z')},
        configuration:{private:'do-not-retain'}}),stderr:''};
      return run;
    }});
  return {lease,setTime:v=>{t=v;},calls:()=>calls,command:()=>command,run:()=>run};
}
function session({phaseHandler}={}) {
  const a=auth();a.lease.acquire();let t=T,callback,clearCount=0;
  const phases=[],notes=[];let overrides={};
  const healthy=()=>({schemaVersion:2,sessionId:'fictional-session',captureId:'fictional-capture',
    at:new Date(t).toISOString(),captureEndsUtc:new Date(T+30*MIN).toISOString(),
    live:true,transportReadyForPlansOnly:true,streamProcessRunning:true,stdoutReaderRunning:true,
    stderrMonitorStarted:true,fault:null,eof:false,appLogSincePlansAuthorization:true,plansBoundaryId:'fictional-boundary',...overrides});
  const s=createSessionSupervisor({sessionId:'fictional-session',lease:a.lease,approved:()=>true,now:()=>t,
    readCapture:healthy,captureExpected:()=>({captureId:'fictional-capture',captureMustEndByUtc:new Date(T+30*MIN).toISOString(),
      plansBoundaryId:'fictional-boundary',ownerPlansReady:true}),
    executePhase:async(phase,context)=>{phases.push(phase);context.beforeRequest();return phaseHandler?phaseHandler(phase,context):{ok:true};},
    notify:v=>notes.push(v),setTimer:fn=>{callback=fn;return 71;},clearTimer:id=>{assert.equal(id,71);clearCount++;}});
  s.startWindow();s.attachCapture();
  return {s,a,phases,notes,tick:()=>callback(),setTime:v=>{t=v;a.setTime(v);},change:v=>{overrides=v;},clears:()=>clearCount};
}
async function group(name,fn){await fn();passed.push(name);console.log('PASS '+name);}
(async()=>{
 let failure;
 try {
  await group('expiry_aware_single_acquisition_and_redacted_receipt',()=>{
    const a=auth();const receipt=a.lease.acquire();a.lease.assertCoversWindow(T+45*MIN);
    assert.equal(a.lease.tokenForWindow(T+45*MIN),TOKEN);assert.equal(a.calls(),1);
    assert(a.command()[1].includes('--min-expiry=55m'));assert(a.command()[1].includes('--format=json'));
    assert.equal(a.command()[2].env.CLOUDSDK_CORE_MAX_RETRIES,'0');assert.equal(a.command()[2].windowsHide,true);
    assert(!JSON.stringify(receipt).includes(TOKEN));assert(!JSON.stringify(receipt).includes('do-not-retain'));
    assert.equal(a.run().stdout,'');assert.equal(a.run().stderr,'');
    assert.throws(()=>a.lease.acquire(),/unused_attempt/);assert.equal(a.calls(),1);
  });
  await group('no_authentication_without_fresh_approval',()=>{
    const a=auth({approved:false});assert.throws(()=>a.lease.acquire(),/approval/);assert.equal(a.calls(),0);
  });
  await group('short_or_unknown_expiry_stops_before_any_cloud_request',()=>{
    for(const options of [{minutes:20},{missingExpiry:true}]){
      const a=auth(options);assert.throws(()=>a.lease.acquire(),/credential_(lifetime_too_short|expiry_required)/);
      assert.throws(()=>a.lease.tokenForWindow(T+45*MIN),/usable_credential/);assert.equal(a.calls(),1);
    }
  });
  await group('waiting_before_start_cannot_consume_shutdown_reserve',()=>{
    const a=auth();a.lease.acquire();a.setTime(T+14*MIN);
    assert.throws(()=>a.lease.assertCoversWindow(T+59*MIN),/does_not_cover_shutdown/);assert.equal(a.calls(),1);
  });
  await group('malformed_auth_response_and_error_text_do_not_leak',()=>{
    const a=auth({run:{status:0,stdout:'secret malformed '+TOKEN,stderr:TOKEN}});
    assert.throws(()=>a.lease.acquire(),/credential_json_invalid/);
    assert(!JSON.stringify(a.lease.receipt()).includes(TOKEN));assert.equal(a.run().stderr,'');
    const b=auth({run:{status:1,stdout:TOKEN,stderr:'invalid_grant '+TOKEN}});
    assert.throws(()=>b.lease.acquire(),/^Error: private_owner_sign_in_required$/);assert.equal(b.calls(),1);
  });
  await group('rejected_or_closed_token_never_refreshes_itself',()=>{
    const a=auth();a.lease.acquire();a.lease.reject();assert.throws(()=>a.lease.tokenForWindow(T+45*MIN),/usable/);
    a.lease.close();assert.throws(()=>a.lease.acquire(),/approval_or_unused/);assert.equal(a.calls(),1);
  });
  await group('provider_401_is_not_automatically_labelled_expiry',()=>{
    const unknown=providerFailure(401,{error:{message:TOKEN,details:[{reason:TOKEN}]}});
    assert.equal(unknown.authenticationRejected,true);assert.equal(unknown.tokenExpiryProven,false);
    assert(!JSON.stringify(unknown).includes(TOKEN));
    assert.equal(providerFailure(401,{error:{details:[{reason:'ACCESS_TOKEN_EXPIRED'}]}}).tokenExpiryProven,true);
  });
  await group('healthy_idle_logging_does_not_create_false_failure',async()=>{
    const x=session();x.change({appLogSincePlansAuthorization:false});x.setTime(T+10*MIN);x.tick();
    assert.deepEqual(x.phases,[]);assert.equal(x.s.snapshot().stopping,false);
    await x.s.stop('owner_stop');assert.deepEqual(x.phases,['master-off','disable']);
  });
  await group('unexpected_adb_exit_triggers_one_ordered_shutdown',async()=>{
    const x=session();x.change({live:false,streamProcessRunning:false,eof:true});x.tick();x.tick();
    await x.s.settled();assert.deepEqual(x.phases,['master-off','disable']);assert.equal(x.clears(),1);
    assert.equal(x.s.snapshot().closed,true);assert.equal(x.a.calls(),1);
  });
  await group('stale_local_heartbeat_stops_even_without_a_new_phone_action',async()=>{
    const x=session();x.setTime(T+6000);x.change({at:new Date(T).toISOString()});x.tick();
    await x.s.settled();assert.deepEqual(x.phases,['master-off','disable']);
  });
  await group('restore_requires_current_logging_and_separate_action_facts',async()=>{
    const x=session();assert.throws(()=>x.s.authorizeAction('restoreA',()=>false),/action_facts/);
    const allowed=x.s.authorizeAction('restoreA',()=>true);assert.equal(allowed.maximumActions,1);
    assert.throws(()=>x.s.authorizeAction('restoreA',()=>true),/one_reviewed_action/);
    x.change({live:false});assert.throws(()=>x.s.authorizeAction('restoreB',()=>true),/fresh_healthy_capture/);
    x.tick();await x.s.settled();
  });
  await group('subscribe_retains_existing_delivery_requirement',async()=>{
    const x=session();x.change({appLogSincePlansAuthorization:false});
    assert.throws(()=>x.s.authorizeAction('subscribe',()=>true),/app_delivery/);
    await x.s.stop('owner_stop');
  });
  await group('logging_loss_blocks_next_request_of_inflight_phase',async()=>{
    let release,stageContext;
    const x=session({phaseHandler:(phase,context)=>{
      if(phase==='stage'){stageContext=context;return new Promise(resolve=>{release=resolve;});}
      return {ok:true};
    }});
    const work=x.s.phase('stage');await Promise.resolve();
    x.change({live:false});x.tick();
    assert.throws(()=>stageContext.beforeRequest(),/testing_stopped/);
    assert.throws(()=>x.s.authorizeAction('restoreA',()=>true),/testing_stopped/);
    release({ok:false});await work;await x.s.settled();
    assert.deepEqual(x.phases,['stage','master-off','disable']);
  });
  await group('401_stops_without_replaying_phase_or_reusing_rejected_token',async()=>{
    const x=session({phaseHandler:()=>({ok:false,authenticationRejected:true})});
    await x.s.phase('purchase');await x.s.settled();
    assert.deepEqual(x.phases,['purchase']);assert.equal(x.a.calls(),1);
    assert.equal(x.notes.at(-1).status,'SHUTDOWN_INCOMPLETE_NO_RETRY');
  });
  await group('non_auth_failure_allows_untouched_independent_shutdown',async()=>{
    const x=session({phaseHandler:phase=>({ok:phase==='disable'})});
    await x.s.phase('purchase');await x.s.settled();
    assert.deepEqual(x.phases,['purchase','master-off','disable']);
    assert.equal(x.notes.at(-1).status,'SHUTDOWN_INCOMPLETE_NO_RETRY');
  });
  await group('normal_cutoff_stops_testing_and_deadline_blocks_late_writes',async()=>{
    const x=session();x.setTime(T+30*MIN);x.tick();await x.s.settled();
    assert.deepEqual(x.phases,['master-off','disable']);
    const y=session();y.setTime(T+45*MIN);y.tick();await y.s.settled();
    assert.deepEqual(y.phases,[]);assert.equal(y.notes.at(-1).status,'SHUTDOWN_INCOMPLETE_NO_RETRY');
  });
  await group('bound_executor_checks_every_request_and_never_reauthenticates',async()=>{
    const source="(async()=>{require('./cleanup-firebase-cloud-20261017.cjs').cliToken();require('node:https').request('fictional');})();";
    let checks=0,requests=0,tokens=0;
    const executor=createReviewedPhaseExecutor({bindings:{stage:{file:__filename,argument:'stage',sha256:crypto.createHash('sha256').update(source).digest('hex'),outcomeFile:'fake',successStatus:'PASS'}},
      readFile:()=>source,readOutcome:()=>({status:'PASS',requests:[]}),core:{cliToken:()=>{throw Error('forbidden_auth');}},
      https:{request:()=>{requests++;}},environment:{},requireModule:()=>{throw Error('unexpected_import');}});
    await assert.rejects(executor('stage',{token:()=>{tokens++;return TOKEN;},beforeRequest:()=>{if(++checks===2)throw Error('testing_stopped');}}),/testing_stopped/);
    assert.equal(requests,0);assert.equal(tokens,1);assert.equal(checks,2);
    await assert.rejects(executor('stage',{}),/once/);
  });
  await group('bound_executor_source_and_provider_outcome_guards',async()=>{
    const source='Promise.resolve();',pin={file:__filename,argument:'purchase',sha256:crypto.createHash('sha256').update(source).digest('hex'),outcomeFile:'fake',successStatus:'PASS'};
    const deps={bindings:{purchase:pin},readFile:()=>source,readOutcome:()=>({status:'STOPPED_NO_RETRY',requests:[{httpStatus:401}]}),core:{},https:{},environment:{},requireModule:()=>{throw Error('unused');}};
    const execute=createReviewedPhaseExecutor(deps);
    assert.deepEqual(await execute('purchase',{beforeRequest:()=>{},token:()=>TOKEN}),{ok:false,authenticationRejected:true,status:'STOPPED_NO_RETRY'});
    const changed=createReviewedPhaseExecutor({...deps,readFile:()=>source+' '});
    await assert.rejects(changed('purchase',{beforeRequest:()=>{}}),/source_changed/);
  });
 } catch(error) {failure=error;console.error(error);}
 const sources=['scripts/operations/coach-ai-session-credential.cjs','scripts/operations/coach-ai-session-supervisor.cjs','scripts/operations/coach-ai-reviewed-phase-executor.cjs',path.relative(root,__filename).replaceAll('\\','/')];
 const report={status:failure?'STOPPED_NO_RETRY':'PASS',groupsPassed:passed.length,groups:passed,offline:true,
   priorPassedChecksReused:true,deviceCommands:0,networkCalls:0,credentialAcquisitions:0,realProcessesStarted:0,builds:0,
   finishedAtUtc:new Date().toISOString(),sources:Object.fromEntries(sources.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]))};
 fs.writeFileSync(path.join(out,'offline-result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(report));process.exitCode=failure?1:0;
})();
