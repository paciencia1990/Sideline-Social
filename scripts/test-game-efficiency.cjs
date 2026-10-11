'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, modules = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`); return modules[name];
  }, module, module.exports);
  return module.exports;
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness(factory) {
  const hooks = []; let cursor = 0, effects = [], mounted = true, lateWrites = 0;
  const changed = (before, deps) => !before || !deps || deps.some((value, index) => value !== before.deps[index]);
  const React = {
    Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    createContext: (value) => ({ Provider: 'Provider', value }), useContext: (context) => context.value,
    useState(initial) { const slot = cursor++; if (!hooks[slot]) hooks[slot] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[slot].value, (value) => { if (!mounted) lateWrites++; hooks[slot].value = typeof value === 'function' ? value(hooks[slot].value) : value; }]; },
    useRef(initial) { const slot = cursor++; if (!hooks[slot]) hooks[slot] = { current: initial }; return hooks[slot]; },
    useMemo(factory, deps) { const slot = cursor++; if (changed(hooks[slot], deps)) hooks[slot] = { deps, value: factory() }; return hooks[slot].value; },
    useCallback(callback, deps) { const slot = cursor++; if (changed(hooks[slot], deps)) hooks[slot] = { deps, value: callback }; return hooks[slot].value; },
    useEffect(effect, deps) { const slot = cursor++, previous = hooks[slot]; if (changed(previous, deps)) effects.push(() => { previous?.cleanup?.(); hooks[slot] = { deps, cleanup: effect() }; }); },
  };
  const component = factory(React);
  return { render(props = {}) { cursor = 0; effects = []; const tree = component(props); effects.forEach((run) => run()); return tree; },
    unmount() { hooks.forEach((hook) => hook?.cleanup?.()); mounted = false; }, lateWrites: () => lateWrites };
}
function all(tree, predicate) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap((node) => all(node, predicate)); return [...(predicate(tree) ? [tree] : []), ...all(tree.props?.children, predicate)]; }
const find = (tree, predicate) => all(tree, predicate)[0];
const hasText = (tree, text) => Boolean(find(tree, (node) => node.type === 'Text' && node.props.children.includes(text)));

const refreshCore=load('utils/coalescedRefresh.ts');
const theme={Colors:{},Spacing:{},Typography:{},Radius:{},Shadow:{}};
const measure={measureDevelopmentPerformance:(_name,work)=>work()};
function refreshHooks(React){return load('hooks/useCoalescedRefresh.ts',{react:React,'@/utils/coalescedRefresh':refreshCore});}

