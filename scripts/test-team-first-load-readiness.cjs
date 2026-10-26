'use strict';
// Actual changed modules, mocked SDK/readiness, fictional data. No live imports.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
global.__DEV__ = false;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function load(file, modules = {}, clock = {}) {
  const result = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  });
  assert.deepEqual((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error), [], file);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', result.outputText)(name => {
    assert.ok(Object.hasOwn(modules, name), 'unmocked_dependency:' + name); return modules[name];
  }, module, module.exports, clock.setTimeout || setTimeout, clock.clearTimeout || clearTimeout);
  return module.exports;
}
function readinessFixture() {
  const ready = deferred(), session = { uid: 'fixture_coach' }, auth = { currentUser: session }, timers = new Map(); let id = 0;
  const api = load('services/teamReadReadiness.ts', { '@/config/firebase': { auth, firebaseAppCheckReady: ready.promise } }, {
    setTimeout: (callback, ms) => { timers.set(++id, { callback, ms }); return id; }, clearTimeout: id => timers.delete(id),
  });
  return { api, ready, auth, session, timers, timeout() { const pending = [...timers.values()]; timers.clear(); pending.forEach(timer => timer.callback()); } };
}
const uid = 'fixture_coach', teamId = 'fixture_team';
const profile = { coachTeamIds: [teamId], parentTeamIds: [] };
const member = { role: 'coach', roles: { coach: true, staff: false, parent: false }, status: 'active' };
const team = { name: 'Fictional Team', createdBy: uid, status: 'active', inviteCode: 'PRIVATE_INVITE' };
const row = { id: uid, userId: uid, teamId, role: 'coach', roles: member.roles, status: 'active', team: { ...team, id: teamId } };
const snapshot = (id, data) => ({ id, data: () => data, exists: () => data !== null, metadata: { fromCache: false, hasPendingWrites: false } });
function serviceFixture({ override } = {}) {
  const f = readinessFixture(), reads = [];
  const read = name => {
    reads.push(name);
    if (override) { const result = override(name, f); if (result !== undefined) return result; }
    if (name === 'users/' + uid) return snapshot(uid, profile);
    if (name === `teams/${teamId}/members/${uid}`) return snapshot(uid, member);
    if (name === 'teams/' + teamId) return snapshot(teamId, team);
    throw Error('unexpected_fixture_document');
  };
  const api = load('services/teamService.ts', {
    'firebase/firestore': { doc: (_db, ...parts) => parts.join('/'), getDocFromServer: async name => read(name), getDoc: async name => read(name) },
    'firebase/functions': {}, '@/config/firebase': { auth: f.auth, db: {}, functions: {} },
    '@/constants/teamHistoryPagination': { TEAM_HISTORY_PAGE_SIZES: {} }, '@/utils/friendPrivacy': {}, '@/utils/teamLifecycleRequest': {},
    '@/services/teamReadReadiness': f.api,
  });
  return { ...f, api, readiness: f.api, reads };
}
const access = load('utils/coachResourcesAccess.ts'), recovery = load('utils/coachHomeRecovery.ts');
const teamCards = load('utils/coachHomeTeamCards.ts'), modeSwitch = load('utils/modeSwitch.ts');
const diagnosticFixture = serviceFixture();
const diagnostic = diagnosticFixture.api.getCoachHomeLookupDiagnostic;
const lookupError = diagnosticFixture.api.CoachHomeLookupError;

