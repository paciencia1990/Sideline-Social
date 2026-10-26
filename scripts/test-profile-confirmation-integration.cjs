'use strict';
// New confirmation integration only: real TS modules, fictional data, mocked SDK.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..');global.__DEV__=false;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function load(file,modules={},clock={}){
 const compiled=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 assert.deepEqual((compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error),[]);
 const module={exports:{}};
 new Function('require','module','exports','setTimeout','clearTimeout',compiled.outputText)(name=>{assert.ok(Object.hasOwn(modules,name),'unmocked_dependency:'+name);return modules[name];},module,module.exports,clock.setTimeout||setTimeout,clock.clearTimeout||clearTimeout);
 return module.exports;
}
const uid='fictional-profile-coach',teamId='fictional-profile-team';
const profile={coachTeamIds:[teamId],parentTeamIds:[],archivedCoachTeamIds:[]};
const member={role:'coach',roles:{coach:true,parent:false,staff:false},status:'active'};
const team={name:'Fictional Team',createdBy:uid,status:'active'};
const snap=(id,data,fromCache=false,hasPendingWrites=false)=>({id,exists:()=>data!==null,data:()=>data,metadata:{fromCache,hasPendingWrites}});
function fixture({memberMetadata,teamMetadata}={}){
 const session={uid},auth={currentUser:session},timers=new Map(),listeners=[],authListeners=new Set(),serverReads=[];
 let sequence=0,authStarts=0,authStops=0;
 const clock={setTimeout:(callback,ms)=>{const id=++sequence;timers.set(id,{callback,ms});return id;},clearTimeout:id=>timers.delete(id)};
 const config={auth,db:{},functions:{},firebaseAppCheckReady:Promise.resolve()};
 const core=load('utils/confirmedProfileRead.ts',{},clock);
 const readiness=load('services/teamReadReadiness.ts',{'@/config/firebase':config},clock);
 const sdk={
  doc:(_db,...parts)=>parts.join('/'),
  onSnapshot(reference,options,next,error){
   assert.equal(reference,'users/'+uid);assert.equal(options.includeMetadataChanges,true);
   const entry={next,error,active:true,stops:0};listeners.push(entry);
   return ()=>{entry.active=false;entry.stops++;};
  },
  async getDocFromServer(reference){
   serverReads.push(reference);
   if(reference==='teams/'+teamId+'/members/'+uid)return snap(uid,member,...(memberMetadata||[false,false]));
   if(reference==='teams/'+teamId)return snap(teamId,team,...(teamMetadata||[false,false]));
   throw Error('unexpected_server_read');
  },
 };
 const api=load('services/teamService.ts',{
  'firebase/firestore':sdk,'firebase/functions':{},
  'firebase/auth':{onAuthStateChanged(value,next){assert.equal(value,auth);authStarts++;authListeners.add(next);next(auth.currentUser);return ()=>{authListeners.delete(next);authStops++;};}},
  '@/config/firebase':config,'@/constants/teamHistoryPagination':{TEAM_HISTORY_PAGE_SIZES:{}},
  '@/utils/friendPrivacy':{},'@/utils/teamLifecycleRequest':{},'@/services/teamReadReadiness':readiness,'@/utils/confirmedProfileRead':core,
 },clock);
 return {api,auth,session,listeners,authListeners,serverReads,timers,
  emit(index,value){assert.ok(listeners[index],'profile_observer_missing');listeners[index].next(value);},
  error(index,value){listeners[index].error(value);},
  changeSession(next){auth.currentUser=next;[...authListeners].forEach(callback=>callback(next));},
  timeout(){const active=[...timers.values()];timers.clear();active.forEach(value=>value.callback());},
  counts:()=>({authStarts,authStops}),
 };
}
function clean(f){assert.equal(f.timers.size,0);assert.equal(f.authListeners.size,0);assert.equal(f.counts().authStarts,f.counts().authStops);assert.ok(f.listeners.every(value=>!value.active&&value.stops===1));}
const groups=[];
async function test(name,run){await run();groups.push(name);}
async function main(){
 await test('pending_and_cache_profile_events_keep_dependent_reads_stopped_until_server_confirmation',async()=>{
  const f=fixture(),controller=new AbortController();let finished=false;
  const pending=f.api.getConfirmedCoachHomeTeams(uid,{signal:controller.signal}).then(value=>{finished=true;return value;});await tick();
  assert.equal(f.listeners.length,1);f.emit(0,snap(uid,profile,true,false));f.emit(0,snap(uid,profile,false,true));await tick();
  assert.equal(finished,false);assert.deepEqual(f.serverReads,[]);assert.equal(f.listeners.length,1);
  f.emit(0,snap(uid,profile));const result=await pending;
  assert.equal(result.memberships.length,1);assert.deepEqual(f.serverReads,['teams/'+teamId+'/members/'+uid,'teams/'+teamId]);clean(f);
 });
 await test('confirmed_missing_profile_and_malformed_indexes_remain_denied',async()=>{
  for(const data of [null,{...profile,coachTeamIds:'bad-index'}]){
   const f=fixture(),pending=f.api.getConfirmedCoachHomeTeams(uid,{signal:new AbortController().signal});
   const rejected=assert.rejects(pending,error=>error.reason===(data===null?'profile_unconfirmed':'index_unconfirmed')&&error.serverConfirmed===true);
   await tick();f.emit(0,snap(uid,data));await rejected;assert.deepEqual(f.serverReads,[]);clean(f);
  }
 });
 await test('profile_permission_error_retains_safe_code_without_private_error_content',async()=>{
  const f=fixture(),pending=f.api.getConfirmedCoachHomeTeams(uid,{signal:new AbortController().signal});let captured;
  const handled=pending.catch(error=>{captured=error;});await tick();f.error(0,Object.assign(Error('PRIVATE_PROVIDER_DETAILS'),{code:'firestore/permission-denied'}));await handled;
  const diagnostic=f.api.getCoachHomeLookupDiagnostic(captured);assert.equal(diagnostic.code,'permission-denied');assert.equal(diagnostic.reason,'profile_unconfirmed');assert.equal(diagnostic.serverConfirmed,false);
  assert.equal(JSON.stringify(captured).includes('PRIVATE'),false);assert.deepEqual(f.serverReads,[]);clean(f);
 });
 await test('pending_or_cached_membership_and_team_snapshots_still_fail_closed',async()=>{
  for(const options of [{memberMetadata:[false,true]},{memberMetadata:[true,false]},{teamMetadata:[false,true]},{teamMetadata:[true,false]}]){
   const f=fixture(options),pending=f.api.getConfirmedCoachHomeTeams(uid,{signal:new AbortController().signal});
   const rejected=assert.rejects(pending,error=>error.reason===(options.memberMetadata?'membership_unconfirmed':'team_unconfirmed')&&error.serverConfirmed===false);
   await tick();f.emit(0,snap(uid,profile));await rejected;assert.equal(f.serverReads.length,options.memberMetadata?1:2);clean(f);
  }
 });
 await test('navigation_abort_and_replaced_auth_session_cleanup_without_late_dependent_reads',async()=>{
  for(const mode of ['abort','same_uid_replaced','signout']){
   const f=fixture(),controller=new AbortController(),pending=f.api.getConfirmedCoachHomeTeams(uid,{signal:controller.signal});
   const rejected=assert.rejects(pending,error=>mode==='abort'?error.safeCode==='cancelled':error.reason==='session_unconfirmed');await tick();
   if(mode==='abort')controller.abort();else f.changeSession(mode==='signout'?null:{uid});
   await rejected;f.emit(0,snap(uid,profile));await tick();assert.deepEqual(f.serverReads,[]);clean(f);
  }
 });
 await test('independent_screen_cancellation_does_not_cancel_peer_and_signal_less_calls_still_share',async()=>{
  const f=fixture(),a=new AbortController(),b=new AbortController();
  const first=f.api.getConfirmedCoachHomeTeams(uid,{signal:a.signal}),peer=f.api.getConfirmedCoachHomeTeams(uid,{signal:b.signal});
  const rejected=assert.rejects(first,error=>error.safeCode==='cancelled');await tick();assert.equal(f.listeners.length,2);a.abort();await rejected;
  assert.equal(f.listeners.filter(value=>value.active).length,1);f.emit(1,snap(uid,profile));assert.equal((await peer).memberships.length,1);clean(f);
  const g=fixture(),shared=g.api.getConfirmedCoachHomeTeams(uid),same=g.api.getConfirmedCoachHomeTeams(uid);assert.equal(shared,same);
  await tick();assert.equal(g.listeners.length,1);g.emit(0,snap(uid,profile));assert.equal((await shared).memberships.length,1);clean(g);
 });
 await test('unconfirmed_profile_deadline_diagnostic_keeps_both_safe_metadata_booleans',async()=>{
  const f=fixture(),pending=f.api.getConfirmedCoachHomeTeams(uid,{signal:new AbortController().signal});let captured;
  const handled=pending.catch(error=>{captured=error;});await tick();f.emit(0,snap(uid,profile,false,true));f.timeout();await handled;
  assert.deepEqual(f.api.getCoachHomeLookupDiagnostic(captured),{reason:'profile_unconfirmed',serverConfirmed:false,code:'deadline-exceeded',fromCache:false,hasPendingWrites:true});
  assert.deepEqual(f.serverReads,[]);clean(f);
 });
 return {status:'PASS',groups:groups.length,cases:groups,networkRequests:0,firestoreRequests:0,deviceCommands:0,builds:0,deployments:0,retries:0};
}
if(require.main===module)main().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(JSON.stringify({status:'STOPPED_NO_RETRY',completed:groups,message:error.message}));process.exitCode=1;});
module.exports={main};
