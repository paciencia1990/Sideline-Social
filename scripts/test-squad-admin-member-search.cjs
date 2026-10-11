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


const search = load('utils/squadAdminMemberSearch.ts');
const member = (index, name = 'Synthetic Member ' + String(index).padStart(3, '0')) => ({ userId: 'member-' + index, displayName: name, profileState: 'available', squadRole: 'member', isCurrentUser: false, photoURL: null });
const eligible = Array.from({ length: 360 }, (_value, index) => member(index));
eligible[359] = member(359, 'José Rivera'); eligible[358] = member(358, 'Rivera José');
assert.deepEqual(search.searchEligibleSquadMembers(eligible, 'JOSE  rivera').map((item) => item.userId), ['member-358', 'member-359']);
assert.equal(search.searchEligibleSquadMembers(eligible, 'member-359').length, 0, 'IDs are not name-search fields');
assert.equal(search.searchEligibleSquadMembers([{ ...member(0), email: 'private@example.test' }], 'private@example.test').length, 0);
assert.equal(search.searchEligibleSquadMembers(eligible, '  ').length, 360);
assert.equal(search.searchEligibleSquadMembers([member(0, null)], 'null').length, 0);
const admin = { ...member('admin', 'Current Admin'), squadRole: 'admin', isCurrentUser: true };
function card({ initial = null, get = null } = {}) {
  const invitations = [], confirmations = []; let uid = 'current-admin', view = initial ?? {
    squadId: 'large-squad', squadLabel: 'Synthetic Venue', callerIsAdmin: true, activeAdminCount: 2, isOrphaned: false,
    admins: [admin, { ...member('other-admin', 'Other Admin'), squadRole: 'admin' }], members: [admin, ...eligible], eligibleMembers: eligible,
    pendingInvitations: [], myInvitation: null, recoveryRequestStatus: null,
  };
  const t = (key, values) => key === 'squadAdmin.memberSearchCount' ? 'Showing ' + values.shown + ' of ' + values.total : key;
  const ui = harness((React) => {
    const create = React.createElement; React.createElement = (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : create(type, props, ...children);
    React.forwardRef = (component) => (props) => component(props, null); React.useImperativeHandle = () => {};
    return load('components/SquadAdministrationCard.tsx', {
      react: React, 'react-native': { ...Object.fromEntries(['ActivityIndicator', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map((name) => [name, name])),
        AccessibilityInfo: {}, AppState: { addEventListener: () => ({ remove() {} }) }, findNodeHandle: () => null, Keyboard: { dismiss() {} },
        StyleSheet: { create: (value) => value }, Alert: { alert: (...args) => confirmations.push(args) } },
      'lucide-react-native': { ShieldCheck: 'ShieldCheck', UserPlus: 'UserPlus' }, 'expo-router': { useFocusEffect: (callback) => React.useEffect(callback, [callback]) },
      'react-i18next': { useTranslation: () => ({ t }) }, '@/components/Card': { Card: 'Card' },
      '@/components/SquadSportsEditor': { SquadSportsEditor: 'SquadSportsEditor' },
      '@/components/SquadWeatherEditor': { SquadWeatherEditor: 'SquadWeatherEditor' },
      '@/constants/theme': { Colors: {}, Radius: {}, Spacing: {}, Typography: {} },
      '@/context/AuthContext': { useAuth: () => ({ user: { uid } }) },
      '@/utils/squadAdminMemberSearch': search,
      '@/services/squadService': { getSquadAdministration: get ?? (async () => view), getSquadAdminErrorReason: () => null,
        inviteSquadAdmin: async (...args) => { invitations.push(args); view = { ...view, eligibleMembers: view.eligibleMembers.filter((item) => item.userId !== args[1]) }; } },
    }).SquadAdministrationCard;
  });
  return { ui, invitations, confirmations, user: (next) => { uid = next; } };
}
const field = (tree) => find(tree, (node) => node.type === 'TextInput');
const shownMemberNames = (tree) => all(tree, (node) => node.type === 'Text' && typeof node.props.children[0] === 'string' && node.props.children[0].startsWith('Synthetic Member'));
(async () => {
  global.__DEV__ = false;
  const fixture = card(), props = { squadId: 'large-squad' };
  fixture.ui.render(props); await flush(); let tree = fixture.ui.render(props);
  assert.equal(field(tree), undefined, 'Search is collapsed until Choose Admin');
  button(tree, 'squadAdmin.chooseNewAdmin').props.onPress(); tree = fixture.ui.render(props);
  assert.ok(field(tree)); assert.equal(shownMemberNames(tree).length, 20); assert.ok(hasText(tree, 'Showing 20 of 360'));
  button(tree, 'squadAdmin.showMoreMembers').props.onPress(); tree = fixture.ui.render(props);
  assert.equal(shownMemberNames(tree).length, 40);
  field(tree).props.onChangeText('jose rivera'); tree = fixture.ui.render(props);
  assert.equal(shownMemberNames(tree).length, 0); assert.ok(hasText(tree, 'José Rivera')); assert.ok(hasText(tree, 'Showing 2 of 2'));
  assert.equal(fixture.invitations.length, 0, 'Typing/searching issues no write');
  const target = all(tree, (node) => node.type === 'TouchableOpacity' && node.props.accessibilityLabel === 'squadAdmin.inviteAsAdmin')[1];
  assert.ok(target); target.props.onPress(); assert.equal(fixture.invitations.length, 0, 'Confirmation remains required');
  const confirmation = fixture.confirmations.at(-1); confirmation[2][1].onPress(); confirmation[2][1].onPress(); await flush(); await flush();
  assert.deepEqual(fixture.invitations, [['large-squad', 'member-359']]);
  tree = fixture.ui.render(props); assert.ok(hasText(tree, 'Showing 1 of 1')); assert.equal(field(tree).props.value, 'jose rivera', 'Refresh preserves active search and removes newly invited target');
  field(tree).props.onChangeText('no-such-name'); tree = fixture.ui.render(props); assert.ok(hasText(tree, 'squadAdmin.noMatchingMembers'));
  button(tree, 'squadAdmin.clearMemberSearch').props.onPress(); tree = fixture.ui.render(props);
  assert.equal(field(tree).props.value, ''); assert.equal(shownMemberNames(tree).length, 20);
  button(tree, 'squadAdmin.chooseNewAdmin').props.onPress(); tree = fixture.ui.render(props); assert.equal(field(tree), undefined);
  const staleConfirmation = card(); staleConfirmation.ui.render(props); await flush(); tree = staleConfirmation.ui.render(props);
  button(tree, 'squadAdmin.chooseNewAdmin').props.onPress(); tree = staleConfirmation.ui.render(props);
  button(tree, 'squadAdmin.inviteAsAdmin').props.onPress();
  const oldConfirmation = staleConfirmation.confirmations.at(-1)[2][1];
  staleConfirmation.user('different-account'); staleConfirmation.ui.render(props); oldConfirmation.onPress(); await flush();
  assert.equal(staleConfirmation.invitations.length, 0, 'An old confirmation cannot send an invitation under another account');
  const ordinary = card({ initial: { squadId: 'large-squad', callerIsAdmin: false, admins: [admin], members: [admin], eligibleMembers: [], pendingInvitations: [], myInvitation: null, recoveryRequestStatus: null, isOrphaned: false } });
  ordinary.ui.render(props); await flush(); tree = ordinary.ui.render(props);
  assert.equal(button(tree, 'squadAdmin.chooseNewAdmin'), undefined); assert.equal(field(tree), undefined);
  const late = deferred(), departing = card({ get: () => late.promise }); departing.ui.render(props); departing.ui.unmount(); late.resolve({ squadId: 'large-squad', eligibleMembers: eligible }); await flush();
  assert.equal(departing.ui.lateWrites(), 0);
  const old = deferred(), fresh = deferred(); let reads = 0;
  const switched = card({ get: () => ++reads === 1 ? old.promise : fresh.promise }); switched.ui.render(props); switched.user('another-account'); switched.ui.render(props);
  old.resolve({ squadId: 'large-squad', admins: [admin], members: eligible, eligibleMembers: eligible, callerIsAdmin: true, pendingInvitations: [] }); await flush();
  tree = switched.ui.render(props);
  assert.ok(find(tree, (node) => node.type === 'ActivityIndicator'));
  assert.equal(button(tree, 'squadAdmin.chooseNewAdmin'), undefined, 'Old-account authorization and member results never appear for the new account');
  fresh.resolve({ squadId: 'large-squad', callerIsAdmin: false, admins: [admin], members: [admin], eligibleMembers: [], pendingInvitations: [], isOrphaned: false }); await flush();
  tree = switched.ui.render(props); assert.equal(field(tree), undefined); assert.equal(button(tree, 'squadAdmin.chooseNewAdmin'), undefined);
  const localization = ts.createSourceFile('i18n/index.ts', fs.readFileSync(path.join(root, 'i18n/index.ts'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const resources = localization.statements.flatMap((statement) => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []).find((entry) => entry.name.text === 'resources').initializer;
  const property = (object, name) => object.properties.find((entry) => entry.name?.text === name).initializer;
  const adminCopy = (language) => property(property(property(resources, language), 'translation'), 'squadAdmin');
  for (const key of ['memberSearchLabel', 'memberSearchPlaceholder', 'memberSearchHelp', 'clearMemberSearch', 'memberSearchCount', 'noMatchingMembers', 'showMoreMembers']) {
    const english = property(adminCopy('en'), key).text, spanish = property(adminCopy('es'), key).text;
    assert.ok(english?.trim() && spanish?.trim());
    assert.deepEqual((english.match(/\{\{[^}]+\}\}/g) ?? []).sort(), (spanish.match(/\{\{[^}]+\}\}/g) ?? []).sort());
  }
  console.log('Squad admin member search passed: 360-member filtering, accents/case/multiple words, 20-row rendering, Show more/Clear, invite confirmation, privacy and departure guards.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
