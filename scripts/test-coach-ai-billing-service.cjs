'use strict';
const assert = require('node:assert/strict');
const { createSourceLoader } = require('./coach-ai-test-loader.cjs');
let authListener, currentSdkId, configured = 0, checkouts = 0, restores = 0, country = 'US', checkoutHook = null, enrollmentDenied = false, enrollmentHook = null;
const auth = { currentUser: { uid: 'coach_service_a' } };
const entitled = new Set(), storage = new Map(), enrolled = new Set();
process.env.EXPO_PUBLIC_COACH_AI_BILLING_ENABLED = 'true';
process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_fixture_public_key_not_live';
const product = { identifier: 'com.sidelinesocial.coachai.monthly', price: 2.99, priceString: '$2.99', currencyCode: 'USD', subscriptionPeriod: 'P1M', introPrice: null };
const pkg = { identifier: '$rc_monthly', product };
const sdk = {
  LOG_LEVEL: { ERROR: 'ERROR' }, setLogLevel: async () => {},
  configure: ({ appUserID }) => { assert.ok(enrolled.has(appUserID)); configured++; currentSdkId = appUserID; }, getAppUserID: async () => currentSdkId,
  logIn: async uid => { assert.ok(enrolled.has(uid)); currentSdkId = uid; }, logOut: async () => { throw Error('Must never create anonymous identity on logout'); },
  getStorefront: async () => ({ countryCode: country }), getOfferings: async () => ({ all: { coach_ai_launch: { availablePackages: [pkg] } } }),
  getCustomerInfo: async () => ({ entitlements: { active: entitled.has(currentSdkId) ? { coach_ai: {} } : {} } }),
  restorePurchases: async () => { restores++; return { entitlements: { active: {} } }; },
  purchasePackage: async () => { checkouts++; const owner = currentSdkId; if (checkoutHook) await checkoutHook(); entitled.add(owner); return { customerInfo: { entitlements: { active: { coach_ai: {} } } } }; },
};
const callableNames = [];
const load = createSourceLoader({
  '@react-native-async-storage/async-storage': { getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => { storage.set(key, value); }, removeItem: async key => { storage.delete(key); } },
  'expo-constants': { __esModule: true, default: { executionEnvironment: 'standalone' }, ExecutionEnvironment: { StoreClient: 'storeClient' } },
  'react-native': { Platform: { OS: 'ios' } },
  'firebase/auth': { onAuthStateChanged: (_, callback) => { authListener = callback; return () => {}; } },
  '@/config/firebase': { auth, functions: {} },
  'firebase/functions': { httpsCallable: (_, name) => { callableNames.push(name); const owner = auth.currentUser?.uid; return async data => {
    assert.deepEqual(data, {}, 'Client never submits entitlement/receipt/customer data');
    if (name === 'prepareCoachAiBilling') {
      if (enrollmentDenied) throw Error('Fixture enrollment denied');
      enrolled.add(owner);
      if (enrollmentHook) await enrollmentHook();
      return { data: { userId: owner, prepared: true } };
    }
    return { data: { userId: owner, enabled: true, entitled: entitled.has(owner), plan: entitled.has(owner) ? 'monthly' : null,
      remaining: entitled.has(owner) ? 30 : 0, pending: 0, limit: 30, resetsAtMs: null, accessUntilMs: null, store: null, autoRenews: false } };
  }; } },
  'react-native-purchases': { default: sdk },
  'expo-crypto': { randomUUID: require('node:crypto').randomUUID, CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: async (_, value) => require('node:crypto').createHash('sha256').update(value).digest('hex') },
});
const service = load('services/coachAiBillingService.ts');
function switchUser(uid) { auth.currentUser = uid ? { uid } : null; authListener(auth.currentUser); }
async function run() {
  enrollmentDenied = true;
  await assert.rejects(service.getCoachAiPurchasePackages('coach_service_a'));
  assert.equal(configured, 0, 'Denied enrollment must never configure the SDK');
  enrollmentDenied = false;
  const packages = await service.getCoachAiPurchasePackages('coach_service_a'); assert.equal(packages.monthly, pkg); assert.equal(configured, 1);
  await service.purchaseCoachAi('coach_service_a', 'monthly', pkg); assert.equal(checkouts, 1); assert.equal(restores, 0); assert.equal(storage.size, 0);
  await service.purchaseCoachAi('coach_service_a', 'monthly', pkg); assert.equal(checkouts, 1, 'An already verified purchase never charges again');
  switchUser(null); await assert.rejects(service.getCoachAiPurchasePackages('coach_service_a'), e => e.kind === 'account_changed');
  switchUser('coach_service_b'); await service.getCoachAiPurchasePackages('coach_service_b'); assert.equal(currentSdkId, 'coach_service_b'); assert.equal(configured, 1);
  checkoutHook = async () => { switchUser('coach_service_c'); };
  await assert.rejects(service.purchaseCoachAi('coach_service_b', 'monthly', pkg), e => e.kind === 'account_changed'); assert.equal(checkouts, 2);
  assert.ok(storage.has('sidelineSocial.coachAiPurchasePending.v1.coach_service_b'));
  checkoutHook = null; switchUser('coach_service_b');
  assert.equal((await service.restoreCoachAi('coach_service_b')).entitled, true); assert.equal(storage.size, 0);
  switchUser('coach_service_c'); country = 'CA'; await assert.rejects(service.getCoachAiPurchasePackages('coach_service_c'), e => e.kind === 'product_unavailable'); assert.equal(checkouts, 2);
  country = 'US'; enrollmentDenied = true;
  switchUser('coach_service_d');
  await assert.rejects(service.getCoachAiPurchasePackages('coach_service_d'));
  assert.equal(currentSdkId, 'coach_service_c', 'Denied enrollment cannot log in a new SDK identity');
  enrollmentDenied = false;
  enrollmentHook = async () => { switchUser('coach_service_e'); };
  await assert.rejects(service.getCoachAiPurchasePackages('coach_service_d'), e => e.kind === 'account_changed');
  assert.equal(currentSdkId, 'coach_service_c', 'Session change during enrollment cannot configure/login');
  assert.ok(callableNames.every(name => ['getCoachAiBillingStatus', 'prepareCoachAiBilling'].includes(name)));
  assert.equal(service.coachAiManagementUrl('play_store'), 'https://play.google.com/store/account/subscriptions?package=com.sidelinesquad.app');
  console.log('Actual billing-service adapter with fixture SDK: UID identification, server-only grants, purchase/restore, logout/switch fencing, pending intent and US storefront restrictions passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
