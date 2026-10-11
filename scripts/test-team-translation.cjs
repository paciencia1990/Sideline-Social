'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const core = require('../functions/lib/teamTranslationCore');
const root = path.resolve(__dirname, '..');
const catalog = require('../functions/src/teamTranslationLanguages.json');
function load(file, modules) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`); return modules[name];
  }, module, module.exports);
  return module.exports;
}
const clientCore = load('utils/teamTranslation.ts', { '@/functions/src/teamTranslationLanguages.json': catalog });
const request = { kind: 'announcement', teamId: 'team-a', messageId: 'announcement-a', targetLanguage: 'es', consentVersion: 1 };
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness(factory) {
  const hooks = []; let cursor = 0, effects = [], mounted = true, lateWrites = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const slot = cursor++; if (!hooks[slot]) hooks[slot] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[slot].value, (value) => { if (!mounted) lateWrites++; hooks[slot].value = typeof value === 'function' ? value(hooks[slot].value) : value; }]; },
    useRef(initial) { const slot = cursor++; if (!hooks[slot]) hooks[slot] = { current: initial }; return hooks[slot]; },
    useEffect(effect, deps) { const slot = cursor++, previous = hooks[slot]; if (!previous || deps.some((value, index) => value !== previous.deps[index])) effects.push(() => { previous?.cleanup?.(); hooks[slot] = { deps, cleanup: effect() }; }); },
  };
  const component = factory(React);
  return { render(props) { cursor = 0; effects = []; const tree = component(props); effects.forEach((run) => run()); return tree; },
    unmount() { hooks.forEach((hook) => hook?.cleanup?.()); mounted = false; }, lateWrites: () => lateWrites };
}
function all(tree, predicate) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap((node) => all(node, predicate)); return [...(predicate(tree) ? [tree] : []), ...all(tree.props?.children, predicate)]; }
const find = (tree, predicate) => all(tree, predicate)[0];

(async () => {
  assert.deepEqual(core.parseTranslationRequest(request), request);
  for (const changes of [{ consentVersion: 0 }, { targetLanguage: 'unsupported' }, { teamId: '../users/secret' }, { text: 'Client-supplied secret' }, { kind: 'friendMessage' }]) {
    assert.throws(() => core.parseTranslationRequest({ ...request, ...changes }), /invalid-argument/);
  }
  assert.equal(clientCore.translationLanguageForLocale('zh-Hant-HK'), 'zh-TW');
  assert.equal(clientCore.translationLanguageForLocale('es-US'), 'es');
  assert.equal(clientCore.translationLanguageForLocale('fil-PH'), 'tl');
  assert.equal(clientCore.translationLanguageForLocale('xx'), null);
  assert.equal(core.translationCharacters(['😀 a']), 3, 'Billing counts Unicode code points, including spaces');
  const text = 'PLEASE use SCYTYR or SC5Y9R: https://example.test/page?id=1\nEmail coach@example.test';
  const parts = core.splitTranslationText(text, 'SCYTYR');
  assert.equal(parts.map((part) => part.text).join(''), text);
  assert.ok(parts.some((part) => part.translate && part.text.includes('PLEASE')), 'Uppercase ordinary words still translate');
  assert.deepEqual(parts.filter((part) => !part.translate && part.text.trim()).map((part) => part.text), ['SCYTYR', 'SC5Y9R', 'https://example.test/page?id=1', 'coach@example.test']);
  assert.ok(parts.filter((part) => part.translate).every((part) => part.text === part.text.trim()));
  const now = Date.UTC(2026, 9, 10);
  const usage = core.nextTranslationUsage({ now, characters: 30, monthlyLimit: 50, global: {}, user: {} });
  assert.throws(() => core.nextTranslationUsage({ now, characters: 21, monthlyLimit: 50, ...usage }), /resource-exhausted/);
  assert.throws(() => core.nextTranslationUsage({ now, characters: 1, monthlyLimit: 50, global: { month: '2026-10', characters: -1 }, user: {} }), /resource-exhausted/);
  assert.equal(core.nextTranslationUsage({ now: Date.UTC(2026, 10, 1), characters: 30, monthlyLimit: 50, ...usage }).global.characters, 30);
  assert.throws(() => core.nextTranslationUsage({ now, characters: 1, monthlyLimit: 50, global: {}, user: { minute: Math.floor(now / 60000), requests: 10 } }), /resource-exhausted/);

  let visible = true, original = text, calls = 0, reservations = 0, clock = now;
  let provider = deferred();
  const engine = core.createTranslationEngine({
    now: () => clock, load: async () => { if (!visible) throw new Error('permission-denied'); return { text: original, inviteCode: 'SCYTYR' }; },
    reserve: async (_uid, count) => { reservations += count; },
    translate: async (texts, language) => { calls++; assert.equal(language, 'es'); assert.ok(!texts.join('').includes('example.test')); await provider.promise; return texts.map((value) => `ES:${value}`); },
  });
  const first = engine('parent-a', request), duplicate = engine('parent-b', request);
  await flush(); assert.equal(calls, 1); provider.resolve();
  const [one, two] = await Promise.all([first, duplicate]);
  assert.equal(one.translatedText, two.translatedText); assert.ok(one.translatedText.includes('https://example.test/page?id=1'));
  assert.equal(one.originalText, text); assert.equal(reservations, core.translationCharacters(parts.filter((part) => part.translate).map((part) => part.text)));
  await engine('parent-a', request); assert.equal(calls, 1, 'Unchanged text and language reuse short-lived result');
  visible = false; await assert.rejects(engine('parent-a', request), /permission-denied/); visible = true;
  original = 'Changed message'; provider = deferred(); const changed = engine('parent-a', request); await flush();
  visible = false; provider.resolve(); await assert.rejects(changed, /permission-denied/); visible = true;
  original = 'Changed during provider'; provider = deferred(); const stale = engine('parent-a', request); await flush(); original = 'New revision'; provider.resolve(); await assert.rejects(stale, /failed-precondition/);
  clock += 6 * 60000; provider = deferred(); const expired = engine('parent-a', request); await flush(); provider.resolve(); await expired; assert.equal(calls, 4);

  const storage = new Map(); let authListener, serviceCalls = 0, pendingResponse = deferred();
  const auth = { currentUser: { uid: 'parent-a' } };
  const service = load('services/teamTranslationService.ts', {
    '@react-native-async-storage/async-storage': { getItem: async (key) => storage.get(key), setItem: async (key, value) => storage.set(key, value) },
    'firebase/functions': { httpsCallable: (_functions, name) => { assert.equal(name, 'translateTeamMessage'); return async (data) => { serviceCalls++; assert.ok(!('text' in data)); assert.equal(data.consentVersion, 1); return { data: await pendingResponse.promise }; }; } },
    'expo-web-browser': { WebBrowserResultType: { LOCKED: 'locked' }, openBrowserAsync: async (url) => { assert.equal(url, clientCore.GOOGLE_TRANSLATION_INFO_URL); return { type: 'cancel' }; } },
    '@/config/firebase': { auth, functions: {}, firebaseAppCheckReady: Promise.resolve() }, '@/utils/teamTranslation': clientCore,
  });
  await service.saveTranslationLanguage('parent-a', 'es'); assert.equal(await service.getTranslationLanguage('parent-b'), null);
  await service.openTranslationInformation();
  const ui = harness((React) => load('components/MessageTranslation.tsx', {
    react: React, 'react-native': { ...Object.fromEntries(['ActivityIndicator', 'Image', 'KeyboardAvoidingView', 'Modal', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map((name) => [name, name])), Platform: { OS: 'ios' }, StyleSheet: { create: (value) => value }, Linking: { openURL: async () => {} } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'react-i18next': { useTranslation: () => ({ t: (key) => key, i18n: { language: 'en' } }) },
    'firebase/auth': { onAuthStateChanged: (_auth, listener) => { authListener = listener; return () => { authListener = null; }; } },
    '@/config/firebase': { auth }, '@/constants/theme': { Colors: {}, Radius: {}, Spacing: {}, Typography: {} },
    '@/components/AnnouncementBody': { AnnouncementBody: 'AnnouncementBody' }, '@/services/teamTranslationService': service,
    '@/utils/teamTranslation': clientCore, '@/assets/images/google-translate-attribution.png': {},
  }).MessageTranslation);
  const props = { source: { kind: 'announcement', teamId: 'team-a', messageId: 'announcement-a' }, sourceText: 'Practice starts at 6.' };
  let tree = ui.render(props); await flush(); tree = ui.render(props);
  assert.equal(serviceCalls, 0, 'Rendering a message never sends text to Google');
  assert.equal(find(tree, (node) => node.type === 'AnnouncementBody'), undefined, 'No translation panel is shown by default');
  assert.equal(find(tree, (node) => node.type === 'Image'), undefined, 'No attribution block appears until translation is requested');
  find(tree, (node) => node.type === 'TouchableOpacity').props.onPress(); tree = ui.render(props);
  assert.equal(find(tree, (node) => node.type === 'Modal').props.visible, true);
  assert.ok(find(tree, (node) => node.type === 'Text' && node.props.children.includes('messageTranslation.notice')));
  const confirm = find(tree, (node) => node.type === 'TouchableOpacity' && node.props.children.some((child) => child?.type === 'Text' && child.props.children.includes('messageTranslation.translate')) && !node.props.children.includes(null));
  assert.ok(confirm); confirm.props.onPress(); confirm.props.onPress(); await flush(); assert.equal(serviceCalls, 1);
  pendingResponse.resolve({ originalText: props.sourceText, translatedText: 'La práctica empieza a las 6.', targetLanguage: 'es', provider: 'Google Translate' }); await flush();
  tree = ui.render(props); assert.ok(find(tree, (node) => node.type === 'AnnouncementBody'));
  find(tree, (node) => node.type === 'TouchableOpacity' && node.props.children.some((child) => child?.type === 'Text' && child.props.children.includes('messageTranslation.hide'))).props.onPress();
  tree = ui.render(props);
  assert.equal(find(tree, (node) => node.type === 'AnnouncementBody'), undefined);
  assert.equal(find(tree, (node) => node.type === 'Image'), undefined);
  assert.equal(find(tree, (node) => node.props?.accessibilityRole === 'link'), undefined, 'Hide removes the translation, badge, notes and information link together');
  const opener = find(tree, (node) => node.type === 'TouchableOpacity');
  assert.ok(opener.props.children.some((child) => child?.type === 'Text' && child.props.children.includes('messageTranslation.open')));
  opener.props.onPress(); tree = ui.render(props);
  assert.equal(find(tree, (node) => node.type === 'Modal').props.visible, true, 'The compact Translate button always opens the same language picker');
  all(find(tree, (node) => node.type === 'Modal'), (node) => node.type === 'TouchableOpacity').at(-2).props.onPress(); await flush();
  tree = ui.render(props); assert.ok(find(tree, (node) => node.type === 'AnnouncementBody'));
  tree = ui.render({ ...props, sourceText: 'Changed' }); tree = ui.render({ ...props, sourceText: 'Changed' });
  assert.equal(find(tree, (node) => node.type === 'AnnouncementBody'), undefined, 'Message change removes earlier translation');
  find(tree, (node) => node.type === 'TouchableOpacity').props.onPress(); tree = ui.render({ ...props, sourceText: 'Changed' });
  pendingResponse = deferred();
  const modal = find(tree, (node) => node.type === 'Modal');
  all(modal, (node) => node.type === 'TouchableOpacity').at(-2).props.onPress(); await flush();
  auth.currentUser = { uid: 'parent-b' }; authListener(auth.currentUser); tree = ui.render(props);
  pendingResponse.reject(new Error('private provider detail')); await flush(); tree = ui.render(props);
  assert.equal(find(tree, (node) => node.props?.accessibilityRole === 'alert'), undefined);
  ui.unmount(); assert.equal(ui.lateWrites(), 0);
  const functions = require('../functions/node_modules/firebase-functions');
  const diagnostics = [];
  const documents = new Map([
    ['teams/team-a', { status: 'active', inviteCode: 'SCYTYR' }],
    ['teams/team-a/members/parent-a', { status: 'active', roles: { parent: true } }],
    ['teamPrivateConversations/private', { teamId: 'team-a', coachUserId: 'coach-a', parentUserId: 'parent-a', participantUserIds: ['coach-a', 'parent-a'] }],
    ['teamPrivateConversations/private/messages/voice', { teamId: 'team-a', contentType: 'voice', senderUserId: 'coach-a', senderRole: 'coach', text: 'This is not a caption.' }],
  ]);
  const ref = (address) => ({ collection: (name) => ref(`${address}/${name}`), doc: (name) => ref(`${address}/${name}`), get: async () => ({ exists: documents.has(address), data: () => documents.get(address) }) });
  const backend = load('functions/src/teamTranslation.ts', {
    'firebase-admin': { app: () => ({ options: { credential: { getAccessToken: async () => ({ access_token: 'synthetic-not-a-real-token' }) } } }), firestore: () => ({ collection: (name) => ref(name) }) },
    'firebase-functions': { ...functions, logger: { warn: (_message, fields) => diagnostics.push(fields) } },
    './permanentAuth': { requirePermanentUid: () => 'parent-a', requireAccountCapability: async () => {} },
    './teamMembershipCore': require('../functions/lib/teamMembershipCore'), './teamVoiceMessagingCore': require('../functions/lib/teamVoiceMessagingCore'),
    './teamTranslationCore': core,
  });
  const voiceRequest = { ...request, kind: 'privateMessage', conversationId: 'private', messageId: 'voice' };
  await assert.rejects(backend.loadAuthorizedTranslationText('parent-a', voiceRequest), (error) => error.code === 'permission-denied');
  documents.get('teamPrivateConversations/private/messages/voice').caption = ' Written caption only. ';
  assert.equal((await backend.loadAuthorizedTranslationText('parent-a', voiceRequest)).text, 'Written caption only.');
  let resources;
  const i18n = { use() { return this; }, init(options) { resources = options.resources; } };
  load('i18n/index.ts', { i18next: i18n, 'react-i18next': { initReactI18next: {} },
    '@react-native-async-storage/async-storage': {}, '@/content/weeklyChallenges': { weeklyChallengeTranslations: { en: {}, es: {} } } });
  const english = resources.en.translation.messageTranslation, spanish = resources.es.translation.messageTranslation;
  assert.deepEqual(Object.keys(english).sort(), Object.keys(spanish).sort());
  for (const key of Object.keys(english)) assert.deepEqual(english[key].match(/\{\{.*?\}\}/g), spanish[key].match(/\{\{.*?\}\}/g));
  const originalFetch = global.fetch;
  const projectKeys = ['TEAM_TRANSLATION_PROJECT_ID', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT'];
  const originalProjects = Object.fromEntries(projectKeys.map(key => [key, process.env[key]]));
  try {
    projectKeys.forEach(key => delete process.env[key]);
    global.fetch = async () => { throw new Error('Must not request Google without an intended project'); };
    await assert.rejects(backend.translateWithGoogle(['Bring water.'], 'es'), error => error.code === 'unavailable');
    assert.deepEqual(diagnostics.at(-1), { stage: 'configuration' });
    process.env.TEAM_TRANSLATION_PROJECT_ID = 'demo-sideline-translation';
    global.fetch = async (url, options) => {
      assert.equal(url, 'https://translation.googleapis.com/v3/projects/demo-sideline-translation/locations/global:translateText');
      assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error'); assert.ok(options.signal);
      assert.equal(options.headers.Authorization, 'Bearer synthetic-not-a-real-token');
      assert.equal(options.headers['x-goog-user-project'], 'demo-sideline-translation', 'Provider quota/billing attribution uses the intended app project');
      assert.deepEqual(Object.keys(options.headers).sort(), ['Authorization', 'Content-Type', 'x-goog-user-project']);
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body).sort(), ['contents', 'mimeType', 'model', 'targetLanguageCode']);
      assert.deepEqual(body.contents, ['Bring water.']); assert.equal(body.mimeType, 'text/plain');
      assert.equal(body.model, 'projects/demo-sideline-translation/locations/global/models/general/nmt');
      return { ok: true, json: async () => ({ translations: [{ translatedText: 'Traigan agua.' }] }) };
    };
    assert.deepEqual(await backend.translateWithGoogle(['Bring water.'], 'es'), ['Traigan agua.']);
    assert.equal(process.env.GCLOUD_PROJECT, undefined, 'The provider works without the removed legacy project variable');
    assert.equal(core.resolveTranslationProject({ TEAM_TRANSLATION_PROJECT_ID: '../wrong-project', GCLOUD_PROJECT: 'demo-sideline-translation' }), null, 'Invalid explicit configuration never silently switches projects');
    assert.equal(core.resolveTranslationProject({ GOOGLE_CLOUD_PROJECT: 'demo-sideline-translation' }), 'demo-sideline-translation');
    let providerCalls = 0;
    global.fetch = async () => { providerCalls++; return { ok: false, status: 403, json: async () => { throw new Error('Must not read private provider body'); } }; };
    await assert.rejects(backend.translateWithGoogle(['Bring water.'], 'es'), (error) => error.code === 'unavailable');
    assert.equal(providerCalls, 1);
    assert.deepEqual(diagnostics.at(-1), { stage: 'provider_response', httpStatus: 403 });
    global.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: { status: 'PERMISSION_DENIED', message: 'private token and message', details: [{ reason: 'SERVICE_DISABLED', metadata: { credential: 'private-token' } }] } }) });
    await assert.rejects(backend.translateWithGoogle(['Bring water.'], 'es'), error => error.code === 'unavailable');
    assert.deepEqual(diagnostics.at(-1), { stage: 'provider_response', httpStatus: 403, providerCode: 'SERVICE_DISABLED' });
    global.fetch = async () => { throw new Error('private token and message in transport details'); };
    await assert.rejects(backend.translateWithGoogle(['Bring water.'], 'es'), error => error.code === 'unavailable');
    assert.deepEqual(diagnostics.at(-1), { stage: 'provider_transport' });
    assert.ok(!JSON.stringify(diagnostics).includes('Bring water') && !JSON.stringify(diagnostics).includes('token'));
  } finally {
    global.fetch = originalFetch;
    for (const key of projectKeys) { if (originalProjects[key] === undefined) delete process.env[key]; else process.env[key] = originalProjects[key]; }
  }
  console.log('Team translation: consent, languages, code/URL preservation, cache access checks, budgets, duplicate taps, account changes and stale replies passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
