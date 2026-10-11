'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function load(source, modules = {}) {
  const loaded = { exports: {} };
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const requireStub = (name) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
    return modules[name];
  };
  new Function('require', 'module', 'exports', compiled)(requireStub, loaded, loaded.exports);
  return loaded.exports;
}
const registry = load(read('constants/venueLightning.ts'));
const core = load(read('utils/venueLightning.ts'), { '@/constants/venueLightning': registry, '@/functions/src/squadWeatherCore': require('../functions/lib/squadWeatherCore') });
const messageCore = load(read('utils/weatherDelayLightning.ts'), {
  '@/constants/venueLightning': registry,
  '@/utils/venueLightning': core,
});
const approved = registry.APPROVED_VENUE_LIGHTNING_SOURCES[0];
const known = { squadId: 'venue_1l4q16f__baseball' };
assert.equal(core.resolveVenueLightningSource(known), approved);
assert.equal(core.resolveVenueLightningSource({ venueId: 'venue_1l4q16f' }), approved);
assert.equal(core.resolveVenueLightningSource({ ...known, venueId: `legacy_${known.squadId}` }), approved, 'field-limited detail must still work');
assert.equal(core.resolveVenueLightningSource({ squadId: 'venue_1l4q16f__basketball' }), approved, 'coverage follows the outdoor venue, not a sport whitelist');
for (const binding of [
  {}, { squadId: 'another-baseball-squad' }, { venueId: 'different-venue' },
  { ...known, venueId: 'different-venue' }, { squadId: 'venue_1l4q16f-extra__baseball' },
  { squadId: 'venue_1l4q16f__baseball__extra' },
  { venueName: 'Dr Phillips Park', sportId: 'baseball' },
]) assert.equal(core.resolveVenueLightningSource(binding), null, 'unknown or conflicting identities must not select this facility');
assert.equal(core.resolveVenueLightningSource(known, [{ ...approved, environment: 'indoor' }]), null);
assert.equal(core.resolveVenueLightningSource(known, [{ ...approved, environment: 'both' }]).id, approved.id);
assert.equal(core.resolveVenueLightningSource(known, [{ ...approved, enabled: false }]), null);
assert.equal(core.resolveVenueLightningSource(known, [approved, { ...approved, id: 'ambiguous' }]), null);
for (const url of ['http://example.com/', 'javascript:alert(1)', 'file:///tmp/status', 'https://user:password@example.com/', 'https://example.com:8443/', ' https://example.com/']) {
  assert.equal(core.isValidVenueLightningUrl(url), false);
  assert.equal(core.resolveVenueLightningSource(known, [{ ...approved, url }]), null);
}
const otherProvider = { ...approved, id: 'reviewed-other-provider', providerName: 'Other venue provider', url: 'https://example.com/facility/status' };
assert.equal(core.resolveVenueLightningSource(known, [otherProvider]).providerName, 'Other venue provider');
assert.equal(approved.url, 'https://oas.earthnetworks.com/widget/ResOASWidget.html?widgetId=5b327a3e-0349-4fe0-be1a-8e32829ba79e');

