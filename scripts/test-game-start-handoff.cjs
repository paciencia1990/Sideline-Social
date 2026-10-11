'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const { StackRouter } = require(path.join(root, 'node_modules/expo-router/build/react-navigation/routers/StackRouter.js'));
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; }
function load(file, modules={}) {
  const module = {exports:{}};
  const code = ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',code)(name => {assert.ok(Object.hasOwn(modules,name),`Unexpected module ${name}`);return modules[name];}, module,module.exports);
  return module.exports;
}
function harness(factory) {
  const slots=[]; let cursor=0,effects=[],mounted=true,lateWrites=0;
  const changed=(previous,deps)=>!previous||!deps||deps.some((v,i)=>v!==previous.deps[i]);
  const React={Fragment:'Fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),
    useState(initial){const key=cursor++;if(!slots[key])slots[key]={value:typeof initial==='function'?initial():initial};return [slots[key].value,value=>{if(!mounted)lateWrites++;slots[key].value=typeof value==='function'?value(slots[key].value):value;}];},
    useRef(initial){const key=cursor++;if(!slots[key])slots[key]={current:initial};return slots[key];},
    useMemo(factory,deps){const key=cursor++;if(changed(slots[key],deps))slots[key]={deps,value:factory()};return slots[key].value;},
    useCallback(fn,deps){return React.useMemo(()=>fn,deps);},
    useEffect(fn,deps){const key=cursor++,previous=slots[key];if(changed(previous,deps))effects.push(()=>{previous?.cleanup?.();slots[key]={deps,cleanup:fn()};});},
  };
  const component=factory(React);
  return {render(props={}){cursor=0;effects=[];const result=component(props);effects.forEach(fn=>fn());return result;},unmount(){slots.forEach(slot=>slot?.cleanup?.());mounted=false;},lateWrites:()=>lateWrites};
}
function all(node,predicate) {if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(n=>all(n,predicate));return [...(predicate(node)?[node]:[]),...all(node.props?.children,predicate)];}
const native={ActivityIndicator:'ActivityIndicator',Alert:{alert(){}},Pressable:'Pressable',ScrollView:'ScrollView',Share:{share:async()=>{}},StyleSheet:{create:v=>v,hairlineWidth:1},Text:'Text',View:'View'};
const t=key=>key;
const theme={Colors:{textHeading:'navy',surface:'white',accentGreen:'green'},Typography:{}};
const departure=load('utils/gameRoomDeparture.ts');
const interaction=load('utils/gameInteraction.ts');
const startCore=load('utils/gameStartSynchronization.ts');

async function navigationTest() {
  const stack=StackRouter({});
  const makeState=()=>({stale:false,type:'stack',key:'root-stack',index:1,routeNames:['(tabs)','(games)','games'],routes:[{key:'tabs-key',name:'(tabs)'},{key:'lobbies-group-key',name:'(games)'}],preloadedRoutes:[]});
  let state=makeState(),guard,leaveCalls=0;
  const dispatched=[];
  const options={routeNames:state.routeNames,routeParamList:{},routeGetIdList:{}};
  const removalMarker=Symbol('visited-routes');
  const rootRef={dispatch(action){dispatched.push(action);const next=stack.getStateForAction(state,action,options);if(next)state=next;}};
  const ui=harness(React=>load('hooks/useGameRoomDeparture.ts',{
    react:React,'react-native':native,'react-i18next':{useTranslation:()=>({t})},
    'expo-router':{useNavigationContainerRef:()=>rootRef},
    'expo-router/react-navigation':{usePreventRemove:(_prevent,callback)=>{guard=callback;}},
    '@/services/gameJoinCodeService':{leaveGameLobby:async()=>{leaveCalls++;},readGameJoinCodeFailureReason:()=> 'network_unavailable'},
    '@/utils/gameRoomDeparture':departure,
  }).useGameRoomDeparture);
  const room=ui.render({enabled:true,lobbyId:'synthetic-lobby'});
  for (const game of ['bomb-defusal','trivia-blitz','spot-the-difference']) {
    state=makeState();
    room.continueWithinRoom(params=>{
      const action={type:'REPLACE',target:'root-stack',payload:{name:'games',params:{screen:`${game}/play`,params}},[removalMarker]:new Set(['leaf-lobby'])};
      assert.equal(stack.getStateForAction(state,{source:'leaf-lobby',...action},options),null,'Original leaf dispatch reproduces the silently discarded parent REPLACE');
      guard({data:{action}});
      assert.equal(dispatched.at(-1),action,'Resume the exact action, including symbols; do not synthesize a new source');
      assert.equal(state.routes[1].name,'games',`${game} reaches the gameplay navigator`);
    });
  }
  assert.equal(leaveCalls,0,'Starting a round retains membership');
  state=makeState();
  guard({data:{action:{type:'REPLACE',target:'root-stack',payload:{name:'(tabs)'}}}});
  await flush();
  assert.equal(leaveCalls,1,'Going Home still leaves authoritatively');
  assert.equal(state.routes[1].name,'(tabs)');
  ui.unmount();
}

