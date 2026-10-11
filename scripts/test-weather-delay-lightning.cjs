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
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const requireStub = (name) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
    return modules[name];
  };
  new Function('require', 'module', 'exports', compiled)(requireStub, module, module.exports);
  return module.exports;
}
const registry = load(read('constants/venueLightning.ts'));
const venueCore = load(read('utils/venueLightning.ts'), { '@/constants/venueLightning': registry, '@/functions/src/squadWeatherCore': require('../functions/lib/squadWeatherCore') });
const core = load(read('utils/weatherDelayLightning.ts'), {
  '@/constants/venueLightning': registry, '@/utils/venueLightning': venueCore,
});
const approved = registry.APPROVED_VENUE_LIGHTNING_SOURCES[0];
const known = { squadId: 'venue_1l4q16f__baseball' };
const input = {
  templateId: 'weather-delay', binding: known, confirmedVenue: true,
  message: 'Coach update: please wait until 6 PM.',
  linkLabel: `Live lightning status — ${approved.venueName}:`,
  safetyNote: 'Follow venue instructions and wait for staff to confirm play may resume.',
};
const combined = core.composeWeatherDelayMessage(input);
assert.ok(combined.startsWith(input.message));
assert.ok(combined.includes(`\n${approved.url}\n`), 'shared content contains a full public HTTPS address');
assert.ok(combined.endsWith(input.safetyNote));
for (const changes of [
  { confirmedVenue: false }, { templateId: 'practice-reminder' },
  { binding: {} }, { binding: { squadId: 'another-venue__baseball' } },
]) assert.equal(core.composeWeatherDelayMessage({ ...input, ...changes }), input.message);
assert.equal(core.composeWeatherDelayMessage({ ...input, message: combined }), combined, 'existing link is not duplicated');
assert.equal(core.getLightningMessageSegments(`(${approved.url}).`).map((part) => part.text).join(''), `(${approved.url}).`);
assert.equal(core.getLightningMessageSegments(combined).filter((part) => part.source).length, 1);
for (const url of [
  `${approved.url}&accountId=private`, `${approved.url}extra`,
  approved.url.replace('https:', 'http:'), 'https://unapproved.example/status',
]) {
  assert.equal(core.resolveApprovedLightningMessageUrl(url), null);
  assert.equal(core.getLightningMessageSegments(url).some((part) => part.source), false);
}
assert.equal(core.resolveApprovedLightningMessageUrl(approved.url, [{ ...approved, enabled: false }]), null);
assert.equal(core.resolveApprovedLightningMessageUrl(approved.url, [{ ...approved, environment: 'indoor' }]), null);
assert.equal(core.resolveApprovedLightningMessageUrl(approved.url, [approved, { ...approved, id: 'duplicate' }]), null);

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
for (const key of Object.keys(en)) assert.deepEqual(en[key].match(/{{[^}]+}}/g) ?? [], es[key].match(/{{[^}]+}}/g) ?? []);
const t = (key, values = {}) => (en[key.replace('venueLightning.', '')] ?? key)
  .replace(/{{([^}]+)}}/g, (_, name) => values[name] ?? `{{${name}}}`);
