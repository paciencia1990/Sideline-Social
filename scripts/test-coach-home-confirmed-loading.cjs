'use strict';
// Focused offline checks: real changed modules, injected SDKs, fictional data only.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'docs/coach-home-confirmed-loading-local-20261023');
global.__DEV__ = false;
function load(file, modules = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(Object.hasOwn(modules, name), `Unmocked dependency: ${name}`);
    return modules[name];
  }, module, module.exports);
  return module.exports;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const uid = 'fictional-coach', teamId = 'fictional-team';
const snap = (id, data, metadata = { fromCache: false, hasPendingWrites: false }) => ({ id, exists: () => data !== null, data: () => data, metadata });
const profile = { coachTeamIds: [teamId], parentTeamIds: [], archivedCoachTeamIds: ['fictional-archive'] };
const member = { role: 'coach', roles: { coach: true, staff: false, parent: false }, status: 'active' };
const team = { name: 'Fictional Team', createdBy: uid, status: 'active', coachIds: [uid] };
const memberRow = { id: uid, userId: uid, teamId, role: 'coach', roles: member.roles, status: 'active', team: { ...team, id: teamId } };
const access = load('utils/coachResourcesAccess.ts');
function serviceFixture({ user = { uid }, data = profile, metadata, override } = {}) {
  const auth = { currentUser: user }, serverReads = [], legacyReads = [];
  const read = name => {
    if (override) { const value = override(name); if (value !== undefined) return value; }
    if (name === `users/${uid}`) return snap(uid, data, metadata);
    if (name === `teams/${teamId}/members/${uid}`) return snap(uid, member);
    if (name === `teams/${teamId}`) return snap(teamId, team);
    throw Error('unexpected_fictional_document');
  };
  const api = load('services/teamService.ts', {
    'firebase/firestore': { doc: (_db, ...parts) => parts.join('/'),
      getDoc: async name => { legacyReads.push(name); return read(name); },
      getDocFromServer: async name => { serverReads.push(name); return read(name); } },
    'firebase/functions': {}, '@/config/firebase': { auth, db: {}, functions: {} },
    '@/constants/teamHistoryPagination': { TEAM_HISTORY_PAGE_SIZES: {} },
    '@/utils/friendPrivacy': {}, '@/utils/teamLifecycleRequest': {},
  });
  return { auth, api, serverReads, legacyReads };
}
const resources = list => access.resolveCoachResourcesAccess({ activeMode: 'coach', authenticatedUserId: uid, loadState: 'loaded', memberships: list });