async function gameStartTests() {
  const oldInterval=global.setInterval,oldClear=global.clearInterval;const timers=new Map(),events=new Set();let id=0;
  global.setInterval=(callback,delay)=>{const key=++id;timers.set(key,{callback,delay});return key;};global.clearInterval=key=>timers.delete(key);
  try {
    let listener;const preloads=[],acks=[];let params={sessionId:'s',lobbyId:'l'};
    const nativeState={currentState:'active',addEventListener:(_event,callback)=>{events.add(callback);return {remove:()=>events.delete(callback)};}};
    const ui=harness(React=>load('components/SynchronizedGameStartGate.tsx',{
      react:React,'react-native':{ActivityIndicator:'ActivityIndicator',Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:value=>value},AppState:nativeState},
      'expo-router':{router:{replace(){}},useLocalSearchParams:()=>params},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:0,bottom:0})},'react-i18next':{useTranslation:()=>({t:key=>key})},
      '@/components/CountdownOverlay':{default:'CountdownOverlay'},'@/constants/theme':theme,'@/context/SquadContext':{useSquad:()=>({selectedSquadId:'squad'})},
      '@/hooks/useFirebaseServerClock':{useFirebaseServerClock:()=>({offsetMs:0})},'@/hooks/useGameRoomDeparture':{useGameRoomDeparture:()=>({departing:false})},
      '@/services/gameStartSynchronizationService':{subscribeToSynchronizedGameStart:(_g,_s,cb)=>{listener=cb;return ()=>{};},
        preloadSynchronizedGameRound:()=>{const task=deferred();preloads.push(task);return task.promise;},acknowledgeSynchronizedGameStart:async input=>{acks.push(input);},prepareSynchronizedGameStart:async()=>{}},
      '@/utils/gameStartSynchronization':load('utils/gameStartSynchronization.ts'),
    }).default);
    const state={schemaVersion:1,gameType:'triviaBlitz',sessionId:'s',lobbyId:'l',startAttemptId:'attempt',phase:'preparing',participantCount:3,acknowledgedCount:0,readinessDeadlineAtMs:Date.now()+30000,countdownStartsAtMs:null,gameplayStartsAtMs:null};
    const props={gameType:'triviaBlitz',children:'game-child'};
    ui.render(props);listener(state);ui.render(props);await flush();assert.equal(preloads.length,1);
    listener({...state,acknowledgedCount:1});ui.render(props);preloads[0].resolve();await flush();let tree=ui.render(props);await flush();assert.equal(acks.length,1,'Progress update must not cancel acknowledgement');assert.equal(preloads.length,1);
    listener({...state,phase:'scheduled',acknowledgedCount:3,countdownStartsAtMs:Date.now()-8000,gameplayStartsAtMs:Date.now()-4000});tree=ui.render(props);
    assert.ok(all(tree,node=>node.props.children.includes('game-child')).length);assert.equal(timers.size,0,'Active gameplay stops countdown ticking');
    listener({...state,startAttemptId:'new',acknowledgedCount:0});ui.render(props);await flush();assert.equal(preloads.length,2);
    listener({...state,startAttemptId:'newer'});ui.render(props);await flush();assert.equal(preloads.length,3);preloads[1].resolve();await flush();assert.equal(acks.length,1,'Superseded preparation cannot acknowledge the new attempt');
    preloads[2].reject(Error('unavailable'));await flush();tree=ui.render(props);
    const retry=find(tree,node=>node.type==='Pressable'&&all(node,n=>n.type==='Text'&&n.props.children.includes('common.retry')).length);assert.ok(retry);
    retry.props.onPress();retry.props.onPress();ui.render(props);await flush();assert.equal(preloads.length,4,'Repeated Retry shares one preparation');
    nativeState.currentState='background';events.forEach(callback=>callback('background'));ui.render(props);assert.equal(timers.size,0);
    nativeState.currentState='active';events.forEach(callback=>callback('active'));ui.render(props);assert.equal(timers.size,1);
    preloads[3].resolve();await flush();ui.render(props);assert.equal(acks.at(-1).startAttemptId,'newer');
    params={sessionId:'other',lobbyId:'other'};ui.render(props);listener({...state,sessionId:'other',startAttemptId:'other'});ui.render(props);await flush();const last=preloads.at(-1);ui.unmount();last.resolve();await flush();assert.equal(ui.lateWrites(),0);assert.equal(timers.size,0);assert.equal(events.size,0);
  } finally {global.setInterval=oldInterval;global.clearInterval=oldClear;}
}

async function backendCoreTests() {
  const core=load('functions/src/gameLobbyCore.ts');const old={lobbyId:'l',sessionId:'s',gameType:'triviaBlitz',squadId:'sq',lobbyNumber:1,hostUserId:'h',hostDisplayName:'Host',status:'waiting',activePlayerCount:2,queuedPlayerCount:0,capacity:20,createdAtMs:1000,updatedAtMs:1100,expiresAtMs:10000};
  assert.equal(core.preserveUnchangedLobbyTimestamp(old,{...old,updatedAtMs:5000},5000),old);
  for(const changed of [{hostUserId:'next'},{activePlayerCount:3},{queuedPlayerCount:1},{status:'inProgress'},{expiresAtMs:20000},{sessionId:'rematch'}]){
    const next=core.preserveUnchangedLobbyTimestamp(old,{...old,...changed},5000);assert.equal(next.updatedAtMs,5000);assert.notDeepEqual(next,old);
  }
  const {mapConcurrentReads}=load('functions/src/parallelReads.ts');let active=0,max=0;
  const result=await mapConcurrentReads([0,1,2,3,4,5,6,7,8],4,async index=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,9-index));active--;return index;});
  assert.equal(max,4);assert.deepEqual(result,[0,1,2,3,4,5,6,7,8],'Join order must survive out-of-order reads');
  let done=false;const pending=deferred();const failure=mapConcurrentReads([0,1,2],2,async index=>{if(index===0)throw Error('authorization lookup failed');await pending.promise;done=true;return index;});
  let rejected=false;failure.catch(()=>{rejected=true;});await flush();assert.equal(rejected,false,'Do not return while other backend reads are still running');pending.resolve();await assert.rejects(failure);assert.equal(done,true);
}

