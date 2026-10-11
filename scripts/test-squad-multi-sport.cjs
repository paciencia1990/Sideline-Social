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

const core = require('../functions/lib/squadSportsCore');
const sports = load('constants/sports.ts');
const t = (key) => key;
const native = { ...Object.fromEntries(['KeyboardAvoidingView', 'Modal', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map((name) => [name, name])), Platform: { OS: 'ios' }, StyleSheet: { create: (value) => value }, Alert: { alert() {} } };
const theme = { Colors: {}, Radius: {}, Shadow: {}, Spacing: {}, Typography: {} };
const primary = (tree) => find(tree, (node) => node.type === 'PrimaryButton');
function editor({ update = async () => ({ squadId: 'squad-a', sportIds: ['baseball', 'swimming'], sportId: 'baseball', sportDisplayName: 'Baseball', sportsRevision: 1 }) } = {}) {
  let uid = 'manager-a'; const writes = [], saved = []; let reloads = 0;
  const ui = harness((React) => load('components/SquadSportsEditor.tsx', {
    react: React, 'react-native': native, 'react-i18next': { useTranslation: () => ({ t }) },
    '@/components/PrimaryButton': { PrimaryButton: 'PrimaryButton' }, '@/components/SquadSportPicker': { SquadSportPicker: 'SquadSportPicker' },
    '@/constants/sports': sports, '@/constants/theme': theme,
    '@/context/AuthContext': { useAuth: () => ({ user: { uid } }) },
    '@/services/squadService': { updateSquadSports: (...args) => { writes.push(args); return update(...args); } },
  }).SquadSportsEditor);
  const props = { squadId: 'squad-a', sportIds: ['baseball'], sportsRevision: 0, onSaved: (value) => saved.push(value), onReload: () => reloads++ };
  return { ui, props, writes, saved, reloads: () => reloads, user: (value) => { uid = value; } };
}
(async () => {
  global.__DEV__ = false;
  assert.deepEqual(core.validateSquadSports(['swimming', 'baseball', 'swimming']), ['baseball', 'swimming']);
  for (const value of [[], ['unsupported'], 'baseball', null]) assert.equal(core.validateSquadSports(value), null);
  assert.deepEqual(core.readSquadSports({ sport: 'Track & Field' }), ['track-field']);
  assert.equal(core.squadSportsFields(['baseball', 'swimming'], 'swimming').sportId, 'swimming');
  assert.equal(core.squadSportsFields(['baseball'], 'swimming').sportId, 'baseball');
  assert.deepEqual(sports.readSquadSportIds(undefined, 'Softball'), ['softball']);
  let uid = 'service-manager', requestBody, callName;
  let response = { squadId: 'service-squad', sportIds: ['baseball', 'swimming'], sportId: 'baseball', sportDisplayName: 'Baseball', sportsRevision: 1 };
  const service = load('services/squadService.ts', {
    '@react-native-async-storage/async-storage': {}, 'expo-location': {},
    'firebase/functions': { httpsCallable: (_functions, name) => { callName = name; return async (body) => { requestBody = body; return { data: response }; }; } },
    'firebase/firestore': { GeoPoint: class {}, Timestamp: class {} },
    '@/config/firebase': { auth: { get currentUser() { return { uid }; } }, firebaseAppCheckReady: Promise.resolve(), functions: {}, db: {} },
    '@/constants/sports': sports,
  });
  const normalized = service.normalizeSquadDocument('legacy-stable-id', { name: 'YMCA', sport: 'Baseball' });
  assert.deepEqual(normalized.sportIds, ['baseball']); assert.equal(normalized.squadId, 'legacy-stable-id');
  await service.updateSquadSports('service-squad', ['swimming', 'baseball'], 0);
  assert.equal(callName, 'updateSquadSports'); assert.deepEqual(requestBody, { squadId: 'service-squad', sportIds: ['swimming', 'baseball'], expectedRevision: 0 });
  response = { ...response, sportIds: ['tennis'] };
  await assert.rejects(service.updateSquadSports('service-squad', ['baseball'], 0), /Unconfirmed sports update/);
  response = { squadId: 'new-community', status: 'created', sportIds: ['baseball', 'swimming'] };
  await service.findOrCreateSquad({ venueName: 'YMCA', sportIds: ['baseball', 'swimming'], venueLocation: { latitude: 28, longitude: -81 } });
  assert.equal(callName, 'findOrCreateVenueSportSquad'); assert.deepEqual(requestBody.sportIds, ['baseball', 'swimming']);
  assert.equal(Object.hasOwn(requestBody, 'sportId'), false, 'Old backend must reject the new request rather than silently ignoring extra sports');
  const pickerChanges = [];
  const picker = load('components/SquadSportPicker.tsx', { react: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) }, 'react-native': native, 'lucide-react-native': { Check: 'Check' }, 'react-i18next': { useTranslation: () => ({ t }) }, '@/constants/sports': sports, '@/constants/theme': theme }).SquadSportPicker;
  let tree = picker({ selected: ['baseball'], onChange: (value) => pickerChanges.push(value) });
  const swimming = find(tree, (node) => node.props?.accessibilityLabel === 'sports.labels.swimming');
  assert.equal(swimming.props.accessibilityRole, 'checkbox'); swimming.props.onPress();
  assert.deepEqual(pickerChanges[0], ['baseball', 'swimming']);
  tree = picker({ selected: pickerChanges[0], onChange: (value) => pickerChanges.push(value) });
  find(tree, (node) => node.props?.accessibilityLabel === 'sports.labels.baseball').props.onPress();
  assert.deepEqual(pickerChanges[1], ['swimming']);
  tree = picker({ selected: ['baseball'], disabled: true, onChange() {} });
  assert.ok(all(tree, (node) => node.type === 'TouchableOpacity').every((node) => node.props.disabled && node.props.accessibilityState.disabled));
  const identity = load('components/SquadIdentity.tsx', { react: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) }, 'react-native': native, 'react-i18next': { useTranslation: () => ({ t }) }, '@/constants/sports': sports, '@/constants/theme': theme }).SquadIdentity;
  assert.ok(hasText(identity({ venueName: 'YMCA', sportId: 'baseball', sportIds: ['baseball', 'swimming'], sportDisplayName: 'Baseball' }), 'sports.labels.baseball · sports.labels.swimming'));
  const pending = deferred(); const success = editor({ update: () => pending.promise });
  tree = success.ui.render(success.props); button(tree, 'squadSports.edit').props.onPress(); tree = success.ui.render(success.props);
  find(tree, (node) => node.type === 'SquadSportPicker').props.onChange(['baseball', 'swimming']);
  tree = success.ui.render(success.props); primary(tree).props.onPress(); primary(tree).props.onPress();
  assert.equal(success.writes.length, 1, 'Repeated save taps share one write');
  assert.deepEqual(success.writes[0], ['squad-a', ['baseball', 'swimming'], 0]);
  pending.resolve({ squadId: 'squad-a', sportIds: ['baseball', 'swimming'], sportId: 'baseball', sportDisplayName: 'Baseball', sportsRevision: 1 });
  await flush(); tree = success.ui.render({ ...success.props, sportIds: ['baseball', 'swimming'], sportsRevision: 1 });
  assert.equal(success.saved.length, 1); assert.ok(hasText(tree, 'squadSports.saved'));
  const failure = editor({ update: async () => { throw Object.assign(new Error('private'), { code: 'functions/aborted' }); } });
  tree = failure.ui.render(failure.props); button(tree, 'squadSports.edit').props.onPress(); tree = failure.ui.render(failure.props);
  find(tree, (node) => node.type === 'SquadSportPicker').props.onChange(['swimming']); tree = failure.ui.render(failure.props);
  primary(tree).props.onPress(); await flush(); tree = failure.ui.render(failure.props);
  assert.ok(hasText(tree, 'squadSports.conflict')); assert.deepEqual(find(tree, (node) => node.type === 'SquadSportPicker').props.selected, ['swimming']);
  button(tree, 'squadSports.reload').props.onPress(); assert.equal(failure.reloads(), 1);
  const stale = deferred(), switched = editor({ update: () => stale.promise });
  tree = switched.ui.render(switched.props); button(tree, 'squadSports.edit').props.onPress(); tree = switched.ui.render(switched.props);
  primary(tree).props.onPress(); switched.user('new-account'); switched.ui.render(switched.props); stale.resolve({ squadId: 'squad-a', sportIds: ['baseball'], sportsRevision: 1 });
  await flush(); assert.equal(switched.saved.length, 0, 'Old-account results never update the new account');
  const gone = deferred(), unmounted = editor({ update: () => gone.promise });
  tree = unmounted.ui.render(unmounted.props); button(tree, 'squadSports.edit').props.onPress(); tree = unmounted.ui.render(unmounted.props);
  primary(tree).props.onPress(); unmounted.ui.unmount(); gone.resolve({ squadId: 'squad-a', sportIds: ['baseball'], sportsRevision: 1 }); await flush();
  assert.equal(unmounted.saved.length, 0); assert.equal(unmounted.ui.lateWrites(), 0);
  let createCalls = 0, joinCalls = 0; const creation = deferred(), alerts = [];
  const createUi = harness((React) => load('components/CreateSquadSheet.tsx', {
    react: React, 'react-native': { ...native, Alert: { alert: (...args) => alerts.push(args) } }, 'lucide-react-native': { X: 'X' },
    'react-i18next': { useTranslation: () => ({ t }) }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    '@/components/PrimaryButton': { PrimaryButton: 'PrimaryButton' }, '@/components/SquadSportPicker': { SquadSportPicker: 'SquadSportPicker' },
    '@/context/AuthContext': { useAuth: () => ({ user: { uid: 'creator' } }) },
    '@/context/SquadContext': { useSquad: () => ({ createSquad: (input) => { createCalls++; assert.deepEqual(input.sportIds, ['baseball', 'swimming']); return creation.promise; }, joinSquad: async () => { joinCalls++; } }) },
    '@/constants/sports': sports, '@/constants/theme': theme,
  }).CreateSquadSheet);
  const props = { isOpen: true, onClose() {}, onSquadCreated() {}, userCoords: { latitude: 28, longitude: -81 } };
  tree = createUi.render(props); find(tree, (node) => node.type === 'TextInput').props.onChangeText('YMCA'); find(tree, (node) => node.type === 'SquadSportPicker').props.onChange(['baseball', 'swimming']);
  tree = createUi.render(props); primary(tree).props.onPress(); primary(tree).props.onPress(); assert.equal(createCalls, 1);
  creation.resolve({ squadId: 'existing-id', status: 'existing', sportIds: ['baseball'] }); await flush();
  assert.equal(joinCalls, 0, 'Existing venue prompts before joining and never claims its sports changed');
  assert.equal(alerts[0][1], 'squadSports.existingBody');
  alerts[0][2][1].onPress(); alerts[0][2][1].onPress(); await flush(); assert.equal(joinCalls, 1);
  const source = fs.readFileSync(path.join(root, 'components/SquadAdministrationCard.tsx'), 'utf8');
  assert.ok(source.indexOf('state.callerIsAdmin ? (') < source.indexOf('<SquadSportsEditor'), 'Only manager UI exposes editing');
  const localization = ts.createSourceFile('i18n/index.ts', fs.readFileSync(path.join(root, 'i18n/index.ts'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const resources = localization.statements.flatMap((statement) => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []).find((entry) => entry.name.text === 'resources').initializer;
  const property = (object, name) => object.properties.find((entry) => entry.name?.text === name).initializer;
  const strings = (language) => property(property(property(resources, language), 'translation'), 'squadSports').properties;
  const english = strings('en'), spanish = strings('es');
  assert.deepEqual(spanish.map((entry) => entry.name.text).sort(), english.map((entry) => entry.name.text).sort());
  assert.ok([...english, ...spanish].every((entry) => ts.isStringLiteral(entry.initializer) && entry.initializer.text.trim()), 'Every new English/Spanish string is present');
  console.log('Multi-sport behavior tests passed: selection, legacy display, create/join, save deduplication, conflict drafts, and stale/unmounted responses.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
