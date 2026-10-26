'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createSourceLoader } = require('./coach-ai-test-loader.cjs');
const fixture = require('./coach-ai-revenuecat-v2-fixture.cjs');
const api = createSourceLoader()('functions/src/coachAiRevenueCatV2.ts');
const policy = createSourceLoader()('functions/src/coachAiSubscriptionCore.ts');
const now = Date.parse('2026-10-13T12:00:00Z'), uid = 'v2_fixture_coach';
const secret = 'sk_read_fixture_only_never_a_real_key', erasureKey = 'sk_erase_fixture_only_never_a_real_key';
const rawConfig = fixture.configuration();
const config = api.parseRevenueCatV2Config(rawConfig, 'production', fixture.appIds);
assert.ok(config);
assert.ok(api.parseRevenueCatV2Config({ ...fixture.configuration('sandbox'), v2StoreLifecycleVerified: false }, 'sandbox', fixture.appIds), 'Approved sandbox testing does not require prior production certification');
assert.equal(api.parseRevenueCatV2Config({ ...fixture.configuration('sandbox'), v2SandboxTestingApproved: false }, 'sandbox', fixture.appIds), null);
for (const field of ['apiVersion', 'apiProjectId', 'credentialPolicy', 'runtimeSecretIsolationVerified', 'v2StoreLifecycleVerified']) {
  const bad = structuredClone(rawConfig); delete bad[field]; assert.equal(api.parseRevenueCatV2Config(bad, 'production', fixture.appIds), null);
}
for (const mutate of [
  c => { c.productMappings[0].revenueCatProductId = 'prod500ba84f76'; },
  c => { c.productMappings[1].revenueCatProductId = c.productMappings[0].revenueCatProductId; },
  c => { c.productMappings[0].appId = c.appIds[1]; },
  c => { c.productMappings[0].productId = 'unapproved'; },
  c => { c.productMappings[2].productId = 'coach-ai:monthly'; },
  c => { c.productMappings[3].productId = 'coach-ai:yearly'; },
]) { const c = structuredClone(rawConfig); mutate(c); assert.equal(api.parseRevenueCatV2Config(c, 'production', fixture.appIds), null); }
assert.equal(api.revenueCatRuntimeIdentities({}), null);
assert.equal(api.revenueCatRuntimeIdentities({ COACH_AI_BILLING_READER_SERVICE_ACCOUNT: 'default', COACH_AI_BILLING_ERASURE_SERVICE_ACCOUNT: 'default' }), null);
const deployedDeletionIdentity = 'sideline-account-delete@sideline-social-staging-2026.iam.gserviceaccount.com';
assert.equal(api.coachAiErasureRuntimeIdentity({}), deployedDeletionIdentity, 'Incomplete billing setup must preserve the existing hardened deletion identity');
assert.equal(api.coachAiErasureRuntimeIdentity({ COACH_AI_BILLING_READER_SERVICE_ACCOUNT: 'default', COACH_AI_BILLING_ERASURE_SERVICE_ACCOUNT: 'default' }), deployedDeletionIdentity);
assert.equal(api.coachAiErasureRuntimeIdentity({ COACH_AI_BILLING_READER_SERVICE_ACCOUNT: deployedDeletionIdentity, COACH_AI_BILLING_ERASURE_SERVICE_ACCOUNT: deployedDeletionIdentity }), deployedDeletionIdentity);
fixture.installFixtureEnvironment(); assert.ok(api.revenueCatRuntimeIdentities());
assert.equal(api.coachAiErasureRuntimeIdentity(), process.env.COACH_AI_BILLING_ERASURE_SERVICE_ACCOUNT, 'A valid distinct reviewed set selects its configured erasure runtime');
const identityNames = ['READER', 'GENERATOR', 'WEBHOOK', 'ERASURE'].map(role => `COACH_AI_BILLING_${role}_SERVICE_ACCOUNT`);
const identityConfig = Object.fromEntries(identityNames.map(name => [name, process.env[name]]));
for (const name of identityNames) {
  const missing = { ...identityConfig }; delete missing[name];
  assert.equal(api.revenueCatRuntimeIdentities(missing), null, 'Incomplete runtime separation cannot activate billing');
  const shared = { ...identityConfig, [name]: identityConfig[identityNames[(identityNames.indexOf(name) + 1) % identityNames.length]] };
  assert.equal(api.revenueCatRuntimeIdentities(shared), null, 'Every billing operation must have a distinct runtime identity');
}
for (const role of ['reader','generator','webhook','erasure']) {
  assert.equal(api.coachAiRuntimeIdentity(role, {}), api.COACH_AI_DEDICATED_RUNTIME_DEFAULTS[role], 'Incomplete configuration must not attach billing secrets to the shared default account');
  assert.notEqual(api.coachAiRuntimeIdentity(role, {}), 'default');
  assert.equal(api.coachAiRuntimeIdentity(role, identityConfig), api.revenueCatRuntimeIdentities(identityConfig)[role]);
}
assert.equal(api.coachAiErasureRuntimeIdentity({ ...identityConfig, COACH_AI_BILLING_WEBHOOK_SERVICE_ACCOUNT: 'default' }), deployedDeletionIdentity);
let count = 0;
async function lookup(value = fixture.fixtures(uid, now), modifyResponse, configuration = config, clock = () => now) {
  const calls = [];
  const fetcher = async (url, options) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, 'https://api.revenuecat.com'); assert.match(parsed.pathname, /^\/v2\/projects\/projec5f2a61\//);
    assert.equal(options.method, 'GET'); assert.equal(options.headers.authorization, `Bearer ${secret}`); assert.equal(options.redirect, 'error');
    calls.push(parsed); let body;
    if (parsed.pathname.endsWith(`/customers/${uid}`)) body = value.customer;
    else if (parsed.pathname.endsWith('/subscriptions') && parsed.pathname.includes('/customers/')) {
      assert.equal(parsed.searchParams.get('environment'), configuration.environment); body = fixture.list([value.subscription]);
    } else if (parsed.pathname.endsWith('/subscriptions/subfixturecoachai')) body = value.subscription;
    else if (parsed.pathname.endsWith('/active_entitlements')) body = value.active;
    else if (parsed.pathname.endsWith('/entitlements')) body = value.subscription.entitlements;
    else throw Error('Unexpected endpoint');
    return modifyResponse?.(parsed, structuredClone(body), calls) ?? new Response(JSON.stringify(body));
  };
  const result = await api.lookupRevenueCatV2(uid, configuration, secret, { now: clock, fetcher }); count++;
  return { result, calls };
}
function allowed(subscription, currentTime = now) {
  return policy.resolveCoachAiPaidAccess({ paidEnabled: true, accountUid: uid, adultEligible: true, activeMode: 'coach', accountStanding: 'active',
    environment: 'production', subscription, nowMs: currentTime, maxVerificationAgeMs: 300000 }).entitled;
}
async function run() {
  for (const store of ['app_store', 'play_store']) for (const yearly of [false, true]) {
    const value = fixture.fixtures(uid, now, { store, yearly }); const { result, calls } = await lookup(value);
    assert.ok(allowed(result.subscription)); assert.equal(result.subscription.store, store);
    assert.equal(result.subscription.paidThroughMs, value.subscription.ends_at); assert.equal(result.subscription.accessUntilMs, now + 300000);
    assert.equal(allowed(result.subscription, now + 300000), false); assert.equal(calls.length, 4);
  }
  const cancel = fixture.fixtures(uid, now); cancel.subscription.auto_renewal_status = 'will_not_renew';
  const numeric = fixture.fixtures(uid, now); numeric.subscription.store_subscription_identifier = 12345678;
  assert.ok((await lookup(numeric)).result.subscription);
  numeric.subscription.store_subscription_identifier = Number.MAX_SAFE_INTEGER + 1; await assert.rejects(lookup(numeric));
  const cancelled = (await lookup(cancel)).result; assert.ok(allowed(cancelled.subscription)); assert.equal(cancelled.subscription.autoRenews, false);
  const grace = fixture.fixtures(uid, now, { expiry: now - 1000 }); grace.subscription.status = 'in_grace_period'; grace.subscription.pending_payment = true;
  const inGrace = (await lookup(grace)).result; assert.ok(allowed(inGrace.subscription)); assert.equal(inGrace.subscription.paidThroughMs, null);
  const renewed = fixture.fixtures(uid, now); renewed.subscription.auto_renewal_status = 'has_already_renewed'; renewed.subscription.ends_at += 30 * 86400000;
  assert.equal((await lookup(renewed)).result.subscription.paidThroughMs, renewed.subscription.ends_at);
  for (const status of ['expired', 'in_billing_retry', 'paused', 'unknown', 'incomplete', 'trialing']) {
    const value = fixture.fixtures(uid, now); value.subscription.status = status; value.subscription.gives_access = status === 'unknown' || status === 'trialing';
    assert.equal((await lookup(value)).result.subscription, null);
  }
  for (const mutate of [
    f => { f.subscription.store = 'promotional'; },
    f => { f.subscription.product_id = 'prod500ba84f76'; },
    f => { f.subscription.ownership = 'family_shared'; },
    f => { f.subscription.entitlements.items[0].lookup_key = 'another_feature'; },
    f => { f.active.items = []; },
    f => { f.subscription.gives_access = false; },
  ]) { const value = fixture.fixtures(uid, now); mutate(value); assert.equal((await lookup(value)).result.subscription, null); }
  for (const mutate of [
    f => { f.customer.id = 'different_account'; },
    f => { f.customer.project_id = 'projanother'; },
    f => { f.subscription.original_customer_id = 'different_account'; },
    f => { f.subscription.environment = 'sandbox'; },
    f => { f.subscription.entitlements.items[0].products.items[0].app_id = 'another_app'; },
    f => { f.subscription.entitlements.items[0].products.items[0].store_identifier = 'another_sku'; },
    f => { f.subscription.ends_at = now - 1; },
  ]) { const value = fixture.fixtures(uid, now); mutate(value); await assert.rejects(lookup(value)); }
  const sandboxConfig = api.parseRevenueCatV2Config(fixture.configuration('sandbox'), 'sandbox', fixture.appIds);
  assert.equal((await lookup(fixture.fixtures(uid, now, { sandbox: true }), undefined, sandboxConfig)).result.subscription.environment, 'sandbox');
  let one = 0;
  const absent = await api.lookupRevenueCatV2(uid, config, secret, { now: () => now, fetcher: async () => {
    one++; return new Response(JSON.stringify({ object: 'error', type: 'resource_missing', param: 'customer_id' }), { status: 404 });
  } }); assert.equal(one, 1); assert.equal(absent.customerExists, false); assert.equal(absent.subscription, null);
  for (const status of [401, 403, 404, 423, 429, 500, 503]) {
    one = 0; await assert.rejects(api.lookupRevenueCatV2(uid, config, secret, { now: () => now, fetcher: async () => {
      one++; return new Response(JSON.stringify({ object: 'error', type: 'authentication_error', retryable: true, backoff_ms: 1 }), { status });
    } })); assert.equal(one, 1, 'No retry after a failed HTTP attempt');
  }
  for (const next of ['https://attacker.invalid/steal', `/v2/projects/projother/customers/${uid}/subscriptions?starting_after=subnext`,
    `/v2/projects/${fixture.projectId}/customers/${uid}/subscriptions?starting_after=subnext&environment=sandbox`,
    `/v2/projects/${fixture.projectId}/customers/${uid}/subscriptions?starting_after=subnext&starting_after=subother`]) {
    let seen = 0; await assert.rejects(lookup(undefined, (url, body) => { seen++; if (url.pathname.endsWith('/subscriptions')) body.next_page = next; return new Response(JSON.stringify(body)); }));
    assert.equal(seen, 2, 'Continuation rejected before sending the key anywhere else');
  }
  const p = `/v2/projects/${fixture.projectId}/customers/${uid}/subscriptions`;
  const paged = await lookup(undefined, (url, body) => {
    if (url.pathname === p && !url.searchParams.has('starting_after')) return new Response(JSON.stringify(fixture.list([], `${p}?starting_after=subnext`)));
    return new Response(JSON.stringify(body));
  }); assert.ok(paged.result.subscription); assert.equal(paged.calls.length, 5);
  let pageReads = 0;
  await assert.rejects(lookup(undefined, (url, body) => {
    if (url.pathname === p) { pageReads++; return new Response(JSON.stringify(fixture.list([], `${p}?starting_after=sub${pageReads}`))); }
    return new Response(JSON.stringify(body));
  })); assert.equal(pageReads, 5, 'Pagination cannot run without a bound');
  await assert.rejects(lookup(undefined, (url, body) => {
    if (url.pathname === p) body.items.push({ ...body.items[0], id: 'subsecond' }); return new Response(JSON.stringify(body));
  }), /billing_multiple_subscriptions/);
  await assert.rejects(lookup(undefined, (url, body) => {
    if (url.pathname.endsWith('/subscriptions/subfixturecoachai')) body.gives_access = false; return new Response(JSON.stringify(body));
  }), /billing_v2_snapshot_changed/);
  let tick = 0; await assert.rejects(lookup(undefined, undefined, config, () => now + (++tick > 2 ? 13000 : 0)), /billing_v2_lookup_budget/);
  await assert.rejects(lookup(undefined, () => new Response('x'.repeat(1024 * 1024 + 1))), /billing_response_too_large/);
  const nextMonthAnchor = fixture.fixtures(uid, now, { yearly: true, startsAt: now - 86400000 });
  assert.equal((await lookup(nextMonthAnchor)).result.originalPurchaseAtMs, nextMonthAnchor.subscription.starts_at);
  for (const status of [200, 404, 409, 429, 500, 503]) {
    let deletes = 0;
    const result = await api.requestRevenueCatV2Erasure(uid, fixture.projectId, erasureKey, { now: () => now, fetcher: async (url, options) => {
      deletes++; assert.equal(options.method, 'DELETE'); assert.equal(options.headers.authorization, `Bearer ${erasureKey}`);
      assert.equal(String(url), `https://api.revenuecat.com/v2/projects/${fixture.projectId}/customers/${uid}`);
      return new Response(JSON.stringify({ object: 'customer', id: uid, deleted_at: now }), { status });
    } }); assert.equal(deletes, 1); assert.equal(result, status === 200 ? 'deletion_requested' : 'needs_review');
  }
  let deletes = 0;
  assert.equal(await api.requestRevenueCatV2Erasure(uid, 'projwrong', erasureKey, { fetcher: async () => { deletes++; throw Error('must not run'); } }), 'needs_review'); assert.equal(deletes, 0);
  assert.equal(await api.requestRevenueCatV2Erasure(uid, fixture.projectId, erasureKey, { now: () => now, fetcher: async () => new Response(JSON.stringify({ object: 'customer', id: 'wrong', deleted_at: now })) }), 'needs_review');
  for (const file of ['coachAiBilling.ts', 'coachAiPaidGeneration.ts']) {
    const source = fs.readFileSync(`functions/src/${file}`, 'utf8'); assert.ok(source.includes('REVENUECAT_VERIFICATION_SECRET'));
    assert.equal(source.includes('REVENUECAT_ERASURE_SECRET'), false); assert.equal(source.includes('REVENUECAT_SECRET_KEY'), false);
  }
  const erasure = fs.readFileSync('functions/src/coachAiBillingDeletion.ts', 'utf8'); assert.equal(erasure.includes('REVENUECAT_VERIFICATION_SECRET'), false);
  assert.ok(erasure.includes('REVENUECAT_ERASURE_SECRET'));
  console.log(`RevenueCat v2 fixture checks passed: scoped credentials, four native plans, lifecycle/lease/grace, identity/products, bounded pagination/streaming, no HTTP retries and erasure outcomes (${count} successful lookup cases).`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