async function authoritativeMemberships() {
  const f = serviceFixture();
  const result = await f.api.getConfirmedCoachHomeTeams(uid);
  assert.equal(result.outcome, 'verified_memberships'); assert.equal(result.memberships.length, 1);
  assert.equal(result.archivedCount, 1); assert.equal(resources(result.memberships), 'allowed');
  assert.deepEqual(f.serverReads, [`users/${uid}`, `teams/${teamId}/members/${uid}`, `teams/${teamId}`]);
  assert.equal(f.legacyReads.length, 0, 'Strict home must not use the cache-permissive SDK read');
}
async function confirmedNewAndLegacyEmpty() {
  for (const data of [{ coachTeamIds: [], parentTeamIds: [] }, { activeMode: 'coach' }, { coachTeamIds: null, parentTeamIds: null }]) {
    const f = serviceFixture({ data }); const result = await f.api.getConfirmedCoachHomeTeams(uid);
    assert.equal(result.outcome, 'verified_empty'); assert.equal(result.memberships.length, 0);
    assert.equal(result.archivedCount, 0); assert.equal(f.serverReads.length, 1);
  }
}
async function unconfirmedProfiles() {
  for (const metadata of [{ fromCache: true, hasPendingWrites: false }, { fromCache: false, hasPendingWrites: true }, { fromCache: true, hasPendingWrites: true }]) {
    const f = serviceFixture({ data: { activeMode: 'coach' }, metadata });
    await assert.rejects(f.api.getConfirmedCoachHomeTeams(uid), error => error.reason === 'profile_unconfirmed' && !error.serverConfirmed);
    assert.equal(f.serverReads.length, 1, 'No fallback/retry or dependent membership read');
  }
  const f = serviceFixture({ data: null });
  await assert.rejects(f.api.getConfirmedCoachHomeTeams(uid), error => error.reason === 'profile_unconfirmed' && error.serverConfirmed);
  assert.equal(f.serverReads.length, 1);
}
async function malformedIndexesAndArchiveIsolation() {
  for (const change of [{ coachTeamIds: 'bad-index' }, { coachTeamIds: [false] }, { parentTeamIds: [''] }, { activeTeamId: 42 }]) {
    const f = serviceFixture({ data: { ...profile, ...change } });
    await assert.rejects(f.api.getConfirmedCoachHomeTeams(uid), error => error.reason === 'index_unconfirmed');
    assert.equal(f.serverReads.length, 1);
  }
  const f = serviceFixture({ data: { ...profile, archivedCoachTeamIds: 'unconfirmed' } });
  const result = await f.api.getConfirmedCoachHomeTeams(uid);
  assert.equal(result.memberships.length, 1); assert.equal(result.archivedCount, null); assert.equal(resources(result.memberships), 'allowed');
}
async function missingAndInactiveMemberships() {
  const cases = [
    { at: `teams/${teamId}/members/${uid}`, value: null, reason: 'membership_unconfirmed', reads: 2 },
    { at: `teams/${teamId}`, value: null, reason: 'team_unconfirmed', reads: 3 },
  ];
  for (const item of cases) {
    const f = serviceFixture({ override: name => name === item.at ? snap(name.split('/').pop(), item.value) : undefined });
    await assert.rejects(f.api.getConfirmedCoachHomeTeams(uid), error => error.reason === item.reason);
    assert.equal(f.serverReads.length, item.reads);
  }
  for (const status of ['removed', 'inactive', 'pending']) {
    const f = serviceFixture({ override: name => name.includes('/members/') ? snap(uid, { ...member, status }) : undefined });
    const result = await f.api.getConfirmedCoachHomeTeams(uid);
    assert.equal(result.memberships.length, 0); assert.equal(resources(result.memberships), 'denied');
    assert.equal(f.serverReads.length, 2, 'Inactive membership must stop before a protected team read');
  }
  for (const at of [`teams/${teamId}/members/${uid}`, `teams/${teamId}`]) {
    const f = serviceFixture({ override: name => name === at ? snap(name.split('/').pop(), name.includes('/members/') ? member : team, { fromCache: true, hasPendingWrites: false }) : undefined });
    await assert.rejects(f.api.getConfirmedCoachHomeTeams(uid));
  }
}
async function canonicalPermissions() {
  for (const [m, t] of [
    [{ role: 'parent', roles: { parent: true }, status: 'active' }, team],
    [{ role: 'assistantCoach', roles: { staff: true }, status: 'active' }, team],
    [member, { ...team, status: 'archived' }],
    [member, { ...team, createdBy: 'fictional-other-owner' }],
  ]) {
    const f = serviceFixture({ override: name => name.includes('/members/') ? snap(uid, m) : name === `teams/${teamId}` ? snap(teamId, t) : undefined });
    assert.equal(resources((await f.api.getConfirmedCoachHomeTeams(uid)).memberships), 'denied');
  }
}
async function identityAndSharing() {
  for (const user of [null, { uid: 'fictional-other' }]) {
    const f = serviceFixture({ user });
    await assert.rejects(f.api.getConfirmedCoachHomeTeams(uid), error => error.reason === 'session_unconfirmed');
    assert.equal(f.serverReads.length, 0);
  }
  const wait = deferred(); const f = serviceFixture({ override: name => name === `users/${uid}` ? wait.promise : undefined });
  const first = f.api.getConfirmedCoachHomeTeams(uid), shared = f.api.getConfirmedCoachHomeTeams(uid);
  assert.equal(first, shared, 'Overlapping reads for the exact session share one request');
  const rejected = assert.rejects(first, error => error.reason === 'session_unconfirmed');
  f.auth.currentUser = null; wait.resolve(snap(uid, profile)); await rejected;
  assert.equal(f.serverReads.length, 1, 'Changed account stops before dependent reads');
  const finalTeam = deferred(); const g = serviceFixture({ override: name => name === `teams/${teamId}` ? finalTeam.promise : undefined });
  const pending = g.api.getConfirmedCoachHomeTeams(uid); const changed = assert.rejects(pending, error => error.reason === 'session_unconfirmed');
  await tick(); g.auth.currentUser = { uid: 'fictional-other' }; finalTeam.resolve(snap(teamId, team)); await changed;
  assert.equal(g.serverReads.length, 3);
}
async function deniedReadsAndSafeDiagnostics() {
  const f = serviceFixture({ override: () => { throw Object.assign(Error('PRIVATE_TOKEN_AND_TEAM_CONTENT'), { code: 'permission-denied' }); } });
  let failure;
  try { await f.api.getConfirmedCoachHomeTeams(uid); } catch (error) { failure = error; }
  assert.equal(failure.reason, 'read_unavailable'); assert.equal(f.serverReads.length, 1);
  assert.deepEqual(f.api.getCoachHomeLookupDiagnostic(failure), { reason: 'read_unavailable', serverConfirmed: false });
  assert.equal(JSON.stringify(failure).includes('PRIVATE'), false);
  assert.deepEqual(f.api.getCoachHomeLookupDiagnostic(Error('PRIVATE')), { reason: 'read_unavailable', serverConfirmed: false });
  const legacy = serviceFixture(); await legacy.api.getCurrentUserTeamMemberships({ requireComplete: true, throwOnError: true });
  assert.equal(legacy.serverReads.length, 0); assert.equal(legacy.legacyReads.length, 3, 'Other lookup callers retain their existing API/read behavior');
}

