'use strict';
// Fake services and hook state only; no SDK, network, device or emitted build.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const { createSourceLoader, root } = require('./coach-ai-test-loader.cjs');
const source = createSourceLoader();
const resolve = source('utils/coachAiBillingAvailability.ts').resolveCoachAiBillingAvailability;
const translations = source('content/coachAiBillingTranslations.ts').coachAiBillingTranslations;
const active = { userId: 'fixture_a', enabled: true, entitled: false, plan: null, remaining: 0, pending: 0, limit: 30, resetsAtMs: null, accessUntilMs: null, store: null, autoRenews: false };
const cases = [];
async function test(name, run) { await run(); cases.push(name); }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness() {
  const slots = [], effects = [];
  let cursor = 0, dirty = false, render, value;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const id = cursor++;
      if (!(id in slots)) slots[id] = typeof initial === 'function' ? initial() : initial;
      return [slots[id], next => { const result = typeof next === 'function' ? next(slots[id]) : next; if (!Object.is(result, slots[id])) { slots[id] = result; dirty = true; } }];
    },
    useRef(initial) { const id = cursor++; return slots[id] ?? (slots[id] = { current: initial }); },
    useCallback(callback, deps) { const id = cursor++; if (!slots[id] || !same(slots[id].deps, deps)) slots[id] = { callback, deps }; return slots[id].callback; },
    useEffect(callback, deps) {
      const id = cursor++, old = slots[id];
      if (!old || !same(old.deps, deps)) { slots[id] = { deps, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[id].cleanup = callback(); }); }
    },
  };
  function flush() {
    for (let i = 0; i < 30; i++) {
      if (dirty) { dirty = false; cursor = 0; value = render(); }
      while (effects.length) effects.shift()();
      if (!dirty) return value;
    }
    throw Error('fixture_render_did_not_settle');
  }
  return { react, mount(callback) { render = callback; dirty = true; return flush(); }, render() { dirty = true; return flush(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
    async settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); flush(); } return value; } };
}
function nodes(tree) {
  if (tree == null || tree === false) return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [tree];
}
function pageFixture() {
  const h = harness(), request = deferred();
  let access = { entitlementSource: null, billing: { enabled: true, eligible: true, availability: 'checking', status: null, loading: true, refresh: async () => {} } };
  let planCalls = 0, purchaseCalls = 0, restoreCalls = 0;
  let t = key => key, uid = 'fixture_a';
  const jsx = (type, props) => ({ type, props: props || {} });
  const overrides = {
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ActivityIndicator: 'Spinner', Linking: { openURL: async () => {} }, ScrollView: 'Scroll', Text: 'Text', TouchableOpacity: 'Button', View: 'View', StyleSheet: { create: value => value } },
    'react-i18next': { useTranslation: () => ({ t, i18n: { language: 'en' } }) },
    '@/components/Card': { Card: 'Card' }, '@/components/CoachResourceHeader': { CoachResourceHeader: 'Header' }, '@/components/ScreenWrapper': { ScreenWrapper: 'Screen' },
    '@/constants/theme': { Colors: {}, Radius: {}, Spacing: {}, Typography: {} },
    '@/config/legal': { PRIVACY_POLICY_URL: 'https://fixture.invalid/privacy', TERMS_OF_USE_URL: 'https://fixture.invalid/terms' },
    '@/context/AuthContext': { useAuth: () => ({ user: uid ? { uid } : null }) },
    '@/hooks/useCoachAiAccess': { useCoachAiAccess: () => access },
    '@/services/coachAiBillingService': {
      getCoachAiPurchasePackages: () => { planCalls++; return request.promise; },
      purchaseCoachAi: async () => { purchaseCalls++; return active; },
      restoreCoachAi: async () => { restoreCalls++; return active; }, coachAiManagementUrl: () => null,
    },
    '@/utils/coachAiPurchaseCore': source('utils/coachAiPurchaseCore.ts'),
    '@/utils/coachAiBillingDiagnostics': source('utils/coachAiBillingDiagnostics.ts'),
  };
  const file = path.join(root, 'app/coach/resources/subscription.tsx');
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputText)(module, module.exports, name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    throw Error('unexpected_fixture_import:' + name);
  });
  const Screen = module.exports.default, has = (tree, text) => nodes(tree).includes(text);
  return { h, request, has, button: (tree, label) => nodes(tree).find(n => n?.type === 'Button' && has(n, label)),
    mount: () => h.mount(Screen), update(billing) { access = { ...access, billing: { ...access.billing, ...billing } }; return h.render(); },
    localeChange() { t = key => key; return h.render(); },
    accountChange(next) { uid = next; return h.render(); },
    counts: () => ({ planCalls, purchaseCalls, restoreCalls }) };
}
async function main() {
  await test('unknown_status_is_checking_and_verified_disabled_status_is_unavailable', () => {
    const base = { enabled: true, eligible: true, prerequisitesLoading: false, prerequisitesError: false, loading: false, error: false, status: null };
    for (const [patch, expected] of [
      [{}, 'checking'], [{ prerequisitesLoading: true, eligible: false }, 'checking'], [{ loading: true, status: active }, 'checking'],
      [{ status: { ...active, enabled: false } }, 'billing_unavailable'], [{ status: active }, 'ready'],
      [{ error: true }, 'verification_error'], [{ prerequisitesError: true, eligible: false }, 'verification_error'],
      [{ eligible: false }, 'account_unavailable'], [{ enabled: false }, 'build_unavailable'],
    ]) assert.equal(resolve({ ...base, ...patch }), expected);
  });
  await test('actual_hook_waits_for_hydration_checks_once_and_fences_late_account_response', async () => {
    const h = harness(), requests = [];
    let auth = { user: { uid: 'fixture_a', adultEligibilityConfirmed: true }, loading: true };
    let standing = { standing: null, loading: true, error: false };
    const hook = createSourceLoader({
      react: h.react, 'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
      '@/context/AuthContext': { useAuth: () => auth }, '@/context/AppContext': { useApp: () => ({ activeMode: 'coach' }) },
      '@/context/AccountStandingContext': { useAccountStanding: () => standing },
      '@/services/coachAiBillingService': { COACH_AI_BILLING_ENABLED: true,
        fetchCoachAiBillingStatus(uid) { const request = deferred(); requests.push({ uid, ...request }); return request.promise; },
        subscribeCoachAiBilling: () => () => {} },
    })('hooks/useCoachAiBilling.ts').useCoachAiBilling;
    assert.equal(h.mount(hook).availability, 'checking'); assert.equal(requests.length, 0);
    auth = { ...auth, loading: false }; standing = { standing: null, loading: false, error: true };
    assert.equal(h.render().availability, 'verification_error'); assert.equal(requests.length, 0);
    standing = { standing: { status: 'active' }, loading: false, error: false };
    assert.equal(h.render().availability, 'checking'); assert.equal(requests.length, 1);
    requests[0].resolve(active); assert.equal((await h.settle()).availability, 'ready');
    h.render(); assert.equal(requests.length, 1);
    auth = { user: { uid: 'fixture_b', adultEligibilityConfirmed: true }, loading: false };
    assert.equal(h.render().availability, 'checking'); assert.equal(requests.length, 2);
    auth = { user: null, loading: false }; assert.equal(h.render().availability, 'account_unavailable');
    requests[1].resolve({ ...active, userId: 'fixture_b' }); assert.equal((await h.settle()).status, null);
  });
  await test('checking_and_disabled_full_page_preserve_disclosures_without_purchase_controls', () => {
    const f = pageFixture(); let tree = f.mount();
    assert.ok(f.has(tree, 'coachAiBilling.availability.checking')); assert.ok(!f.has(tree, 'coachAiBilling.availability.billing_unavailable'));
    assert.ok(f.has(tree, 'coachAiBilling.included') && f.has(tree, 'coachAiBilling.support'));
    assert.ok(!f.button(tree, 'coachAiBilling.subscribe')); assert.equal(f.button(tree, 'coachAiBilling.restore').props.disabled, true);
    tree = f.update({ availability: 'billing_unavailable', loading: false, status: { ...active, enabled: false } });
    assert.ok(f.has(tree, 'coachAiBilling.availability.billing_unavailable')); assert.ok(!f.button(tree, 'coachAiBilling.subscribe'));
    assert.equal(f.button(tree, 'coachAiBilling.restore').props.disabled, true);
    assert.deepEqual(f.counts(), { planCalls: 0, purchaseCalls: 0, restoreCalls: 0 });
  });
  await test('enabled_status_loads_both_plans_once_and_selection_unlocks_subscribe', async () => {
    const f = pageFixture(); f.mount(); f.update({ availability: 'ready', status: active, loading: false });
    f.request.resolve({ monthly: { product: { priceString: '$2.99' } }, yearly: { product: { priceString: '$24.99' } } });
    let tree = await f.h.settle(); assert.ok(f.has(tree, '$2.99') && f.has(tree, '$24.99'));
    assert.equal(f.button(tree, 'coachAiBilling.subscribe').props.disabled, true);
    f.button(tree, 'coachAiBilling.monthly').props.onPress(); tree = f.h.render();
    assert.equal(f.button(tree, 'coachAiBilling.subscribe').props.disabled, false);
    assert.deepEqual(f.counts(), { planCalls: 1, purchaseCalls: 0, restoreCalls: 0 });
  });
  await test('store_failure_is_distinct_and_rerenders_never_retry_the_plan_request', async () => {
    const f = pageFixture(); f.mount(); f.update({ availability: 'ready', status: active, loading: false });
    f.request.reject(Error('private_fake_store_error')); const tree = await f.h.settle();
    assert.ok(f.has(tree, 'coachAiBilling.planDiagnostics.store_request')); assert.ok(!f.has(tree, 'coachAiBilling.availability.billing_unavailable'));
    assert.equal(f.button(tree, 'coachAiBilling.subscribe').props.disabled, true);
    f.update({ availability: 'checking', loading: true, status: null });
    assert.ok(f.has(f.localeChange(), 'coachAiBilling.planDiagnostics.store_request'));
    f.update({ availability: 'ready', loading: false, status: active });
    f.h.render(); await f.h.settle(); assert.equal(f.counts().planCalls, 1);
    const details = f.button(f.h.render(), 'coachAiBilling.showSupportDetails');
    assert.ok(details); details.props.onPress();
    const visible = nodes(f.h.render()).filter(value => typeof value === 'string').join(' ');
    assert.ok(visible.includes('request_failed'));
    assert.ok(!visible.includes('private_fake_store_error') && !visible.includes('fixture_a'));
  });
  await test('verification_failure_keeps_purchase_restore_closed_without_store_request', () => {
    const f = pageFixture(); f.mount(); const tree = f.update({ availability: 'verification_error', loading: false, status: null });
    assert.ok(f.has(tree, 'coachAiBilling.availability.verification_error')); assert.ok(!f.button(tree, 'coachAiBilling.subscribe'));
    assert.equal(f.button(tree, 'coachAiBilling.restore').props.disabled, true); assert.equal(f.counts().planCalls, 0);
  });
  await test('english_and_spanish_have_matching_nonempty_availability_messages', () => {
    assert.deepEqual(Object.keys(translations.en.availability).sort(), Object.keys(translations.es.availability).sort());
    assert.deepEqual(Object.keys(translations.en.planDiagnostics).sort(), Object.keys(translations.es.planDiagnostics).sort());
    for (const locale of ['en', 'es']) for (const message of Object.values(translations[locale].availability)) assert.ok(message.length > 15);
    for (const locale of ['en', 'es']) for (const message of Object.values(translations[locale].planDiagnostics)) assert.ok(message.length > 15);
  });
  return { state: 'PASSED', groups: cases.length, cases, networkRequests: 0, builds: 0, liveChanges: 0 };
}
module.exports = { main, harness, pageFixture, nodes, deferred };
if (require.main === module) main().then(value => console.log(JSON.stringify(value))).catch(error => { console.error(error); process.exitCode = 1; });
