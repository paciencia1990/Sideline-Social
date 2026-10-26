'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// In-memory test compilation; no Function package/native build or emitted files.
const file = path.join(__dirname, '../functions/src/coachAiSubscriptionCore.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
});
const moduleUnderTest = { exports: {} };
vm.runInNewContext(compiled.outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports });
const core = moduleUnderTest.exports;
assert.equal(core.COACH_AI_INCLUDED_RESPONSES_PER_MONTH, 30);
const now = Date.parse('2026-10-12T16:00:00Z');
const snapshot = {
  accountUid: 'fixture_coach', entitlementId: 'coach_ai',
  productId: 'com.sidelinesocial.coachai.monthly', store: 'app_store',
  environment: 'production', status: 'active', verifiedAtMs: now,
  accessUntilMs: now + 86400000, autoRenews: true,
};
const context = {
  paidEnabled: true, accountUid: 'fixture_coach', adultEligible: true,
  activeMode: 'coach', accountStanding: 'active', environment: 'production',
  subscription: snapshot, nowMs: now, maxVerificationAgeMs: 300000,
};
let checks = 0;
function decision(contextChanges, subscriptionChanges, expected, reason) {
  const input = { ...context, ...contextChanges };
  if (subscriptionChanges) input.subscription = { ...snapshot, ...subscriptionChanges };
  const actual = core.resolveCoachAiPaidAccess(input);
  assert.equal(actual.entitled, expected);
  assert.equal(actual.reason, reason);
  checks += 1;
}
decision({}, {}, true, 'allowed');
decision({}, { autoRenews: false }, true, 'allowed'); // cancelled, still paid
decision({}, { status: 'grace_period' }, true, 'allowed');
for (const status of ['pending', 'billing_hold', 'paused', 'expired', 'revoked', 'invented']) {
  decision({}, { status }, false, 'inactive');
}
for (const state of ['messagingRestricted', 'suspended', 'banned', null]) {
  decision({ accountStanding: state }, {}, false, 'context');
}
decision({ paidEnabled: false }, {}, false, 'disabled');
decision({ accountUid: null }, {}, false, 'context');
decision({ adultEligible: false }, {}, false, 'context');
decision({ activeMode: 'parent' }, {}, false, 'context');
decision({ subscription: null }, null, false, 'unverified');
decision({}, { accountUid: 'another_account' }, false, 'account_mismatch');
decision({}, { entitlementId: 'another_feature' }, false, 'wrong_product');
decision({}, { productId: 'lifetime_unlock' }, false, 'wrong_product');
for (const productId of ['coach-ai:monthly', 'coach-ai:yearly', 'coach_ai', 'coach_ai:monthly:trial']) {
  decision({}, { store: 'play_store', productId }, false, 'wrong_product');
}
decision({}, { store: 'promotional' }, false, 'wrong_product');
decision({}, { environment: 'sandbox' }, false, 'wrong_environment');
decision({ environment: 'sandbox' }, { environment: 'sandbox' }, true, 'allowed');
decision({}, { accessUntilMs: now }, false, 'inactive');
decision({}, { accessUntilMs: NaN }, false, 'inactive');
decision({}, { verifiedAtMs: now + 1 }, false, 'stale');
decision({}, { verifiedAtMs: now - 300001 }, false, 'stale');
decision({ maxVerificationAgeMs: -1 }, {}, false, 'stale');
decision({}, { verifiedAtMs: null }, false, 'stale');
for (const store of ['app_store', 'play_store']) {
  for (const plan of ['monthly', 'yearly']) {
    const actual = core.resolveCoachAiPaidAccess({ ...context, subscription: {
      ...snapshot, store, productId: core.COACH_AI_PRODUCT_CATALOG[store][plan],
    } });
    assert.equal(actual.plan, plan);
    assert.equal(actual.entitled, true);
    checks += 1;
  }
}
assert.equal(core.canReplaceVerifiedSubscription(snapshot, snapshot), false, 'Duplicate verification must be idempotent.');
assert.equal(core.canReplaceVerifiedSubscription(snapshot, { ...snapshot, verifiedAtMs: now - 1 }), false, 'Out-of-order refresh cannot overwrite the newer state.');
assert.equal(core.canReplaceVerifiedSubscription(snapshot, { ...snapshot, accountUid: 'another_account', verifiedAtMs: now + 1 }), false, 'Restore must not silently transfer access.');
assert.equal(core.canReplaceVerifiedSubscription(snapshot, { ...snapshot, environment: 'sandbox', verifiedAtMs: now + 1 }), false, 'Sandbox and production records must remain separate.');
assert.equal(core.canReplaceVerifiedSubscription(snapshot, { ...snapshot, status: 'revoked', verifiedAtMs: now + 1 }), true);

const ledger = { accountUid: 'fixture_coach', windowId: 'fixture_month', limit: 2, fulfilled: 0, reserved: 0 };
const first = core.reserveCoachAiPaidGuide(ledger);
const second = core.reserveCoachAiPaidGuide(first);
assert.throws(() => core.reserveCoachAiPaidGuide(second), /allowance_exhausted/);
assert.equal(ledger.reserved, 0, 'Policy helpers do not mutate their inputs.');
const completed = core.finishCoachAiPaidGuide(second, 'fulfilled');
assert.equal(completed.fulfilled, 1);
assert.equal(completed.reserved, 1);
const released = core.finishCoachAiPaidGuide(completed, 'failed');
assert.equal(released.fulfilled, 1, 'Failures do not count as fulfilled guides.');
assert.equal(released.reserved, 0);
const safety = core.finishCoachAiPaidGuide(core.reserveCoachAiPaidGuide(released), 'local_safety');
assert.equal(safety.fulfilled, 1, 'A deterministic safety response does not consume paid usage.');
assert.throws(() => core.finishCoachAiPaidGuide(released, 'fulfilled'), /reservation_missing/);
assert.throws(() => core.reserveCoachAiPaidGuide({ ...ledger, limit: 0 }), /invalid_usage_ledger/);
assert.throws(() => core.reserveCoachAiPaidGuide({ ...ledger, fulfilled: -1 }), /invalid_usage_ledger/);
assert.throws(() => core.reserveCoachAiPaidGuide({ ...ledger, reserved: 3 }), /invalid_usage_ledger/);
let approvedAllowance = { ...ledger, limit: core.COACH_AI_INCLUDED_RESPONSES_PER_MONTH };
for (let i = 0; i < 30; i += 1) approvedAllowance = core.reserveCoachAiPaidGuide(approvedAllowance);
assert.throws(() => core.reserveCoachAiPaidGuide(approvedAllowance), /allowance_exhausted/, 'Outstanding work reserves all 30 shared slots before a 31st response can start.');
for (let i = 0; i < 30; i += 1) approvedAllowance = core.finishCoachAiPaidGuide(approvedAllowance, 'fulfilled');
assert.equal(approvedAllowance.fulfilled, 30);
assert.equal(approvedAllowance.reserved, 0);
assert.throws(() => core.reserveCoachAiPaidGuide(approvedAllowance), /allowance_exhausted/);

// Paid integration does not change the beta-only generation authorization.
assert.ok(fs.readFileSync(path.join(__dirname, '../functions/src/coachResourceHelp.ts'), 'utf8').includes('context.auth?.token.aiCoachTester !== true'));
console.log(`Coach AI subscription policy tests passed: ${checks} access cases plus replacement and allowance checks.`);
