'use strict';
// Render the actual routes with fictional local state; never load a live SDK.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createSourceLoader, root } = require('./coach-ai-test-loader.cjs');
const { harness, nodes } = require('./test-coach-ai-billing-availability.cjs');
const load = createSourceLoader();
const { resolveCoachAiAccess } = load('utils/coachAiAccess.ts');
const base = { buildAvailable: false, billingAvailable: true, claimLoaded: true,
  testerClaimEntitled: false, paidEntitled: false, paidRemaining: 0,
  signedIn: true, adultEligible: true, activeMode: 'coach', accountStanding: 'active' };
const cases = [];
const parsed = new Map();

function compile(file) {
  if (!parsed.has(file)) {
    const result = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
      fileName: file, reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    assert.deepEqual((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error), [], file);
    parsed.set(file, result.outputText);
  }
  return parsed.get(file);
}

function fixture({ route = 'help', input = {}, accepted = true, availability = 'ready' } = {}) {
  const h = harness(), navigations = [];
  let values = { ...base, ...input }, generationCalls = 0;
  const savedEntry = { id: 'fixture_saved_guide', result: { title: 'Fictional saved guide' } };
  const jsx = (type, props) => ({ type, props: props || {} });
  const overrides = {
    react: { ...h.react, useLayoutEffect: h.react.useEffect },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { AccessibilityInfo: { announceForAccessibility() {} }, ActivityIndicator: 'Spinner',
      Platform: { OS: 'android' }, ScrollView: 'Scroll', Text: 'Text', TextInput: 'Input',
      TouchableOpacity: 'Button', View: 'View', StyleSheet: { create: styles => styles } },
    'expo-router': { router: { push: route => navigations.push(route), replace: route => navigations.push(route) },
      useFocusEffect: callback => h.react.useEffect(callback, [callback]) },
    'lucide-react-native': Object.fromEntries(['ChevronDown', 'ChevronRight', 'ShieldAlert', 'ClipboardList',
      'Lightbulb', 'MessageSquareText', 'Sparkles'].map(name => [name, name])),
    'react-i18next': { useTranslation: () => ({ t: key => key, i18n: { language: 'en' } }) },
    '@/components/Card': { Card: 'Card' },
    '@/components/CoachAiBillingSummary': { CoachAiBillingSummary: 'BillingSummary' },
    '@/components/CoachResourceHeader': { CoachResourceHeader: 'Header' },
    '@/components/ScreenWrapper': { ScreenWrapper: 'Screen' },
    '@/components/CoachAiKeyboardAwareScrollView': { KeyboardAwareScrollView: 'Scroll' },
    '@/constants/theme': { Colors: {}, Radius: {}, Shadow: {}, Spacing: {}, Typography: {} },
    '@/context/AuthContext': { useAuth: () => ({ user: values.signedIn ? { uid: 'fixture_coach' } : null }) },
    '@/hooks/useCoachAiAccess': { useCoachAiAccess: () => ({ ...resolveCoachAiAccess(values),
      billing: { enabled: true, availability, status: { entitled: values.paidEntitled, remaining: values.paidRemaining } } }) },
    '@/services/coachResourcesService': {
      resolveCoachResourceLocale: () => 'en', hasAcceptedCoachAiDisclosure: async () => accepted,
      getSavedCoachHelpResults: async () => [savedEntry], acceptCoachAiDisclosure: async () => {},
      generateCoachResourceHelp: async () => { generationCalls++; throw Error('unexpected_generation'); },
      cacheGeneratedCoachHelpResult: async () => {}, getDailyCoachProTip: () => ({ title: {}, body: {} }),
      localizeCoachText: () => 'Fictional static tip',
    },
    '@/utils/coachAiErrors': load('utils/coachAiErrors.ts'),
    '@/utils/coachAiExperienceCore': load('utils/coachAiExperienceCore.ts'),
  };
  const file = route === 'hub' ? 'app/coach/resources/index.tsx' : 'app/coach/resources/help/index.tsx';
  const module = { exports: {} };
  new Function('module', 'exports', 'require', compile(file))(module, module.exports, name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    throw Error('unexpected_visibility_import:' + name);
  });
  const has = (tree, text) => nodes(tree).includes(text);
  return { h, has, navigations, mount: () => h.mount(module.exports.default),
    update(patch) { values = { ...values, ...patch }; return h.render(); },
    button: (tree, text) => nodes(tree).find(node => node?.type === 'Button' && has(node, text)),
    assertNoForm(tree) {
      assert.equal(has(tree, 'coach.resources.helpQuestion'), false);
      assert.equal(nodes(tree).some(node => node?.type === 'Input' || typeof node?.type === 'function' && node.type.name === 'Field'), false);
      assert.equal(has(tree, 'coach.resources.generateHelp'), false);
      for (const category of ['practice_plan', 'parent_message', 'other']) assert.equal(has(tree, 'coach.resources.helpCategories.' + category), false);
    }, generationCalls: () => generationCalls };
}