function harness(factory) {
  const slots = []; let cursor = 0, effects = [], mounted = true, lateWrites = 0;
  const callbacks = new Set();
  const changed = (old, deps) => !old || !deps || old.deps?.length !== deps.length || deps.some((value, i) => value !== old.deps[i]);
  const react = {
    Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[id].value, value => { if (!mounted) { lateWrites++; return; } slots[id].value = typeof value === 'function' ? value(slots[id].value) : value; }]; },
    useRef(initial) { const id = cursor++; return slots[id] ?? (slots[id] = { current: initial }); },
    useMemo(make, deps) { const id = cursor++; if (changed(slots[id], deps)) slots[id] = { deps, value: make() }; return slots[id].value; },
    useCallback(fn, deps) { const value = react.useMemo(() => fn, deps); callbacks.add(value); return value; },
    useEffect(callback, deps) { const id = cursor++, old = slots[id]; if (changed(old, deps)) effects.push(() => { old?.cleanup?.(); slots[id] = { deps, cleanup: callback() }; }); },
  };
  const Component = factory(react);
  return { render() { cursor = 0; effects = []; const tree = Component(); effects.forEach(run => run()); return tree; },
    loadTeams() { const fn = [...callbacks].reverse().find(value => value.toString().includes('getConfirmedCoachHomeTeams'));
      assert.ok(fn, 'actual_loadTeams_callback_missing'); return fn(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); mounted = false; }, lateWrites: () => lateWrites };
}
function nodes(tree) { if (tree == null || tree === false) return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [tree]; }
const has = (tree, text) => nodes(tree).includes(text);
const button = (tree, text) => nodes(tree).find(node => node?.type === 'Button' && has(node, text));
const confirmed = (memberships = [row]) => ({ outcome: memberships.length ? 'verified_memberships' : 'verified_empty', memberships, archivedCount: 0 });
function screenFixture({ read = async () => confirmed(), ready = async () => {} } = {}) {
  let user = { uid }, calls = 0;
  const auth = { currentUser: { uid } }, t = key => key;
  const ui = harness(react => load('app/coach/index.tsx', {
    react, 'react-native': { ...Object.fromEntries(['ActivityIndicator', 'ScrollView', 'Text', 'View'].map(name => [name, name])),
      TouchableOpacity: 'Button', StyleSheet: { create: value => value }, Alert: { alert() {} } },
    'expo-router': { router: { push() {} }, useFocusEffect: callback => react.useEffect(callback, [callback]) },
    'lucide-react-native': Object.fromEntries(['Archive', 'CalendarDays', 'ChevronDown', 'ChevronUp', 'MessageCircle', 'MessagesSquare', 'RotateCcw', 'Shield', 'Users'].map(name => [name, name])),
    'react-i18next': { useTranslation: () => ({ t }) }, '@/components/Card': { Card: 'Card' }, '@/components/ScreenWrapper': { ScreenWrapper: 'Screen' },
    '@/components/NestedBackButton': { replaceAfterOptionalDismiss() {} }, '@/constants/routes': { PARENT_PROFILE_ROUTE: '/profile' },
    '@/constants/teamHistoryPagination': { TEAM_HISTORY_PAGE_SIZES: { archivedTeams: 10 } },
    '@/constants/theme': { Colors: {}, Radius: {}, Shadow: {}, Spacing: {}, TeamCodeTypography: {}, Typography: {} },
    '@/context/AppContext': { useApp: () => ({ activeMode: 'coach', modeHydrated: true, setActiveMode() {} }) },
    '@/context/AuthContext': { useAuth: () => ({ user }) }, '@/config/firebase': { auth },
    '@/services/teamService': { getConfirmedCoachHomeTeams: expected => { calls++; return read(expected); }, getCoachHomeLookupDiagnostic: diagnostic,
      getArchivedCoachTeamMembershipsPage: async () => ({ memberships: [], totalCount: 0, hasMore: false, nextOffset: 0 }),
      hasCoachAccess: m => m.roles.coach || m.roles.staff, hasTeamRole: (m, role) => m.roles[role] === true,
      isTeamActive: team => team?.status === 'active', canManageTeamRoles: () => true, switchActiveMode: async () => {} },
    '@/services/teamReadReadiness': { requireTeamReadReady: expected => ready(expected), isTransientTeamReadError: diagnosticFixture.readiness.isTransientTeamReadError },
    '@/services/teamPrivateMessageService': { getTeamPrivateMessageInboxPage: async () => ({ conversations: [] }) },
    '@/utils/coachCommunicationCore': { shouldShowPrivateMessagesCard: () => false }, '@/utils/coachHomeTeamCards': teamCards,
    '@/utils/coachResourcesAccess': access, '@/utils/coachHomeRecovery': recovery, '@/utils/modeSwitch': modeSwitch,
  }).default);
  return { ui, auth, calls: () => calls, changeUser(next) { user = next; auth.currentUser = next ? { uid: next.uid } : null; } };
}
function assertNoProtectedActions(tree) {
  assert.equal(button(tree, 'coach.home.resources'), undefined);
  assert.equal(button(tree, 'coach.team.createTeam'), undefined);
  assert.equal(button(tree, 'coach.home.addTeam'), undefined);
  assert.equal(nodes(tree).some(node => typeof node?.type === 'function' && node.type.name === 'QuickAction'), false);
  assert.equal(has(tree, 'PRIVATE_INVITE'), false);
}
const groups = [];
async function test(name, run) { await run(); groups.push(name); }
async function main() {
  await test('readiness_waits_for_existing_attestation_and_returns_exact_session', async () => {
    const f = readinessFixture(); let reads = 0;
    const pending = f.api.requireTeamReadReady(uid).then(session => { reads++; return session; });
    await tick(); assert.equal(reads, 0); assert.equal(f.timers.size, 1);
    f.ready.resolve(); assert.equal(await pending, f.session); assert.equal(reads, 1); assert.equal(f.timers.size, 0);
  });
  await test('failed_security_and_timeout_never_run_dependent_read', async () => {
    for (const mode of ['failure', 'timeout']) {
      const f = readinessFixture(); let reads = 0;
      const pending = f.api.requireTeamReadReady(uid).then(() => { reads++; });
      const rejected = assert.rejects(pending, error => error.code === (mode === 'failure' ? 'team-read/security-unavailable' : 'team-read/security-timeout'));
      if (mode === 'failure') f.ready.reject(Error('PRIVATE_PROVIDER_DETAILS')); else f.timeout();
      await rejected; f.ready.resolve(); await tick(); assert.equal(reads, 0); assert.equal(f.timers.size, 0);
    }
  });
  await test('missing_wrong_and_replaced_session_fail_without_query', async () => {
    for (const value of [null, { uid: 'other_fixture' }]) {
      const f = readinessFixture(); f.auth.currentUser = value;
      await assert.rejects(f.api.requireTeamReadReady(uid), error => error.code === 'team-read/session-unconfirmed'); assert.equal(f.timers.size, 0);
    }
    const f = readinessFixture(), pending = f.api.requireTeamReadReady(uid);
    const rejected = assert.rejects(pending, error => error.code === 'team-read/session-unconfirmed');
    f.auth.currentUser = { uid }; f.ready.resolve(); await rejected;
  });
  await test('safe_codes_preserve_transience_without_private_messages', () => {
    const api = diagnosticFixture.readiness;
    for (const code of ['unavailable', 'deadline-exceeded', 'cancelled', 'resource-exhausted']) {
      assert.equal(api.getSafeTeamReadErrorCode({ code: 'firestore/' + code, message: 'PRIVATE' }), code);
      assert.equal(api.isTransientTeamReadError({ code: 'firestore/' + code }), true);
    }
    for (const code of ['permission-denied', 'unauthenticated', 'failed-precondition', 'unknown', 'PRIVATE_TOKEN']) assert.equal(api.isTransientTeamReadError({ code }), false);
    assert.equal(api.getSafeTeamReadErrorCode({ message: 'PRIVATE_TOKEN' }), 'unknown');
  });
  await test('strict_coach_and_parent_service_reads_wait_for_security_once', async () => {
    for (const coach of [true, false]) {
      const f = serviceFixture();
      const pending = coach ? f.api.getConfirmedCoachHomeTeams(uid) : f.api.getCurrentUserTeamMemberships({ requireComplete: true, throwOnError: true });
      await tick(); assert.equal(f.reads.length, 0); f.ready.resolve();
      const result = await pending; assert.equal((coach ? result.memberships : result).length, 1);
      assert.deepEqual(f.reads, [`users/${uid}`, `teams/${teamId}/members/${uid}`, `teams/${teamId}`]);
    }
  });
  await test('security_failure_never_becomes_false_empty_or_queries_firestore', async () => {
    for (const coach of [true, false]) {
      const f = serviceFixture();
      const pending = coach ? f.api.getConfirmedCoachHomeTeams(uid) : f.api.getCurrentUserTeamMemberships({ throwOnError: true });
      const rejected = assert.rejects(pending); f.ready.reject(Error('PRIVATE_SECURITY_REASON')); await rejected;
      assert.equal(f.reads.length, 0);
    }
  });
  await test('coach_service_retains_safe_native_error_code', async () => {
    const f = serviceFixture({ override: () => { throw Object.assign(Error('PRIVATE_CUSTOMER_DATA'), { code: 'firestore/permission-denied' }); } });
    f.ready.resolve(); let failure;
    try { await f.api.getConfirmedCoachHomeTeams(uid); } catch (error) { failure = error; }
    assert.deepEqual(f.api.getCoachHomeLookupDiagnostic(failure), { reason: 'read_unavailable', serverConfirmed: false, code: 'permission-denied' });
    assert.equal(JSON.stringify(failure).includes('PRIVATE_CUSTOMER_DATA'), false); assert.equal(f.reads.length, 1);
  });
  await test('initial_screen_stays_loading_until_security_is_ready', async () => {
    const ready = deferred(), f = screenFixture({ ready: () => ready.promise });
    let tree = f.ui.render(); await tick(); tree = f.ui.render();
    assert.equal(f.calls(), 0); assert.equal(has(tree, 'coach.home.teamLoadUnconfirmedTitle'), false); assertNoProtectedActions(tree);
    ready.resolve(); await tick(); tree = f.ui.render(); assert.ok(has(tree, 'Fictional Team')); assert.ok(button(tree, 'coach.home.resources')); f.ui.unmount();
  });
  await test('transient_refresh_retains_only_readonly_same_account_team_names', async () => {
    let count = 0; const wait = deferred(), f = screenFixture({ read: () => ++count === 1 ? Promise.resolve(confirmed()) : wait.promise });
    f.ui.render(); await tick(); assert.ok(button(f.ui.render(), 'coach.home.resources'));
    const pending = f.ui.loadTeams(); await tick(); let tree = f.ui.render();
    assert.ok(has(tree, 'Fictional Team')); assert.ok(has(tree, 'coach.home.lastConfirmedTeams')); assertNoProtectedActions(tree);
    wait.reject(Object.assign(Error('PRIVATE_TRANSPORT_DETAILS'), { code: 'firestore/unavailable' })); await pending;
    tree = f.ui.render(); assert.ok(has(tree, 'Fictional Team')); assertNoProtectedActions(tree); assert.equal(f.calls(), 2); f.ui.unmount();
  });
  await test('permission_or_unconfirmed_membership_clears_retained_snapshot', async () => {
    for (const failure of [Object.assign(Error('PRIVATE'), { code: 'permission-denied' }), new lookupError('membership_unconfirmed', true)]) {
      let count = 0; const f = screenFixture({ read: async () => { if (++count === 1) return confirmed(); throw failure; } });
      f.ui.render(); await tick(); assert.ok(has(f.ui.render(), 'Fictional Team'));
      await f.ui.loadTeams(); const tree = f.ui.render(); assert.equal(has(tree, 'Fictional Team'), false); assertNoProtectedActions(tree); f.ui.unmount();
    }
  });
  await test('account_change_never_displays_prior_account_snapshot_or_late_result', async () => {
    let calls = 0; const old = deferred(), next = deferred();
    const f = screenFixture({ read: async expected => expected === uid ? (++calls === 1 ? confirmed() : old.promise) : next.promise });
    f.ui.render(); await tick(); assert.ok(has(f.ui.render(), 'Fictional Team'));
    const stale = f.ui.loadTeams(); await tick(); f.changeUser({ uid: 'other_fixture' });
    let tree = f.ui.render(); assert.equal(has(tree, 'Fictional Team'), false); assertNoProtectedActions(tree);
    old.resolve(confirmed()); await stale; next.resolve(confirmed([])); await tick(); tree = f.ui.render();
    assert.equal(has(tree, 'Fictional Team'), false); assert.equal(button(tree, 'coach.home.resources'), undefined); f.ui.unmount(); assert.equal(f.ui.lateWrites(), 0);
  });
  return { status: 'PASS', groups: groups.length, cases: groups, networkRequests: 0, firestoreRequests: 0, deviceCommands: 0,
    builds: 0, deployments: 0, retries: 0 };
}
if (require.main === module) {
  const original = { warn: console.warn, info: console.info }, logs = [];
  console.warn = (...values) => logs.push(values); console.info = (...values) => logs.push(values);
  main().then(result => {
    const text = JSON.stringify(logs);
    for (const privateValue of ['PRIVATE_', uid, teamId]) assert.equal(text.includes(privateValue), false, 'diagnostic_must_not_expose_content_or_identity');
    console.log(JSON.stringify(result));
  }).catch(error => { console.error(JSON.stringify({ status: 'FAIL', completed: groups, message: error.message })); process.exitCode = 1; })
    .finally(() => { console.warn = original.warn; console.info = original.info; });
}
module.exports = { main };
