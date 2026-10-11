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
function button(tree, label) { return find(tree, (node) => node.type === 'TouchableOpacity' && all(node, (child) => child.type === 'Text' && child.props.children.includes(label)).length); }
const hasText = (tree, text) => Boolean(find(tree, (node) => node.type === 'Text' && node.props.children.includes(text)));

function useHarnessFocusEffect(React, focused, callback) { React.useEffect(() => focused ? callback() : undefined, [callback, focused]); }
const measure = { measureDevelopmentPerformance: (_label, work) => work(), startDevelopmentPerformanceTrace: () => () => {} };
const ref = (_db, ...parts) => parts.join('/');
const snap = (id, data) => ({ id, exists: () => data != null, data: () => data });
const firestore = { doc: ref, collection: ref, query: (...args) => args, where: (...args) => args, orderBy: (...args) => args, limit: (n) => n, Timestamp: class { static now() { return new Date(); } } };
const privacy = load('utils/friendPrivacy.ts');
const refreshCore = load('utils/coalescedRefresh.ts');

async function refreshTests() {
  const reads = [], results = [], failures = []; let active = 0, max = 0;
  const controller = refreshCore.createCoalescedRefresh({
    load: (input) => { const task = deferred(); reads.push({ input, task }); active++; max = Math.max(max, active); return task.promise.finally(() => active--); },
    merge: (a,b) => [...new Set([...a,...b])], onSuccess: (value) => results.push(value), onError: (error) => failures.push(error),
  });
  const first = controller.refresh(['profile']);
  assert.equal(controller.refresh(['profile'], false), first, 'Overlapping focus shares the promise');
  await flush();
  for (let n = 0; n < 20; n++) controller.refresh(['requests']);
  controller.refresh(['friends']);
  assert.equal(reads.length, 1);
  reads[0].task.resolve('initial'); await flush();
  assert.deepEqual(reads[1].input, ['requests','friends'], 'Listener bursts merge into one follow-up');
  reads[1].task.resolve('fresh'); await first;
  assert.equal(max, 1); assert.deepEqual(results, ['initial','fresh']);
  const failed = controller.refresh(['requests']); await flush(); reads[2].task.reject('unavailable'); await failed;
  assert.deepEqual(failures, ['unavailable']);
  const retry = controller.refresh(['profile']); await flush(); reads[3].task.resolve('retry'); await retry;
  const disposed = controller.refresh(['profile']); await flush(); controller.dispose(); reads[4].task.resolve('old'); await disposed;
  assert.equal(results.includes('old'), false);
  controller.activate(); const replay = controller.refresh(['profile']); await flush(); controller.dispose(); controller.activate(); controller.refresh(['friends']);
  reads[5].task.resolve('disposed-lifecycle'); await flush(); reads[6].task.resolve('new-lifecycle'); await replay;
  assert.equal(results.includes('disposed-lifecycle'), false); assert.equal(results.at(-1), 'new-lifecycle');

  const scopeReads=[], scopeGate=deferred();
  const scoped=refreshCore.createCoalescedRefresh({load:async sections=>{scopeReads.push(sections);if(scopeReads.length===1)await scopeGate.promise;return sections;},
    merge:(a,b)=>[...new Set([...a,...b])],covers:(a,b)=>b.every(section=>a.includes(section)),onSuccess(){},onError(){}});
  const requestOnly=scoped.refresh(['requests']);await flush();scoped.refresh(['profile','friends','requests'],false);scopeGate.resolve();await requestOnly;
  assert.deepEqual(scopeReads,[['requests'],['profile','friends','requests']],'Sharing a partial read must not lose a later full refresh');

  let replayReads=0;
  const immediate=refreshCore.createCoalescedRefresh({load:async()=>++replayReads,merge:()=>true,onSuccess(){},onError(){}});
  const scheduled=immediate.refresh(true,false);immediate.dispose();immediate.activate();immediate.refresh(true,false);await scheduled;
  assert.equal(replayReads,1,'Effect replay before the first microtask must not cancel initial hydration');

  let identity = 'a'; const old = deferred(), next = deferred(), published = [];
  const ui = harness((React) => {
    const { useCoalescedRefresh } = load('hooks/useCoalescedRefresh.ts', { react: React, '@/utils/coalescedRefresh': refreshCore });
    return () => useCoalescedRefresh(identity, { load: () => identity === 'a' ? old.promise : next.promise,
      merge: () => true, onSuccess: (value) => published.push(value), onError() {} });
  });
  let refresh = ui.render(); const oldRead = refresh(true); await flush(); identity = 'b'; refresh = ui.render(); const newRead = refresh(true); await flush();
  old.resolve('private-old-account'); next.resolve('current-account'); await Promise.all([oldRead, newRead]);
  assert.deepEqual(published, ['current-account']); ui.unmount();
}

