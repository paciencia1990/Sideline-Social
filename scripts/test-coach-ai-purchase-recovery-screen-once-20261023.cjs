'use strict';
// Prepared only. Run once after explicit approval of the stopped UI completion.
// Actual hooks/screen execute against fake React/storage/provider boundaries.
// No device, SDK, Firebase, network call, app bundle or backend build is loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), ts = require('typescript');
const { createSourceLoader, root } = require('./coach-ai-test-loader.cjs');
const { harness, nodes, deferred } = require('./test-coach-ai-billing-availability.cjs');

const active = { userId: 'fixture_a', enabled: true, entitled: false, plan: null, remaining: 0, pending: 0, limit: 30,
  resetsAtMs: null, accessUntilMs: null, store: null, autoRenews: false };
const source = createSourceLoader();
const { CoachAiPurchaseError } = source('utils/coachAiPurchaseCore.ts');
const coreDiagnostic = source('utils/coachAiBillingDiagnostics.ts');
const docs = path.join(root, 'docs/coach-ai-consolidated-purchase-recovery-local-20261023');
const receipt = path.join(docs, 'ui-hook-focused-check-attempt.json');
const resultPath = path.join(docs, 'ui-hook-focused-check-result.json');
const key = suffix => 'coachAiBilling.' + suffix;

function diagnostic({ present = false, phase = 'idle', operation = 'inspect', fingerprint = 'a'.repeat(64) } = {}) {
  return { version: 1, operation, correlationId: 'purchase-fixture-correlation', phase, nativeInvokedThisOperation: false,
    providerCode: null, markerFingerprint: present ? fingerprint : null,
    record: { present, schema: present ? 'legacy' : 'none', plan: present ? 'monthly' : null, ageMs: present ? 1000 : null,
      state: present ? 'recovery_required' : 'idle', attemptId: null } };
}
function text(tree) { return nodes(tree).filter(value => typeof value === 'string').join(' '); }
function has(tree, label) { return nodes(tree).includes(label); }
function findButton(tree, label) { return nodes(tree).find(node => node?.type === 'Button' && has(node, label)); }
function findInput(tree) { return nodes(tree).find(node => node?.type === 'Input'); }
function press(tree, label) {
  const button = findButton(tree, label);
  assert.ok(button, 'expected_button:' + label);
  assert.notEqual(button.props.disabled, true, 'button_is_disabled:' + label);
  button.props.onPress();
}

