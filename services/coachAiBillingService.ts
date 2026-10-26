import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import type { PurchasesPackage } from 'react-native-purchases';
import { auth, functions } from '@/config/firebase';
import type { CoachAiBillingPlan, CoachAiBillingStatus } from '@/types/coachAiBilling';
import { CoachAiPurchaseError, createCoachAiPurchaseController, isApprovedCoachAiProduct, coachAiProductRejection, type CoachAiPurchaseDiagnostic, type CoachAiPurchasePhase, type CoachAiPurchaseRecoveryDecision } from '@/utils/coachAiPurchaseCore';
import { BillingDiagnosticFault, createBillingDiagnostic, type BillingDiagnostic, type BillingRecorder } from '@/utils/coachAiBillingDiagnostics';

export const COACH_AI_BILLING_ENABLED = process.env.EXPO_PUBLIC_COACH_AI_BILLING_ENABLED === 'true';
const PENDING_PREFIX = 'sidelineSocial.coachAiPurchasePending.v1';
let sdk: typeof import('react-native-purchases').default | null = null;
let initialized = false;
let identityUid: string | null = auth.currentUser?.uid ?? null;
let epoch = 0;
let sdkQueue = Promise.resolve();
const listeners = new Set<(status?: CoachAiBillingStatus) => void>();
const inFlightStatus = new Map<string, Promise<CoachAiBillingStatus>>();
function currentIdentity() { return identityUid ? `${identityUid}:${epoch}` : null; }
function requireUid(uid: string, identity = currentIdentity()) {
  if (!uid || auth.currentUser?.uid !== uid || !identity || currentIdentity() !== identity) throw new CoachAiPurchaseError('account_changed');
}
function notify(status?: CoachAiBillingStatus) { listeners.forEach((listener) => listener(status)); }

onAuthStateChanged(auth, (user) => {
  const next = user?.uid ?? null;
  if (next === identityUid) return;
  identityUid = next; epoch += 1; inFlightStatus.clear(); notify();
  // Invalidate all app access immediately. RevenueCat logOut creates an
  // anonymous ID; avoid that aliasing path by switching directly between
  // identified UIDs at the next authorized SDK operation instead.
});