async function serviceTests() {
  const auth = { currentUser: { uid: 'viewer' } }; let reads = 0; let task = deferred(); const listeners = [];
  const friends = load('services/friendsService.ts', {
    'firebase/firestore': { ...firestore, getDoc: () => { reads++; return task.promise; }, onSnapshot: (query, callback) => { listeners.push({ query, callback }); return () => {}; } },
    'firebase/functions': { httpsCallable() {} }, '@/config/firebase': { auth, db: {}, functions: {} },
    '@/services/publicProfileService': { getPublicUserProfiles: async () => [] }, '@/utils/friendRequestMapping': load('utils/friendRequestMapping.ts'),
    '@/utils/friendRequestState': load('utils/friendRequestState.ts'), '@/utils/friendPrivacy': privacy, '@/utils/profileName': load('utils/profileName.ts'),
  });
  const profile = friends.getCurrentUserProfile(), list = friends.getFriends('viewer');
  assert.equal(reads, 1, 'Friends overview shares its private-profile read');
  task.resolve(snap('viewer', { displayName: 'Synthetic Viewer', friendIds: [] })); await Promise.all([profile,list]);
  task = deferred(); const fresh = friends.getCurrentUserProfile(); assert.equal(reads,2, 'Settled profiles are not cached');
  auth.currentUser = { uid: 'other' }; task.resolve(snap('viewer', { displayName: 'Must not escape' })); assert.equal(await fresh,null);
  auth.currentUser = { uid: 'viewer' }; task = deferred(); const failure = friends.getCurrentUserProfile(); task.reject(new Error('unavailable')); await assert.rejects(failure);
  task = deferred(); const retry = friends.getCurrentUserProfile(); task.resolve(snap('viewer',{})); await retry; assert.equal(reads,4);
  const changes = []; friends.subscribeToFriendRequestChanges('viewer', (section) => changes.push(section));
  listeners.forEach((item) => item.callback()); assert.deepEqual(changes,[], 'Initial snapshots do not refetch');
  listeners.forEach((item) => item.callback()); assert.deepEqual(changes,['requests','requests','friendship']);

  const teamReads = [], gates = new Map(); let failMember = false;
  const teams = load('services/teamService.ts', {
    'firebase/firestore': { ...firestore, getDoc: async (path) => { teamReads.push(path); if(gates.has(path)) return gates.get(path).promise;
      if(path.startsWith('users/')) return snap('viewer',{ parentTeamIds: ['active','removed'] });
      if(path.includes('/members/')) { if(failMember && path.includes('/active/')) throw Error('unavailable'); return snap('viewer',{status:path.includes('/removed/')?'removed':'active',role:'parent'}); }
      return snap(path.split('/').at(-1),{name:'Synthetic Team',status:'active'});
    } }, 'firebase/functions': {}, '@/config/firebase': { auth, db: {} }, '@/constants/teamHistoryPagination': {},
    '@/utils/friendPrivacy': privacy, '@/utils/teamLifecycleRequest': {},
  });
  const index = deferred(); gates.set('users/viewer',index);
  const one = teams.getCurrentUserTeamMemberships(), two = teams.getCurrentUserTeamMemberships(); assert.equal(one,two);
  assert.deepEqual(teamReads,['users/viewer']); index.resolve(snap('viewer',{parentTeamIds:['active','removed']}));
  assert.equal((await one).length,1); assert.equal(teamReads.filter((p)=>p==='teams/active/members/viewer').length,1);
  assert.equal(teamReads.includes('teams/removed'),false,'Inactive membership must not read the team');
  assert.ok(teamReads.indexOf('teams/active/members/viewer')<teamReads.indexOf('teams/active'));
  gates.clear(); const strict = teams.getCurrentUserTeamMemberships({throwOnError:true,requireComplete:true}); const loose = teams.getCurrentUserTeamMemberships();
  assert.notEqual(strict,loose,'Strict callers cannot share partial permissive results'); await Promise.all([strict,loose]);
  failMember=true; await assert.rejects(teams.getCurrentUserTeamMemberships({throwOnError:true,requireComplete:true}));
  failMember=false; assert.equal((await teams.getCurrentUserTeamMemberships({throwOnError:true,requireComplete:true})).length,1);
  const stale=deferred(); gates.set('users/viewer',stale); const old=teams.getCurrentUserTeamMemberships(); auth.currentUser={uid:'other'};
  stale.resolve(snap('viewer',{parentTeamIds:[]})); assert.deepEqual(await old,[]);
}

