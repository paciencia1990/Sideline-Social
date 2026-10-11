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
const team = { teamId: 'team-a', status: 'active', roles: { coach: true }, team: { id: 'team-a', status: 'active', name: 'Synthetic Team' } };
const recovery = load('utils/coachHomeRecovery.ts');
const onboarding = load('utils/onboardingMode.ts');

function screen({ memberships, archive = async () => 0, persist = async () => {} }) {
  const navigation = [], modes = [], reads = []; let mode = 'coach', userId = 'synthetic-coach';
  const t = (key) => key;
  const ui = harness((React) => load('app/coach/index.tsx', {
    react: React,
    'react-native': { ...Object.fromEntries(['ActivityIndicator', 'ScrollView', 'Text', 'TouchableOpacity', 'View'].map((name) => [name, name])), StyleSheet: { create: (value) => value }, Alert: { alert() {} } },
    'expo-router': { router: { push: (route) => navigation.push(route) }, useFocusEffect: (callback) => React.useEffect(callback, [callback]) },
    'lucide-react-native': Object.fromEntries(['Archive', 'CalendarDays', 'ChevronDown', 'ChevronUp', 'MessageCircle', 'MessagesSquare', 'RotateCcw', 'Shield', 'Users'].map((name) => [name, name])),
    'react-i18next': { useTranslation: () => ({ t }) },
    '@/components/Card': { Card: 'Card' }, '@/components/ScreenWrapper': { ScreenWrapper: 'ScreenWrapper' },
    '@/components/NestedBackButton': { replaceAfterOptionalDismiss: (route) => navigation.push(route) },
    '@/constants/routes': { PARENT_PROFILE_ROUTE: '/(tabs)/profile' }, '@/constants/teamHistoryPagination': { TEAM_HISTORY_PAGE_SIZES: { archivedTeams: 10 } },
    '@/constants/theme': { Colors: {}, Radius: {}, Shadow: {}, Spacing: {}, TeamCodeTypography: {}, Typography: {} },
    '@/context/AppContext': { useApp: () => ({ activeMode: mode, modeHydrated: true, setActiveMode: (next) => { mode = next; modes.push(next); } }) },
    '@/context/AuthContext': { useAuth: () => ({ user: { uid: userId } }) },
    '@/services/teamService': { getCurrentUserTeamMemberships: (options) => { reads.push(options); return memberships(); }, getArchivedCoachTeamCount: archive,
      hasCoachAccess: (item) => item.roles.coach, isTeamActive: (item) => item?.status === 'active', hasTeamRole: (item, role) => Boolean(item.roles[role]),
      canManageTeamRoles: () => true, switchActiveMode: persist },
    '@/services/teamPrivateMessageService': { getTeamPrivateMessageInboxPage: async () => ({ conversations: [] }) },
    '@/utils/coachCommunicationCore': { shouldShowPrivateMessagesCard: () => false },
    '@/utils/coachHomeTeamCards': { createCoachHomeTeamCards: (items) => items.map((item) => ({ teamId: item.teamId, ...item.team })) },
    '@/utils/coachResourcesAccess': { resolveCoachResourcesAccess: ({ loadState }) => loadState === 'loaded' ? 'allowed' : 'denied' },
    '@/utils/coachHomeRecovery': recovery,
  }).default);
  return { ui, navigation, modes, reads, setUserId: (next) => { userId = next; } };
}