function screenFixture(file, options = {}) {
  const h = harness();
  let uid = 'fixture_a', language = 'en';
  let access = { entitlementSource: null, billing: { enabled: true, eligible: true, availability: 'ready', status: active,
    loading: false, refresh: async () => active } };
  if (options.billing) access.billing = { ...access.billing, ...options.billing };
  let inspection = diagnostic(options.marker ? { present: true, phase: 'recovery_required' } : {});
  const calls = { plans: [], inspect: [], buy: [], restore: [], check: [], resolve: [] };
  const requests = { buy: deferred(), inspect: null, publishBuy: null };
  const jsx = (type, props) => ({ type, props: props || {} });
  const publish = (callback, value) => { if (typeof callback === 'function') callback(value); };
  const overrides = {
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ActivityIndicator: 'Spinner', TextInput: 'Input', Linking: { openURL: async () => {} }, ScrollView: 'Scroll',
      Text: 'Text', TouchableOpacity: 'Button', View: 'View', StyleSheet: { create: value => value } },
    'react-i18next': { useTranslation: () => ({ t: value => value, i18n: { language } }) },
    '@/components/Card': { Card: 'Card' }, '@/components/CoachResourceHeader': { CoachResourceHeader: 'Header' },
    '@/components/ScreenWrapper': { ScreenWrapper: 'Screen' },
    '@/constants/theme': { Colors: {}, Radius: {}, Spacing: {}, Typography: {} },
    '@/config/legal': { PRIVACY_POLICY_URL: 'https://fixture.invalid/privacy', TERMS_OF_USE_URL: 'https://fixture.invalid/terms' },
    '@/context/AuthContext': { useAuth: () => ({ user: uid ? { uid } : null }) },
    '@/hooks/useCoachAiAccess': { useCoachAiAccess: () => access },
    '@/services/coachAiBillingService': {
      COACH_AI_TEST_RECOVERY_AVAILABLE: options.recoveryAvailable !== false,
      getCoachAiPurchasePackages: async caller => {
        calls.plans.push(caller);
        return { monthly: { product: { priceString: '$2.99' } }, yearly: { product: { priceString: '$24.99' } } };
      },
      inspectCoachAiPurchase: async (caller, callback) => {
        calls.inspect.push(caller);
        if (requests.inspect) return requests.inspect.promise;
        publish(callback, inspection); return inspection;
      },
      purchaseCoachAi: async (caller, plan, product, callback) => {
        calls.buy.push({ uid: caller, plan });
        requests.publishBuy = callback;
        publish(callback, diagnostic({ phase: 'checkout_started', operation: 'buy' }));
        return requests.buy.promise;
      },
      restoreCoachAi: async (caller, callback) => { calls.restore.push(caller); publish(callback, inspection); return active; },
      checkCoachAiPurchaseStatus: async (caller, callback) => { calls.check.push(caller); publish(callback, inspection); return active; },
      resolveReviewedCoachAiPurchase: async (caller, reference, callback) => {
        calls.resolve.push({ uid: caller, reference }); inspection = diagnostic({ phase: 'resolved', operation: 'resolve' });
        publish(callback, inspection); return inspection;
      },
      coachAiManagementUrl: () => null,
    },
    '@/utils/coachAiPurchaseCore': source('utils/coachAiPurchaseCore.ts'),
    '@/utils/coachAiBillingDiagnostics': coreDiagnostic,
  };
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  assert.equal((compiled.diagnostics || []).filter(value => value.category === ts.DiagnosticCategory.Error).length, 0, 'screen_transpile_errors');
  const module = { exports: {} };
  new Function('module', 'exports', 'require', compiled.outputText)(module, module.exports, name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    throw Error('unexpected_offline_screen_import:' + name);
  });
  return { h, calls, requests, mount: () => h.mount(module.exports.default),
    update(billing) { access = { ...access, billing: { ...access.billing, ...billing } }; return h.render(); },
    accountChange(next) { uid = next; access = { ...access, billing: { ...access.billing, status: { ...active, userId: next } } }; return h.render(); },
    localeChange(next) { language = next; return h.render(); },
    setInspection(value) { inspection = value; },
  };
}

function hookFixture() {
  const h = harness(), requests = [];
  let user = { uid: 'fixture_a', adultEligibilityConfirmed: true }, notification, foreground;
  const hook = createSourceLoader({
    react: h.react, 'react-native': { AppState: { addEventListener: (_, callback) => { foreground = callback; return { remove() {} }; } } },
    '@/context/AuthContext': { useAuth: () => ({ user, loading: false }) },
    '@/context/AppContext': { useApp: () => ({ activeMode: 'coach' }) },
    '@/context/AccountStandingContext': { useAccountStanding: () => ({ standing: { status: 'active' }, loading: false, error: false }) },
    '@/services/coachAiBillingService': { COACH_AI_BILLING_ENABLED: true,
      fetchCoachAiBillingStatus(uid) { const request = deferred(); requests.push({ uid, ...request }); return request.promise; },
      subscribeCoachAiBilling(callback) { notification = callback; return () => { notification = undefined; }; },
    },
  })('hooks/useCoachAiBilling.ts').useCoachAiBilling;
  return { h, requests, mount: () => h.mount(hook), accountChange(uid) { user = uid ? { uid, adultEligibilityConfirmed: true } : null; return h.render(); },
    notify(status) { notification?.(status); return h.render(); }, foreground() { foreground?.('active'); return h.render(); } };
}

function unionKeys(name) {
  const file = path.join(root, 'utils/coachAiPurchaseCore.ts');
  const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = tree.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === name);
  assert.ok(declaration && ts.isUnionTypeNode(declaration.type), 'missing_core_union:' + name);
  return declaration.type.types.map(node => {
    assert.ok(ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal), 'nonliteral_core_union:' + name);
    return node.literal.text;
  }).sort();
}