async function lobbyTests() {
  const oldInterval=global.setInterval,oldClear=global.clearInterval;const timers=new Map(),events=new Set();let id=0,focused=true,user={uid:'u'},input={enabled:true,squadId:'sq'};const reads=[];
  const app={currentState:'active',addEventListener:(_event,callback)=>{events.add(callback);return {remove:()=>events.delete(callback)};}};
  global.setInterval=(callback)=>{timers.set(++id,callback);return id;};global.clearInterval=id=>timers.delete(id);
  try {
    const ui=harness(React=>{
      const polling=load('hooks/useFocusedGameRefresh.ts',{react:React,'react-native':{AppState:app},'expo-router':{useFocusEffect:callback=>useHarnessFocus(React,focused,callback)}});
      const hook=load('hooks/useSquadGameLobbies.ts',{react:React,'@/context/AuthContext':{useAuth:()=>({user})},'@/hooks/useCoalescedRefresh':refreshHooks(React),'@/hooks/useFocusedGameRefresh':polling,
        '@/services/gameJoinCodeService':{listGameLobbies:input=>{const task=deferred();reads.push({input,task});return task.promise;},readGameJoinCodeFailureReason:()=> 'not_authorized'},'@/utils/performanceDiagnostics':measure});return ()=>hook.useSquadGameLobbies(input);
    });
    ui.render();await flush();let view=ui.render();timers.forEach(callback=>callback());events.forEach(callback=>callback('active'));await flush();assert.equal(reads.length,1,'Focus, foreground and polling share an in-flight directory');
    const latest=view.refresh(false);view.refresh(false);reads[0].task.resolve({lobbies:[{lobbyId:'first'}]});await flush();assert.equal(reads.length,2,'Mutation invalidations collapse into a single fresh directory');
    reads[1].task.resolve({lobbies:[{lobbyId:'current'}]});await latest;view=ui.render();assert.equal(view.lobbies[0].lobbyId,'current');
    app.currentState='background';events.forEach(callback=>callback('background'));assert.equal(timers.size,0);app.currentState='active';events.forEach(callback=>callback('active'));await flush();assert.equal(reads.length,3);
    focused=false;ui.render();assert.equal(timers.size,0);assert.equal(events.size,0);reads[2].task.resolve({lobbies:[]});await flush();
    focused=true;user={uid:'other'};view=ui.render();assert.deepEqual(view.lobbies,[]);await flush();reads.at(-1).task.resolve({lobbies:[]});await flush();ui.unmount();assert.equal(ui.lateWrites(),0);
  } finally {global.setInterval=oldInterval;global.clearInterval=oldClear;}
}
function useHarnessFocus(React,focused,callback){React.useEffect(()=>focused?callback():undefined,[callback,focused]);}

