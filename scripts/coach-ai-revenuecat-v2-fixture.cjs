'use strict';
const projectId = 'projec5f2a61';
const entitlementId = 'entlfixturecoachai';
const appIds = ['appfixtureios', 'appfixtureandroid'];
const productMappings = [
  { revenueCatProductId: 'prodfixtureiosmonthly', productId: 'com.sidelinesocial.coachai.monthly', store: 'app_store', appId: appIds[0] },
  { revenueCatProductId: 'prodfixtureiosyearly', productId: 'com.sidelinesocial.coachai.yearly', store: 'app_store', appId: appIds[0] },
  { revenueCatProductId: 'prodfixtureandroidmonthly', productId: 'coach_ai:monthly', store: 'play_store', appId: appIds[1] },
  { revenueCatProductId: 'prodfixtureandroidyearly', productId: 'coach_ai:yearly', store: 'play_store', appId: appIds[1] },
];
function configuration(environment = 'production') {
  return { enabled: true, environment, projectId: 'ec5f2a61', allowance: 30, restorePolicy: 'keep_original', salesCountry: 'US',
    storeConnectionsVerified: true, appIds: [...appIds], apiVersion: 2, apiProjectId: projectId, credentialPolicy: 'separate_v2',
    v2StoreLifecycleVerified: true, v2SandboxTestingApproved: true, runtimeSecretIsolationVerified: true, entitlementId, productMappings: structuredClone(productMappings) };
}
function list(items, next = null) { return { object: 'list', items, next_page: next }; }
function fixtures(uid, now, settings = {}) {
  const product = productMappings.find(p => p.store === (settings.store ?? 'app_store') && p.productId.endsWith(settings.yearly ? 'yearly' : 'monthly'));
  const start = settings.startsAt ?? now - 20 * 86400000;
  const end = settings.expiry ?? now + 30 * 86400000;
  const entitled = settings.entitled ?? !settings.revoked;
  const ent = { state: 'active', object: 'entitlement', project_id: projectId, id: entitlementId, lookup_key: 'coach_ai',
    products: list([{ id: product.revenueCatProductId, app_id: product.appId, store_identifier: product.productId, type: 'subscription' }]) };
  const subscription = { object: 'subscription', id: 'subfixturecoachai', customer_id: uid, original_customer_id: uid,
    product_id: product.revenueCatProductId, starts_at: start, current_period_starts_at: start, current_period_ends_at: end, ends_at: end,
    gives_access: Boolean(entitled), pending_payment: false, auto_renewal_status: 'will_renew', status: settings.revoked ? 'expired' : 'active',
    environment: settings.sandbox ? 'sandbox' : 'production', store: product.store, ownership: 'purchased',
    store_subscription_identifier: product.store === 'play_store' ? 'GPA.1234-5678-9012-34567..0' : '1000000123456789', entitlements: list([ent]),
    total_revenue_in_usd: { currency: 'USD', gross: settings.yearly ? 24.99 : 2.99, tax: 0, proceeds: 0 } };
  return { customer: { object: 'customer', id: uid, project_id: projectId }, subscription,
    active: list(entitled ? [{ object: 'customer.active_entitlement', entitlement_id: entitlementId, expires_at: end }] : []) };
}
function installFixtureEnvironment() {
  Object.assign(process.env, {
    REVENUECAT_PROJECT_ID: 'ec5f2a61', REVENUECAT_API_V2_PROJECT_ID: projectId,
    REVENUECAT_VERIFICATION_KEY: 'sk_read_fixture_only_never_a_real_key',
    REVENUECAT_ERASURE_KEY: 'sk_erase_fixture_only_never_a_real_key',
    COACH_AI_BILLING_READER_SERVICE_ACCOUNT: 'fixture-coach-reader@sideline-social-staging-2026.iam.gserviceaccount.com',
    COACH_AI_BILLING_GENERATOR_SERVICE_ACCOUNT: 'fixture-coach-generator@sideline-social-staging-2026.iam.gserviceaccount.com',
    COACH_AI_BILLING_WEBHOOK_SERVICE_ACCOUNT: 'fixture-coach-webhook@sideline-social-staging-2026.iam.gserviceaccount.com',
    COACH_AI_BILLING_ERASURE_SERVICE_ACCOUNT: 'fixture-coach-erasure@sideline-social-staging-2026.iam.gserviceaccount.com',
  });
  // Any accidental v1 fallback must still be blocked by test HTTP allowlists.
  process.env.REVENUECAT_SECRET_KEY = 'sk_legacy_fixture_must_never_be_used';
}
module.exports = { projectId, entitlementId, productMappings, appIds, configuration, fixtures, list, installFixtureEnvironment };
