'use strict';
// New mode-persistence ordering only. Fictional callbacks, no SDK or network.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const source=ts.transpileModule(fs.readFileSync(path.join(root,'utils/modeSwitch.ts'),'utf8'),{fileName:'utils/modeSwitch.ts',reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
assert.deepEqual((source.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error),[]);
const fixture={exports:{}};
new Function('require','module','exports',source.outputText)(name=>{throw Error('unexpected_dependency:'+name);},fixture,fixture.exports);
const {switchModeImmediately}=fixture.exports;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const groups=[];
async function test(name,run){await run();groups.push(name);}
async function main(){
 await test('persistence_starts_before_immediate_navigation_and_duplicate_taps_do_not_write',async()=>{
  for(const mode of ['coach','parent']){
   const gate=deferred(),events=[],inFlight={current:false};let finished=false;
   const options={inFlight,mode,isCurrentAccount:()=>true,persist:()=>{events.push('persist');return gate.promise;},setMode:value=>events.push(value),navigate:()=>events.push('navigate'),onPersistenceError:()=>events.push('notice')};
   const pending=switchModeImmediately(options).then(()=>{finished=true;});
   assert.deepEqual(events,['persist',mode,'navigate']);assert.equal(finished,false);
   await switchModeImmediately(options);assert.deepEqual(events,['persist',mode,'navigate']);
   gate.resolve();await pending;assert.equal(finished,true);assert.equal(events.includes('notice'),false);
  }
 });
 await test('synchronous_preference_failure_still_navigates_and_notifies_current_account_once',async()=>{
  const events=[],inFlight={current:false};
  await switchModeImmediately({inFlight,mode:'coach',isCurrentAccount:()=>true,persist:()=>{events.push('persist');throw Error('fictional_preference_failure');},setMode:()=>events.push('mode'),navigate:()=>events.push('navigate'),onPersistenceError:()=>events.push('notice')});
  assert.deepEqual(events,['persist','mode','navigate','notice']);
 });
 await test('asynchronous_preference_failure_and_account_fence',async()=>{
  for(const remainsCurrent of [true,false]){
   const gate=deferred(),events=[];let current=true;
   const pending=switchModeImmediately({inFlight:{current:false},mode:'coach',isCurrentAccount:()=>current,persist:()=>{events.push('persist');return gate.promise;},setMode:()=>events.push('mode'),navigate:()=>events.push('navigate'),onPersistenceError:()=>events.push('notice')});
   current=remainsCurrent;gate.reject(Error('fictional_offline'));await pending;
   assert.deepEqual(events,remainsCurrent?['persist','mode','navigate','notice']:['persist','mode','navigate']);
  }
 });
 await test('invalid_account_and_inflight_guards_start_nothing',async()=>{
  for(const [busy,current] of [[true,true],[false,false]]){
   let calls=0;
   await switchModeImmediately({inFlight:{current:busy},mode:'coach',isCurrentAccount:()=>current,persist:async()=>{calls++;},setMode:()=>{calls++;},navigate:()=>{calls++;},onPersistenceError:()=>{calls++;}});
   assert.equal(calls,0);
  }
 });
 await test('failed_navigation_keeps_one_started_preference_write_and_handles_late_rejection',async()=>{
  const gate=deferred(),inFlight={current:false},unhandled=[];let writes=0,notices=0;
  const onUnhandled=reason=>unhandled.push(reason);process.on('unhandledRejection',onUnhandled);
  try{
   const pending=switchModeImmediately({inFlight,mode:'coach',isCurrentAccount:()=>true,persist:()=>{writes++;return gate.promise;},setMode(){},navigate(){throw Error('fictional_navigation_failure');},onPersistenceError(){notices++;}});
   await assert.rejects(pending,/fictional_navigation_failure/);assert.equal(inFlight.current,false);assert.equal(writes,1);
   gate.reject(Error('fictional_late_preference_failure'));await tick();await tick();
   assert.equal(writes,1);assert.equal(unhandled.length,0);assert.equal(notices,0);
  }finally{process.removeListener('unhandledRejection',onUnhandled);}
 });
 return {status:'PASS',groups:groups.length,cases:groups,networkRequests:0,deviceCommands:0,builds:0,deployments:0,retries:0};
}
if(require.main===module)main().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(JSON.stringify({status:'STOPPED_NO_RETRY',completed:groups,message:error.message}));process.exitCode=1;});
module.exports={main};
