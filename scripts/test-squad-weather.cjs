'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, modules = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => { assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`); return modules[name]; }, module, module.exports);
  return module.exports;
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function harness(factory) {
  const slots = []; let cursor = 0, effects = [], mounted = true, late = 0;
  const changed = (slot, deps) => !slot || !deps || deps.some((v, i) => v !== slot.deps[i]);
  const React = {
    createContext: value => ({ value }), useContext: context => context.value,
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { if (!mounted) late++; slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useRef(initial) { const i = cursor++; if (!slots[i]) slots[i] = { current: initial }; return slots[i]; },
    useCallback(callback, deps) { const i = cursor++; if (changed(slots[i], deps)) slots[i] = { deps, value: callback }; return slots[i].value; },
    useEffect(effect, deps) { const i = cursor++, previous = slots[i]; if (changed(previous, deps)) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; }); },
  };
  const component = factory(React);
  return { render(props) { cursor = 0; effects = []; const result = component(props); effects.forEach(effect => effect()); return result; }, unmount() { slots.forEach(s => s?.cleanup?.()); mounted = false; }, late: () => late };
}
function all(tree, match) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(node => all(node, match)); return [...(match(tree) ? [tree] : []), ...all(tree.props?.children, match)]; }
const button = (tree, key) => all(tree, n => n.type === 'TouchableOpacity' && all(n, child => child.type === 'Text' && child.props.children.includes(key)).length)[0];
const core = require('../functions/lib/squadWeatherCore');
const registry = load('constants/venueLightning.ts'), venue = load('utils/venueLightning.ts', { '@/constants/venueLightning': registry, '@/functions/src/squadWeatherCore': core });
const link = { venueName: 'YMCA', providerName: 'Facility Weather', url: 'https://weather.example.org/ymca?id=123', environment: 'both' };
for (const url of ['http://weather.example.org', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://weather.local', 'https://x..com', 'https://user:pass@weather.example.org', 'https://weather.example.org:8080', 'https://weather.example.org/ bad', 'https://weather.example.org/\\private']) assert.equal(core.isPublicWeatherUrl(url), false);
assert.equal(core.isPublicWeatherUrl('https://weather.example.org/#/venue/ymca'), true, 'Public provider pages may use venue-specific fragments');
assert.deepEqual(core.parseSquadWeatherLink({ ...link, venueName: '  YMCA  ', unrelated: 'ignored' }), link);
assert.equal(core.parseSquadWeatherLink({ ...link, environment: 'indoor' }), null);
const translations = ts.createSourceFile('i18n/index.ts', fs.readFileSync(path.join(root, 'i18n/index.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const declaration = translations.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]).find(entry => entry.name.getText(translations) === 'resources');
const property = (object, name) => object.properties.find(entry => ts.isPropertyAssignment(entry) && entry.name.getText(translations) === name).initializer;
const localized = language => property(property(property(declaration.initializer, language), 'translation'), 'venueWeather');
const en = new Function(`return (${localized('en').getText(translations)});`)(), es = new Function(`return (${localized('es').getText(translations)});`)();
assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort()); for (const key of Object.keys(en)) assert.ok(es[key]);
const view = { squadId: 'a', venueId: 'venue-a', mode: 'custom', revision: 1, link };
(async () => {
  let currentUid = 'admin-a', request = deferred(); const calls = [];
  const auth = { get currentUser() { return { uid: currentUid }; } };
  const service = load('services/squadWeatherService.ts', {
    'firebase/functions': { httpsCallable: (_functions, name) => async body => { calls.push({ name, body }); return request.promise; } },
    '@/config/firebase': { auth, functions: {}, firebaseAppCheckReady: Promise.resolve() },
    '@/functions/src/squadWeatherCore': core, '@/utils/venueLightning': venue,
  });
  const reads = [service.getSquadWeather('a'), service.getSquadWeather('a')]; await flush();
  assert.equal(calls.length, 1, 'Concurrent readers share one request'); request.resolve({ data: view }); await Promise.all(reads);
  assert.equal(service.resolveSquadWeatherSource(view, { squadId: 'b' }), null, 'No other Squad inherits a custom source');
  const messageCore = load('utils/weatherDelayLightning.ts', { '@/constants/venueLightning': registry, '@/utils/venueLightning': venue });
  const source = service.resolveSquadWeatherSource(view, { squadId: 'a' });
  const composed = messageCore.composeWeatherDelayMessage({ templateId: 'weather-delay', binding: { squadId: 'a' }, source, confirmedVenue: true, message: 'Wait for staff.', linkLabel: 'YMCA weather:', safetyNote: 'Follow venue instructions.' });
  assert.equal(messageCore.getLightningMessageSegments(composed, [source]).filter(part => part.source).length, 1);
  assert.equal(messageCore.getLightningMessageSegments(composed, []).some(part => part.source), false, 'Removed sources remain plain text in preserved messages');
  assert.equal(messageCore.composeWeatherDelayMessage({ templateId: 'weather-delay', binding: { squadId: 'a' }, source: null, confirmedVenue: true, message: 'Wait for staff.', linkLabel: '', safetyNote: '' }), 'Wait for staff.');
  const terminal = { ...source, url: 'https://weather.example.org/ymca?' };
  assert.equal(messageCore.getLightningMessageSegments(terminal.url, [terminal])[0].text, terminal.url, 'Exact provider URLs preserve terminal punctuation');
  assert.equal(service.resolveSquadWeatherSource({ ...view, mode: 'disabled', link: null }, { squadId: 'a' }), null);
  const fallback = { squadId: 'venue_1l4q16f__baseball', venueId: 'venue_1l4q16f', revision: 0, mode: 'default', link: null };
  assert.ok(service.resolveSquadWeatherSource(fallback, { squadId: fallback.squadId }));
  assert.equal(service.resolveSquadWeatherSource({ ...fallback, mode: 'disabled', revision: 1 }, { squadId: fallback.squadId }), null, 'Removed preset stays removed');
  request = deferred(); const notifications = [];
  const unsubscribe = service.subscribeSquadWeather((uid, result) => notifications.push({ uid, result }));
  const save = service.updateSquadWeather('a', link, 0, true); await flush(); request.resolve({ data: view }); await save;
  assert.equal(notifications.length, 1); unsubscribe();
  request = deferred(); const stale = service.getSquadWeather('a'); await flush(); currentUid = 'parent'; request.resolve({ data: view }); await assert.rejects(stale, /Account changed/);
  request = deferred(); const unconfirmed = service.updateSquadWeather('a', null, 1, false); await flush(); request.resolve({ data: view }); await assert.rejects(unconfirmed, /Unconfirmed/);

  // Execute the shipped hook: late reads, account/squad changes, removals and failures.
  let uid = 'admin-a', read = deferred(), subscriber, appChange;
  const hook = harness(React => load('hooks/useSquadWeather.ts', {
    react: React, 'react-native': { AppState: { addEventListener: (_name, callback) => { appChange = callback; return { remove() {} }; } } },
    'expo-router': { useFocusEffect: callback => React.useEffect(callback, [callback]) }, '@/context/AuthContext': { useAuth: () => ({ user: { uid } }) },
    '@/services/squadWeatherService': { getSquadWeather: () => read.promise, resolveSquadWeatherSource: service.resolveSquadWeatherSource, subscribeSquadWeather: callback => { subscriber = callback; return () => { subscriber = null; }; } },
  }).useSquadWeather);
  hook.render({ squadId: 'a' }); read.resolve(view); await flush(); assert.ok(hook.render({ squadId: 'a' }).source);
  read = deferred(); appChange('background'); appChange('active'); hook.render({ squadId: 'a' });
  subscriber(uid, { ...view, revision: 2, mode: 'disabled', link: null }); read.resolve(view); await flush();
  assert.equal(hook.render({ squadId: 'a' }).source, null, 'A stale in-flight read cannot revive a removed link');
  read = deferred(); hook.render({ squadId: 'b' }); read.resolve(view); await flush(); assert.equal(hook.render({ squadId: 'b' }).source, null);
  read = deferred(); uid = 'parent'; hook.render({ squadId: 'a' }); read.reject(new Error('private raw error')); await flush();
  assert.equal(hook.render({ squadId: 'a' }).failed, true); assert.equal(hook.render({ squadId: 'a' }).source, null);
  read = deferred(); appChange('background'); appChange('active'); hook.unmount(); read.resolve(view); await flush(); assert.equal(hook.late(), 0);

  // Execute the editor: no write until preview and fresh confirmation, dedup, conflict reload.
  uid = 'admin-a'; let weatherView = { ...fallback, squadId: 'a', venueId: 'venue-a' }, reloads = 0, previews = [], writes = [], mutation = deferred();
  const editor = harness(React => load('components/SquadWeatherEditor.tsx', {
    react: React, 'react-native': { ...Object.fromEntries(['ActivityIndicator', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map(n => [n, n])), StyleSheet: { create: x => x }, Alert: { alert() {} } },
    'react-i18next': { useTranslation: () => ({ t: key => key }) }, '@/constants/theme': { Colors: {}, Radius: {}, Spacing: {}, Typography: {} },
    '@/context/AuthContext': { useAuth: () => ({ user: { uid } }) }, '@/hooks/useSquadWeather': { useSquadWeather: () => ({ view: weatherView, source: null, loading: false, failed: false, reload: () => { reloads++; } }) },
    '@/functions/src/squadWeatherCore': core, '@/services/squadWeatherService': { updateSquadWeather: (...args) => { writes.push(args); return mutation.promise; } },
    '@/services/venueLightningService': { openSquadWeatherPreview: async url => { previews.push(url); } }, '@/components/PrimaryButton': { PrimaryButton: 'PrimaryButton' },
  }).SquadWeatherEditor);
  const props = { squadId: 'a' }; let tree = editor.render(props); button(tree, 'venueWeather.add').props.onPress(); tree = editor.render(props);
  for (const input of all(tree, n => n.type === 'TextInput')) input.props.onChangeText(link[input.props.accessibilityLabel.replace('venueWeather.', '')]);
  tree = editor.render(props); assert.equal(all(tree, n => n.type === 'PrimaryButton')[0].props.disabled, true);
  button(tree, 'venueWeather.preview').props.onPress(); await flush(); tree = editor.render(props);
  assert.deepEqual(previews, [link.url]); all(tree, n => n.props.accessibilityRole === 'checkbox')[0].props.onPress(); tree = editor.render(props);
  all(tree, n => n.type === 'TextInput' && n.props.accessibilityLabel === 'venueWeather.url')[0].props.onChangeText('https://weather.example.org/new'); tree = editor.render(props);
  assert.equal(all(tree, n => n.type === 'PrimaryButton')[0].props.disabled, true, 'Editing after preview clears confirmation');
  button(tree, 'venueWeather.preview').props.onPress(); await flush(); tree = editor.render(props); all(tree, n => n.props.accessibilityRole === 'checkbox')[0].props.onPress(); tree = editor.render(props);
  const saveButton = all(tree, n => n.type === 'PrimaryButton')[0]; saveButton.props.onPress(); saveButton.props.onPress(); assert.equal(writes.length, 1);
  mutation.reject(Object.assign(new Error('raw provider info'), { code: 'functions/aborted' })); await flush(); tree = editor.render(props);
  assert.equal(all(tree, n => n.type === 'PrimaryButton')[0].props.disabled, true); assert.ok(button(tree, 'venueWeather.reload')); assert.equal(writes.length, 1, 'No automatic write retry');
  button(tree, 'venueWeather.reload').props.onPress(); assert.equal(reloads, 1);
  tree = editor.render(props); button(tree, 'venueWeather.add').props.onPress(); tree = editor.render(props); uid = 'parent'; tree = editor.render(props); tree = editor.render(props);
  assert.equal(all(tree, n => n.type === 'TextInput').length, 0, 'Account changes discard editor state');
  console.log('Squad weather client passed: public URLs, coalesced reads, scoped sources, removal and stale-read safety, preview/confirmation, duplicate saves and conflict reload.');
})().catch(error => { console.error(error); process.exitCode = 1; });
