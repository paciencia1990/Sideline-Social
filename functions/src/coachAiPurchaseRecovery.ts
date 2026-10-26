import { createHash } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import * as firebaseFunctions from 'firebase-functions/v1';
import { permanentAccountFunctions } from './permanentAuth';
import { coachAiRuntimeIdentity } from './coachAiRevenueCatV2';
import {
  COACH_AI_PURCHASE_RECOVERY_PROJECT,
  COACH_AI_PURCHASE_RECOVERY_RC_PROJECT,
  COACH_AI_PURCHASE_RECOVERY_RC_API_PROJECT,
  readCoachAiPurchaseRecoveryRequest,
  validateCoachAiPurchaseRecoveryDecision,
} from './coachAiPurchaseRecoveryCore';

const functions = permanentAccountFunctions(firebaseFunctions, 'communication');

/**
 * Read only: a separate, explicitly authorized staff process must already have
 * reviewed the exact sandbox attempt with both Google and RevenueCat and saved
 * its disposition. This endpoint cannot create/approve/consume that review,
 * restore purchases, contact a provider, grant access, or turn billing on.
 * No paid/runtime master flag is required: inspection precedes reactivation.
 */
export const getCoachAiPurchaseRecoveryDecision = functions.region('us-central1').runWith({
  serviceAccount: coachAiRuntimeIdentity('reader'),
  timeoutSeconds: 30,
  memory: '256MB',
  enforceAppCheck: true,
}).https.onCall(async (data, context) => {
  let request;
  try { request = readCoachAiPurchaseRecoveryRequest(data); }
  catch { throw new firebaseFunctions.https.HttpsError('invalid-argument', 'An exact purchase recovery reference is required.'); }
  const uid = context.auth!.uid;
  if (!context.app || context.auth!.token.aiCoachBillingTester !== true || context.auth!.token.aiCoachTester === true) {
    throw new firebaseFunctions.https.HttpsError('permission-denied', 'Reviewed sandbox recovery is unavailable.', { reason: 'recovery_review_unavailable' });
  }
  const actualProject = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (actualProject !== COACH_AI_PURCHASE_RECOVERY_PROJECT
    || process.env.REVENUECAT_PROJECT_ID !== COACH_AI_PURCHASE_RECOVERY_RC_PROJECT
    || process.env.REVENUECAT_API_V2_PROJECT_ID !== COACH_AI_PURCHASE_RECOVERY_RC_API_PROJECT) {
    throw new firebaseFunctions.https.HttpsError('failed-precondition', 'Reviewed sandbox recovery is unavailable.', { reason: 'recovery_review_unavailable' });
  }
  const db = getFirestore();
  const accountKey = createHash('sha256').update(uid).digest('hex');
  try {
    // A read-only operation in a maxAttempts:1 transaction gives one consistent
    // database view of the review, current access and account-deletion fences.
    // No transaction.set/update/delete or provider call is made.
    return await db.runTransaction(async transaction => {
      const review = await transaction.get(db.doc(`coachAiPurchaseRecoveryReviews/${request.reviewReference}`));
      const reviewData = review.data();
      const reviewerUid = reviewData?.reviewerUid;
      if (typeof reviewerUid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(reviewerUid) || reviewerUid === uid) {
        throw new Error('purchase_recovery_review_unavailable');
      }
      const [config, profile, enrollment, deletion, buyerStanding, directory, reviewerStanding] = await transaction.getAll(
        db.doc('coachAiInternalConfig/billing'),
        db.doc(`users/${uid}`),
        db.doc(`coachAiBillingEnrollments/${accountKey}`),
        db.doc(`coachAiBillingDeletionQueue/${accountKey}`),
        db.doc(`accountStanding/${uid}`),
        db.doc(`moderatorDirectory/${reviewerUid}`),
        db.doc(`accountStanding/${reviewerUid}`),
      );
      const reviewerAuth = await getAuth().getUser(reviewerUid);
      return validateCoachAiPurchaseRecoveryDecision({
        request, uid, nowMs: Date.now(), appVerified: Boolean(context.app), callerClaims: context.auth!.token,
        billingConfig: config.data(), profile: profile.data(), enrollment: enrollment.data(),
        deletionExists: deletion.exists, buyerStanding: buyerStanding.data() ?? null, review: reviewData,
        reviewer: {
          uid: reviewerAuth.uid, disabled: reviewerAuth.disabled, emailVerified: reviewerAuth.emailVerified,
          claims: reviewerAuth.customClaims, directory: directory.data(), standing: reviewerStanding.data() ?? null,
        },
      });
    }, { maxAttempts: 1 });
  } catch {
    // Do not expose whether another user's review exists, its staff author,
    // provider payloads, or any database/Auth error details.
    throw new firebaseFunctions.https.HttpsError('permission-denied', 'Reviewed sandbox recovery is unavailable.', { reason: 'recovery_review_unavailable' });
  }
});
