import { createHash } from 'node:crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';
import type { BillingEnvironment } from './coachAiBillingCore';

export function billingEnrollmentRef(uid: string) {
  return getFirestore().doc(`coachAiBillingEnrollments/${createHash('sha256').update(uid).digest('hex')}`);
}

/** Persist intent BEFORE SDK configure/login, including users who never buy. */
export async function enrollCoachAiBilling(uid: string, environment: BillingEnvironment) {
  const db = getFirestore();
  const enrollmentRef = billingEnrollmentRef(uid);
  const deletionRef = db.doc(`coachAiBillingDeletionQueue/${enrollmentRef.id}`);
  await db.runTransaction(async transaction => {
    const [profile, enrollment, deletion] = await Promise.all([
      transaction.get(db.doc(`users/${uid}`)), transaction.get(enrollmentRef), transaction.get(deletionRef),
    ]);
    if (!profile.exists || deletion.exists || enrollment.data()?.state === 'deleting') {
      throw new functions.https.HttpsError('permission-denied', 'Account deletion is in progress.', { reason: 'account_deleting' });
    }
    if (enrollment.exists && (enrollment.data()?.userId !== uid || enrollment.data()?.state !== 'enrolled')) {
      throw new functions.https.HttpsError('failed-precondition', 'Billing enrollment needs review.', { reason: 'billing_unavailable' });
    }
    transaction.set(enrollmentRef, { userId: uid, state: 'enrolled', vendorCleanupRequired: true,
      lastEnvironment: environment, lastAuthorizedAt: FieldValue.serverTimestamp(),
      ...(enrollment.exists ? {} : { createdAt: FieldValue.serverTimestamp() }) }, { merge: true });
  }, { maxAttempts: 1 });
}