async function test(name, run) {
  if (process.argv.includes('--hub-only') && name !== 'hub_offers_saved_guides_instead_of_creation_for_unpaid_users') return;
  await run(); cases.push(name);
}
async function main() {
  await test('entitlement_required_for_creation_but_saved_navigation_remains', () => {
    for (const patch of [{}, { claimLoaded: false }, { buildAvailable: true, testerClaimEntitled: false }]) {
      const access = resolveCoachAiAccess({ ...base, ...patch });
      assert.equal(access.canView, true); assert.equal(access.canCreate, false); assert.equal(access.canRequest, false);
    }
    const paid = resolveCoachAiAccess({ ...base, paidEntitled: true, paidRemaining: 0 });
    assert.equal(paid.canCreate, true); assert.equal(paid.canRequest, false);
    const beta = resolveCoachAiAccess({ ...base, buildAvailable: true, testerClaimEntitled: true });
    assert.equal(beta.canCreate, true); assert.equal(beta.canRequest, true);
    assert.equal(resolveCoachAiAccess({ ...base, testerClaimEntitled: true }).canCreate, false);
    for (const patch of [{ signedIn: false }, { adultEligible: false }, { activeMode: 'parent' },
      { accountStanding: 'banned' }, { accountStanding: null }]) {
      const access = resolveCoachAiAccess({ ...base, paidEntitled: true, paidRemaining: 30, ...patch });
      assert.equal(access.canCreate, false); assert.equal(access.canView, false);
    }
  });
  await test('unpaid_expired_paused_and_checking_routes_show_saved_guides_without_consent', async () => {
    for (const availability of ['ready', 'billing_unavailable', 'checking', 'verification_error']) {
      const f = fixture({ accepted: false, availability }); f.mount();
      let tree = await f.h.settle(); f.assertNoForm(tree);
      assert.ok(nodes(tree).some(node => node?.type === 'Header' && node.props.title === 'coach.resources.savedHelpEntry'));
      assert.equal(f.has(tree, 'coach.resources.aiDisclosureContinue'), false);
      assert.ok(nodes(tree).some(node => node?.type === 'BillingSummary'));
      f.button(tree, 'coach.resources.savedHelp').props.onPress(); tree = await f.h.settle();
      f.button(tree, 'Fictional saved guide').props.onPress();
      assert.deepEqual(f.navigations, [{ pathname: '/coach/resources/help/result', params: { requestId: 'fixture_saved_guide' } }]);
      assert.equal(f.generationCalls(), 0); f.h.unmount();
    }
  });
  await test('paid_and_approved_beta_accounts_retain_topics_and_forms', async () => {
    for (const input of [{ paidEntitled: true, paidRemaining: 30 }, { buildAvailable: true, testerClaimEntitled: true }]) {
      const f = fixture({ input }); f.mount(); let tree = await f.h.settle();
      assert.ok(f.has(tree, 'coach.resources.helpQuestion'));
      f.button(tree, 'coach.resources.helpCategories.practice_plan').props.onPress(); tree = await f.h.settle();
      assert.ok(nodes(tree).some(node => typeof node?.type === 'function' && node.type.name === 'Field'));
      assert.equal(f.button(tree, 'coach.resources.generateHelp').props.disabled, false);
      assert.equal(f.generationCalls(), 0); f.h.unmount();
    }
  });
  await test('paid_zero_allowance_keeps_menu_but_not_generation', async () => {
    const f = fixture({ input: { paidEntitled: true, paidRemaining: 0 } }); f.mount();
    let tree = await f.h.settle(); f.button(tree, 'coach.resources.helpCategories.practice_plan').props.onPress();
    tree = await f.h.settle(); assert.equal(f.button(tree, 'coach.resources.generateHelp').props.disabled, true); f.h.unmount();
  });
  await test('entitlement_loss_hides_an_already_selected_form_immediately', async () => {
    const f = fixture({ input: { paidEntitled: true, paidRemaining: 30 } }); f.mount();
    let tree = await f.h.settle(); f.button(tree, 'coach.resources.helpCategories.practice_plan').props.onPress();
    tree = await f.h.settle(); assert.ok(f.button(tree, 'coach.resources.generateHelp'));
    tree = f.update({ paidEntitled: false, paidRemaining: 0 }); f.assertNoForm(tree);
    assert.ok(f.button(tree, 'coach.resources.savedHelp')); assert.equal(f.generationCalls(), 0); f.h.unmount();
  });
  await test('entitled_users_still_accept_ai_disclosure_before_seeing_form', async () => {
    const f = fixture({ input: { paidEntitled: true, paidRemaining: 30 }, accepted: false }); f.mount();
    const tree = await f.h.settle(); f.assertNoForm(tree);
    assert.ok(f.button(tree, 'coach.resources.aiDisclosureContinue')); f.h.unmount();
  });
  await test('hub_offers_saved_guides_instead_of_creation_for_unpaid_users', async () => {
    const f = fixture({ route: 'hub' }); const tree = f.mount();
    assert.equal(f.has(tree, 'coach.resources.needHelp'), false); assert.equal(f.has(tree, 'coach.resources.notFinding'), false);
    f.button(tree, 'coach.resources.savedHelpEntry').props.onPress();
    assert.deepEqual(f.navigations, ['/coach/resources/help']);
    for (const text of ['checklists', 'communication']) assert.ok(nodes(tree).some(node =>
      typeof node?.type === 'function' && node.type.name === 'ResourceCard' && node.props.title === 'coach.resources.' + text));
    f.h.unmount();
    const paid = fixture({ route: 'hub', input: { paidEntitled: true, paidRemaining: 30 } });
    assert.ok(paid.button(paid.mount(), 'coach.resources.needHelp')); paid.h.unmount();
  });
  await test('updated_translation_source_parses', () => { compile('i18n/index.ts'); compile('utils/coachAiAccess.ts'); });
  return { status: 'PASS', groups: cases.length, cases, networkRequests: 0, generationRequests: 0,
    builds: 0, deployments: 0, retries: 0 };
}

main().then(result => console.log(JSON.stringify(result))).catch(error => {
  console.error(JSON.stringify({ status: 'FAIL', completed: cases, message: error.message })); process.exitCode = 1;
});