async function messageTests() {
  const auth={currentUser:{uid:'viewer'}},subscriptions=[],pages=[],errors=[];
  const service=load('services/teamPrivateMessageService.ts',{
    'firebase/firestore':{doc:(_db,...parts)=>parts.join('/'),collection:(_db,...parts)=>parts.join('/'),query:(...args)=>args,orderBy:(...args)=>args,where:(...args)=>args,documentId:()=> '__name__',limit:n=>n,
      onSnapshot:(query,next,error)=>{const item={query,next,error,stopped:false};subscriptions.push(item);return ()=>{item.stopped=true;};}},
    'firebase/functions':{},'firebase/storage':{},'@/config/firebase':{auth,db:{}},'@/constants/teamHistoryPagination':{TEAM_HISTORY_PAGE_SIZES:{privateMessages:40}},
    '@/services/publicProfileService':{},'@/utils/nativeUploadBlob':{},'@/utils/voiceMessageNormalizer':{normalizeVoiceMessageFields:data=>({senderUserId:data.senderUserId,contentType:'text',caption:null,voiceMemo:null})},'@/utils/voicePlaybackCore':{},
  });
  const stop=service.listenToNewestPrivateTeamMessagesPage('conversation',page=>pages.push(page),error=>errors.push(error));
  const messages=Array.from({length:40},(_v,index)=>({id:'m'+index,data:()=>({text:'Synthetic '+index,createdAt:100+index,senderUserId:'sender'})}));
  const emit=docs=>subscriptions[0].next({docs,size:docs.length});emit(messages);assert.equal(subscriptions.length,3);assert.equal(pages.length,0);
  subscriptions[1].next({docs:[{id:'m39'}]});assert.equal(pages.length,0,'Wait for every visibility chunk');subscriptions[2].next({docs:[]});
  assert.equal(pages.at(-1).messages.length,39);assert.equal(pages.at(-1).messages.some(m=>m.id==='m39'),false);
  emit(messages.map(m=>m.id==='m10'?{...m,data:()=>({text:'Edited',createdAt:110})}:m));assert.equal(subscriptions.length,3,'Content-only snapshot reuses hidden-message listeners');assert.equal(pages.at(-1).messages.length,39);
  subscriptions[1].next({docs:[{id:'m39'},{id:'m38'}]});assert.equal(pages.at(-1).messages.length,38,'Reused listener still processes newly hidden content');
  emit([{id:'new',data:()=>({text:'New',createdAt:200})},...messages.slice(0,39)]);assert.ok(subscriptions[1].stopped);const before=pages.length;
  subscriptions[1].next({docs:[]});subscriptions[1].error(Error('old query'));assert.equal(pages.length,before);assert.equal(errors.length,0,'Retired chunk callbacks cannot affect the new page');
  subscriptions.filter((sub,index)=>index>2&&!sub.stopped).forEach(sub=>sub.next({docs:[]}));assert.equal(pages.at(-1).messages.length,40);
  const live=subscriptions.find((sub,index)=>index>2&&!sub.stopped);live.error(Error('permission-denied'));assert.deepEqual(pages.at(-1).messages,[]);assert.equal(errors.length,1);emit(messages);assert.equal(errors.length,1);
  stop();const stoppedPages=pages.length;live.next({docs:[]});assert.equal(pages.length,stoppedPages);

  const emptyPages=[];const emptyStop=service.listenToNewestPrivateTeamMessagesPage('empty',page=>emptyPages.push(page));
  subscriptions.at(-1).next({docs:[],size:0});assert.deepEqual(emptyPages[0].messages,[]);emptyStop();

  let user={uid:'viewer'},focused=true;const calls=[],app={currentState:'active',addEventListener:()=>({remove(){}})};
  const ui=harness(React=>{
    const hook=load('hooks/usePrivateTeamReadAcknowledgement.ts',{react:React,'react-native':{AppState:app},'expo-router':{useFocusEffect:cb=>useHarnessFocus(React,focused,cb)},
      '@/context/AuthContext':{useAuth:()=>({user})},'@/hooks/useCoalescedRefresh':refreshHooks(React),'@/services/teamPrivateMessageService':{markPrivateTeamConversationRead:()=>{const task=deferred();calls.push(task);return task.promise;}}});return ()=>hook.usePrivateTeamReadAcknowledgement('conversation');
  });
  let observe=ui.render();observe('m1');observe('m1');await flush();assert.equal(calls.length,1);
  for(let n=0;n<20;n++)observe('m2');observe('m3');focused=false;ui.render();calls[0].resolve();await flush();assert.equal(calls.length,1,'Queued acknowledgements do not run after blur');
  focused=true;observe=ui.render();await flush();assert.equal(calls.length,2,'Returning reads the newest visible page');calls[1].resolve();await flush();observe=ui.render();observe('m3');await flush();assert.equal(calls.length,2,'An acknowledged unchanged page does not write again');
  app.currentState='background';observe('m4');await flush();assert.equal(calls.length,2);app.currentState='active';user={uid:'other'};observe=ui.render();observe('m5',false);await flush();assert.equal(calls.length,2);observe(undefined,true);await flush();assert.equal(calls.length,3);ui.unmount();calls[2].resolve();await flush();assert.equal(ui.lateWrites(),0);
}