async function chatTests() {
  const auth = {currentUser:{uid:'viewer'}}, listeners = [], reads = []; let profileCalls=0, profiles=deferred(), held=null;
  const chat = load('services/chatService.ts', {
    'firebase/firestore': {...firestore, getDoc: async (path) => {
      reads.push(path); if(held) return held.promise;
      const conversation = path.split('/')[1];
      if(path.includes('/members/')) return snap('viewer',{status:conversation==='left'?'left':'active',lastReadAt:conversation==='read'?new Date(200):null});
      if(path.includes('/reactions/')) return snap('viewer',{emoji:'👍'});
      return snap(path.split('/').at(-1),{hiddenForMe:conversation==='hidden'||path.endsWith('/hide'),starred:true});
    }, onSnapshot: (query, next, error) => { const item={query,next,error,stopped:false};listeners.push(item);return ()=>{item.stopped=true}; }},
    'firebase/functions':{}, 'firebase/storage':{}, '@/config/firebase':{auth,db:{}},
    '@/services/publicProfileService':{getPublicUserProfiles:()=>{profileCalls++;return profiles.promise;}},
    '@/utils/friendPrivacy':privacy, '@/utils/friendChatUploadCancellation':{}, '@/utils/friendChatPhotoUploadDiagnostic':{},
    '@/utils/friendChatPhotoUploadTransfer':{}, '@/utils/friendChatPhotoUploadAuth':{}, '@/utils/voicePlaybackCore':{},
    '@/utils/performanceDiagnostics':measure, '@/utils/friendChatError':{},
  });
  const counts=[];const stop=chat.subscribeToUnreadFriendConversationCount('viewer',value=>counts.push(value));
  const conversation=(id, extra={})=>snap(id,{activeParticipantIds:['viewer','sender'],lastSenderId:'sender',lastMessageAt:new Date(100),lastMessageId:'message',...extra});
  await listeners[0].next({docs:[conversation('unread'),conversation('read'),conversation('self',{lastSenderId:'viewer'}),conversation('left'),conversation('hidden'),conversation('deleted',{lastMessageRemoved:true})]});
  assert.deepEqual(counts,[1]);assert.equal(profileCalls,0,'Badge counting must not hydrate public profiles');assert.ok(listeners[0].query.includes(25));
  const oldGate = deferred(); held=oldGate; const stale=listeners[0].next({docs:[conversation('stale')]});held=null;
  await listeners[0].next({docs:[]});oldGate.resolve(snap('viewer',{status:'active'}));await stale;assert.equal(counts.at(-1),0);
  // A pending callback cannot change another account's badge or update after unsubscribe.
  const accountGate=deferred();held=accountGate;const accountRead=listeners[0].next({docs:[conversation('account')]});held=null;
  auth.currentUser={uid:'other'};accountGate.resolve(snap('viewer',{status:'active'}));await accountRead;
  const before=counts.length;listeners[0].error(new Error('unavailable'));assert.equal(counts.length,before);auth.currentUser={uid:'viewer'};
  const errorGate=deferred();held=errorGate;const interrupted=listeners[0].next({docs:[conversation('interrupt')]});held=null;
  listeners[0].error(Error('unavailable'));errorGate.resolve(snap('viewer',{status:'active'}));await interrupted;assert.equal(counts.at(-1),0);
  const afterError=counts.length;
  stop();await listeners[0].next({docs:[]});assert.equal(counts.length,afterError);assert.equal(listeners[0].stopped,true);

  reads.length=0;const messages=[];chat.listenToFriendChatMessages('chat','viewer',['blocked'],value=>messages.push(value),error=>{throw error;});
  const message=(id,extra={})=>snap(id,{conversationId:'chat',senderUserId:'sender',text:id,messageType:'text',status:'active',reactionCounts:{'👍':1},...extra});
  listeners[1].next({docs:[message('visible'),message('hide'),message('blocked',{senderUserId:'blocked'}),message('moderated',{moderationState:'hidden'})]});
  await flush();assert.equal(profileCalls,1);assert.ok(reads.some(path=>path.includes('/reactions/')));assert.ok(reads.some(path=>path.includes('/userMessageStates/')),'Per-user state starts while profiles are pending');
  assert.equal(messages.length,0,'No message appears before visibility hydration finishes');
  profiles.resolve([{userId:'sender',displayName:'Synthetic Sender',profileState:'available'}]);await flush();
  assert.equal(messages.length,1);assert.deepEqual(messages[0].map(m=>m.messageId),['moderated','visible']);
  assert.equal(messages[0][0].status,'removed');assert.equal(messages[0][0].text,'');
  const visible=messages[0][1];assert.equal(visible.senderDisplayName,'Synthetic Sender');assert.equal(visible.starredBySelf,true);assert.equal(visible.reactions[0].reactedBySelf,true);
}

