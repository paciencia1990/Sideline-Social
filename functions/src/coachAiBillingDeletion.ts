import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { billingDocumentId } from './coachAiBillingCore';
import { billingEnrollmentRef } from './coachAiBillingEnrollment';
import { REVENUECAT_ERASURE_SECRET, REVENUECAT_V2_PROJECT_ID, requestRevenueCatV2Erasure, revenueCatRuntimeIdentities } from './coachAiRevenueCatV2';

/** Called only after ordinary data cleanup and successful Auth deletion. */
export async function recordCoachAiLocalDeletionComplete(uid: string) {
  const db = getFirestore(), fence = billingEnrollmentRef(uid);
  await db.runTransaction(async tx => {
    const [profile, existing] = await Promise.all([tx.get(db.doc('users/' + uid)), tx.get(fence)]);
    if (profile.exists || existing.data()?.state !== 'deleting') throw Error('billing_cleanup_completion_blocked');
    if (existing.data()?.localCleanupCompletedAt) return;
    tx.update(fence, { localCleanupCompletedAt: FieldValue.serverTimestamp() });
  }, { maxAttempts: 1 });
}

/** One vendor erasure request; an uncertain failure requires operator review. */
export async function deleteCoachAiBillingData(uid: string) {
  const firestore = getFirestore();
  const markerRef = firestore.doc(`coachAiBillingDeletionQueue/${createHash('sha256').update(uid).digest('hex')}`);
  const accounts = await firestore.collection('coachAiBillingAccounts').where('userId', '==', uid).get();
  const enrollmentRef = billingEnrollmentRef(uid);
  const claimed = await firestore.runTransaction(async (transaction) => {
    const [marker, enrollment, sandboxAccount, productionAccount] = await Promise.all([
      transaction.get(markerRef), transaction.get(enrollmentRef),
      transaction.get(firestore.doc(`coachAiBillingAccounts/${billingDocumentId('sandbox', uid)}`)),
      transaction.get(firestore.doc(`coachAiBillingAccounts/${billingDocumentId('production', uid)}`)),
    ]);
    // Enrollment and deletion share this document, so concurrent authorization
    // cannot commit after deletion's fence. Retain even a never-buyer tombstone.
    // Existing/unknown enrollment and legacy accounts conservatively need cleanup.
    const vendorCleanupRequired = marker.exists || !accounts.empty || sandboxAccount.exists || productionAccount.exists
      || enrollment.exists && (enrollment.data()?.state !== 'deleting' || enrollment.data()?.vendorCleanupRequired !== false);
    transaction.set(enrollmentRef, { state: 'deleting', vendorCleanupRequired,
      fencedAt: FieldValue.serverTimestamp() });
    if (!vendorCleanupRequired || marker.exists) return false;
    transaction.create(markerRef, { userId: uid, status: 'processing',
      requiresCompletionCheck: true, createdAt: FieldValue.serverTimestamp() });
    return true;
  }, { maxAttempts: 1 });
  if (claimed) {
      let status = 'needs_review';
      try {
        const key = process.env[REVENUECAT_ERASURE_SECRET]?.trim();
        if (!key || process.env.REVENUECAT_API_V2_PROJECT_ID !== REVENUECAT_V2_PROJECT_ID || !revenueCatRuntimeIdentities()) throw new Error('billing_unavailable');
        status = await requestRevenueCatV2Erasure(uid, REVENUECAT_V2_PROJECT_ID, key);
      } catch { /* Keep app deletion available; queue a single manual follow-up. */ }
      // SDK work authorized before the fence may still finish at RevenueCat.
      // Retain a manual completion check; acceptance is never final erasure.
      await markerRef.update({ status, protocolVersion: 2, attemptedAt: FieldValue.serverTimestamp() });
  }
  // The marker fences verification while erasure proceeds. No store cancellation
  // is attempted: deleting an app account does not cancel automatic renewals.
  const writer = firestore.bulkWriter();
  writer.onWriteError(() => false);
  const paths = new Set(accounts.docs.map((account) => account.ref.path));
  for (const environment of ['production', 'sandbox'] as const) paths.add(`coachAiBillingAccounts/${billingDocumentId(environment, uid)}`);
  for (const path of paths) await firestore.recursiveDelete(firestore.doc(path), writer);
  await writer.close();
  for (const collection of ['coachAiPaidRequests', 'coachAiBillingRateLimits', 'coachAiBillingVerificationRates']) {
    const records = await firestore.collection(collection).where('userId', '==', uid).get();
    for (const document of records.docs) await document.ref.delete();
  }
  const events = await firestore.collection('coachAiBillingEvents').where('userIds', 'array-contains', uid).get();
  for (const event of events.docs) await event.ref.update({ userIds: FieldValue.arrayRemove(uid) });
}