const native = {
  StyleSheet: { create: (styles) => styles }, Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  View: 'View', TextInput: 'TextInput', Alert: { alert: () => {} }, Share: {},
};
const theme = { Colors: {}, Radius: {}, Spacing: {}, Typography: {} };
const translation = { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
function harness(factory) {
  const hooks = [];
  let cursor = 0, effects = [], mounted = true, lateWrites = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: (initial) => {
      const slot = cursor++;
      if (!hooks[slot]) hooks[slot] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[slot].value, (value) => {
        if (!mounted) lateWrites += 1;
        hooks[slot].value = typeof value === 'function' ? value(hooks[slot].value) : value;
      }];
    },
    useRef: (initial) => {
      const slot = cursor++;
      if (!hooks[slot]) hooks[slot] = { current: initial };
      return hooks[slot];
    },
    useMemo: (create) => create(), useCallback: (callback) => callback,
    useEffect: (effect, deps) => {
      const slot = cursor++;
      const previous = hooks[slot];
      if (!previous || deps.some((value, index) => value !== previous.deps[index])) effects.push(() => {
        previous?.cleanup?.();
        hooks[slot] = { deps, cleanup: effect() };
      });
    },
  };
  const component = factory(React);
  return {
    render: (props) => {
      cursor = 0; effects = [];
      const tree = component(props);
      for (const run of effects) run();
      return tree;
    },
    unmount: () => { for (const hook of hooks) hook?.cleanup?.(); mounted = false; },
    lateWrites: () => lateWrites,
  };
}
function findAll(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => findAll(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...findAll(tree.props?.children, predicate)];
}
const find = (tree, predicate) => findAll(tree, predicate)[0];
const hasText = (tree, text) => JSON.stringify(tree.props?.children).includes(text);

