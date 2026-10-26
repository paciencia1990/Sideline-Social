'use strict';
const assert = require('node:assert/strict');
const { createSourceLoader } = require('./coach-ai-test-loader.cjs');
const load = createSourceLoader();
const { createCoachAiPurchaseController, isApprovedCoachAiProduct } = load('utils/coachAiPurchaseCore.ts');
function fixture() {
  const state = { identity: 'coach_fixture:0', entitled: false, enabled: true, pending: false, raw: null, buys: 0, restores: 0, verifications: 0, cancel: false, unknown: false, restoreOwns: false, unboundStorePurchase: false, afterVerify: null, buyHook: null };
  const controller = createCoachAiPurchaseController({
    identity: () => state.identity, newAttemptId: () => 'purchase-' + require('node:crypto').randomUUID(),
    verify: async () => { state.verifications++; if (state.restoreOwns) state.entitled = true; if (state.afterVerify) await state.afterVerify(); return { userId: 'coach_fixture', enabled: state.enabled, entitled: state.entitled }; },
    restore: async () => { state.restores++; if (state.restoreOwns) state.entitled = true; return state.unboundStorePurchase; },
    purchase: async (_uid, _product, invoke) => invoke(async () => { state.buys++; if (state.buyHook) await state.buyHook(); if (state.cancel) throw { userCancelled: true }; if (state.unknown) throw Error('unknown outcome'); state.entitled = true; }),
    read: async () => state.raw,
    write: async (_uid, expected, raw) => { if (state.raw !== expected) return false; state.raw = raw; state.pending = true; return true; },
    remove: async (_uid, expected) => { if (state.raw !== expected) return false; state.raw = null; state.pending = false; return true; },
    fingerprint: async (uid, raw) => require('node:crypto').createHash('sha256').update(uid + raw).digest('hex'),
    decision: async () => { throw Error('No legacy fixture review exists'); },
  });
  return { state, controller };
}
async function run() {
  const success = fixture(); assert.equal((await success.controller.buy('coach_fixture', {}, 'monthly')).entitled, true); assert.equal(success.state.buys, 1); assert.equal(success.state.pending, false);
  const owned = fixture(); owned.state.restoreOwns = true; assert.equal((await owned.controller.buy('coach_fixture', {}, 'yearly')).entitled, true); assert.equal(owned.state.buys, 0);
  const restore = fixture(); assert.equal((await restore.controller.restore('coach_fixture')).entitled, false); assert.equal(restore.state.buys, 0);
  const unbound = fixture(); unbound.state.unboundStorePurchase = true; await assert.rejects(unbound.controller.buy('coach_fixture', {}, 'yearly'), e => e.kind === 'confirmation_pending'); assert.equal(unbound.state.buys, 0);
  const cancelled = fixture(); cancelled.state.cancel = true; await assert.rejects(cancelled.controller.buy('coach_fixture', {}, 'monthly'), e => e.kind === 'cancelled'); assert.equal(cancelled.state.pending, false); assert.equal(cancelled.state.buys, 1);
  const unclear = fixture(); unclear.state.unknown = true; await assert.rejects(unclear.controller.buy('coach_fixture', {}, 'monthly'), e => e.kind === 'confirmation_pending');
  await assert.rejects(unclear.controller.buy('coach_fixture', {}, 'monthly'), e => e.kind === 'recovery_required'); assert.equal(unclear.state.buys, 1, 'No automatic or blind second charge');
  unclear.state.restoreOwns = true; assert.equal((await unclear.controller.restore('coach_fixture')).entitled, true); assert.equal(unclear.state.pending, false);
  const disabled = fixture(); disabled.state.enabled = false; await assert.rejects(disabled.controller.buy('coach_fixture', {}, 'monthly')); assert.equal(disabled.state.buys, 0); assert.equal(disabled.state.restores, 0);
  const switched = fixture(); switched.state.afterVerify = async () => { switched.state.identity = 'another_account:1'; }; await assert.rejects(switched.controller.buy('coach_fixture', {}, 'monthly'), e => e.kind === 'account_changed'); assert.equal(switched.state.buys, 0);
  const aba = fixture(); aba.state.afterVerify = async () => { aba.state.identity = 'coach_fixture:2'; }; await assert.rejects(aba.controller.buy('coach_fixture', {}, 'monthly'), e => e.kind === 'account_changed'); assert.equal(aba.state.buys, 0);
  const lateSwitch = fixture(); lateSwitch.state.buyHook = async () => { lateSwitch.state.identity = 'another_account:1'; }; await assert.rejects(lateSwitch.controller.buy('coach_fixture', {}, 'monthly'), e => e.kind === 'account_changed'); assert.equal(lateSwitch.state.pending, true);
  let release; const gate = new Promise(resolve => { release = resolve; }); const duplicate = fixture(); duplicate.state.buyHook = () => gate;
  const first = duplicate.controller.buy('coach_fixture', {}, 'monthly');
  await assert.rejects(duplicate.controller.buy('coach_fixture', {}, 'yearly'), e => e.kind === 'busy'); release(); await first; assert.equal(duplicate.state.buys, 1);
  const verifyFails = fixture(); verifyFails.state.buyHook = async () => { verifyFails.state.afterVerify = async () => { throw Error('network'); }; };
  await assert.rejects(verifyFails.controller.buy('coach_fixture', {}, 'monthly'), e => e.kind === 'confirmation_pending'); assert.equal(verifyFails.state.pending, true);
  const catalog = require('../docs/coach-ai-native-products-preparation-20261014.json');
  const serverCatalog = load('functions/src/coachAiSubscriptionCore.ts').COACH_AI_PRODUCT_CATALOG;
  assert.match(catalog.google.subscriptionId, /^[a-z0-9][a-z0-9_.]{0,39}$/);
  for (const plan of catalog.google.basePlans) {
    assert.match(plan.basePlanId, /^[a-z0-9][a-z0-9-]*$/);
    assert.equal(plan.revenueCatIdentifier, `${catalog.google.subscriptionId}:${plan.basePlanId}`);
    assert.equal(serverCatalog.play_store[plan.basePlanId], plan.revenueCatIdentifier, 'Prepared store IDs must match server verification');
  }
  for (const [platform, plan, id, price, period] of [['ios', 'monthly', 'com.sidelinesocial.coachai.monthly', 2.99, 'P1M'], ['ios', 'yearly', 'com.sidelinesocial.coachai.yearly', 24.99, 'P1Y'], ['android', 'monthly', 'coach_ai:monthly', 2.99, 'P1M'], ['android', 'yearly', 'coach_ai:yearly', 24.99, 'P1Y']]) {
    const product = { identifier: id, currencyCode: 'USD', price, subscriptionPeriod: period, defaultOption: { isBasePlan: true } };
    assert.equal(isApprovedCoachAiProduct(product, plan, platform), true);
    assert.equal(serverCatalog[platform === 'ios' ? 'app_store' : 'play_store'][plan], id);
    if (platform === 'android') {
      for (const identifier of [`coach-ai:${plan}`, 'coach_ai', `coach_ai:${plan}:trial`]) {
        assert.equal(isApprovedCoachAiProduct({ ...product, identifier }, plan, platform), false, 'Reject old, incomplete and offer IDs');
      }
    }
    for (const override of [{ identifier: 'coach_ai_monthly' }, { currencyCode: 'CAD' }, { price: 4.99 }, { subscriptionPeriod: 'P4M' }, { introPrice: {} }, { installmentsInfo: {} }]) assert.equal(isApprovedCoachAiProduct({ ...product, ...override }, plan, platform), false);
  }
  const cleanup = load('utils/localUserStateCore.ts');
  assert.deepEqual(cleanup.getLocalUserStateKeysToRemove(['sidelineSocial.coachAiPurchasePending.v1.coach_fixture', 'sidelineSocial.coachSavedHelp.v1.coach_fixture']), ['sidelineSocial.coachSavedHelp.v1.coach_fixture']);
  const access = load('utils/coachAiAccess.ts');
  const input = { buildAvailable: false, billingAvailable: true, claimLoaded: true, testerClaimEntitled: false, paidEntitled: true, paidRemaining: 0, signedIn: true, adultEligible: true, activeMode: 'coach', accountStanding: 'active' };
  assert.equal(access.resolveCoachAiAccess(input).canRequest, false); assert.equal(access.resolveCoachAiAccess(input).canView, true);
  assert.equal(access.resolveCoachAiAccess({ ...input, paidEntitled: false }).canRequest, false);
  assert.equal(access.resolveCoachAiAccess({ ...input, buildAvailable: true, testerClaimEntitled: true }).entitlementSource, 'tester-claim');
  console.log('Purchase flow: single checkout, explicit restore, cancellation, ambiguous outcomes, double taps, account-switch races, product restrictions and complimentary beta access passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