async function lobbyStartTest() {
  const timers=new Map();let timerId=0,listener,listenerError;
  const originalSet=global.setTimeout,originalClear=global.clearTimeout;
  global.setTimeout=(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;};global.clearTimeout=id=>timers.delete(id);
  let user={uid:'host',displayName:'Host'},sessionId='session',request=deferred(),pendingExit=false,departed=false;
  const requests=[],navigations=[];
  const room={departing:false,continueWithinRoom:fn=>fn({__gameRoomTransition:'synthetic'}),markDeparted(){},depart:async()=>true,hasPendingNavigation:()=>pendingExit,hasDeparted:()=>departed};
  const ui=harness(React=>load('hooks/useGameLobby.ts',{
    react:React,'expo-router':{router:{replace:input=>navigations.push(input)},useLocalSearchParams:()=>({sessionId,lobbyId:'lobby'})},
    'firebase/firestore':{onSnapshot(){return ()=>{};},orderBy(){},query(){}},'firebase/database':{onValue(_r,cb){cb({val:()=>({hostUserId:'host',players:{host:{displayName:'Host',isReady:true},other:{displayName:'Other',isReady:true}}})});return ()=>{};},ref(){}},
    'react-i18next':{useTranslation:()=>({t})},'@/config/firebase':{rtdb:{}},'@/context/AuthContext':{useAuth:()=>({user,loading:false})},'@/context/SquadContext':{useSquad:()=>({selectedSquadId:'squad'})},
    '@/hooks/useGameRoomDeparture':{useGameRoomDeparture:()=>room},
    '@/services/gameJoinCodeService':{getGameJoinCodeForSession:async()=>({joinCode:'TEST',lobbyId:'lobby'}),closeGameLobby:async()=>{},setRealtimeGamePlayerReady:async()=>{},readGameJoinCodeFailureReason:()=> 'start_failed'},
    '@/services/gameStartSynchronizationService':{subscribeToSynchronizedGameStart:(_g,_s,cb,error)=>{listener=cb;listenerError=error;return ()=>{};},prepareSynchronizedGameStart:input=>{requests.push(input);return request.promise;}},
    '@/src/game/triviaBlitz/gameState':{togglePlayerReady:async()=>{}},'@/src/game/triviaBlitz/firebaseUtils':{getTriviaParentSessionRef(){},getTriviaPlayersRef(){}},
    '@/utils/gameInteraction':interaction,'@/utils/gameStartSynchronization':startCore,
  }).useGameLobby.bind(null,'bomb-defusal'));
  try {
    ui.render();await flush();let lobby=ui.render();await flush();lobby=ui.render();
    assert.equal(lobby.players.isHost,true);
    lobby.startGame();lobby.startGame();await flush();assert.equal(requests.length,1,'Two immediate Start taps share one request');
    const prepared={schemaVersion:1,gameType:'bombDefusal',sessionId:'session',lobbyId:'lobby',hostUserId:'host',startAttemptId:'attempt',phase:'preparing',participantCount:2,acknowledgedCount:0,readinessDeadlineAtMs:Date.now()+20000,countdownStartsAtMs:null,gameplayStartsAtMs:null,failureReason:null};
    request.resolve(prepared);await flush();
    assert.equal(navigations.length,1,'The host transitions using the authoritative callable response without waiting for another snapshot');
    listener(prepared);ui.render();assert.equal(navigations.length,1,'The corresponding snapshot cannot navigate twice');
    const timeout=[...timers.values()].find(x=>x.delay===startCore.GAME_START_HANDOFF_TIMEOUT_MS);assert.ok(timeout);
    timeout.fn();lobby=ui.render();assert.equal(lobby.startPending,false);assert.equal(lobby.startError,'start_failed');assert.equal(requests.length,1,'A stalled handoff offers an error without an automatic write retry');
    request=deferred();lobby.startGame();await flush();pendingExit=true;request.resolve({...prepared,startAttemptId:'late-attempt'});await flush();
    listener({...prepared,startAttemptId:'late-snapshot'});assert.equal(navigations.length,1,'An exit requested before a late response/snapshot takes priority over game-start navigation');
    pendingExit=false;departed=true;listener({...prepared,startAttemptId:'after-leave'});assert.equal(navigations.length,1,'A completed departure fences snapshots before unmount');
    lobby=ui.render();const count=requests.length;lobby.startGame();await flush();assert.equal(requests.length,count,'A completed leave cannot submit another start');
    departed=false;listenerError(Error('unavailable'));lobby=ui.render();
    request=deferred();lobby.startGame();await flush();request.resolve(prepared);await flush();assert.equal(navigations.length,2,'Manual retry may resume the same authoritative attempt');
    lobby=ui.render();listenerError(Error('unavailable'));lobby=ui.render();assert.equal(lobby.startPending,false);assert.equal(lobby.startError,'start_failed');
    request=deferred();lobby.startGame();await flush();user={uid:'different'};ui.render();request.resolve(prepared);await flush();assert.equal(navigations.length,2,'An old account response cannot navigate the new account');
    const beforeUnmount=ui.lateWrites();ui.unmount();listener(prepared);await flush();assert.equal(ui.lateWrites(),beforeUnmount,'Retired listeners cannot update an unmounted lobby');
    assert.equal(timers.size,0,'Unmount clears the handoff watchdog');
  } finally {global.setTimeout=originalSet;global.clearTimeout=originalClear;}
}