(async () => {
  global.__DEV__ = false;
  const oldWarn = console.warn; const warnings = []; console.warn = (...values) => warnings.push(values);
  try {
    const archived = await recovery.loadCoachHomeData({ memberships: async () => [team], archivedCount: async () => { throw Object.assign(new Error('private archive error'), { code: 'unavailable' }); } });
    assert.deepEqual(archived.memberships, [team]); assert.equal(archived.archiveCountUnavailable, true);
    await assert.rejects(recovery.loadCoachHomeData({ memberships: () => new Promise(() => {}), archivedCount: async () => 0 }, 5), (error) => error.code === 'deadline-exceeded');
    const timeoutArchive = await recovery.loadCoachHomeData({ memberships: async () => [team], archivedCount: () => new Promise(() => {}) }, 5);
    assert.equal(timeoutArchive.archiveCountUnavailable, true);

    let fail = true, attempts = 0; const persistence = deferred(); let modeWrites = 0;
    const failed = screen({ memberships: async () => { attempts++; if (fail) throw Object.assign(new Error('Private failure detail'), { code: 'permission-denied' }); return [team]; },
      persist: () => { modeWrites++; return persistence.promise; } });
    let tree = failed.ui.render(); assert.ok(button(tree, 'mode.switchToParent'), 'Escape remains visible during loading');
    await flush(); tree = failed.ui.render();
    assert.ok(hasText(tree, 'coach.home.errorTitle')); assert.ok(button(tree, 'common.retry'));
    assert.equal(button(tree, 'coach.home.resources'), undefined, 'Failed authorization does not expose coach tools');
    assert.equal(button(tree, 'coach.team.createTeam'), undefined, 'Failed lookup does not pretend the account has no teams');
    fail = false; button(tree, 'common.retry').props.onPress(); await flush(); tree = failed.ui.render();
    assert.equal(attempts, 2); assert.ok(button(tree, 'coach.home.resources'), 'Manual retry restores current coach content');
    assert.deepEqual(failed.reads, [{ throwOnError: true, requireComplete: true }, { throwOnError: true, requireComplete: true }]);
    const leave = button(tree, 'mode.switchToParent'); const pendingSwitch = leave.props.onPress(); leave.props.onPress();
    assert.deepEqual(failed.modes, ['parent']); assert.deepEqual(failed.navigation, ['/(tabs)/profile']); assert.equal(modeWrites, 1);
    failed.ui.unmount(); persistence.reject(Object.assign(new Error('Private preference error'), { code: 'Private provider detail in a nonstandard code' })); await pendingSwitch; await flush();
    assert.equal(failed.ui.lateWrites(), 0); assert.ok(warnings.every((values) => !JSON.stringify(values).includes('Private')));

    const archiveFailure = screen({ memberships: async () => [team], archive: async () => { throw new Error('archive failed'); } });
    archiveFailure.ui.render(); await flush(); tree = archiveFailure.ui.render();
    assert.ok(hasText(tree, 'coach.home.archiveUnavailable')); assert.ok(button(tree, 'coach.home.resources'));
    archiveFailure.ui.unmount();
    const slow = deferred(); const leaving = screen({ memberships: () => slow.promise });
    tree = leaving.ui.render(); await button(tree, 'mode.switchToParent').props.onPress(); leaving.ui.unmount();
    slow.resolve([team]); await flush(); assert.equal(leaving.ui.lateWrites(), 0, 'Late team response cannot resurrect a departed screen');

    const oldAccountRead = deferred(); let accountReads = 0;
    const accountSwitch = screen({ memberships: () => ++accountReads === 1 ? oldAccountRead.promise : Promise.resolve([]) });
    accountSwitch.ui.render(); await flush(); accountSwitch.setUserId('synthetic-new-coach'); accountSwitch.ui.render(); await flush();
    oldAccountRead.resolve([team]); await flush(); tree = accountSwitch.ui.render();
    assert.equal(hasText(tree, 'Synthetic Team'), false, 'An old account response cannot expose its team on the new account screen');
    accountSwitch.ui.unmount(); assert.equal(accountSwitch.ui.lateWrites(), 0);

    let user = { uid: 'coach-a', activeMode: 'coach' }; let stored = 'coach';
    const provider = harness((React) => load('context/AppContext.tsx', {
      react: React,
      '@react-native-async-storage/async-storage': { getItem: async () => stored, setItem: async (_key, value) => { stored = value; }, removeItem: async () => { stored = null; } },
      '@/i18n': { language: 'en', on() {}, off() {}, changeLanguage: async () => {} },
      '@/context/AuthContext': { useAuth: () => ({ loading: false, user }) },
      '@/utils/onboardingMode': onboarding,
      '@/utils/performanceDiagnostics': { startDevelopmentPerformanceTrace: () => () => {} },
    }).AppProvider);
    provider.render(); await flush(); tree = provider.render(); assert.equal(tree.props.value.activeMode, 'coach');
    tree.props.value.setActiveMode('parent'); tree = provider.render(); assert.equal(tree.props.value.activeMode, 'parent');
    user = { uid: 'coach-a', activeMode: 'coach' }; provider.render(); await flush(); tree = provider.render();
    assert.equal(tree.props.value.activeMode, 'parent', 'Stale profile refresh cannot undo the explicit escape choice');
    user = { uid: 'coach-b', activeMode: 'coach' }; provider.render(); await flush(); tree = provider.render();
    assert.equal(tree.props.value.activeMode, 'coach', 'Navigation preference does not leak into another account');
    user = null; provider.render(); await flush(); tree = provider.render(); assert.equal(tree.props.value.activeMode, 'parent');
    user = { uid: 'coach-a', activeMode: 'coach' }; provider.render(); await flush(); tree = provider.render(); assert.equal(tree.props.value.activeMode, 'coach', 'A new sign-in uses authoritative saved preference');
    provider.unmount(); assert.equal(provider.lateWrites(), 0);
    console.log('Coach home recovery: visible escape, Retry, archive isolation, timeout, failed preference save, stale responses and account-scoped mode hydration passed.');
  } finally { console.warn = oldWarn; }
})().catch((error) => { console.error(error); process.exitCode = 1; });
