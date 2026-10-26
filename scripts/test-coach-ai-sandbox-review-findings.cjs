'use strict';
// Corrected-behavior regression. In-memory data/fake credentials; no network.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createSourceLoader } = require('./coach-ai-test-loader.cjs');
const { createMemoryFirestore } = require('./coach-ai-memory-firestore.cjs');
const fixture = require('./coach-ai-revenuecat-v2-fixture.cjs');
global.fetch = async () => { throw new Error('Network forbidden in review fixture'); };

async function main() {
  const memory = createMemoryFirestore();
  const { db } = memory;
  fixture.installFixtureEnvironment();
  process.env.COACH_AI_PAID_ENABLED = 'true';
  process.env.COACH_AI_BILLING_ENVIRONMENT = 'sandbox';
  const load = createSourceLoader(memory.overrides);
  const billing = load('functions/src/coachAiBilling.ts');
  const enrollment = load('functions/src/coachAiBillingEnrollment.ts');
  const core = load('functions/src/coachAiBillingCore.ts');
  await db.doc('coachAiInternalConfig/runtime').set({ enabled: true });
  await db.doc('coachAiInternalConfig/billing').set(fixture.configuration('sandbox'));
  const uid = 'sandbox_paid_only';
  const profile = { adultEligibilityConfirmed: true, activeMode: 'coach' };
  await db.doc(`users/${uid}`).set(profile);
  const context = claims => ({ app: { appId: 'fixture' }, auth: { uid,
    token: { firebase: { sign_in_provider: 'password' }, ...claims } } });
  const prepare = claims => billing.prepareCoachAiBilling.run({}, context(claims));
  const denied = reason => error => error.details?.reason === reason;
  for (const claims of [{}, { aiCoachTester: true }, { aiCoachTester: true, aiCoachBillingTester: true }]) {
    await assert.rejects(prepare(claims), denied('billing_tester_required'));
  }
  assert.equal((await enrollment.billingEnrollmentRef(uid).get()).exists, false);
  await assert.rejects(billing.prepareCoachAiBilling.run({}, { auth: context({ aiCoachBillingTester: true }).auth }), denied('app_check_required'));
  assert.deepEqual(await prepare({ aiCoachBillingTester: true }), { userId: uid, prepared: true });
  assert.equal((await enrollment.billingEnrollmentRef(uid).get()).data().vendorCleanupRequired, true);
  const resolve = load('utils/coachAiAccess.ts').resolveCoachAiAccess;
  const base = { buildAvailable: true, claimLoaded: true, testerClaimEntitled: true,
    billingAvailable: true, signedIn: true, adultEligible: true,
    activeMode: 'coach', accountStanding: 'active' };
  const withoutPurchase = resolve({ ...base, paidEntitled: false, paidRemaining: 0 });
  const exhaustedPurchase = resolve({ ...base, paidEntitled: true, paidRemaining: 0 });
  assert.equal(withoutPurchase.entitlementSource, 'tester-claim');
  assert.equal(withoutPurchase.canRequest, true);
  assert.equal(exhaustedPurchase.entitlementSource, 'tester-claim');
  assert.equal(exhaustedPurchase.canRequest, true);
  const paidOnlyBuild = resolve({ ...base, buildAvailable: false, paidEntitled: false, paidRemaining: 0 });
  assert.equal(paidOnlyBuild.canRequest, false);
  assert.equal(resolve({ ...base, testerClaimEntitled: false, paidEntitled: false }).canRequest, false);
  assert.equal(resolve({ ...base, testerClaimEntitled: false, paidEntitled: true, paidRemaining: 0 }).canRequest, false);
  assert.equal(resolve({ ...base, testerClaimEntitled: false, paidEntitled: true, paidRemaining: 30 }).entitlementSource, 'paid');

  let erasures = 0, outcome = 'deletion_requested';
  const deletion = createSourceLoader({ ...memory.overrides, './coachAiRevenueCatV2': {
    ...load('functions/src/coachAiRevenueCatV2.ts'),
    requestRevenueCatV2Erasure: async () => { erasures++; return outcome; },
  } })('functions/src/coachAiBillingDeletion.ts');
  const marker = id => db.doc('coachAiBillingDeletionQueue/' + createHash('sha256').update(id).digest('hex'));
  const unused = 'never_billed'; await db.doc(`users/${unused}`).set(profile);
  await deletion.deleteCoachAiBillingData(unused);
  assert.equal(erasures, 0, 'Global paid flag cannot enroll nonbuyers into vendor erasure');
  assert.equal((await marker(unused).get()).exists, false);
  assert.equal((await enrollment.billingEnrollmentRef(unused).get()).data().vendorCleanupRequired, false);
  await assert.rejects(enrollment.enrollCoachAiBilling(unused, 'sandbox'), denied('account_deleting'));
  await deletion.deleteCoachAiBillingData(uid);
  assert.equal(erasures, 1, 'Enrolled nonbuyers require cleanup');
  assert.equal((await marker(uid).get()).data().status, 'deletion_requested');
  assert.equal((await marker(uid).get()).data().requiresCompletionCheck, true);
  await assert.rejects(prepare({ aiCoachBillingTester: true }), denied('account_deleting'));
  await deletion.deleteCoachAiBillingData(uid);
  assert.equal(erasures, 1, 'A prior erasure attempt is not repeated');
  const legacy = 'legacy_billing_record'; outcome = 'needs_review';
  for (const env of ['sandbox', 'production']) await db.doc(`coachAiBillingAccounts/${core.billingDocumentId(env, legacy)}`).set({ userId: legacy });
  await deletion.deleteCoachAiBillingData(legacy);
  assert.equal(erasures, 2);
  assert.equal((await marker(legacy).get()).data().status, 'needs_review');
  for (const env of ['sandbox', 'production']) assert.equal((await db.doc(`coachAiBillingAccounts/${core.billingDocumentId(env, legacy)}`).get()).exists, false);
  const unknown = 'legacy_unknown_enrollment';
  await enrollment.billingEnrollmentRef(unknown).set({ userId: unknown, state: 'legacy_unknown' });
  await deletion.deleteCoachAiBillingData(unknown);
  assert.equal(erasures, 3, 'Unknown recorded enrollment conservatively receives cleanup');
  const race = 'enrollment_delete_race'; await db.doc(`users/${race}`).set(profile);
  const results = await Promise.allSettled([enrollment.enrollCoachAiBilling(race, 'sandbox'), deletion.deleteCoachAiBillingData(race)]);
  // With maxAttempts:1 either contender can abort; deletion must not continue
  // past an aborted fence. Do not retry either transaction to make it pass.
  assert.ok(results.some(result => result.status === 'fulfilled'));
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 10);
  const racedEnrollment = (await enrollment.billingEnrollmentRef(race).get()).data();
  if (results[1].status === 'fulfilled') {
    assert.equal(racedEnrollment.state, 'deleting');
    await assert.rejects(enrollment.enrollCoachAiBilling(race, 'sandbox'), denied('account_deleting'));
  } else {
    assert.equal(racedEnrollment.state, 'enrolled');
    assert.equal((await marker(race).get()).exists, false, 'Failed fence must not trigger vendor erasure');
    assert.equal(erasures, 3);
  }
  console.log('PASS: separate sandbox permission, free beta preserved, pre-SDK enrollment, nonbuyer/legacy cleanup, deletion fence and no repeated erasure. In-memory only; native acceptance not run.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