async function profileTests() {
  const auth={currentUser:{uid:'viewer'}},calls=[];
  const profiles=load('services/publicProfileService.ts',{'firebase/functions':{httpsCallable:()=>input=>{const task=deferred();calls.push({input,task});return task.promise;}},'@/config/firebase':{auth,functions:{}},
    '@/utils/friendRequestMapping':load('utils/friendRequestMapping.ts'),'@/utils/friendPrivacy':load('utils/friendPrivacy.ts')});
  const first=profiles.getPublicUserProfiles(['a']),overlap=profiles.getPublicUserProfiles(['a']);assert.equal(calls.length,1);calls[0].task.resolve({data:{profiles:[{userId:'a',displayName:'Synthetic Person',profileState:'available'}]}});assert.deepEqual(await first,await overlap);
  const fresh=profiles.getPublicUserProfiles(['a']);assert.equal(calls.length,2);auth.currentUser={uid:'other'};calls[1].task.resolve({data:{profiles:[{userId:'a',displayName:'Synthetic Person',profileState:'available'}]}});assert.deepEqual(await fresh,[],'Pending names cannot cross accounts');
  const failed=profiles.getPublicUserProfiles(['a']);calls[2].task.reject(Error('unavailable'));await assert.rejects(failed);const retry=profiles.getPublicUserProfiles(['a']);calls[3].task.resolve({data:{profiles:[]}});assert.deepEqual(await retry,[]);
}

async function teamsTests() {
  const archive=deferred();let overviewCalls=0,user={uid:'viewer'};const t=key=>key;
  const ui=harness(React=>load('app/teams/index.tsx',{
    react:React,'react-native':{ActivityIndicator:'ActivityIndicator',Text:'Text',View:'View',ScrollView:'ScrollView',TouchableOpacity:'TouchableOpacity',StyleSheet:{create:s=>s},Alert:{alert(){}}},
    'expo-router':{router:{push(){}},useFocusEffect:cb=>React.useEffect(cb,[cb])},'lucide-react-native':{},'react-i18next':{useTranslation:()=>({t,i18n:{language:'en'}})},
    '@/context/AuthContext':{useAuth:()=>({user})},'@/hooks/useCoalescedRefresh':refreshHooks(React),'@/components/Card':{Card:'Card'},'@/components/ScreenWrapper':{ScreenWrapper:'ScreenWrapper'},'@/constants/theme':theme,
    '@/services/parentTeamService':{getParentTeamsOverview:async()=>{overviewCalls++;return {teams:[{teamId:'team'}],totalTeams:1,privateInboxAvailable:true};},getParentPastTeamCount:()=>archive.promise,groupParentTeamsByChild:teams=>teams.length?[{key:'child',childName:'Synthetic Child',teams}]:[]},
  }).default);
  ui.render();await flush();let tree=ui.render();assert.ok(find(tree,node=>node.props.summary?.teamId==='team'),'Active Teams render before archive count finishes');archive.reject(Error('unavailable'));await flush();tree=ui.render();assert.ok(find(tree,node=>node.props.summary?.teamId==='team'));assert.ok(hasText(tree,'myTeams.pastTeamsLoadError'));assert.equal(overviewCalls,1);
  user={uid:'other'};tree=ui.render();assert.equal(find(tree,node=>node.props.summary?.teamId==='team'),undefined,'Old-account teams are masked immediately');await flush();ui.render();ui.unmount();assert.equal(ui.lateWrites(),0);
}


