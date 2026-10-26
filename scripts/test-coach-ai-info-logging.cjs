'use strict';
// New log-level behavior only; actual service, in-memory compiler and fake providers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSourceLoader } = require('./coach-ai-test-loader.cjs');
const keys = ['EXPO_PUBLIC_COACH_AI_BILLING_ENABLED', 'EXPO_PUBLIC_COACH_AI_BILLING_INFO_LOGGING', 'EXPO_PUBLIC_REVENUECAT_ANDROID_KEY', 'EXPO_PUBLIC_REVENUECAT_IOS_KEY'];
const original = new Map(keys.map(key => [key, process.env[key]]));
const passed = [];
function fixture({ os = 'android', flag, denied = false, logFailure = false } = {}) {
  process.env.EXPO_PUBLIC_COACH_AI_BILLING_ENABLED = 'true';
  if (flag === undefined) delete process.env.EXPO_PUBLIC_COACH_AI_BILLING_INFO_LOGGING;
  else process.env.EXPO_PUBLIC_COACH_AI_BILLING_INFO_LOGGING = flag;
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = 'goog_OFFLINE_LOGGING_FIXTURE';
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_OFFLINE_LOGGING_FIXTURE';
  const uid = 'offline_logging_fixture';
  const calls = [];
  const sdk = {
    LOG_LEVEL: { INFO: 'INFO', ERROR: 'ERROR' },
    async setLogLevel(level) { calls.push(['log', level]); if (logFailure) throw new Error('synthetic_log_failure'); },
    configure({ appUserID }) { assert.equal(appUserID, uid); calls.push(['configure']); },
    getAppUserID: async () => uid,
    logIn() { throw new Error('unexpected_identity_switch'); },
    getStorefront: async () => ({ countryCode: 'US' }),
    async getOfferings() {
      calls.push(['offerings']);
      return { all: { coach_ai_launch: { availablePackages: ['monthly', 'yearly'].map(plan => ({ identifier: plan === 'monthly' ? '$rc_monthly' : '$rc_annual', product: {
        identifier: os === 'android' ? 'coach_ai:' + plan : 'com.sidelinesocial.coachai.' + plan,
        currencyCode: 'USD', price: plan === 'monthly' ? 2.99 : 24.99,
        subscriptionPeriod: plan === 'monthly' ? 'P1M' : 'P1Y', introPrice: null,
        installmentsInfo: null, defaultOption: { isBasePlan: true },
      } })) } } };
    },
    restorePurchases() { throw new Error('unexpected_restore'); },
    purchasePackage() { throw new Error('unexpected_purchase'); },
  };
  const forbiddenStorage = () => { throw new Error('unexpected_storage'); };
  const service = createSourceLoader({
    '@react-native-async-storage/async-storage': { getItem: forbiddenStorage, setItem: forbiddenStorage, removeItem: forbiddenStorage },
    'expo-constants': { __esModule: true, default: { executionEnvironment: 'standalone' }, ExecutionEnvironment: { StoreClient: 'storeClient' } },
    'react-native': { Platform: { OS: os } },
    'firebase/auth': { onAuthStateChanged: () => () => {} },
    'firebase/functions': { httpsCallable(_functions, name) {
      assert.equal(name, 'prepareCoachAiBilling');
      return async () => { calls.push(['prepare']); if (denied) throw new Error('synthetic_preparation_denied'); return { data: { userId: uid, prepared: true } }; };
    } },
    '@/config/firebase': { auth: { currentUser: { uid } }, functions: {} },
    'react-native-purchases': { default: sdk },
  })('services/coachAiBillingService.ts');
  return { calls, run: () => service.getCoachAiPurchasePackages(uid) };
}
async function group(name, run) { await run(); passed.push(name); }
async function main() {
  await group('Android opt-in sets INFO after authorization and before configure', async () => {
    const f = fixture({ flag: 'true' }); const packages = await f.run();
    assert.deepEqual(f.calls, [['prepare'], ['log', 'INFO'], ['configure'], ['offerings']]);
    assert.deepEqual(Object.keys(packages), ['monthly', 'yearly']);
  });
  await group('Android absent, false and malformed opt-in retain ERROR', async () => {
    for (const flag of [undefined, 'false', 'TRUE']) {
      const f = fixture({ flag }); await f.run(); assert.deepEqual(f.calls[1], ['log', 'ERROR']);
    }
  });
  await group('iOS keeps ERROR even when the Android diagnostic flag is set', async () => {
    const f = fixture({ os: 'ios', flag: 'true' }); await f.run(); assert.deepEqual(f.calls[1], ['log', 'ERROR']);
  });
  await group('INFO opt-in cannot bypass preparation denial', async () => {
    const f = fixture({ flag: 'true', denied: true }); await assert.rejects(f.run()); assert.deepEqual(f.calls, [['prepare']]);
  });
  await group('Rejected log setup stops once before configure or offerings', async () => {
    const f = fixture({ flag: 'true', logFailure: true }); await assert.rejects(f.run());
    await Promise.resolve(); assert.deepEqual(f.calls, [['prepare'], ['log', 'INFO']]);
  });
  await group('EAS opt-in exists only in the billing-test child profile', async () => {
    const eas = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../eas.json'), 'utf8'));
    assert.equal(eas.build['coach-ai-billing-beta'].env.EXPO_PUBLIC_COACH_AI_BILLING_INFO_LOGGING, 'true');
    assert.equal(eas.build['coach-ai-billing-beta'].extends, 'external-testing');
    for (const [name, profile] of Object.entries(eas.build)) if (name !== 'coach-ai-billing-beta') assert.equal(profile.env?.EXPO_PUBLIC_COACH_AI_BILLING_INFO_LOGGING, undefined);
  });
  console.log(JSON.stringify({ status: 'PASSED', groups: passed, newGroups: passed.length, liveRequests: 0, builds: 0, purchases: 0, restores: 0, retries: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { for (const [key, value] of original) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