function loadSdk() {
  if (!COACH_AI_BILLING_ENABLED || Constants.executionEnvironment === ExecutionEnvironment.StoreClient
    || Platform.OS !== 'ios' && Platform.OS !== 'android') throw new CoachAiPurchaseError('unavailable');
  // Keep the native module unloaded in beta builds without billing and Expo Go.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (!sdk) sdk = require('react-native-purchases').default;
  return sdk!;
}
async function withSdk<T>(uid: string, operation: (client: NonNullable<typeof sdk>, guard: () => void) => Promise<T>,
  diagnostic?: BillingRecorder, isActive: () => boolean = () => true, stage?: (phase: CoachAiPurchasePhase) => void) {
  const session = currentIdentity();
  const guard = () => {
    requireUid(uid, session);
    if (!isActive()) throw new BillingDiagnosticFault('navigation_cancelled');
  };
  guard();
  const result = sdkQueue.then(async () => {
    guard();
    diagnostic?.enter('sdk_setup'); stage?.('sdk_setup');
    const client = loadSdk();
    const apiKey = Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
    if (!apiKey || !apiKey.startsWith(Platform.OS === 'ios' ? 'appl_' : 'goog_')) throw new BillingDiagnosticFault('sdk_unavailable');
    diagnostic?.pass();
    // Fail closed before configure/login or any SDK operation. The durable
    // server record covers nonbuyers too; authorization is never cached.
    diagnostic?.enter('prepare'); stage?.('account_preparation');
    const prepared = await httpsCallable<Record<string, never>, { userId: string; prepared: boolean }>(functions, 'prepareCoachAiBilling', { timeout: 30_000 })({});
    guard();
    if (prepared.data.userId !== uid || prepared.data.prepared !== true) throw new BillingDiagnosticFault('preparation_rejected');
    diagnostic?.pass();
    diagnostic?.enter('sdk_identity'); stage?.('sdk_identity');
    if (!initialized) {
      // Build-time diagnostic opt-in for Android Internal testing; other builds
      // retain ERROR logging. Set the level before configuring the native SDK.
      const logLevel = Platform.OS === 'android' && process.env.EXPO_PUBLIC_COACH_AI_BILLING_INFO_LOGGING === 'true'
        ? client.LOG_LEVEL.INFO : client.LOG_LEVEL.ERROR;
      await client.setLogLevel(logLevel); guard(); client.configure({ apiKey, appUserID: uid }); initialized = true;
    }
    else if (await client.getAppUserID() !== uid) { guard(); await client.logIn(uid); }
    guard(); diagnostic?.pass();
    const value = await operation(client, guard);
    guard();
    return value;
  });
  sdkQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function fetchCoachAiBillingStatus(uid: string) {
  if (!COACH_AI_BILLING_ENABLED) throw new CoachAiPurchaseError('unavailable');
  const identity = currentIdentity(); requireUid(uid, identity);
  const existing = inFlightStatus.get(identity!);
  if (existing) return existing;
  const operation = (async () => {
    const diagnostic = createBillingDiagnostic('billing_status');
    try {
    const result = await httpsCallable<Record<string, never>, CoachAiBillingStatus>(functions, 'getCoachAiBillingStatus', { timeout: 30_000 })({});
    requireUid(uid, identity);
    const value = result.data;
    if (!value || value.userId !== uid || typeof value.enabled !== 'boolean' || typeof value.entitled !== 'boolean'
      || !Number.isInteger(value.remaining) || value.remaining < 0 || value.remaining > 30 || value.limit !== 30) throw new BillingDiagnosticFault('invalid_status');
    return value;
    } catch (error) { throw diagnostic.fail(error); }
  })();
  inFlightStatus.set(identity!, operation);
  try { return await operation; }
  finally { if (inFlightStatus.get(identity!) === operation) inFlightStatus.delete(identity!); }
}

export async function getCoachAiPurchasePackages(uid: string, publish?: (value: BillingDiagnostic) => void,
  isActive: () => boolean = () => true): Promise<Partial<Record<CoachAiBillingPlan, PurchasesPackage>>> {
  const diagnostic = createBillingDiagnostic('sdk_setup', publish);
  try {
  const approved = await withSdk(uid, async (client, guard) => {
    diagnostic.enter('storefront');
    const country = (await client.getStorefront())?.countryCode;
    guard();
    if (typeof country !== 'string' || !/^[A-Z]{2,3}$/.test(country)) throw new BillingDiagnosticFault('storefront_unknown');
    if (!['US', 'USA'].includes(country)) throw new BillingDiagnosticFault('storefront_unsupported');
    diagnostic.pass();
    diagnostic.enter('offerings');
    const offering = (await client.getOfferings()).all.coach_ai_launch;
    guard();
    if (!offering) throw new BillingDiagnosticFault('offering_missing');
    diagnostic.pass();
    const approved: Partial<Record<CoachAiBillingPlan, PurchasesPackage>> = {};
    for (const plan of ['monthly', 'yearly'] as const) {
      const candidate = offering.availablePackages.find((entry) => entry.identifier === (plan === 'monthly' ? '$rc_monthly' : '$rc_annual'));
      diagnostic.enter(plan);
      const reason = candidate ? coachAiProductRejection(candidate.product, plan, Platform.OS as 'ios' | 'android') : 'package_missing';
      diagnostic.pass(reason ?? 'ok');
      if (candidate && !reason) approved[plan] = candidate;
    }
    return approved;
  }, diagnostic, isActive);
  diagnostic.enter('screen');
  diagnostic.finish(approved.monthly && approved.yearly ? 'ready' : approved.monthly || approved.yearly ? 'partial' : 'failed',
    approved.monthly && approved.yearly ? 'ok' : approved.monthly || approved.yearly ? 'partial_plans' : 'no_plans');
  return approved;
  } catch (error) { throw diagnostic.fail(error); }
}

type PurchasePublisher = (value: CoachAiPurchaseDiagnostic) => void;
// Retain the existing key so sign-out preserves legacy and v2 attempts alike.
function pendingKey(uid: string) { return `${PENDING_PREFIX}.${uid}`; }
const controller = createCoachAiPurchaseController<PurchasesPackage>({
  identity: currentIdentity,
  newAttemptId: () => `purchase-${Crypto.randomUUID()}`,
  verify: fetchCoachAiBillingStatus,
  restore: async (uid, stage) => Boolean((await withSdk(uid, client => client.restorePurchases(), undefined, () => true, stage)).entitlements.active.coach_ai),
  purchase: async (uid, product, invoke, stage) => { await withSdk(uid, async (client, guard) => {
    stage('storefront');
    const country = (await client.getStorefront())?.countryCode; guard();
    if (!['US', 'USA'].includes(country ?? '')) throw new CoachAiPurchaseError('product_unavailable');
    // Read this identified customer's state; Buy never calls restore or sync.
    stage('ownership_check');
    const info = await client.getCustomerInfo(); guard();
    if (info.entitlements.active.coach_ai) throw new CoachAiPurchaseError('ownership_conflict');
    await invoke(async () => { await client.purchasePackage(product); }, guard);
  }, undefined, () => true, stage); },
  read: async uid => { requireUid(uid); return AsyncStorage.getItem(pendingKey(uid)); },
  write: async (uid, expected, value) => {
    const session = currentIdentity(); requireUid(uid, session);
    const current = await AsyncStorage.getItem(pendingKey(uid)); requireUid(uid, session);
    if (current !== expected) return false;
    await AsyncStorage.setItem(pendingKey(uid), value); requireUid(uid, session); return true;
  },
  remove: async (uid, expected) => {
    const session = currentIdentity(); requireUid(uid, session);
    const current = await AsyncStorage.getItem(pendingKey(uid)); requireUid(uid, session);
    if (current !== expected) return false;
    await AsyncStorage.removeItem(pendingKey(uid)); requireUid(uid, session); return true;
  },
  fingerprint: (uid, value) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${uid}\n${value}`),
  decision: async (uid, markerFingerprint, reviewReference) => {
    if (process.env.EXPO_PUBLIC_COACH_AI_BILLING_INFO_LOGGING !== 'true') throw new CoachAiPurchaseError('recovery_required');
    const session = currentIdentity(); requireUid(uid, session);
    // Server validates an independently reviewed, exact-record sandbox decision.
    // This does not create approval, change entitlement or contact the store.
    const response = await httpsCallable<{ markerFingerprint: string; reviewReference: string }, CoachAiPurchaseRecoveryDecision>(
      functions, 'getCoachAiPurchaseRecoveryDecision', { timeout: 30_000 })({ markerFingerprint, reviewReference });
    requireUid(uid, session); return response.data;
  },
});
export async function purchaseCoachAi(uid: string, plan: CoachAiBillingPlan, product: PurchasesPackage, publish?: PurchasePublisher) {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android' || !isApprovedCoachAiProduct(product.product, plan, Platform.OS)) throw new CoachAiPurchaseError('product_unavailable');
  const status = await controller.buy(uid, product, plan, publish); notify(status); return status;
}
export async function restoreCoachAi(uid: string, publish?: PurchasePublisher) {
  const status = await controller.restore(uid, publish); notify(status); return status;
}
export async function checkCoachAiPurchaseStatus(uid: string, publish?: PurchasePublisher) {
  const status = await controller.checkStatus(uid, publish); notify(status); return status;
}
export function inspectCoachAiPurchase(uid: string, publish?: PurchasePublisher) { return controller.inspect(uid, publish); }
export function resolveReviewedCoachAiPurchase(uid: string, reference: string, publish?: PurchasePublisher) { return controller.resolve(uid, reference, publish); }
export const COACH_AI_TEST_RECOVERY_AVAILABLE = process.env.EXPO_PUBLIC_COACH_AI_BILLING_INFO_LOGGING === 'true';
export function subscribeCoachAiBilling(listener: (status?: CoachAiBillingStatus) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function notifyCoachAiUsageChanged() { notify(); }
export function coachAiManagementUrl(store: CoachAiBillingStatus['store']) {
  return store === 'app_store' ? 'https://apps.apple.com/account/subscriptions'
    : store === 'play_store' ? 'https://play.google.com/store/account/subscriptions?package=com.sidelinesquad.app' : null;
}
