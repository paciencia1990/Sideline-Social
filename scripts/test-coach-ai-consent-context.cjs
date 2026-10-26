'use strict';
// Execute the actual screen callbacks with deferred local storage and fake
// generation. Nothing is bundled, emitted, installed, or sent over the network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createSourceLoader } = require('./coach-ai-test-loader.cjs');
const root = path.resolve(__dirname, '..');
const screenText = fs.readFileSync(path.join(root, 'app/coach/resources/help/index.tsx'), 'utf8');
const screen = ts.createSourceFile('help.tsx', screenText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function initializer(name) {
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(screen);
  assert.ok(found, 'Screen binding must exist: ' + name);
  return found;
}
function evaluate(node, scope) {
  const emitted = ts.transpileModule('module.exports = (' + node.getText(screen) + ');', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function('module', ...Object.keys(scope), emitted)(loaded, ...Object.values(scope));
  return loaded.exports;
}
function callback(name, scope) {
  const call = initializer(name);
  assert.ok(ts.isCallExpression(call) && call.expression.getText(screen) === 'useCallback');
  return evaluate(call.arguments[0], scope);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function consentScope(save) {
  const events = { saved: [], accepted: [], announcements: [], errors: [], busy: [] };
  return {
    events, user: { uid: 'synthetic_coach_a' }, disclosureAccepted: false,
    generationToken: { current: 11 }, disclosureAcceptanceToken: { current: null },
    setDisclosure: value => events.accepted.push(value),
    setDisclosureError: value => events.errors.push(value),
    setAcceptingDisclosure: value => events.busy.push(value),
    acceptCoachAiDisclosure: async uid => { events.saved.push(uid); return save(); },
    AccessibilityInfo: { announceForAccessibility: value => events.announcements.push(value) },
    t: key => key,
  };
}
const cases = [];
async function test(name, fn) { await fn(); cases.push(name); }
async function run() {
  await test('old_disclosure_does_not_grant_named_provider_permission_and_accounts_are_separate', async () => {
    const values = new Map([['sidelineSocial.coachAiDisclosure.v1.synthetic_coach_a', 'accepted']]);
    const service = createSourceLoader({
      '@react-native-async-storage/async-storage': {
        getItem: async key => values.get(key) ?? null,
        setItem: async (key, value) => { values.set(key, value); },
      },
      'firebase/functions': { httpsCallable() { throw Error('network_not_allowed'); } },
      '@/config/featureFlags': { FEATURE_FLAGS: { coachAiEnabled: true } },
      '@/config/firebase': { functions: {} },
      '@/content/coachResources/checklists': { COACH_CHECKLISTS: [] },
      '@/content/coachResources/communicationTemplates': { COACH_COMMUNICATION_TEMPLATES: [] },
      '@/content/coachResources/proTips': { COACH_PRO_TIPS: [] },
      './coachAiBillingService': { COACH_AI_BILLING_ENABLED: false },
    })('services/coachResourcesService.ts');
    assert.equal(await service.hasAcceptedCoachAiDisclosure('synthetic_coach_a'), false);
    await service.acceptCoachAiDisclosure('synthetic_coach_a');
    assert.equal(await service.hasAcceptedCoachAiDisclosure('synthetic_coach_a'), true);
    assert.equal(await service.hasAcceptedCoachAiDisclosure('synthetic_coach_b'), false);
    assert.equal(await service.hasAcceptedCoachAiDisclosure(''), false);
    assert.equal(values.get('sidelineSocial.coachAiDisclosure.v1.synthetic_coach_a'), 'accepted');
    assert.equal(values.get('sidelineSocial.coachAiDisclosure.v2.synthetic_coach_a'), 'accepted');
  });
  await test('rendered_permission_is_bound_to_current_account_even_before_effects_run', () => {
    const expression = initializer('disclosureAccepted');
    assert.equal(evaluate(expression, { disclosure: { userId: 'a', accepted: true }, user: { uid: 'b' } }), null);
    assert.equal(evaluate(expression, { disclosure: { userId: 'a', accepted: true }, user: { uid: 'a' } }), true);
    assert.equal(evaluate(expression, { disclosure: { userId: 'a', accepted: false }, user: { uid: 'a' } }), false);
    assert.equal(evaluate(expression, { disclosure: null, user: null }), null);
  });
  await test('late_acceptance_cannot_unlock_or_announce_for_a_different_account', async () => {
    const pending = deferred(), scope = consentScope(() => pending.promise);
    const completion = callback('acceptDisclosure', scope)();
    scope.user = { uid: 'synthetic_coach_b' };
    scope.generationToken.current++;
    pending.resolve(); await completion;
    assert.deepEqual(scope.events.saved, ['synthetic_coach_a']);
    assert.deepEqual(scope.events.accepted, []);
    assert.deepEqual(scope.events.announcements, []);
    assert.deepEqual(scope.events.busy, [true]);
  });
  await test('late_failure_cannot_change_another_accounts_error_or_acceptance_lock', async () => {
    const pending = deferred(), scope = consentScope(() => pending.promise);
    const completion = callback('acceptDisclosure', scope)();
    scope.generationToken.current++;
    scope.disclosureAcceptanceToken.current = scope.generationToken.current;
    pending.reject(Error('synthetic_storage_failure')); await completion;
    assert.deepEqual(scope.events.errors, [false]);
    assert.equal(scope.disclosureAcceptanceToken.current, scope.generationToken.current);
    assert.deepEqual(scope.events.accepted, []);
  });
  await test('a_double_tap_saves_and_announces_current_account_permission_once', async () => {
    const pending = deferred(), scope = consentScope(() => pending.promise);
    const accept = callback('acceptDisclosure', scope);
    const completion = accept(); await accept();
    assert.deepEqual(scope.events.saved, ['synthetic_coach_a']);
    pending.resolve(); await completion;
    assert.deepEqual(scope.events.accepted, [{ userId: 'synthetic_coach_a', accepted: true }]);
    assert.equal(scope.events.announcements.length, 1);
    assert.deepEqual(scope.events.busy, [true, false]);
    assert.equal(scope.disclosureAcceptanceToken.current, null);
  });
  await test('storage_failure_and_pending_or_absent_identity_do_not_grant_permission', async () => {
    const scope = consentScope(async () => { throw Error('synthetic_storage_failure'); });
    await callback('acceptDisclosure', scope)();
    assert.deepEqual(scope.events.accepted, []);
    assert.deepEqual(scope.events.errors, [false, true]);
    assert.deepEqual(scope.events.busy, [true, false]);
    for (const patch of [{ user: null }, { disclosureAccepted: null }, { disclosureAccepted: true }]) {
      const denied = Object.assign(consentScope(async () => {}), patch);
      await callback('acceptDisclosure', denied)();
      assert.deepEqual(denied.events.saved, []);
    }
  });
  await test('generation_and_paid_same_request_recovery_require_current_permission', async () => {
    let generated = 0, cached = 0;
    const scope = {
      user: { uid: 'synthetic_coach_a' }, category: 'other', disclosureAccepted: false,
      generationInFlight: { current: false }, generationToken: { current: 1 },
      coachAiAccess: { canRequest: true, entitlementSource: 'paid', billing: { status: { entitled: true } } },
      setGenerating() {}, setError() {}, setRetryRequest() {},
      generateCoachResourceHelp: async () => { generated++; return { title: 'Synthetic result' }; },
      cacheGeneratedCoachHelpResult: async () => { cached++; },
      router: { push() {} }, t: key => key, CoachAiRequestError: class extends Error {},
    };
    const request = { clientRequestId: 'synthetic_request', category: 'other', situation: 'Fictional practice', locale: 'en' };
    await callback('generate', scope)(request);
    scope.coachAiAccess.canRequest = false;
    await callback('generate', scope)(request);
    assert.equal(generated, 0); assert.equal(cached, 0);
    scope.disclosureAccepted = true;
    await callback('generate', scope)(request);
    assert.equal(generated, 1); assert.equal(cached, 1);
  });
  await test('returning_to_the_screen_clears_stale_busy_state_and_ignores_a_blurred_read', async () => {
    const pending = deferred();
    const values = { busy: true, disclosure: { userId: 'other', accepted: true }, errors: true, generated: true };
    const scope = {
      user: { uid: 'synthetic_coach_a' }, generationToken: { current: 9 },
      disclosureAcceptanceToken: { current: 8 }, generationInFlight: { current: true },
      setAcceptingDisclosure: value => { values.busy = value; },
      setDisclosure: value => { values.disclosure = value; },
      setDisclosureError: value => { values.errors = value; },
      setGenerating: value => { values.generated = value; },
      setSaved() {}, setSavedOwnerId() {}, setSavedExpanded() {},
      getSavedCoachHelpResults: async () => [], hasAcceptedCoachAiDisclosure: () => pending.promise,
    };
    let effect;
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(screen) === 'useFocusEffect') effect = node.arguments[0].arguments[0];
      ts.forEachChild(node, visit);
    }
    visit(screen); assert.ok(effect);
    const cleanup = evaluate(effect, scope)();
    assert.deepEqual(values, { busy: false, disclosure: null, errors: false, generated: false });
    assert.equal(scope.disclosureAcceptanceToken.current, null);
    cleanup(); pending.resolve(true); await pending.promise;
    assert.equal(values.disclosure, null);
    assert.equal(scope.generationToken.current, 10);
  });
  await test('both_languages_name_the_actual_AI_recipient_before_explicit_agreement', () => {
    const translations = ts.createSourceFile('translations.ts', fs.readFileSync(path.join(root, 'i18n/index.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    const privacy = [], buttons = [];
    function visit(node) {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && ts.isStringLiteral(node.initializer)) {
        if (node.name.text === 'aiDisclosurePrivacy') privacy.push(node.initializer.text);
        if (node.name.text === 'aiDisclosureContinue') buttons.push(node.initializer.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(translations);
    assert.equal(privacy.length, 2); assert.equal(buttons.length, 2);
    for (const text of privacy) { assert.match(text, /Anthropic \(Claude\)/); assert.match(text, /Firebase/); }
    assert.match(buttons[0], /Agree/); assert.match(buttons[1], /Acepto/);
  });
  console.log(JSON.stringify({ passed: true, cases: cases.length, names: cases,
    networkRequests: 0, generationRequests: 0, builds: 0, deployments: 0, agentRetries: 0 }));
}
run().catch(error => { console.error(JSON.stringify({ passed: false, completedCases: cases, message: error.message })); process.exitCode = 1; });