// Execute the shipped card with a small hook/element harness, not a copied handler.
function createCardHarness(open) {
  const hooks = [];
  let cursor = 0, effects = [], mounted = true, postUnmountWrites = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: (initial) => {
      const slot = cursor++;
      if (!hooks[slot]) hooks[slot] = { value: initial };
      return [hooks[slot].value, (value) => {
        if (!mounted) postUnmountWrites += 1;
        hooks[slot].value = typeof value === 'function' ? value(hooks[slot].value) : value;
      }];
    },
    useRef: (initial) => {
      const slot = cursor++;
      if (!hooks[slot]) hooks[slot] = { current: initial };
      return hooks[slot];
    },
    useEffect: (effect, deps) => {
      const slot = cursor++;
      const previous = hooks[slot];
      if (!previous || deps.some((value, index) => value !== previous.deps[index])) {
        effects.push(() => {
          previous?.cleanup?.();
          hooks[slot] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const component = load(read('components/VenueLightningCard.tsx'), {
    react: React,
    'react-native': { ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (styles) => styles }, Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View' },
    'lucide-react-native': { CloudLightning: 'CloudLightning', ExternalLink: 'ExternalLink' },
    'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
    '@/components/Card': { Card: 'Card' },
    '@/constants/theme': { Colors: {}, Radius: {}, Spacing: {}, Typography: {} },
    '@/services/venueLightningService': { openVenueLightningStatus: open },
    '@/utils/venueLightning': core,
    '@/hooks/useSquadWeather': { useSquadWeather: (binding) => ({ source: core.resolveVenueLightningSource(binding), failed: false }) },
  }).VenueLightningCard;
  return {
    render: (props) => {
      cursor = 0;
      effects = [];
      const tree = component(props);
      for (const run of effects) run();
      return tree;
    },
    unmount: () => { for (const hook of hooks) hook?.cleanup?.(); mounted = false; },
    postUnmountWrites: () => postUnmountWrites,
  };
}
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) return tree.map((child) => find(child, predicate)).find(Boolean) ?? null;
  if (predicate(tree)) return tree;
  return find(tree.props?.children, predicate);
}
const button = (tree) => find(tree, (node) => node.type === 'TouchableOpacity');

(async () => {
  let browserRequest = deferred();
  const browserCalls = [];
  const service = load(read('services/venueLightningService.ts'), {
    'expo-web-browser': {
      WebBrowserResultType: { LOCKED: 'locked' },
      openBrowserAsync: (url, options) => { browserCalls.push({ url, options }); return browserRequest.promise; },
    },
    '@/constants/theme': { Colors: { surface: '#f8f4ec', primary: '#c44a3b' } },
    '@/utils/venueLightning': core,
    '@/utils/weatherDelayLightning': messageCore,
    '@/functions/src/squadWeatherCore': require('../functions/lib/squadWeatherCore'),
  });
  const first = service.openVenueLightningStatus(known);
  assert.equal(service.openVenueLightningStatus(known), first, 'repeated opens coalesce');
  await flush();
  assert.equal(browserCalls.length, 1);
  assert.equal(browserCalls[0].url, approved.url, 'never append account, GPS, event or child data');
  assert.equal(browserCalls[0].options.enableBarCollapsing, false, 'provider browser toolbar remains visible');
  assert.equal(browserCalls[0].options.createTask, false, 'Android browser stays in the app task');
  browserRequest.resolve({ type: 'cancel' });
  await first;
  await service.openVenueLightningStatus(known); // Cancel/close is a normal return, not an error.
  await assert.rejects(service.openVenueLightningStatus({ squadId: 'wrong-venue' }), /UNAVAILABLE/);
  browserRequest = deferred();
  const busy = service.openVenueLightningStatus(known);
  browserRequest.resolve({ type: 'locked' });
  await assert.rejects(busy, /BROWSER_BUSY/);
  browserRequest = deferred();
  const failed = service.openVenueLightningStatus(known);
  browserRequest.reject(new Error('private provider detail'));
  await assert.rejects(failed);
  browserRequest = deferred();
  const retry = service.openVenueLightningStatus(known);
  browserRequest.resolve({ type: 'opened' });
  await retry;

  let cardRequest = deferred();
  let cardCalls = 0;
  const card = createCardHarness(() => { cardCalls += 1; return cardRequest.promise; });
  let tree = card.render(known);
  const initialButton = button(tree);
  initialButton.props.onPress();
  initialButton.props.onPress();
  assert.equal(cardCalls, 1);
  tree = card.render(known);
  assert.equal(button(tree).props.disabled, true);
  assert.equal(button(tree).props.accessibilityState.busy, true);
  cardRequest.reject(new Error('never display this raw detail'));
  await flush();
  tree = card.render(known);
  assert.equal(button(tree).props.disabled, false);
  assert.ok(find(tree, (node) => node.props?.accessibilityRole === 'alert'), 'launch failure shows visible Retry feedback');
  cardRequest = deferred();
  button(tree).props.onPress();
  assert.equal(cardCalls, 2);
  cardRequest.resolve();
  await flush();
  tree = card.render(known);
  assert.equal(find(tree, (node) => node.props?.accessibilityRole === 'alert'), null);
  cardRequest = deferred();
  button(tree).props.onPress();
  assert.equal(card.render({ squadId: 'unconfigured-indoor-venue' }), null, 'other venues hide the card');
  cardRequest.reject(new Error('old venue failure'));
  await flush();
  tree = card.render(known);
  tree = card.render(known);
  assert.equal(find(tree, (node) => node.props?.accessibilityRole === 'alert'), null, 'old venue replies cannot create a new venue error');
  cardRequest = deferred();
  button(tree).props.onPress();
  card.unmount();
  cardRequest.reject(new Error('closed screen'));
  await flush();
  assert.equal(card.postUnmountWrites(), 0);

  // Translation strings and interpolation must cover both released languages.
  const translationsSource = ts.createSourceFile('i18n/index.ts', read('i18n/index.ts'), ts.ScriptTarget.Latest, true);
  const declaration = translationsSource.statements.filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((entry) => entry.name.getText(translationsSource) === 'resources');
  const property = (object, name) => object.properties.find((entry) =>
    ts.isPropertyAssignment(entry) && entry.name.getText(translationsSource) === name).initializer;
  const localized = (language) => property(property(property(declaration.initializer, language), 'translation'), 'venueLightning');
  const en = load(`exports.strings = ${localized('en').getText(translationsSource)};`).strings;
  const es = load(`exports.strings = ${localized('es').getText(translationsSource)};`).strings;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  for (const key of Object.keys(en)) {
    assert.ok(es[key]);
    assert.deepEqual(en[key].match(/{{[^}]+}}/g) ?? [], es[key].match(/{{[^}]+}}/g) ?? []);
  }
  console.log('Venue lightning binding, provider opening/return, Retry, stale replies and localization passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