async function bombTests() {
  let user={uid:'viewer'},locale='en',listener;const reads=[];const t=key=>key;
  const ui=harness(React=>load('src/game/BombDefusalScreen.tsx',{
    react:React,'react-native':{...Object.fromEntries(['ActivityIndicator','KeyboardAvoidingView','Pressable','ScrollView','Text','TextInput','View'].map(n=>[n,n])),Platform:{OS:'android'},StyleSheet:{create:s=>s},Keyboard:{dismiss(){}}},
    'lucide-react-native':{},'lottie-react-native':{default:'Lottie'},'expo-router':{router:{replace(){}},useLocalSearchParams:()=>({sessionId:'session',lobbyId:'lobby'})},'react-i18next':{useTranslation:()=>({t,i18n:{resolvedLanguage:locale}})},'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},
    '@/components/GameEndActions':{GameEndActions:'GameEndActions'},'@/components/GameRewardSummary':{GameRewardSummary:'GameRewardSummary'},'@/constants/theme':theme,
    '@/context/AuthContext':{useAuth:()=>({user})},'@/context/SquadContext':{useSquad:()=>({})},'@/hooks/useCoalescedRefresh':refreshHooks(React),'@/hooks/useGameRoomDeparture':{useGameRoomDeparture:()=>({departing:false})},
    '@/utils/gameInteraction':load('utils/gameInteraction.ts'),'@/src/game/bombDefusalChoiceText':{},'@/services/gameJoinCodeService':{getBombDefusalPlayerView:input=>{const task=deferred();reads.push({input,task});return task.promise;},readGameJoinCodeFailureReason:()=> 'network_unavailable'},
    '@/services/gameService':{subscribeToSession:(_id,cb)=>{listener=cb;return ()=>{};}},'@/services/sidelineStarsService':{createGameRewardSession:async()=>({sessionId:'reward'})},'../../assets/animations/explosion.json':{},'../../assets/animations/wireCut.json':{},
  }).default);
  const endsAt=Date.now()+60000;
  const state=index=>({sessionId:'session',hostUserId:'host',status:'active',gameplayStartsAt:1,endsAt,gameState:{currentCommandId:'command-'+(index+1),currentCommandIndex:index,roleRevision:index,roleAssignment:{defuserUserId:'other',expertUserId:'expert'},outcome:null,strikeCount:0,lastResult:null}});
  const view=index=>({sessionId:'session',role:'support',commandId:'command-'+(index+1),commandIndex:index,defuserUserId:'other',expertUserId:'expert',outcome:'playing',strikeCount:0,lastResult:null,endsAtMs:endsAt,serverNowMs:Date.now(),publicCommand:{},totalCommands:6});
  ui.render();listener(state(0));ui.render();await flush();assert.equal(reads.length,1,'Initial public and private loading share one Bomb view read');
  listener(state(1));ui.render();reads[0].task.resolve(view(0));await flush();assert.equal(reads.length,2,'Changed command queues one fresh view');reads[1].task.resolve(view(1));await flush();ui.render();assert.equal(reads.length,2);
  locale='es';let tree=ui.render();assert.ok(hasText(tree,'bomb.loading'),'Changing locale immediately masks the prior private view');await flush();assert.equal(reads.length,3);assert.equal(reads[2].input.locale,'es');
  user={uid:'other-viewer'};ui.render();await flush();assert.equal(reads.length,4);reads[2].task.resolve(view(1));await flush();tree=ui.render();assert.ok(hasText(tree,'bomb.loading'),'Old-account private response cannot fill the new account view');
  ui.unmount();reads[3].task.resolve(view(1));await flush();assert.equal(ui.lateWrites(),0);
}

(async()=>{global.__DEV__=false;await gameStartTests();await backendCoreTests();await lobbyTests();await messageTests();await profileTests();await teamsTests();await bombTests();console.log('Game/Teams efficiency passed: start progress/retry/supersession, active/background clocks, bounded rematch reads, stable room timestamps, focused/coalesced polling, reusable fail-closed visibility, read acknowledgements, profile isolation and independent archive counts.');})().catch(error=>{console.error(error);process.exitCode=1;});