async function friendsScreenTests() {
  let user={uid:'viewer'}, focused=true, listener;const appListeners=new Set(), counts={profile:0,friends:0,requests:0,suggestions:0};
  const suggestions=deferred();let suggestionRead=()=>suggestions.promise;const t=key=>key;
  const api={ getCurrentUserProfile:async()=>{counts.profile++;return {id:user.uid,displayName:'Synthetic Viewer'};},
    getFriends:async()=>{counts.friends++;return [{id:'friend',displayName:'Synthetic Friend'}];},
    getFriendRequestGroups:async()=>{counts.requests++;return {incoming:[],outgoing:[]};},
    searchUsers:()=>{counts.suggestions++;return suggestionRead();},
    subscribeToFriendRequestChanges:(_uid,cb)=>{listener=cb;return ()=>{listener=null;};},
  };
  const ui=harness(React=>{
    const hooks=load('hooks/useCoalescedRefresh.ts',{react:React,'@/utils/coalescedRefresh':refreshCore});
    return load('app/(tabs)/friends.tsx',{
      react:React,'react-native':{...Object.fromEntries(['ActivityIndicator','Image','RefreshControl','Text','TextInput','TouchableOpacity','View'].map(n=>[n,n])),
        StyleSheet:{create:s=>s},Alert:{alert(){}},AppState:{addEventListener:(_event,cb)=>{appListeners.add(cb);return {remove:()=>appListeners.delete(cb)};}}},
      'expo-router':{router:{push(){}},useLocalSearchParams:()=>({}),useFocusEffect:cb=>useHarnessFocusEffect(React, focused, cb)},
      'lucide-react-native':{},'react-i18next':{useTranslation:()=>({t})},
      '@/components/Card':{Card:'Card'},'@/components/KeyboardAwareScrollView':{KeyboardAwareScrollView:'ScrollView'},'@/components/ScreenWrapper':{ScreenWrapper:'ScreenWrapper'},
      '@/context/AuthContext':{useAuth:()=>({user,loading:false})},'@/hooks/useCoalescedRefresh':hooks,
      '@/constants/theme':{Colors:{},Radius:{},Shadow:{},Spacing:{},Typography:{}},'@/services/friendsService':api,
      '@/services/chatService':{},'@/services/notificationService':{},'@/utils/friendPrivacy':privacy,
      '@/utils/friendRequestState':load('utils/friendRequestState.ts'),'@/utils/performanceDiagnostics':measure,
    }).default;
  });
  ui.render();await flush();let tree=ui.render();assert.ok(find(tree,n=>n.props.profile?.id==='friend'),'Friends appear without waiting for suggestions');
  assert.deepEqual(counts,{profile:1,friends:1,requests:1,suggestions:1});
  user={uid:'viewer'};ui.render();await flush();assert.equal(counts.profile,1,'Profile object refresh must not reload the tab');
  listener('requests');await flush();ui.render();assert.deepEqual(counts,{profile:1,friends:1,requests:2,suggestions:1});
  listener('friendship');await flush();ui.render();assert.equal(counts.friends,2);assert.equal(counts.profile,2);
  suggestions.resolve([]);await flush();ui.render();focused=false;ui.render();assert.equal(listener,null);assert.equal(appListeners.size,0,'Hidden tab stops subscriptions and foreground refreshes');
  suggestionRead=async()=>{throw Error('unavailable');};focused=true;ui.render();await flush();tree=ui.render();
  assert.ok(find(tree,n=>n.props.profile?.id==='friend'));assert.ok(hasText(tree,'friends.suggestionsUnavailable'),'Suggestions fail independently with visible retry');
  suggestionRead=async()=>[];const retry=button(tree,'friends.retry');assert.ok(retry);retry.props.onPress();await flush();tree=ui.render();assert.equal(hasText(tree,'friends.suggestionsUnavailable'),false);
  ui.unmount();assert.equal(appListeners.size,0);assert.equal(ui.lateWrites(),0);
}

