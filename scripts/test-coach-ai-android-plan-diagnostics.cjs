'use strict';
// Actual Android billing adapter + UI, with fake SDK/Firebase only.
// No emitted code, device, live credential, network, checkout or restore call.
const assert = require('node:assert/strict');
const { createSourceLoader } = require('./coach-ai-test-loader.cjs');
const ui = require('./test-coach-ai-billing-availability.cjs');
const cases = [];
const userId = 'fixture_a';
const status = { userId, enabled: true, entitled: false, remaining: 0, limit: 30 };
const secret = 'DO_NOT_RETAIN_PRIVATE_PAYLOAD';
const rawError = (code) => ({ code, message: secret, details: { uid: secret, token: secret }, receipt: secret });
function product(plan) {
  return { identifier: 'coach_ai:' + plan, currencyCode: 'USD', price: plan === 'monthly' ? 2.99 : 24.99,
    priceString: plan === 'monthly' ? '$2.99' : '$24.99', subscriptionPeriod: plan === 'monthly' ? 'P1M' : 'P1Y',
    defaultOption: { isBasePlan: true }, introPrice: null, installmentsInfo: null };
}
function fixture(options = {}) {
  process.env.EXPO_PUBLIC_COACH_AI_BILLING_ENABLED = 'true';
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = options.missingKey ? '' : 'goog_OFFLINE_PUBLIC_FIXTURE';
  const auth = { currentUser: { uid: userId } }, calls = [], reports = [];
  let authListener;
  const packages = ['monthly', 'yearly'].map(plan => ({ identifier: plan === 'monthly' ? '$rc_monthly' : '$rc_annual', product: product(plan) }));
  options.editPackages?.(packages);
  async function step(name, value) {
    calls.push(name);
    if (options.fail === name) throw rawError(options.code ?? '10');
    if (options.wait?.name === name) await options.wait.promise;
    return value;
  }
  const sdk = {
    LOG_LEVEL: { ERROR: 'ERROR' }, setLogLevel: () => step('log_level'),
    configure({ appUserID, apiKey }) { calls.push('configure'); assert.equal(appUserID, userId); assert.ok(apiKey.startsWith('goog_')); if (options.fail === 'configure') throw rawError('23'); },
    getAppUserID: () => step('identity', userId), logIn: () => step('login'),
    getStorefront: () => step('storefront', Object.hasOwn(options, 'country') ? options.country === null ? null : { countryCode: options.country } : { countryCode: 'US' }),
    getOfferings: () => step('offerings', { all: options.missingOffering ? {} : { coach_ai_launch: { availablePackages: packages } } }),
    restorePurchases() { throw Error('UNEXPECTED_RESTORE'); }, purchasePackage() { throw Error('UNEXPECTED_PURCHASE'); },
  };
  const load = createSourceLoader({
    '@react-native-async-storage/async-storage': { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
    'expo-constants': { default: { executionEnvironment: 'standalone' }, __esModule: true, ExecutionEnvironment: { StoreClient: 'storeClient' } },
    'react-native': { Platform: { OS: 'android' } },
    'firebase/auth': { onAuthStateChanged(_auth, callback) { authListener = callback; } },
    'firebase/functions': { httpsCallable(_functions, name) {
      assert.ok(['prepareCoachAiBilling', 'getCoachAiBillingStatus'].includes(name));
      return async () => ({ data: await step(name, name === 'prepareCoachAiBilling'
        ? { userId: options.badPreparation ? 'other' : userId, prepared: true }
        : options.badStatus ? { ...status, limit: 99 } : status) });
    } },
    '@/config/firebase': { auth, functions: {} }, 'react-native-purchases': { default: sdk },
  });
  const service = load('services/coachAiBillingService.ts');
  return { service, calls, reports, load,
    plans: (active) => service.getCoachAiPurchasePackages(userId, value => reports.push(value), active),
    switchAccount() { auth.currentUser = { uid: 'other' }; authListener(auth.currentUser); } };
}
async function test(name, run) { await run(); cases.push(name); }
function safeReport(report) {
  const json = JSON.stringify(report);
  for (const forbidden of [secret, userId, 'goog_', 'receipt', 'appUserID']) assert.ok(!json.includes(forbidden), forbidden);
  assert.match(report.attemptId, /^plans-[a-z0-9]+-[a-z0-9]+$/);
  assert.ok(Number.isFinite(Date.parse(report.startedAt)) && Number.isFinite(Date.parse(report.finishedAt)));
}
async function failed(f, stage, reason, code) {
  let caught;
  try { await f.plans(); } catch (error) { caught = error; }
  assert.ok(caught, 'expected a stopped attempt');
  const report = f.reports.at(-1);
  assert.equal(report.stage, stage); assert.equal(report.reason, reason);
  if (code) assert.equal(report.steps.at(-1).providerCode, code);
  safeReport(report);
  assert.equal(JSON.stringify(caught).includes(secret), false);
  const calls = [...f.calls]; await Promise.resolve(); await Promise.resolve(); assert.deepEqual(f.calls, calls);
  return report;
}
async function main() {
  await test('Android valid monthly/yearly: one ordered preparation and SDK lookup, no checkout', async () => {
    const f = fixture(); const plans = await f.plans();
    assert.deepEqual(Object.keys(plans), ['monthly', 'yearly']);
    assert.deepEqual(f.calls, ['prepareCoachAiBilling', 'log_level', 'configure', 'storefront', 'offerings']);
    const report = f.reports.at(-1); assert.equal(report.outcome, 'ready'); safeReport(report);
    assert.deepEqual(report.steps.map(step => step.stage), ['sdk_setup', 'prepare', 'sdk_identity', 'storefront', 'offerings', 'monthly', 'yearly', 'screen']);
  });
  await test('Android missing public configuration stops before preparation', async () => {
    const f = fixture({ missingKey: true }); await failed(f, 'sdk_setup', 'sdk_unavailable'); assert.equal(f.calls.length, 0);
  });
  await test('Preparation denial preserves only allowlisted server code and stops SDK', async () => {
    const f = fixture({ fail: 'prepareCoachAiBilling', code: 'functions/permission-denied' });
    await failed(f, 'prepare', 'request_failed', 'functions/permission-denied');
    assert.deepEqual(f.calls, ['prepareCoachAiBilling']);
  });
  await test('Preparation identity mismatch stops before SDK configuration', async () => {
    const f = fixture({ badPreparation: true }); await failed(f, 'prepare', 'preparation_rejected'); assert.deepEqual(f.calls, ['prepareCoachAiBilling']);
  });
  await test('Native configuration failure has its own stage and safe SDK code', async () => {
    const f = fixture({ fail: 'configure' }); await failed(f, 'sdk_identity', 'request_failed', 'sdk_23'); assert.ok(!f.calls.includes('storefront'));
  });
  await test('Unknown storefront and known unsupported country remain distinct and fail closed', async () => {
    for (const country of [null, '', 'invalid-country', 'CA']) {
      const f = fixture({ country });
      await failed(f, 'storefront', country === 'CA' ? 'storefront_unsupported' : 'storefront_unknown');
      assert.ok(!f.calls.includes('offerings'));
    }
  });
  await test('Storefront and offering request errors keep stage/code without retrying', async () => {
    for (const stage of ['storefront', 'offerings']) {
      const f = fixture({ fail: stage }); await failed(f, stage, 'request_failed', 'sdk_10');
      assert.equal(f.calls.filter(value => value === stage).length, 1);
    }
  });
  await test('Missing offering is distinguished from a request failure', async () => {
    const f = fixture({ missingOffering: true }); await failed(f, 'offerings', 'offering_missing');
  });
  await test('Every Android product guard reports its exact rejected field and preserves the valid other plan', async () => {
    const edits = [
      ['product_id', p => { p.identifier = secret; }], ['currency', p => { p.currencyCode = 'EUR'; }],
      ['price', p => { p.price = 3.99; }], ['price', p => { p.price = NaN; }],
      ['period', p => { p.subscriptionPeriod = 'P4M'; }], ['intro_price', p => { p.introPrice = { private: secret }; }],
      ['installments', p => { p.installmentsInfo = { private: secret }; }],
      ['installments', p => { p.defaultOption.installmentsInfo = { private: secret }; }],
      ['base_plan', p => { p.defaultOption = null; }], ['base_plan', p => { p.defaultOption.isBasePlan = false; }],
    ];
    for (const [reason, edit] of edits) for (const index of [0, 1]) {
      const f = fixture({ editPackages(packages) { edit(packages[index].product); } });
      const result = await f.plans(), report = f.reports.at(-1);
      const plan = index === 0 ? 'monthly' : 'yearly', other = index === 0 ? 'yearly' : 'monthly';
      assert.equal(result[plan], undefined); assert.ok(result[other]); assert.equal(report.outcome, 'partial');
      assert.equal(report.steps.find(step => step.stage === plan).reason, reason); safeReport(report);
      assert.equal(f.load('utils/coachAiPurchaseCore.ts').isApprovedCoachAiProduct(product(other), other, 'android'), true);
    }
  });
  await test('Missing packages and empty catalog produce terminal per-plan reasons, never silent success', async () => {
    for (const missing of ['monthly', 'yearly', 'both']) {
      const f = fixture({ editPackages(packages) { if (missing === 'both') packages.length = 0; else packages.splice(missing === 'monthly' ? 0 : 1, 1); } });
      const result = await f.plans(), report = f.reports.at(-1);
      assert.equal(report.outcome, missing === 'both' ? 'failed' : 'partial');
      assert.equal(Object.keys(result).length, missing === 'both' ? 0 : 1);
      for (const plan of missing === 'both' ? ['monthly', 'yearly'] : [missing]) {
        assert.equal(report.steps.find(step => step.stage === plan).reason, 'package_missing');
      }
    }
  });
  await test('Account change and navigation cancellation stop before the next request with distinct outcomes', async () => {
    for (const changedAccount of [true, false]) {
      const wait = ui.deferred(); let active = true;
      const f = fixture({ wait: { name: 'storefront', promise: wait.promise } });
      const pending = f.plans(() => active);
      // Wait for fixture entry without polling a real device/service.
      for (let i = 0; i < 20 && !f.calls.includes('storefront'); i++) await Promise.resolve();
      assert.ok(f.calls.includes('storefront'));
      if (changedAccount) f.switchAccount(); else active = false;
      wait.resolve(); await assert.rejects(pending);
      const report = f.reports.at(-1);
      assert.equal(report.outcome, 'cancelled'); assert.equal(report.reason, changedAccount ? 'account_changed' : 'navigation_cancelled');
      assert.ok(!f.calls.includes('offerings')); safeReport(report);
    }
  });
  await test('Status response validation and arbitrary provider fields remain private', async () => {
    for (const options of [{ badStatus: true }, { fail: 'getCoachAiBillingStatus', code: secret }]) {
      const f = fixture(options);
      await assert.rejects(f.service.fetchCoachAiBillingStatus(userId), error => {
        assert.equal(error.diagnostic.stage, 'billing_status'); safeReport(error.diagnostic);
        assert.equal(error.diagnostic.reason, options.badStatus ? 'invalid_status' : 'request_failed');
        assert.ok(!JSON.stringify(error).includes(secret)); return true;
      });
      assert.deepEqual(f.calls, ['getCoachAiBillingStatus']);
    }
  });
  await test('Status failure is preserved across foreground events; only explicit action makes another request', async () => {
    const h = ui.harness(); let foreground, notify, calls = 0;
    const hook = createSourceLoader({
      react: h.react, 'react-native': { AppState: { addEventListener(_name, handler) { foreground = handler; return { remove() {} }; } } },
      '@/context/AuthContext': { useAuth: () => ({ user: { uid: userId, adultEligibilityConfirmed: true }, loading: false }) },
      '@/context/AppContext': { useApp: () => ({ activeMode: 'coach' }) },
      '@/context/AccountStandingContext': { useAccountStanding: () => ({ standing: { status: 'active' }, loading: false, error: false }) },
      '@/services/coachAiBillingService': { COACH_AI_BILLING_ENABLED: true, subscribeCoachAiBilling(handler) { notify = handler; return () => {}; },
        async fetchCoachAiBillingStatus() { calls++; if (calls === 1) throw rawError('functions/unavailable'); return status; } },
    })('hooks/useCoachAiBilling.ts').useCoachAiBilling;
    h.mount(hook); let view = await h.settle(); assert.equal(view.availability, 'verification_error');
    const id = view.diagnostic.attemptId; foreground('active'); notify(); view = await h.settle();
    assert.equal(calls, 1); assert.equal(view.diagnostic.attemptId, id); safeReport(view.diagnostic);
    await view.refresh(); view = await h.settle(); assert.equal(calls, 2); assert.equal(view.availability, 'ready');
  });
  await test('Late plan results do not populate a signed-out screen', async () => {
    const f = ui.pageFixture(); f.mount(); f.update({ availability: 'ready', status, loading: false });
    f.accountChange(undefined); f.update({ availability: 'account_unavailable', status: null });
    f.request.resolve({ monthly: { product: product('monthly') } });
    const tree = await f.h.settle(); assert.ok(!f.has(tree, '$2.99')); assert.equal(f.counts().planCalls, 1);
  });
  const availability = await ui.main();
  return { state: 'PASSED', groups: cases.length + availability.groups, androidCases: cases, availabilityCases: availability.cases,
    liveNetworkRequests: 0, deviceRequests: 0, emittedFiles: 0, builds: 0, deployments: 0 };
}
if (require.main === module) main().then(value => console.log(JSON.stringify(value))).catch(error => { console.error(error); process.exitCode = 1; });