function readinessTest() {
  let toggles=0;
  const ui=harness(React=>load('components/LobbyBase.tsx',{
    react:React,'react-native':native,'@/context/ParentNavigationContext':{useParentScreenInsets:()=>({top:0,bottom:0})},'react-i18next':{useTranslation:()=>({t})},'@/constants/theme':theme,
    '@/utils/safeAreaLayout':{getFixedFooterBottomPadding:()=>0},'@/utils/gameJoinCode':{spokenGameJoinCode:x=>x},'@/utils/gameInteraction':interaction,
  }).default);
  const self={id:'self',name:'Me',ready:false},other={id:'other',name:'Other',ready:true};
  const props={gameName:'Game',minPlayers:2,players:{joinCode:'TEST',list:[self,other],self,isHost:true},codeState:'ready',codeError:null,isLocal:false,onReadyToggle:()=>{toggles++;},onStart(){},onLeave:async()=>{},onCloseLobby:async()=>{},onRetryCode(){},onRetryLifecycle(){},lifecycleAction:null,lifecycleError:null};
  for(const teamSections of [undefined,{selfTeamMessage:'A',teams:[{id:'A',label:'A',players:[self]},{id:'B',label:'B',players:[other]}]}]) {
    let tree=ui.render({...props,teamSections});
    let ready=all(tree,n=>n.type==='Pressable'&&n.props.onPress===props.onReadyToggle);
    assert.equal(ready.length,1,'Readiness has exactly one control, on the caller row, including split-team lobbies');
    assert.equal(ready[0].props.accessibilityState.selected,false);ready[0].props.onPress();
    tree=ui.render({...props,teamSections,readyPending:true});ready=all(tree,n=>n.type==='Pressable'&&n.props.onPress===props.onReadyToggle);
    assert.equal(ready[0].props.disabled,true);assert.equal(ready[0].props.accessibilityState.busy,true);
    tree=ui.render({...props,teamSections,startPending:true});assert.equal(all(tree,n=>n.type==='Pressable'&&n.props.onPress===props.onReadyToggle)[0].props.disabled,true);
  }
  assert.equal(toggles,2);
  const noHost=ui.render({...props,players:{...props.players,isHost:false}});assert.equal(all(noHost,n=>n.type==='Pressable'&&n.props.onPress===props.onStart).length,0);
  ui.unmount();
  for(const game of ['bomb-defusal','trivia-blitz','spot-the-difference']) {
    const route=harness(React=>load(`app/(games)/${game}/Lobby.tsx`,{react:React,'expo-router':{router:{replace(){}}},'react-native':native,'react-i18next':{useTranslation:()=>({t})},'@/components/CountdownOverlay':{__esModule:true,default:'CountdownOverlay'},'@/components/LobbyBase':{__esModule:true,default:'LobbyBase'},'@/hooks/useGameLobby':{useGameLobby:()=>({players:props.players,startError:'start_failed'})}}).default);
    assert.equal(all(route.render(),n=>n.type==='LobbyBase')[0].props.startError,'start_failed',`${game} displays the start failure`);route.unmount();
  }
}
(async()=>{global.__DEV__=false;await navigationTest();await lobbyStartTest();readinessTest();console.log('Game-start handoff passed: real parent-stack REPLACE, retained membership, response/snapshot deduplication, bounded failure/manual retry, account isolation, and one self-only readiness control in every lobby.');})().catch(e=>{console.error(e);process.exitCode=1;});