async function squadTests() {
  let user={uid:'first'}, task=deferred(), fail=false;const reads=[], selections=[];
  const squad={squadId:'squad',name:'Synthetic Squad'};
  const ui=harness(React=>load('context/SquadContext.tsx',{
    react:React,'@/context/AuthContext':{useAuth:()=>({user})},'@/services/squadService':{
      fetchUserSquadState:uid=>{reads.push(uid);return fail?Promise.reject(Error('unavailable')):task.promise;},
      fetchSquadsByIds:async ids=>ids.length?[squad]:[],fetchAppConfig:async()=>({}),persistSelectedSquad:async(uid,id)=>selections.push([uid,id]),
    },'@/utils/squadCallableError':{},'@/utils/performanceDiagnostics':measure,
  }).SquadProvider);
  let tree=ui.render();assert.equal(tree.props.value.membershipLoading,true);task.resolve({squadIds:['squad'],selectedSquadId:'squad'});await flush();tree=ui.render();
  assert.equal(tree.props.value.currentSquad.squadId,'squad');assert.equal(tree.props.value.membershipLoading,false);
  task=deferred();const a=tree.props.value.reloadMemberships(),b=tree.props.value.reloadMemberships();assert.equal(a,b);tree=ui.render();
  assert.equal(tree.props.value.membershipLoading,false,'Same-account background refresh keeps known Squad visible');assert.equal(tree.props.value.currentSquad.squadId,'squad');
  task.resolve({squadIds:[],selectedSquadId:'squad'});await a;tree=ui.render();assert.equal(tree.props.value.currentSquad,null);assert.deepEqual(tree.props.value.mySquadIds,[]);
  assert.deepEqual(selections,[['first',null]],'Stale selected membership is repaired');
  fail=true;await tree.props.value.reloadMemberships();tree=ui.render();assert.equal(tree.props.value.membershipError,'membership_load_failed');assert.equal(tree.props.value.currentSquad,null);
  fail=false;const oldTask=deferred();task=oldTask;const old=tree.props.value.reloadMemberships();task=deferred();user={uid:'second'};tree=ui.render();assert.equal(tree.props.value.currentSquad,null);assert.deepEqual(tree.props.value.mySquads,[]);
  oldTask.resolve({squadIds:['squad'],selectedSquadId:'squad'});await old;tree=ui.render();assert.equal(tree.props.value.currentSquad,null,'Old-account response cannot publish on new account');
  task.resolve({squadIds:[],selectedSquadId:null});await flush();tree=ui.render();assert.equal(reads.at(-1),'second');assert.equal(tree.props.value.currentSquad,null);
  user=null;tree=ui.render();assert.equal(tree.props.value.currentSquad,null);await flush();ui.unmount();assert.equal(ui.lateWrites(),0);
}