function harness(factory) {
  const slots = []; let cursor = 0, effects = [], mounted = true, lateWrites = 0;
  const changed = (old, deps) => !old || !deps || old.deps?.length !== deps.length || deps.some((value, i) => value !== old.deps[i]);
  const React = {
    Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, value => { if (!mounted) { lateWrites++; return; } slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useMemo(make, deps) { const i = cursor++; if (changed(slots[i], deps)) slots[i] = { deps, value: make() }; return slots[i].value; },
    useCallback(fn, deps) { return React.useMemo(() => fn, deps); },
    useEffect(effect, deps) { const i = cursor++, old = slots[i]; if (changed(old, deps)) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; }); },
  };
  const component = factory(React);
  return { render() { cursor = 0; effects = []; const tree = component(); effects.forEach(run => run()); return tree; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); mounted = false; }, lateWrites: () => lateWrites };
}
function nodes(tree, match) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(x => nodes(x, match)); return [...(match(tree) ? [tree] : []), ...nodes(tree.props?.children, match)]; }
const textPresent = (tree, text) => nodes(tree, n => n.type === 'Text' && n.props.children.includes(text)).length > 0;
const button = (tree, text) => nodes(tree, n => n.type === 'TouchableOpacity' && textPresent(n, text))[0];
const t = key => key;
const recovery = load('utils/coachHomeRecovery.ts');
const modeSwitch = load('utils/modeSwitch.ts');
const teamCards = load('utils/coachHomeTeamCards.ts');
const uiLookupTypes = serviceFixture().api;
function screen({ read, archivedRead = async () => ({ memberships: [], totalCount: 0, hasMore: false, nextOffset: 0 }) }) {
  let user = { uid }, calls = 0; const auth = { currentUser: { uid } }, logs = [];
  const diagnostic = uiLookupTypes.getCoachHomeLookupDiagnostic;
  const ui = harness(React => load('app/coach/index.tsx', {
    react: React, 'react-native': { ...Object.fromEntries(['ActivityIndicator','ScrollView','Text','TouchableOpacity','View'].map(k => [k,k])), StyleSheet: { create: x => x }, Alert: { alert() {} } },
    'expo-router': { router: { push() {} }, useFocusEffect: cb => React.useEffect(cb, [cb]) },
    'lucide-react-native': Object.fromEntries(['Archive','CalendarDays','ChevronDown','ChevronUp','MessageCircle','MessagesSquare','RotateCcw','Shield','Users'].map(k => [k,k])),
    'react-i18next': { useTranslation: () => ({ t }) }, '@/components/Card': { Card: 'Card' }, '@/components/ScreenWrapper': { ScreenWrapper: 'ScreenWrapper' },
    '@/components/NestedBackButton': { replaceAfterOptionalDismiss() {} }, '@/constants/routes': { PARENT_PROFILE_ROUTE: '/profile' },
    '@/constants/teamHistoryPagination': { TEAM_HISTORY_PAGE_SIZES: { archivedTeams: 10 } },
    '@/constants/theme': { Colors: {}, Radius: {}, Shadow: {}, Spacing: {}, TeamCodeTypography: {}, Typography: {} },
    '@/context/AppContext': { useApp: () => ({ activeMode: 'coach', modeHydrated: true, setActiveMode() {} }) },
    '@/context/AuthContext': { useAuth: () => ({ user }) }, '@/config/firebase': { auth },
    '@/services/teamService': { getConfirmedCoachHomeTeams: expected => { calls++; assert.equal(expected, user.uid); return read(expected); }, getCoachHomeLookupDiagnostic: diagnostic,
      getArchivedCoachTeamMembershipsPage: archivedRead, hasCoachAccess: m => m.roles.coach || m.roles.staff,
      hasTeamRole: (m, role) => m.roles[role] === true, isTeamActive: v => v?.status === 'active', canManageTeamRoles: () => true, switchActiveMode: async () => {} },
    '@/services/teamPrivateMessageService': { getTeamPrivateMessageInboxPage: async () => ({ conversations: [] }) },
    '@/utils/coachCommunicationCore': { shouldShowPrivateMessagesCard: () => false }, '@/utils/coachHomeTeamCards': teamCards,
    '@/utils/coachResourcesAccess': access, '@/utils/coachHomeRecovery': recovery, '@/utils/modeSwitch': modeSwitch,
  }).default);
  return { ui, auth, logs, calls: () => calls, setUser: value => { user = value; auth.currentUser = { uid: value.uid }; } };
}
const confirmed = (memberships = [memberRow], archivedCount = 0) => ({ memberships, archivedCount, outcome: memberships.length ? 'verified_memberships' : 'verified_empty' });
async function screenConfirmedAndEmpty() {
  for (const empty of [false, true]) {
    const s = screen({ read: async () => confirmed(empty ? [] : [memberRow]) });
    let tree = s.ui.render(); assert.equal(button(tree, 'coach.team.createTeam'), undefined, 'Unconfirmed initial state must not show team creation');
    await tick(); tree = s.ui.render();
    assert.equal(textPresent(tree, 'Fictional Team'), !empty); assert.equal(Boolean(button(tree, 'coach.home.resources')), !empty);
    assert.equal(Boolean(button(tree, 'coach.team.createTeam')), empty); assert.equal(textPresent(tree, 'startMode.coachWelcome'), empty);
    await tick(); assert.equal(s.calls(), 1, 'No automatic repeated lookup'); s.ui.unmount();
  }
}
async function screenUnconfirmedAndArchives() {
  const api = uiLookupTypes;
  for (const reason of ['profile_unconfirmed','membership_unconfirmed','session_unconfirmed','read_unavailable']) {
    const s = screen({ read: async () => { throw new api.CoachHomeLookupError(reason); } });
    s.ui.render(); await tick(); const tree = s.ui.render();
    assert.ok(textPresent(tree, 'coach.home.teamLoadUnconfirmedTitle'));
    assert.equal(button(tree, 'coach.team.createTeam'), undefined); assert.equal(button(tree, 'coach.home.resources'), undefined);
    assert.equal(textPresent(tree, 'startMode.coachWelcome'), false); assert.equal(textPresent(tree, 'coach.home.coachTeams'), false);
    assert.ok(button(tree, 'mode.switchToParent')); assert.equal(s.calls(), 1); s.ui.unmount();
  }
  const s = screen({ read: async () => confirmed([memberRow], null) });
  s.ui.render(); await tick(); const tree = s.ui.render();
  assert.ok(textPresent(tree, 'coach.home.archiveUnavailable')); assert.ok(textPresent(tree, 'Fictional Team')); assert.ok(button(tree, 'coach.home.resources')); s.ui.unmount();
}
async function screenIdentityAndLateResponses() {
  const old = deferred(); let reads = 0;
  const s = screen({ read: () => ++reads === 1 ? old.promise : Promise.resolve(confirmed([])) });
  s.ui.render(); await tick(); s.setUser({ uid: 'fictional-other' });
  let tree = s.ui.render(); assert.equal(textPresent(tree, 'Fictional Team'), false); assert.equal(button(tree, 'coach.team.createTeam'), undefined);
  await tick(); old.resolve(confirmed([memberRow], 2)); await tick(); tree = s.ui.render();
  assert.equal(textPresent(tree, 'Fictional Team'), false); assert.equal(button(tree, 'coach.home.resources'), undefined);
  s.ui.unmount(); assert.equal(s.ui.lateWrites(), 0);
  const wait = deferred(); const leaving = screen({ read: () => wait.promise });
  leaving.ui.render(); leaving.ui.unmount(); wait.resolve(confirmed()); await tick(); assert.equal(leaving.ui.lateWrites(), 0);
  const archive = deferred(); let latest = 0;
  const archived = screen({ read: async () => ++latest === 1 ? confirmed([memberRow], 1) : confirmed([]), archivedRead: () => archive.promise });
  archived.ui.render(); await tick(); tree = archived.ui.render();
  const expand = nodes(tree, n => n.type === 'TouchableOpacity' && n.props.accessibilityState?.expanded === false)[0];
  assert.ok(expand); expand.props.onPress(); archived.ui.render();
  archived.setUser({ uid: 'fictional-other' }); archived.ui.render(); await tick();
  archive.resolve({ memberships: [{ ...memberRow, team: { ...memberRow.team, name: 'OLD PRIVATE ARCHIVE', status: 'archived' } }], totalCount: 1, hasMore: false, nextOffset: 1 });
  await tick(); tree = archived.ui.render(); assert.equal(textPresent(tree, 'OLD PRIVATE ARCHIVE'), false); archived.ui.unmount(); assert.equal(archived.ui.lateWrites(), 0);
}
async function localizedMessagesAndLogPrivacy() {
  const translations = load('i18n/index.ts', { i18next: { use() { return this; }, init(options) { this.options = options; return Promise.resolve(); } },
    'react-i18next': { initReactI18next: {} }, '@react-native-async-storage/async-storage': { getItem: async () => null, setItem: async () => {} },
    '@/content/weeklyChallenges': { weeklyChallengeTranslations: { en: {}, es: {} } },
    '@/content/coachAiBillingTranslations': { coachAiBillingTranslations: { en: {}, es: {} } } });
  const resources = translations.default.options.resources;
  for (const key of ['teamLoadUnconfirmedTitle','teamLoadUnconfirmed','sessionUnconfirmed']) {
    const en = resources.en.translation.coach.home[key], es = resources.es.translation.coach.home[key];
    assert.equal(typeof en, 'string'); assert.equal(typeof es, 'string'); assert.ok(en.length > 10 && es.length > 10); assert.notEqual(en, es);
  }
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'focused-attempt.json'), JSON.stringify({ at: new Date().toISOString(), offline: true, retries: 0 }), { flag: 'wx' });
  const result = { status: 'STARTED', groups: [], networkCalls: 0, deviceCommands: 0, builds: 0, retries: 0 };
  const warn = console.warn, info = console.info, logs = [];
  console.warn = (...values) => logs.push(values); console.info = (...values) => logs.push(values);
  try {
    const groups = { authoritativeMemberships, confirmedNewAndLegacyEmpty, unconfirmedProfiles, malformedIndexesAndArchiveIsolation,
      missingAndInactiveMemberships, canonicalPermissions, identityAndSharing, deniedReadsAndSafeDiagnostics,
      screenConfirmedAndEmpty, screenUnconfirmedAndArchives, screenIdentityAndLateResponses, localizedMessagesAndLogPrivacy };
    for (const [name, run] of Object.entries(groups)) {
      await run(); result.groups.push({ name, status: 'PASS' }); process.stdout.write('PASS ' + name + '\n');
    }
    const serialized = JSON.stringify(logs);
    for (const privateText of ['PRIVATE_TOKEN','fictional-coach','fictional-team','OLD PRIVATE ARCHIVE']) assert.equal(serialized.includes(privateText), false, 'Diagnostic logs must not contain identities/content');
    result.safeLogFieldsOnly = logs.every(([, data]) => data && Object.keys(data).every(k => ['reason','serverConfirmed','sessionCurrent'].includes(k)));
    assert.equal(result.safeLogFieldsOnly, true); result.status = 'FOCUSED_OFFLINE_CHECKS_PASSED';
  } catch (error) { result.status = 'STOPPED_NO_RETRY'; result.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    console.warn = warn; console.info = info;
    result.sourceHashes = Object.fromEntries(['services/teamService.ts','app/coach/index.tsx','i18n/index.ts','utils/coachHomeRecovery.ts','utils/coachResourcesAccess.ts'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
    fs.writeFileSync(path.join(out, 'focused-result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    process.stdout.write(JSON.stringify({ status: result.status, groupsPassed: result.groups.length, error: result.error }) + '\n');
  }
})();