async function runOnce({ prepared = false } = {}) {
  if (process.env.SIDELINE_COACH_AI_RECOVERY_UI_APPROVED_ONCE !== 'once') throw Error('ui_completion_approval_required');
  fs.mkdirSync(docs, { recursive: true });
  // The wx receipt is written BEFORE evaluating any new test; a stopped group
  // cannot silently be rerun under the same approved attempt.
  const screenFile = path.join(root, prepared
    ? 'docs/coach-ai-consolidated-purchase-recovery-local-20261023/prepared/subscription.tsx'
    : 'app/coach/resources/subscription.tsx');
  const startedAt = new Date().toISOString();
  fs.writeFileSync(receipt, JSON.stringify({ startedAt, source: path.relative(root, screenFile), preparedOnly: prepared,
    approval: 'one_new_UI_hook_offline_attempt', previousPassedGroupsReused: 26, retries: 0 }, null, 2) + '\n', { flag: 'wx' });
  const passed = [];
  let stoppedGroup = null;
  const test = async (name, run) => { stoppedGroup = name; await run(); passed.push(name); stoppedGroup = null; };
  try {
    await test('same_account_status_is_preserved_but_not_ready_during_refresh_or_error', async () => {
      const f = hookFixture(); f.mount(); f.requests[0].resolve(active);
      let value = await f.h.settle(); assert.equal(value.availability, 'ready'); assert.deepEqual(value.status, active);
      const refreshing = value.refresh(false); value = f.h.render();
      assert.deepEqual(value.status, active); assert.equal(value.availability, 'checking');
      f.requests[1].reject(Error('private_provider_failure')); await refreshing; value = await f.h.settle();
      assert.deepEqual(value.status, active); assert.equal(value.availability, 'verification_error');
      f.foreground(); f.notify(); await f.h.settle(); assert.equal(f.requests.length, 2, 'failed_status_must_not_automatically_retry');
    });
    await test('late_hook_error_cannot_replace_the_new_accounts_ready_status', async () => {
      const f = hookFixture(); f.mount(); f.requests[0].resolve(active); const original = await f.h.settle();
      const pending = original.refresh(false); f.h.render(); f.accountChange('fixture_b');
      f.requests[2].resolve({ ...active, userId: 'fixture_b' }); await f.h.settle();
      f.requests[1].reject(Error('private_old_account_error')); await pending;
      const value = await f.h.settle(); assert.equal(value.status.userId, 'fixture_b'); assert.equal(value.availability, 'ready');
    });
    await test('operation_status_notification_updates_without_extra_status_request', async () => {
      const f = hookFixture(); f.mount(); f.requests[0].resolve(active); await f.h.settle();
      const value = f.notify({ ...active, entitled: true, remaining: 30 });
      assert.equal(value.status.entitled, true); assert.equal(value.availability, 'ready'); assert.equal(f.requests.length, 1);
    });
    await test('billing_off_still_inspects_marker_locally_without_sdk_or_provider_operation', async () => {
      const f = screenFixture(screenFile, { marker: true,
        billing: { availability: 'billing_unavailable', status: { ...active, enabled: false }, loading: false } });
      f.mount(); const tree = await f.h.settle();
      assert.deepEqual(f.calls.inspect, ['fixture_a']); assert.equal(f.calls.plans.length, 0);
      assert.equal(f.calls.buy.length + f.calls.restore.length + f.calls.check.length + f.calls.resolve.length, 0);
      assert.ok(!findButton(tree, key('subscribe')) || findButton(tree, key('subscribe')).props.disabled === true);
      assert.equal(findButton(tree, key('restore')).props.disabled, true);
      assert.ok(has(tree, key('accountNotice')) && has(tree, key('support')));
    });
    await test('loaded_plan_cards_survive_transient_refresh_with_all_checkout_actions_disabled', async () => {
      const f = screenFixture(screenFile); f.mount(); let tree = await f.h.settle();
      press(tree, key('monthly')); tree = f.h.render(); assert.equal(findButton(tree, key('subscribe')).props.disabled, false);
      for (const state of [{ availability: 'checking', loading: true }, { availability: 'verification_error', loading: false }]) {
        tree = f.update(state); assert.ok(has(tree, '$2.99') && has(tree, '$24.99'));
        assert.equal(findButton(tree, key('subscribe')).props.disabled, true);
        assert.equal(findButton(tree, key('monthly')).props.disabled, true);
        assert.equal(findButton(tree, key('yearly')).props.disabled, true);
        assert.equal(findButton(tree, key('restore')).props.disabled, true);
      }
      tree = f.update({ availability: 'ready', loading: false }); assert.equal(findButton(tree, key('subscribe')).props.disabled, false);
      assert.equal(f.calls.plans.length, 1, 'retained_status_must_not_reload_products');
      tree = f.update({ availability: 'billing_unavailable', status: { ...active, enabled: false } });
      assert.ok(!has(tree, '$2.99') && !has(tree, '$24.99'), 'verified_disabled_master_must_pause_catalog');
    });
    await test('inspection_pending_or_retained_marker_blocks_buy_and_does_not_retry_automatically', async () => {
      const f = screenFixture(screenFile); f.requests.inspect = deferred(); f.mount(); let tree = await f.h.settle();
      assert.ok(!findButton(tree, key('subscribe')) || findButton(tree, key('subscribe')).props.disabled === true);
      f.requests.inspect.resolve(diagnostic({ present: true, phase: 'recovery_required' })); tree = await f.h.settle();
      assert.ok(!findButton(tree, key('subscribe')) || findButton(tree, key('subscribe')).props.disabled === true);
      f.localeChange('es'); await f.h.settle(); assert.equal(f.calls.inspect.length, 1);
      assert.equal(f.calls.buy.length, 0); assert.equal(f.calls.restore.length, 0); assert.equal(f.calls.resolve.length, 0);
    });
    await test('late_purchase_error_and_callback_cannot_leak_into_another_account_or_unmounted_screen', async () => {
      const f = screenFixture(screenFile); f.mount(); let tree = await f.h.settle();
      press(tree, key('monthly')); tree = f.h.render(); press(tree, key('subscribe')); await f.h.settle();
      assert.equal(f.calls.buy.length, 1); f.accountChange('fixture_b'); await f.h.settle();
      f.requests.publishBuy(diagnostic({ present: true, phase: 'uncertain', operation: 'buy' }));
      f.requests.buy.reject(new CoachAiPurchaseError('confirmation_pending')); tree = await f.h.settle();
      assert.ok(!has(tree, key('errors.confirmation_pending'))); assert.ok(!text(tree).includes('fixture_a'));
      assert.ok(!has(tree, key('purchaseStages.uncertain')));
      const gone = screenFixture(screenFile); gone.mount(); tree = await gone.h.settle();
      press(tree, key('monthly')); tree = gone.h.render(); press(tree, key('subscribe')); await gone.h.settle();
      gone.h.unmount(); gone.requests.publishBuy(diagnostic({ present: true, phase: 'uncertain', operation: 'buy' }));
      gone.requests.buy.reject(new CoachAiPurchaseError('confirmation_pending')); tree = await gone.h.settle();
      assert.ok(!has(tree, key('errors.confirmation_pending'))); assert.ok(!has(tree, key('purchaseStages.uncertain')));
      assert.equal(f.calls.buy.length, 1); assert.equal(gone.calls.buy.length, 1);
    });
    await test('reviewed_resolution_is_explicit_exact_reference_confirmation_only_and_never_starts_checkout', async () => {
      const f = screenFixture(screenFile, { marker: true,
        billing: { availability: 'billing_unavailable', status: { ...active, enabled: false } } });
      f.mount(); let tree = await f.h.settle(); press(tree, key('showSupportDetails')); tree = f.h.render();
      assert.ok(has(tree, key('purchaseRecovery.reviewHelp')));
      const input = findInput(tree); assert.ok(input); assert.equal(input.props.maxLength, 128);
      const apply = findButton(tree, key('purchaseRecovery.apply')); assert.ok(apply); assert.equal(apply.props.disabled, true);
      input.props.onChangeText('review_fixture_20261023'); tree = f.h.render();
      assert.equal(findButton(tree, key('purchaseRecovery.apply')).props.disabled, true, 'reference_alone_does_not_authorize_resolution');
      press(tree, key('purchaseRecovery.confirm')); tree = f.h.render();
      press(tree, key('purchaseRecovery.apply')); tree = await f.h.settle();
      assert.deepEqual(f.calls.resolve, [{ uid: 'fixture_a', reference: 'review_fixture_20261023' }]);
      assert.equal(f.calls.buy.length + f.calls.restore.length + f.calls.check.length, 0);
      assert.ok(has(tree, key('purchaseRecovery.resolved')));
      assert.ok(!text(tree).includes('fixture_a'), 'support_details_must_not_disclose_uid');
    });
    await test('ordinary_build_has_no_review_disposition_controls_or_automatic_resolution', async () => {
      const f = screenFixture(screenFile, { marker: true, recoveryAvailable: false }); f.mount();
      let tree = await f.h.settle(); press(tree, key('showSupportDetails')); tree = f.h.render();
      assert.ok(!findInput(tree)); assert.ok(!findButton(tree, key('purchaseRecovery.apply')));
      assert.equal(f.calls.resolve.length, 0);
    });
    await test('english_spanish_recovery_and_every_core_phase_error_have_matching_nonempty_copy', () => {
      const translationRelative = prepared
        ? 'docs/coach-ai-consolidated-purchase-recovery-local-20261023/prepared/coachAiBillingTranslations.ts'
        : 'content/coachAiBillingTranslations.ts';
      const copy = createSourceLoader()(translationRelative).coachAiBillingTranslations;
      for (const group of ['purchaseRecovery', 'purchaseStages', 'errors']) {
        assert.ok(copy.en[group] && copy.es[group], 'missing_copy_group:' + group);
        assert.deepEqual(Object.keys(copy.en[group]).sort(), Object.keys(copy.es[group]).sort(), 'locale_key_mismatch:' + group);
        for (const locale of ['en', 'es']) for (const [name, value] of Object.entries(copy[locale][group])) {
          assert.equal(typeof value, 'string', 'nontext_copy:' + locale + '.' + group + '.' + name);
          assert.ok(value.trim().length > 0, 'empty_copy:' + locale + '.' + group + '.' + name);
        }
      }
      for (const locale of ['en', 'es']) {
        for (const phase of unionKeys('CoachAiPurchasePhase')) assert.ok(copy[locale].purchaseStages[phase], 'missing_phase:' + locale + '.' + phase);
        for (const error of unionKeys('CoachAiPurchaseErrorKind')) assert.ok(copy[locale].errors[error], 'missing_error:' + locale + '.' + error);
        for (const name of ['inspect', 'reference', 'required', 'clear', 'inspectionError', 'noActivePurchase', 'reviewHelp', 'confirm', 'apply', 'resolved']) {
          assert.ok(copy[locale].purchaseRecovery[name], 'missing_recovery_copy:' + locale + '.' + name);
        }
      }
    });
    const result = { status: 'PASSED', startedAt, completedAt: new Date().toISOString(), groups: passed.length, passed,
      source: path.relative(root, screenFile), screenSha256: crypto.createHash('sha256').update(fs.readFileSync(screenFile)).digest('hex'),
      sourceCandidateOnly: prepared, networkRequests: 0, nativeCalls: 0, builds: 0, liveChanges: 0, retries: 0,
      previousPassedGroupsReused: 26 };
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); return result;
  } catch (error) {
    const result = { status: 'STOPPED_NO_RETRY', startedAt, completedAt: new Date().toISOString(), groupsPassed: passed.length,
      passed, stoppedGroup, error: error instanceof Error ? error.message : 'offline_check_failure', sourceCandidateOnly: prepared,
      networkRequests: 0, nativeCalls: 0, builds: 0, liveChanges: 0, retries: 0, previousPassedGroupsReused: 26 };
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); throw error;
  }
}
module.exports = { runOnce };
if (require.main === module) runOnce({ prepared: process.argv.includes('--prepared') }).then(value => console.log(JSON.stringify(value)))
  .catch(error => { console.error(error); process.exitCode = 1; });