async function homeScreenTests() {
  let user={uid:'first'}, focused=true, reads=0, task=deferred();const t=key=>key;
  const ui=harness(React=>load('app/(tabs)/index.tsx',{
    react:React,'react-native':{...Object.fromEntries(['ActivityIndicator','Image','RefreshControl','ScrollView','Text','TouchableOpacity','Pressable','View'].map(n=>[n,n])),StyleSheet:{create:s=>s},Alert:{alert(){}}},
    'expo-router':{router:{push(){}},useFocusEffect:cb=>useHarnessFocusEffect(React, focused, cb)},'lucide-react-native':{},'react-i18next':{useTranslation:()=>({t})},
    ...Object.fromEntries(['Card','IcebreakerCard','LocalPerkAdCard','ScreenWrapper','SquadIdentity','SquadSelector'].map(n=>['@/components/'+n,{[n]:n}])),
    '@/constants/localPerkPreview':{},'@/context/AuthContext':{useAuth:()=>({user})},'@/context/SquadContext':{useSquad:()=>({mySquads:[],membershipLoading:false,reloadMemberships:reloadSquads})},
    '@/constants/theme':{Colors:{},Radius:{},Shadow:{},Spacing:{},Typography:{}},
    '@/hooks/useCoalescedRefresh':load('hooks/useCoalescedRefresh.ts',{react:React,'@/utils/coalescedRefresh':refreshCore}),
    '@/hooks/useSquadGameLobbies':{useSquadGameLobbies:()=>({lobbies:[],refresh:async()=>{}})},
    '@/services/notificationService':{subscribeToUnreadNotificationCount:()=>()=>{},retryPendingNotificationAcknowledgements:async()=>{}},
    '@/utils/notificationCore':{formatUnreadBadgeCount:()=>''},'@/services/chatService':{subscribeToUnreadFriendConversationCount:()=>()=>{}},'@/utils/performanceDiagnostics':measure,
    '@/services/parentTeamService':{getParentHomeTeamsSummary:()=>{reads++;return task.promise;},isParentHomeTeamAvailable:async()=>false},
    '@/services/weeklyChallengeService':{getCurrentWeeklyChallenge:async()=>null},'@/services/weeklyChallengeLocalization':{},'@/assets/branding/sideline-social-logo.png':'logo',
  }).default);
  function reloadSquads(){return Promise.resolve();}
  const card=tree=>find(tree,n=>n.props.onOpenTeam&&Object.hasOwn(n.props,'summary'));
  ui.render();await flush();let tree=ui.render();assert.equal(reads,1);
  card(tree).props.onRetry();card(tree).props.onRetry();await flush();assert.equal(reads,1,'Home refreshes never overlap');
  const first={rows:[{key:'first'}],totalTeams:1};task.resolve(first);task=deferred();await flush();assert.equal(reads,2,'Repeated retries coalesce into one fresh read');
  tree=ui.render();assert.equal(card(tree).props.summary,first,'Known rows stay visible during refresh');task.resolve({rows:[],totalTeams:0});await flush();tree=ui.render();assert.equal(card(tree).props.summary.totalTeams,0);
  task=deferred();card(tree).props.onRetry();await flush();const old=task;task=deferred();user={uid:'second'};tree=ui.render();assert.equal(card(tree).props.summary,null,'Account switch masks old rows immediately');await flush();
  old.resolve(first);await flush();tree=ui.render();assert.equal(card(tree).props.summary,null);task.resolve({rows:[],totalTeams:0});await flush();ui.render();
  ui.unmount();assert.equal(ui.lateWrites(),0);
}

async function lobbyScopeTests() {
  let input={enabled:true,squadId:'first'}, task=deferred();
  const ui=harness(React=>{
    const api=load('hooks/useSquadGameLobbies.ts',{
      react:React,'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},
      'expo-router':{useFocusEffect:cb=>React.useEffect(cb,[cb])},'@/services/gameJoinCodeService':{listGameLobbies:()=>task.promise,readGameJoinCodeFailureReason:()=> 'not_authorized'},'@/utils/performanceDiagnostics':measure,
    });return ()=>api.useSquadGameLobbies(input);
  });
  ui.render();task.resolve({lobbies:[{lobbyId:'first-room'}]});await flush();let value=ui.render();assert.equal(value.lobbies[0].lobbyId,'first-room');
  task=deferred();const background=value.refresh(true);value=ui.render();assert.equal(value.lobbies[0].lobbyId,'first-room');
  const old=task;task=deferred();input={enabled:true,squadId:'second'};value=ui.render();assert.deepEqual(value.lobbies,[],'Squad switch hides the old directory immediately');
  old.resolve({lobbies:[{lobbyId:'old-room'}]});await background;assert.deepEqual(ui.render().lobbies,[]);
  task.resolve({lobbies:[{lobbyId:'second-room'}]});await flush();value=ui.render();assert.equal(value.lobbies[0].lobbyId,'second-room');
  task=deferred();const denied=value.refresh(true);task.reject(Error('permission-denied'));await denied;assert.deepEqual(ui.render().lobbies,[],'Revoked access clears previously known lobbies');
  input={enabled:false,squadId:null};ui.render();ui.unmount();assert.equal(ui.lateWrites(),0);
}

(async()=>{
  global.__DEV__=false;
  await refreshTests();await serviceTests();await chatTests();await friendsScreenTests();await squadTests();await homeScreenTests();await lobbyScopeTests();
  console.log('App efficiency: coalesced refresh races, fresh mutations, account isolation, section-only Friends reads, independent suggestions, unread visibility, parallel message hydration, membership-first teams and stable Home refresh passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
