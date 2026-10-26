'use strict';
// Focused offline checks. No native app, Firebase, network, build or store calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const RuntimeReact = require('react');
const root = path.resolve(__dirname, '..');
function load(file, modules = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(Object.hasOwn(modules, name), 'Unexpected dependency: ' + file + ': ' + name);
    return modules[name];
  }, module, module.exports);
  return module.exports;
}
function harness(factory) {
  const slots = []; let cursor = 0, effects = [], mounted = true, late = 0;
  const changed = (old, deps) => !old || !deps || old.deps?.length !== deps.length || deps.some((v, i) => v !== old.deps[i]);
  const React = {
    ...RuntimeReact,
    createContext: value => ({ value, Provider: 'Provider' }), useContext: context => context.value,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, next => { if (!mounted) { late++; return; } slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }];
    },
    useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; },
    useMemo(make, deps) { const index = cursor++; if (changed(slots[index], deps)) slots[index] = { deps, value: make() }; return slots[index].value; },
    useCallback(fn, deps) { return React.useMemo(() => fn, deps); },
    useEffect(effect, deps) {
      const index = cursor++, old = slots[index];
      if (changed(old, deps)) effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
    },
  };
  const component = factory(React);
  return {
    render(props) { cursor = 0; effects = []; const tree = component(props); effects.forEach(fn => fn()); return tree; },
    unmount() { mounted = false; slots.forEach(slot => slot?.cleanup?.()); },
    late: () => late,
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function materialize(tree) {
  if (Array.isArray(tree)) return tree.map(materialize);
  if (!RuntimeReact.isValidElement(tree)) return tree;
  if (typeof tree.type === 'function') return materialize(tree.type(tree.props));
  return { type: tree.type, props: { ...tree.props, children: materialize(tree.props.children) } };
}
const flatten = load('utils/virtualizedRows.ts', { react: RuntimeReact });
function listFixture({ keyboardAware = false, children, platform = 'android' } = {}) {
  const listeners = new Map(), frames = new Map(); let nextFrame = 0, removals = 0, revealed = [], focusedInput = { synthetic: 'input' };
  global.requestAnimationFrame = fn => { frames.set(++nextFrame, fn); return nextFrame; };
  global.cancelAnimationFrame = id => frames.delete(id);
  let exports;
  const ui = harness(React => {
    exports = load('components/VirtualizedRows.tsx', {
      react: React, 'react-native': {
        FlatList: 'FlatList', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: platform },
        StyleSheet: { create: s => s }, TextInput: { State: { currentlyFocusedInput: () => focusedInput } },
        Keyboard: { addListener: (name, fn) => { listeners.set(name, fn); return { remove() { listeners.delete(name); removals++; } }; } },
      },
      '@/constants/theme': { Spacing: { md: 16 } }, '@/utils/virtualizedRows': flatten,
    });
    return exports.VirtualizedRows;
  });
  const tree = ui.render({ children, keyboardAware, onFocus() {}, onContentSizeChange() {} });
  const list = nodes(tree).find(node => node.type === 'FlatList');
  list.props.ref.current = { getScrollResponder: () => ({ scrollResponderScrollNativeHandleToKeyboard: (...args) => revealed.push(args) }) };
  return { ui, tree, list, exports, listeners, frames, revealed, removals: () => removals, clearInput: () => { focusedInput = null; } };
}
function listWindowAndKeys() {
  const h = RuntimeReact.createElement, fragment = RuntimeReact.Fragment;
  let made = 0;
  const fixture = listFixture();
  const makeChildren = ids => [
    h('View', { key: 'header' }, 'header'),
    h(fragment, { key: 'group' }, ids.map(id => h(fixture.exports.VirtualizedRow, { key: id, render: () => { made++; return h('View', { id }, id); } }))),
    h('View', { key: 'search' }, h('TextInput', { value: 'kept in parent state' })),
    h('View', { key: 'pagination' }, 'Load more'),
  ];
  const first = flatten.flattenVirtualizedRows(makeChildren(['a', 'b']));
  const next = flatten.flattenVirtualizedRows(makeChildren(['b', 'a', 'c']));
  const keyOf = (rows, key) => rows.find(row => row.node.key?.includes(key))?.key;
  assert.equal(keyOf(first, 'header'), keyOf(next, 'header'));
  assert.equal(keyOf(first, 'search'), keyOf(next, 'search'), 'Growing rows preserve the input cell');
  assert.equal(keyOf(first, 'pagination'), keyOf(next, 'pagination'));
  for (const id of ['a', 'b']) assert.equal(first.find(r => r.node.props.render && r.node.key.endsWith('$' + id)).key, next.find(r => r.node.props.render && r.node.key.endsWith('$' + id)).key);
  const children = makeChildren(Array.from({ length: 1000 }, (_, i) => 'item-' + i));
  const view = fixture.ui.render({ children });
  const list = nodes(view).find(node => node.type === 'FlatList');
  assert.equal(made, 0, 'Preparing list data must not construct row contents');
  assert.equal(list.props.data.length, 1003);
  assert.equal(new Set(list.props.data.map(r => r.key)).size, 1003);
  assert.equal(list.props.initialNumToRender, 12);
  assert.equal(list.props.maxToRenderPerBatch, 8);
  assert.equal(list.props.windowSize, 7);
  for (const item of list.props.data.slice(0, 12)) materialize(list.props.renderItem({ item }));
  assert.equal(made, 11, 'Only mounted cells create row contents');
  assert.equal(nodes(view).filter(n => n.type === 'ScrollView').length, 0, 'No enclosing ScrollView disables virtualization');
  assert.equal(fixture.listeners.size, 0, 'Non-input lists do not add keyboard listeners');
  fixture.ui.unmount();
}
function keyboardBehavior() {
  for (const platform of ['android', 'ios']) {
    const f = listFixture({ keyboardAware: true, platform, children: RuntimeReact.createElement('TextInput') });
    const show = platform === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = platform === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    assert.equal(f.tree.type, 'KeyboardAvoidingView');
    assert.equal(f.tree.props.behavior, platform === 'ios' ? 'padding' : undefined);
    assert.equal(f.list.props.keyboardShouldPersistTaps, 'handled');
    assert.equal(f.list.props.removeClippedSubviews, false);
    f.listeners.get(show)(); f.list.props.onFocus({}); f.list.props.onContentSizeChange(100, 200);
    assert.equal(f.frames.size, 1, 'Repeated layout events coalesce input reveal');
    for (const [id, fn] of f.frames) { f.frames.delete(id); fn(); }
    assert.equal(f.revealed.length, 1);
    assert.equal(f.revealed[0][1], 16);
    f.listeners.get(hide)(); f.list.props.onContentSizeChange(100, 300);
    assert.equal(f.frames.size, 0, 'Closed keyboard does not trigger scrolling');
    f.list.props.onFocus({}); assert.equal(f.frames.size, 1);
    f.ui.unmount(); assert.equal(f.frames.size, 0); assert.equal(f.removals(), 2);
  }
}
const core = require('../functions/lib/squadWeatherCore');
const registry = load('constants/venueLightning.ts');
const venue = load('utils/venueLightning.ts', { '@/constants/venueLightning': registry, '@/functions/src/squadWeatherCore': core });
const resolver = load('services/squadWeatherService.ts', {
  'firebase/functions': {}, '@/config/firebase': {}, '@/functions/src/squadWeatherCore': core, '@/utils/venueLightning': venue,
}).resolveSquadWeatherSource;
const view = { squadId: 'a', venueId: 'venue-a', revision: 1, mode: 'custom', link: { venueName: 'Demo', providerName: 'Demo weather', url: 'https://weather.example.org/demo', environment: 'both' } };
function weatherFixture() {
  let uid = 'first', focused = true, requests = [], exported;
  const app = { currentState: 'active', listeners: new Set(), addEventListener(_name, fn) { this.listeners.add(fn); return { remove: () => this.listeners.delete(fn) }; } };
  const updates = new Set();
  const ui = harness(React => {
    exported = load('hooks/useSquadWeather.ts', {
      react: React, 'react-native': { AppState: app },
      'expo-router': { useFocusEffect: cb => React.useEffect(() => focused ? cb() : undefined, [focused, cb]) },
      '@/context/AuthContext': { useAuth: () => ({ user: uid ? { uid } : null }) },
      '@/services/squadWeatherService': {
        resolveSquadWeatherSource: resolver,
        getSquadWeather: (squadId, teamId) => { const read = deferred(); requests.push({ squadId, teamId, ...read }); return read.promise; },
        subscribeSquadWeather: fn => { updates.add(fn); return () => updates.delete(fn); },
      },
    });
    return exported.useSquadWeather;
  });
  return {
    ui, app, updates, requests, get exports() { return exported; },
    setUid: value => { uid = value; }, setFocus: value => { focused = value; },
    appChange(value) { app.currentState = value; [...app.listeners].forEach(fn => fn(value)); },
    update(value) { [...updates].forEach(fn => fn(uid, value)); },
  };
}
async function weatherLifecycle() {
  const f = weatherFixture(), binding = { squadId: 'a', venueId: 'venue-a' };
  f.ui.render(binding); assert.equal(f.requests.length, 1);
  f.requests[0].resolve(view); await flush(); assert.ok(f.ui.render(binding).source);
  f.appChange('active'); assert.equal(f.requests.length, 1, 'Duplicate active notifications are ignored');
  f.appChange('background'); assert.equal(f.ui.render(binding).source, null);
  f.appChange('active'); assert.equal(f.requests.length, 2);
  assert.equal(f.ui.render(binding).source, null, 'Refresh immediately removes the old actionable link');
  f.update({ ...view, revision: 2, mode: 'disabled', link: null });
  f.requests[1].resolve(view); await flush();
  assert.equal(f.ui.render(binding).source, null, 'A late read cannot revive a removed source');
  f.setFocus(false); f.ui.render(binding);
  assert.equal(f.app.listeners.size, 0); assert.equal(f.updates.size, 0);
  f.appChange('background'); f.appChange('active'); assert.equal(f.requests.length, 2);
  f.setFocus(true); f.ui.render(binding); assert.equal(f.requests.length, 3);
  f.setFocus(false); f.ui.render(binding); f.requests[2].resolve(view); await flush();
  assert.equal(f.ui.render(binding).source, null, 'Blurred reads cannot publish');
  f.setFocus(true); f.ui.render(binding); assert.equal(f.requests.length, 4);
  f.requests[3].reject(Error('synthetic read failure')); await flush(); assert.equal(f.ui.render(binding).failed, true);
  const manual = f.ui.render(binding).reload(); assert.equal(f.requests.length, 5);
  f.requests[4].resolve(view); await manual; assert.ok(f.ui.render(binding).source);
  f.ui.render({ ...binding, squadId: 'b' }); assert.equal(f.requests.length, 6);
  f.requests[5].resolve(view); await flush(); assert.equal(f.ui.render({ ...binding, squadId: 'b' }).source, null);
  f.ui.unmount(); assert.equal(f.ui.late(), 0);
}
async function weatherIdentityAndSharing() {
  const f = weatherFixture(), binding = { squadId: 'a', venueId: 'venue-a', teamId: 'team' };
  f.ui.render(binding); f.requests[0].resolve(view); await flush();
  assert.ok(f.ui.render(binding).source);
  f.setUid('second'); assert.equal(f.ui.render(binding).source, null);
  f.requests[1].resolve(view); await flush(); assert.ok(f.ui.render(binding).source);
  const shared = { query: f.exports.squadWeatherQuery('second', 'a', 'team'), view, loading: false, failed: false, reload: async () => {} };
  f.exports.SquadWeatherContext.value = shared;
  assert.ok(f.ui.render(binding).source);
  assert.equal(f.app.listeners.size, 0); assert.equal(f.updates.size, 0);
  assert.equal(f.requests.length, 2, 'Matching consumers start no reads or listeners');
  assert.equal(f.ui.render({ ...binding, venueId: 'wrong-venue' }).source, null, 'Shared data still validates each consumer venue');
  f.exports.SquadWeatherContext.value = { ...shared, query: f.exports.squadWeatherQuery('second', 'a', 'other-team') };
  f.ui.render(binding); assert.equal(f.requests.length, 3, 'A different authorized team binding is not shared');
  f.ui.unmount(); f.requests[2].resolve(view); await flush(); assert.equal(f.ui.late(), 0);
  const empty = weatherFixture(); empty.ui.render({}); assert.equal(empty.requests.length, 0); assert.equal(empty.app.listeners.size, 0); empty.ui.unmount();
}
function routeIntegration() {
  const targets = { 'app/(tabs)/friends.tsx': 5, 'app/(social)/chat/index.tsx': 2, 'app/teams/[teamId]/index.tsx': 2 };
  for (const [file, count] of Object.entries(targets)) {
    const source = fs.readFileSync(path.join(root, file), 'utf8'), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const deferredRows = [], lists = [];
    function walk(node) {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'VirtualizedRow') deferredRows.push(node);
      if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === 'VirtualizedRows') lists.push(node);
      ts.forEachChild(node, walk);
    }
    walk(ast); assert.equal(lists.length, 1); assert.equal(deferredRows.length, count);
    assert.equal(/<(?:KeyboardAware)?ScrollView/.test(source), false);
    for (const row of deferredRows) assert.ok(row.attributes.properties.some(a => a.name?.getText(ast) === 'key'));
  }
  const team = fs.readFileSync(path.join(root, 'app/teams/[teamId]/index.tsx'), 'utf8');
  assert.ok(team.includes('getOlderParentTeamAnnouncementsPage'));
  assert.ok(team.includes('loadingOlderAnnouncements'));
  const chat = fs.readFileSync(path.join(root, 'app/(social)/chat/index.tsx'), 'utf8');
  assert.ok(chat.includes('Math.min(CHAT_LIST_MAX, value + CHAT_LIST_LIMIT)'));
  for (const [file, query] of [
    ['app/(social)/squad-detail.tsx', 'squadId={squadDetail.squadId} venueId={squadDetail.venueId}'],
    ['app/teams/[teamId]/announcements/[announcementId].tsx', 'squadId={summary?.team.squadId} teamId={teamId}'],
  ]) assert.ok(fs.readFileSync(path.join(root, file), 'utf8').includes('<SquadWeatherProvider ' + query + '>'));
}
(async () => {
  const groups = { listWindowAndKeys, keyboardBehavior, weatherLifecycle, weatherIdentityAndSharing, routeIntegration };
  let failed = 0;
  for (const [name, run] of Object.entries(groups)) {
    try { await run(); console.log('PASS ' + name); } catch (error) { failed++; console.error('FAIL ' + name, error); }
  }
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
