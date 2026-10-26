import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';
import { lifecyclePatch, minimized, type Kind } from './moderationRetentionCore';
import { orderedStandingProjection } from './standingProjection';

// A deletion fence is purpose-limited pseudonymous information, not anonymized
// data. It must be reconciled/released under the separately reviewed delivery
// and provider inventory. No TTL or automatic release is installed here.
export async function prepareModerationDeletion(db: FirebaseFirestore.Firestore, uid: string): Promise<void> {
  const at = Date.now(); const fence = db.collection('moderationAccountDeletionFences').doc(uid);
  const standing = db.collection('accountStanding').doc(uid);
  await db.runTransaction(async tx => {
    const [old, current] = await Promise.all([tx.get(fence), tx.get(standing)]);
    tx.set(fence, { deletionState: 'inProgress', accountDeletedAt: old.data()?.accountDeletedAt ?? Timestamp.fromMillis(at),
      reviewRequired: true, reviewAtMs: at, purpose: 'prevent_pending_delivery_resurrection', updatedAt: Timestamp.fromMillis(at) }, { merge: true });
    if (current.exists) tx.update(standing, { accountDeletedAt: Timestamp.fromMillis(at), retentionReviewAtMs: at });
  });
  // Fence each canonical case before changing any links. Paginated queries do
  // not infer that an unbounded subject history fits inside one read/batch.
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let query: FirebaseFirestore.Query = db.collection('moderationCases').where('reportedUserId', '==', uid).orderBy('__name__').limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const entry of page.docs) await db.runTransaction(async tx => {
      const row = await tx.get(entry.ref);
      if (!row.exists) return;
      tx.update(entry.ref, { ...lifecyclePatch(row.data()!, 'preserve', at, fence.path),
        accountDeletedAt: Timestamp.fromMillis(at), retentionReviewRequired: true,
        retentionReviewAtMs: at, caseVersion: Number(row.data()?.caseVersion ?? 0) + 1 });
    });
    if (page.size < 100) break;
    cursor = page.docs[page.docs.length - 1];
  }
}

export async function minimizeDeletedSubjectCases(db: FirebaseFirestore.Firestore, uid: string): Promise<number> {
  let reviewRequired = 0;
  let caseCursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
  let caseQuery: FirebaseFirestore.Query = db.collection('moderationCases').where('reportedUserId', '==', uid).orderBy('__name__').limit(100);
  if (caseCursor) caseQuery = caseQuery.startAfter(caseCursor);
  const cases = await caseQuery.get();
  for (const entry of cases.docs) {
    const caseData = entry.data();
    // Existing preservation must not be guessed away. Its exact authority/scope
    // is a launch prerequisite, and is surfaced for staff review, never a silent
    // claim that every safety flag supplies a lawful deletion exception.
    const preserved = caseData.severity === 'critical' || (caseData.legalHoldIds?.length ?? 0) > 0;
    if (preserved) { reviewRequired++; continue; }
    for (const [collection, kind] of [['notes', 'note'], ['appeals', 'appeal'], ['actions', 'action']] as const) {
      let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
      for (;;) {
        let query: FirebaseFirestore.Query = entry.ref.collection(collection).orderBy('__name__').limit(100);
        if (cursor) query = query.startAfter(cursor);
        const page = await query.get();
        for (const item of page.docs) await db.runTransaction(async tx => {
          const [row, currentCase] = await Promise.all([tx.get(item.ref), tx.get(entry.ref)]);
          if (!row.exists) return;
          if ((currentCase.data()?.legalHoldIds?.length ?? 0) > 0 || currentCase.data()?.severity === 'critical') throw new Error('preservation_changed_during_deletion');
          // Keep the structured action/appeal reference while pending deliveries
          // are reconciled, but remove narrative and unnecessary subject links.
          const clean = minimized(kind as Kind, row.data()!, false);
          if (clean) tx.set(item.ref, { ...clean, accountDeletedAt: Timestamp.now() });
          else tx.delete(item.ref);
        });
        if (page.size < 100) break;
        cursor = page.docs[page.docs.length - 1];
      }
    }
    // Top-level copied narratives and execution justifications are separate
    // records. Never mistake deleting case notes for erasing these copies.
    for (const [collection, kind] of [['moderationReports', 'report'], ['moderationActionRequests', 'request'],
      ['moderationActionApprovals', 'request'], ['moderationAuditEvents', 'audit']] as const) {
      let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
      for (;;) {
        let query: FirebaseFirestore.Query = db.collection(collection).where('caseId', '==', entry.id).orderBy('__name__').limit(100);
        if (cursor) query = query.startAfter(cursor);
        const page = await query.get();
        for (const item of page.docs) await db.runTransaction(async tx => {
          const [row, currentCase] = await Promise.all([tx.get(item.ref), tx.get(entry.ref)]);
          if (!row.exists) return;
          if ((currentCase.data()?.legalHoldIds?.length ?? 0) > 0 || currentCase.data()?.severity === 'critical') throw new Error('preservation_changed_during_deletion');
          tx.set(item.ref, { ...minimized(kind, row.data()!, false), accountDeletedAt: Timestamp.now() });
        });
        if (page.size < 100) break;
        cursor = page.docs[page.docs.length - 1];
      }
    }
    await db.runTransaction(async tx => {
      const row = await tx.get(entry.ref);
      if (!row.exists) return;
      if ((row.data()?.legalHoldIds?.length ?? 0) > 0 || row.data()?.severity === 'critical') { reviewRequired++; return; }
      const writers = row.data()?.retentionWriters ?? {};
      tx.set(entry.ref, { ...minimized('case', row.data()!, false), reportedUserId: null,
        retentionWriters: writers, accountDeletedAt: Timestamp.now(),
        retentionReviewRequired: true, retentionReviewAtMs: Date.now(),
        subjectIdentityRetentionState: 'minimized_pending_delivery_review' });
    });
    // Media/capture sources with unresolved ownership/preservation dependencies
    // remain explicit disposition work. Do not remove a shared original here.
    reviewRequired++;
  }
  if (cases.size < 100) break;
  caseCursor = cases.docs[cases.docs.length - 1];
  }
  return reviewRequired;
}

export async function completeModerationDeletion(db: FirebaseFirestore.Firestore, uid: string): Promise<void> {
  const fence = db.collection('moderationAccountDeletionFences').doc(uid);
  await fence.set({ deletionState: 'complete', reviewRequired: true, reviewAtMs: Date.now(),
    updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const row = await fence.get();
  if (!row.updateTime) throw new Error('deletion_fence_version_missing');
  const version = `${row.updateTime.seconds}:${row.updateTime.nanoseconds}`;
  await getDatabase().ref(`accountStanding/${uid}`).transaction(current => orderedStandingProjection(current, {
    status: 'deleted', deleted: true, messagingRestricted: false, expiresAt: null,
    revision: 1, version, updatedAt: Date.now(),
  }), undefined, false);
}
