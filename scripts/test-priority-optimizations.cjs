'use strict';
// Offline only: actual client modules run against injected SDKs and deferred reads.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
global.__DEV__ = false;
function load(file, modules = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency in ${file}: ${name}`);
    return modules[name];
  }, module, module.exports);
  return module.exports;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness(factory) {
  const slots = []; let cursor = 0, effects = [], mounted = true, lateWrites = 0;
  const changed = (old, deps) => !old || !deps || old.deps?.length !== deps.length || deps.some((value, i) => value !== old.deps[i]);
  const React = {
    Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    createContext: value => ({ Provider: 'Provider', value }), useContext: context => context.value,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => { if (!mounted) { lateWrites++; return; } slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useMemo(make, deps) { const index = cursor++; if (changed(slots[index], deps)) slots[index] = { deps, value: make() }; return slots[index].value; },
    useCallback(fn, deps) { return React.useMemo(() => fn, deps); },
    useEffect(effect, deps) { const index = cursor++, old = slots[index]; if (changed(old, deps)) effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; }); },
  };
  const component = factory(React);
  return { render(props = {}) { cursor = 0; effects = []; const tree = component(props); effects.forEach(run => run()); return tree; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); mounted = false; }, lateWrites: () => lateWrites };
}
function nodes(tree, predicate) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(node => nodes(node, predicate)); return [...(predicate(tree) ? [tree] : []), ...nodes(tree.type === 'VirtualizedRow' ? tree.props.render() : tree.props?.children, predicate)]; }
const find = (tree, predicate) => nodes(tree, predicate)[0];
const hasText = (tree, text) => Boolean(find(tree, node => node.type === 'Text' && node.props.children.includes(text)));
const snap = (id, data) => ({ id, exists: () => data != null, data: () => data });
const reference = (_db, ...parts) => parts.join('/');
const firestore = { doc: reference, collection: reference, query: (...args) => args, where: (...args) => args, orderBy: (...args) => args, documentId: () => '__name__', limit: n => n, Timestamp: class { static now() { return new Date(); } } };
const privacy = load('utils/friendPrivacy.ts');
const measure = { measureDevelopmentPerformance: (_label, work) => work(), startDevelopmentPerformanceTrace: () => () => {} };
const t = key => key;
function native() { return { ...Object.fromEntries(['ActivityIndicator', 'Image', 'RefreshControl', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'Pressable', 'View'].map(name => [name, name])), StyleSheet: { create: styles => styles }, Alert: { alert() {} }, AppState: { addEventListener: () => ({ remove() {} }) } }; }
const theme = { Colors: {}, Radius: {}, Shadow: {}, Spacing: {}, Typography: {} };

async function profileRefresh() {
  const auth = { currentUser: null }; let listener, read = deferred(), calls = 0;
  const ui = harness(React => load('context/AuthContext.tsx', {
    react: React, 'firebase/auth': { onAuthStateChanged: (_auth, next) => { listener = next; return () => {}; } },
    'firebase/firestore': { doc: reference, getDoc: () => { calls++; return read.promise; } },
    '@/config/firebase': { auth, db: {} }, '@/config/firebaseAppCheck': {}, '@/services/accountStandingService': {}, '@/services/authProfileService': {},
    '@/services/federatedAuthService': { ProviderFlowError: class ProviderFlowError extends Error {}, subscribeToAppleCredentialRevocation: () => () => {} },
    '@/services/localUserStateService': {}, '@/services/notificationService': {},
    '@/utils/federatedAuthCore': load('utils/federatedAuthCore.ts'), '@/utils/authIdentity': load('utils/authIdentity.ts'),
    '@/utils/authSessionProfileCore': load('utils/authSessionProfileCore.ts'), '@/utils/localUserStateCore': {},
    '@/utils/onboardingMode': load('utils/onboardingMode.ts'), '@/utils/profileName': load('utils/profileName.ts'),
    '@/utils/voicePlaybackCore': { setVoicePlaybackAuthorizationContext() {} }, '@/utils/performanceDiagnostics': measure,
  }).AuthProvider);
  assert.equal(ui.render().props.value.loading, true);
  auth.currentUser = { uid: 'a', isAnonymous: false, displayName: 'Old Name', providerData: [] }; listener(auth.currentUser);
  assert.equal(ui.render().props.value.loading, true, 'Initial auth retains the loading boundary');
  read.resolve(snap('a', { displayName: 'Old Name' })); await tick();
  let value = ui.render().props.value; assert.equal(value.loading, false);
  read = deferred(); const update = value.refreshProfile();
  value = ui.render().props.value;
  assert.equal(value.loading, false, 'Routine refresh must leave the navigator mounted');
  assert.equal(value.user.displayName, 'Old Name');
  read.resolve(snap('a', { displayName: 'New Name' })); await update;
  value = ui.render().props.value; assert.equal(value.user.displayName, 'New Name');
  read = deferred(); const failed = value.refreshProfile(); const rejection = assert.rejects(failed, /offline/);
  read.reject(Error('offline')); await rejection;
  value = ui.render().props.value; assert.equal(value.loading, false); assert.equal(value.user.displayName, 'New Name');
  read = deferred(); const stale = value.refreshProfile(); const oldRead = read;
  auth.currentUser = { uid: 'b', isAnonymous: false, displayName: 'B', providerData: [] }; read = deferred(); listener(auth.currentUser);
  value = ui.render().props.value; assert.equal(value.loading, true); assert.equal(value.user, null);
  oldRead.resolve(snap('a', { displayName: 'Must not escape' })); await stale;
  value = ui.render().props.value; assert.equal(value.loading, true); assert.equal(value.user, null);
  read.resolve(snap('b', { displayName: 'B' })); await tick(); value = ui.render().props.value; assert.equal(value.user.uid, 'b');
  read = deferred(); const signedOutRead = value.refreshProfile(); auth.currentUser = null; listener(null);
  read.resolve(snap('b', { displayName: 'Stale B' })); await signedOutRead;
  value = ui.render().props.value; assert.equal(value.user, null); assert.equal(value.firebaseUser, null);
  read = deferred(); auth.currentUser = { uid: 'restricted', isAnonymous: false, providerData: [] }; listener(auth.currentUser);
  read.reject(Object.assign(Error('denied'), { code: 'permission-denied' })); await tick(); value = ui.render().props.value;
  assert.equal(value.loading, false); assert.equal(value.firebaseUser.uid, 'restricted', 'Restricted sessions must survive ordinary-profile denial for the standing/appeal gate');
  assert.equal(calls, 7); ui.unmount(); assert.equal(ui.lateWrites(), 0);
}

async function modeSwitches() {
  const { switchModeImmediately } = load('utils/modeSwitch.ts');
  for (const mode of ['coach', 'parent']) {
    const gate = deferred(), events = [], inFlight = { current: false }; let sameAccount = true;
    const options = { inFlight, mode, isCurrentAccount: () => sameAccount, setMode: next => events.push(next), navigate: () => events.push('navigate'), persist: () => { events.push('persist'); return gate.promise; }, onPersistenceError: () => events.push('notice') };
    const work = switchModeImmediately(options);
    assert.deepEqual(events, [mode, 'navigate', 'persist'], 'Navigation cannot wait for persistence');
    await switchModeImmediately(options); assert.equal(events.length, 3, 'Duplicate taps cannot repeat the write or navigation');
    gate.reject(Error('offline')); await work; assert.equal(events.at(-1), 'notice');
    const other = deferred(); inFlight.current = false; events.length = 0;
    const late = switchModeImmediately({ ...options, persist: () => other.promise }); sameAccount = false; other.reject(Error('offline')); await late;
    assert.equal(events.includes('notice'), false, 'Old-account completion cannot show a notice');
    inFlight.current = false; events.length = 0; await switchModeImmediately(options); assert.deepEqual(events, []);
  }
  const inFlight = { current: false };
  await assert.rejects(switchModeImmediately({ inFlight, mode: 'coach', isCurrentAccount: () => true, setMode() {}, navigate() { throw Error('navigation'); }, persist: async () => { assert.fail('No write after failed navigation'); }, onPersistenceError() {} }), /navigation/);
  assert.equal(inFlight.current, false);
}

async function selectedTeam() {
  const auth = { currentUser: { uid: 'a' } }; let accessGate, membership, dependentReads = 0;
  const valid = () => ({ teamId: 'picked', status: 'active', roles: { parent: true }, childId: null, childName: '', team: { id: 'picked', status: 'active', name: 'Demo', coachIds: [] } });
  membership = valid();
  const service = load('services/parentTeamService.ts', {
    'firebase/firestore': { ...firestore, getDocs: async () => { dependentReads++; return { docs: [], size: 0 }; } },
    'firebase/functions': { httpsCallable: () => async () => { dependentReads++; return { data: { summaries: [] } }; } },
    '@/config/firebase': { auth, db: {}, functions: {} }, '@/constants/teamHistoryPagination': { TEAM_HISTORY_PAGE_SIZES: { announcements: 20 } },
    '@/utils/parentTeamCore': load('utils/parentTeamCore.ts'), '@/services/childService': { getCurrentUserChildren: async () => { dependentReads++; return []; } },
    '@/services/teamService': { getCurrentUserTeamMembershipById: async id => { assert.equal(id, 'picked'); return accessGate ? accessGate.promise : membership; }, getParentTeams: () => assert.fail('Single team must not load every membership'), hasTeamRole: (item, role) => item.roles[role], isTeamActive: team => team?.status === 'active' },
    '@/utils/friendPrivacy': privacy, '@/services/teamPrivateMessageService': { getTeamPrivateMessageInbox: async () => { dependentReads++; return []; } },
    '@/services/publicProfileService': { getPublicUserProfiles: async () => [] }, '@/utils/voiceMessageNormalizer': {}, '@/utils/parentTeamInboxCore': load('utils/parentTeamInboxCore.ts'),
  });
  const summary = await service.getParentTeamSummary('picked'); assert.equal(summary.teamId, 'picked'); assert.ok(dependentReads > 0);
  for (const denied of [null, { ...valid(), roles: { parent: false } }, { ...valid(), team: { ...valid().team, status: 'archived' } }]) {
    dependentReads = 0; membership = denied;
    await assert.rejects(service.getParentTeamSummary('picked'), error => error.code === 'membership-missing');
    assert.equal(dependentReads, 0, 'Denied teams must not load protected child/history data');
  }
  accessGate = deferred(); const pending = service.getParentTeamSummary('picked');
  auth.currentUser = { uid: 'b' }; accessGate.resolve(valid()); await assert.rejects(pending); assert.equal(dependentReads, 0);
}

async function homeNavigation() {
  const user = { uid: 'a' }, pushes = [], wait = deferred();
  const ui = harness(React => load('app/(tabs)/index.tsx', {
    react: React, 'react-native': native(), 'expo-router': { router: { push: route => pushes.push(route) }, useFocusEffect: cb => React.useEffect(cb, [cb]) }, 'lucide-react-native': {}, 'react-i18next': { useTranslation: () => ({ t }) },
    ...Object.fromEntries(['Card', 'IcebreakerCard', 'LocalPerkAdCard', 'ScreenWrapper', 'SquadIdentity', 'SquadSelector'].map(name => ['@/components/' + name, { [name]: name }])),
    '@/constants/localPerkPreview': {}, '@/context/AuthContext': { useAuth: () => ({ user }) }, '@/context/SquadContext': { useSquad: () => ({ mySquads: [], membershipLoading: false, reloadMemberships: async () => {} }) }, '@/constants/theme': theme,
    '@/hooks/useCoalescedRefresh': load('hooks/useCoalescedRefresh.ts', { react: React, '@/utils/coalescedRefresh': load('utils/coalescedRefresh.ts') }),
    '@/hooks/useSquadGameLobbies': { useSquadGameLobbies: () => ({ lobbies: [], refresh: async () => {} }) },
    '@/services/notificationService': { subscribeToUnreadNotificationCount: () => () => {}, retryPendingNotificationAcknowledgements: async () => {} },
    '@/utils/notificationCore': { formatUnreadBadgeCount: () => '' }, '@/services/chatService': { subscribeToUnreadFriendConversationCount: () => () => {} }, '@/utils/performanceDiagnostics': measure,
    '@/services/parentTeamService': { getParentHomeTeamsSummary: () => wait.promise },
    '@/services/weeklyChallengeService': { getCurrentWeeklyChallenge: async () => null }, '@/services/weeklyChallengeLocalization': {}, '@/assets/branding/sideline-social-logo.png': 'logo',
  }).default);
  ui.render(); await tick(); const tree = ui.render(); const card = find(tree, node => node.props.onOpenTeam && Object.hasOwn(node.props, 'summary'));
  assert.ok(card); card.props.onOpenTeam('picked'); card.props.onOpenTeam('picked');
  assert.equal(pushes.length, 1, 'Transition starts before any unresolved Home reads and duplicate taps are blocked');
  assert.equal(pushes[0].params.teamId, 'picked');
  wait.resolve({ rows: [], totalTeams: 0 }); await tick(); ui.unmount(); assert.equal(ui.lateWrites(), 0);
}

async function friendServiceFailures() {
  const auth = { currentUser: { uid: 'a' } }; let read, publicRead, profileCalls = 0;
  const friends = load('services/friendsService.ts', {
    'firebase/firestore': { ...firestore, getDoc: () => read.promise }, 'firebase/functions': {}, '@/config/firebase': { auth, db: {}, functions: {} },
    '@/services/publicProfileService': { getPublicUserProfiles: async () => { profileCalls++; return publicRead.promise; } },
    '@/utils/friendRequestMapping': load('utils/friendRequestMapping.ts'), '@/utils/friendRequestState': load('utils/friendRequestState.ts'), '@/utils/friendPrivacy': privacy, '@/utils/profileName': load('utils/profileName.ts'),
  });
  read = deferred(); let work = friends.getFriends('a'); read.resolve(snap('a', { friendIds: [] })); assert.deepEqual(await work, []); assert.equal(profileCalls, 0);
  read = deferred(); work = friends.getFriends('a'); const missing = assert.rejects(work, error => error.code === 'friends/profile-unavailable'); read.resolve(snap('a', null)); await missing;
  read = deferred(); work = friends.getFriends('a'); const offline = assert.rejects(work, /offline/); read.reject(Error('offline')); await offline;
  read = deferred(); publicRead = deferred(); work = friends.getFriends('a'); const denied = assert.rejects(work, /denied/);
  read.resolve(snap('a', { friendIds: ['friend'] })); await tick(); publicRead.reject(Error('denied')); await denied;
  read = deferred(); publicRead = deferred(); work = friends.getFriends('a'); const changed = assert.rejects(work, error => error.code === 'friends/account-changed');
  read.resolve(snap('a', { friendIds: ['friend'] })); await tick(); auth.currentUser = { uid: 'b' }; publicRead.resolve([{ userId: 'friend', displayName: 'Old-account friend' }]); await changed;
}

async function friendErrorScreens() {
  let user = { uid: 'a' }, fail = false, changed;
  const api = { getCurrentUserProfile: async () => ({ id: user.uid, displayName: 'Demo' }), getFriends: async () => { if (fail) throw Error('offline'); return [{ id: 'friend', displayName: 'Demo Friend' }]; }, getFriendRequestGroups: async () => ({ incoming: [], outgoing: [] }), searchUsers: async () => [], subscribeToFriendRequestChanges: (_uid, next) => { changed = next; return () => {}; } };
  const ui = harness(React => load('app/(tabs)/friends.tsx', {
    react: React, 'react-native': native(), 'expo-router': { router: { push() {} }, useLocalSearchParams: () => ({}), useFocusEffect: cb => React.useEffect(cb, [cb]) }, 'lucide-react-native': {}, 'react-i18next': { useTranslation: () => ({ t }) },
    '@/components/Card': { Card: 'Card' }, '@/components/KeyboardAwareScrollView': { KeyboardAwareScrollView: 'ScrollView' }, '@/components/VirtualizedRows': { VirtualizedRows: 'VirtualizedRows', VirtualizedRow: 'VirtualizedRow' }, '@/components/ScreenWrapper': { ScreenWrapper: 'ScreenWrapper' }, '@/context/AuthContext': { useAuth: () => ({ user, loading: false }) },
    '@/hooks/useCoalescedRefresh': load('hooks/useCoalescedRefresh.ts', { react: React, '@/utils/coalescedRefresh': load('utils/coalescedRefresh.ts') }), '@/constants/theme': theme, '@/services/friendsService': api,
    '@/services/chatService': {}, '@/services/notificationService': {}, '@/utils/friendPrivacy': privacy, '@/utils/friendRequestState': load('utils/friendRequestState.ts'), '@/utils/performanceDiagnostics': measure,
  }).default);
  ui.render(); await tick(); let tree = ui.render(); assert.ok(find(tree, node => node.props.profile?.id === 'friend'));
  fail = true; changed('friendship'); await tick(); tree = ui.render();
  assert.ok(hasText(tree, 'friends.errorBody')); assert.equal(Boolean(find(tree, node => node.props.title === 'friends.emptyTitle')), false); assert.equal(Boolean(find(tree, node => node.props.profile?.id === 'friend')), false);
  ui.unmount(); assert.equal(ui.lateWrites(), 0);

  for (const empty of [true, false]) {
    const gate = deferred(); let activeUser = { uid: 'a' };
    const selector = harness(React => load('app/(social)/chat/new.tsx', {
      react: React, 'react-native': native(), 'expo-router': { router: {} }, 'lucide-react-native': {}, 'react-i18next': { useTranslation: () => ({ t }) },
      '@/components/Card': { Card: 'Card' }, '@/components/KeyboardAwareScrollView': { KeyboardAwareScrollView: 'ScrollView' }, '@/components/NestedBackButton': { NestedBackButton: 'Back' }, '@/components/ScreenWrapper': { ScreenWrapper: 'ScreenWrapper' }, '@/constants/theme': theme,
      '@/context/AuthContext': { useAuth: () => ({ user: activeUser }) }, '@/services/chatService': { MAX_CHAT_PARTICIPANTS: 8 }, '@/services/friendsService': { getFriends: () => gate.promise },
    }).default);
    selector.render(); if (empty) gate.resolve([]); else gate.reject(Error('offline')); await tick(); const result = selector.render();
    assert.equal(hasText(result, 'chat.noAcceptedFriends'), empty); assert.equal(hasText(result, 'chat.temporarilyUnavailable'), !empty);
    selector.unmount(); assert.equal(selector.lateWrites(), 0);
  }
  const manage = harness(React => load('app/(social)/chat/manage.tsx', {
    react: React, 'react-native': native(), 'expo-router': { router: {}, useLocalSearchParams: () => ({ conversationId: 'demo' }) }, 'lucide-react-native': {}, 'react-i18next': { useTranslation: () => ({ t }) },
    '@/components/Card': { Card: 'Card' }, '@/components/KeyboardAwareScrollView': { KeyboardAwareScrollView: 'ScrollView' }, '@/components/NestedBackButton': { NestedBackButton: 'Back' }, '@/components/ScreenWrapper': { ScreenWrapper: 'ScreenWrapper' }, '@/constants/theme': theme,
    '@/context/AuthContext': { useAuth: () => ({ user: { uid: 'a' } }) }, '@/services/chatService': { MAX_CHAT_PARTICIPANTS: 8, getFriendConversationAccess: async () => ({ member: { status: 'active' }, conversation: { conversationType: 'group' } }), getFriendConversationMembers: async () => [], mapFriendChatError: () => 'network' },
    '@/services/friendsService': { getFriends: async () => { throw Error('offline'); } },
  }).default);
  manage.render(); await tick(); const blocked = manage.render(); assert.ok(hasText(blocked, 'chat.networkError')); assert.ok(hasText(blocked, 'chat.cannotOpenTitle')); manage.unmount(); assert.equal(manage.lateWrites(), 0);
}

(async () => {
  let failures = 0;
  const groups = { profileRefresh, modeSwitches, selectedTeam, homeNavigation, friendServiceFailures, friendErrorScreens };
  const selected = process.argv.slice(2);
  if (selected.some(name => !Object.hasOwn(groups, name))) throw Error('Unknown focused check group');
  for (const [name, run] of Object.entries(groups)) {
    if (selected.length && !selected.includes(name)) continue;
    try { await run(); console.log(`PASS ${name}`); } catch (error) { failures++; console.error(`FAIL ${name}:`, error); }
  }
  if (failures) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