(async () => {
  const option = harness((React) => load(read('components/WeatherDelayLightningOption.tsx'), {
    react: React, 'react-native': native, 'lucide-react-native': { Check: 'Check', CloudLightning: 'CloudLightning' },
    'react-i18next': translation, '@/constants/theme': theme, '@/utils/venueLightning': venueCore,
  }).WeatherDelayLightningOption);
  let chosen = false;
  let tree = option.render({ ...known, checked: chosen, onChange: (value) => { chosen = value; } });
  const checkbox = find(tree, (node) => node.props.accessibilityRole === 'checkbox');
  assert.equal(checkbox.props.accessibilityState.checked, false, 'venue inclusion requires an affirmative choice');
  assert.ok(checkbox.props.accessibilityLabel.includes('Dr Phillips Park'));
  checkbox.props.onPress();
  tree = option.render({ ...known, checked: chosen, onChange: (value) => { chosen = value; } });
  assert.ok(find(tree, (node) => node.type === 'Text' && hasText(node, approved.url)));
  assert.equal(option.render({ squadId: 'unknown', checked: true, onChange: () => {} }), null);

  const shared = [], navigated = [];
  let configuredHome = approved;
  const memberships = [
    { teamId: 'home', team: { name: 'Home Team', squadId: known.squadId } },
    { teamId: 'away', team: { name: 'Away Team', squadId: 'another-venue__baseball' } },
  ];
  const template = { id: 'weather-delay', category: 'schedule', canSendAsAnnouncement: true, defaultAnnouncementAudience: 'all', title: 'Weather Delay', description: 'Weather update' };
  const route = harness((React) => load(read('app/coach/resources/communication/[templateId].tsx'), {
    react: React,
    'react-native': { ...native, Share: { sharedAction: 'shared', share: async (value) => { shared.push(value); return { action: 'shared' }; } } },
    'expo-router': { Redirect: 'Redirect', router: { push: (value) => navigated.push(value) }, useLocalSearchParams: () => ({ templateId: 'weather-delay' }) },
    'lucide-react-native': { Send: 'Send', Share2: 'Share2' }, 'react-i18next': translation,
    '@/components/Card': { Card: 'Card' }, '@/components/CoachResourceHeader': { CoachResourceHeader: 'CoachResourceHeader' },
    '@/components/KeyboardAwareScrollView': { KeyboardAwareScrollView: 'KeyboardAwareScrollView' },
    '@/components/ScreenWrapper': { ScreenWrapper: 'ScreenWrapper' },
    '@/components/WeatherDelayLightningOption': { WeatherDelayLightningOption: 'WeatherDelayLightningOption' },
    '@/constants/theme': theme, '@/context/AuthContext': { useAuth: () => ({ user: { displayName: 'Coach' } }) },
    '@/services/coachResourcesService': {
      getCoachCommunicationTemplate: () => template, resolveCoachResourceLocale: () => 'en', localizeCoachText: (value) => value,
      personalizeCoachTemplate: (_template, _locale, values) => `Hi ${values.teamName ?? '{teamName}'}. Next update: {time}.`,
      findUnresolvedCoachPlaceholders: (value) => [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]),
    },
    '@/services/teamService': { getCurrentUserTeamMemberships: async () => memberships, hasCoachAccess: () => true, isTeamActive: () => true },
    '@/utils/coachCommunicationDraftCore': load(read('utils/coachCommunicationDraftCore.ts')),
    '@/hooks/useSquadWeather': { useSquadWeather: (binding) => ({ source: binding.squadId === known.squadId ? configuredHome : null, failed: false }) },
    '@/utils/weatherDelayLightning': core,
  }).default);
  route.render(); await flush(); tree = route.render();
  findAll(tree, (node) => node.props.accessibilityRole === 'radio')[0].props.onPress();
  tree = route.render();
  find(tree, (node) => node.type === 'TextInput').props.onChangeText(input.message);
  tree = route.render();
  find(tree, (node) => node.type === 'WeatherDelayLightningOption').props.onChange(true);
  tree = route.render();
  assert.equal(shared.length + navigated.length, 0, 'including a link never sends or shares automatically');
  find(tree, (node) => node.type === 'TouchableOpacity' && hasText(node, 'coach.resources.shareMessage')).props.onPress();
  await flush();
  find(tree, (node) => node.type === 'TouchableOpacity' && hasText(node, 'coach.resources.sendToTeam')).props.onPress();
  assert.equal(shared[0].message, navigated[0].params.draftBody, 'share and team composer use exactly the same final preview');
  assert.ok(shared[0].message.includes(approved.url));
  assert.equal(navigated[0].params.teamId, 'home');
  findAll(tree, (node) => node.props.accessibilityRole === 'radio')[1].props.onPress();
  tree = route.render();
  assert.equal(find(tree, (node) => node.type === 'WeatherDelayLightningOption').props.checked, false, 'team switching must not carry venue confirmation');
  assert.ok(!find(tree, (node) => node.type === 'TextInput').props.value.includes(approved.url));
  findAll(tree, (node) => node.props.accessibilityRole === 'radio')[0].props.onPress();
  tree = route.render();
  assert.equal(find(tree, (node) => node.type === 'WeatherDelayLightningOption').props.checked, true);
  assert.equal(find(tree, (node) => node.type === 'TextInput').props.value, input.message, 'team drafts preserve coach edits');
  find(tree, (node) => node.type === 'WeatherDelayLightningOption').props.onChange(false);
  tree = route.render();
  find(tree, (node) => node.type === 'TouchableOpacity' && hasText(node, 'coach.resources.shareMessage')).props.onPress();
  await flush();
  assert.equal(shared[1].message, input.message, 'unchecking removes only the optional suffix');
  find(tree, (node) => node.type === 'TextInput').props.onChangeText('');
  find(tree, (node) => node.type === 'WeatherDelayLightningOption').props.onChange(true);
  tree = route.render();
  find(tree, (node) => node.type === 'TouchableOpacity' && hasText(node, 'coach.resources.shareMessage')).props.onPress();
  await flush();
  assert.equal(shared.length, 2, 'the optional link cannot make an empty coach message valid');
  find(tree, (node) => node.type === 'TextInput').props.onChangeText('Coach update. '.repeat(160));
  tree = route.render();
  find(tree, (node) => node.type === 'TouchableOpacity' && hasText(node, 'coach.resources.sendToTeam')).props.onPress();
  assert.equal(navigated.length, 1, 'a long suffix must not overflow or be silently truncated by the team composer');

  configuredHome = { ...approved, id: 'squad-weather:home:2', url: 'https://weather.example.org/facility#venue' };
  tree = route.render();
  assert.equal(find(tree, (node) => node.type === 'WeatherDelayLightningOption').props.checked, false, 'Changing a saved link requires fresh venue confirmation');
  find(tree, (node) => node.type === 'TextInput').props.onChangeText(input.message);
  find(tree, (node) => node.type === 'WeatherDelayLightningOption').props.onChange(true);
  tree = route.render();
  find(tree, (node) => node.type === 'TouchableOpacity' && hasText(node, 'coach.resources.shareMessage')).props.onPress(); await flush();
  assert.ok(shared.at(-1).message.includes(configuredHome.url)); assert.ok(!shared.at(-1).message.includes(approved.url));
  configuredHome = null; tree = route.render();
  find(tree, (node) => node.type === 'TouchableOpacity' && hasText(node, 'coach.resources.shareMessage')).props.onPress(); await flush();
  assert.equal(shared.at(-1).message, input.message, 'Removal suppresses the optional link without losing the coach draft');

  let browser = deferred();
  const opened = [];
  const service = load(read('services/venueLightningService.ts'), {
    'expo-web-browser': { WebBrowserResultType: { LOCKED: 'locked' }, openBrowserAsync: (url) => { opened.push(url); return browser.promise; } },
    '@/constants/theme': theme, '@/utils/venueLightning': venueCore, '@/utils/weatherDelayLightning': core,
    '@/functions/src/squadWeatherCore': require('../functions/lib/squadWeatherCore'),
  });
  const first = service.openApprovedLightningMessageUrl(approved.url);
  assert.equal(service.openVenueLightningStatus(known), first, 'card and announcement opens coalesce');
  await flush();
  assert.deepEqual(opened, [approved.url], 'provider request has no additional personal parameters');
  browser.resolve({ type: 'cancel' }); await first;
  await assert.rejects(service.openApprovedLightningMessageUrl(`${approved.url}&extra=true`), /UNAVAILABLE/);
  assert.equal(opened.length, 1);

  let request = deferred(), calls = 0;
  const announcement = harness((React) => load(read('components/AnnouncementBody.tsx'), {
    react: React, 'react-native': native, 'react-i18next': translation, '@/constants/theme': theme,
    '@/utils/weatherDelayLightning': core,
    '@/constants/venueLightning': registry,
    '@/hooks/useSquadWeather': { useSquadWeather: () => ({ source: null, failed: false }) },
    '@/services/venueLightningService': { openApprovedLightningMessageUrl: () => { calls += 1; return request.promise; } },
  }).AnnouncementBody);
  tree = announcement.render({ body: combined });
  const link = find(tree, (node) => node.props.accessibilityRole === 'link');
  assert.ok(link); link.props.onPress(); link.props.onPress(); assert.equal(calls, 1);
  request.reject(new Error('private raw browser detail')); await flush();
  tree = announcement.render({ body: combined });
  assert.ok(find(tree, (node) => node.props.accessibilityRole === 'alert'));
  assert.ok(!JSON.stringify(tree).includes('private raw browser detail'));
  request = deferred(); find(tree, (node) => node.type === 'TouchableOpacity').props.onPress();
  assert.equal(calls, 2); request.resolve(); await flush();
  tree = announcement.render({ body: combined });
  assert.equal(find(tree, (node) => node.props.accessibilityRole === 'alert'), undefined);
  request = deferred(); find(tree, (node) => node.props.accessibilityRole === 'link').props.onPress();
  tree = announcement.render({ body: 'A different announcement' });
  request.reject(new Error('old announcement')); await flush();
  tree = announcement.render({ body: 'A different announcement' });
  assert.equal(find(tree, (node) => node.props.accessibilityRole === 'alert'), undefined);
  assert.equal(find(tree, (node) => node.props.accessibilityRole === 'link'), undefined);
  tree = announcement.render({ body: combined }); request = deferred();
  find(tree, (node) => node.props.accessibilityRole === 'link').props.onPress();
  announcement.unmount(); request.reject(new Error('closed screen')); await flush();
  assert.equal(announcement.lateWrites(), 0);
  console.log('Weather Delay venue opt-in, team drafts, shared/composer content, exact links and browser Retry passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
