import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';

// Internal library only: deliberately not exported from index.ts, callable,
// scheduled, or wired to credentials. Every mutation requires fresh restricted
// operator verification. No vendor DELETE, provider retry, TTL or bulk deletion.
export const BILLING_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const REVIEW_MAX_AGE_MS = 60_000;
const SCAN_LIMIT = 500;
const KEY = /^[a-f0-9]{64}$/;
const REVIEW_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export type CleanupOperation = 'close' | 'expire_cleanup' | 'expire_event';
type Operation = CleanupOperation;
type Role = 'primary' | 'backup';
type Data = FirebaseFirestore.DocumentData;
export type ReviewScope = { operation: Operation; key: string; revision: string; reviewId: string };
export type CleanupReview = ReviewScope & {
  checkedAtMs: number;
  // These are verified external facts, not assertions accepted from the app.
  authAbsent: boolean;
  ordinaryCleanupComplete: boolean;
  vendor: 'absent' | 'not_required' | 'present' | 'unknown';
  aliasesReconciled: boolean;
  sdkWorkSettled: boolean;
  holdsClear: boolean;
  backupsClear: boolean;
  identityReuseBlocked: boolean;
  relatedWorkClear: boolean;
};
export type MaintenanceDependencies = {
  db: FirebaseFirestore.Firestore;
  now: () => number;
  // Must authenticate the operator against the approved roster. Fail closed.
  authorize: (actor: string) => Promise<Role>;
  // Must use the restricted review workflow: exact project/customer verification,
  // Auth absence, aliases/SDK work, holds, and backup inventory. No default proof.
  // Expiry uses only the hashed key; do not retain/recover a raw UID in receipts.
  inspect: (scope: ReviewScope, actor: string) => Promise<CleanupReview>;
  // Optional internal adapter: lock an approved review, then consume it in the
  // same transaction as the result. The legacy offline fixture omits this.
  lockReview?: (tx: FirebaseFirestore.Transaction, proof: CleanupReview) => Promise<(status: string) => void>;
  beforeCommit?: () => Promise<void>;
};
type Request = { actor: string; reviewId: string };
type Result = { status: 'closed' | 'expired' | 'already_closed' | 'absent' | 'not_due' | 'retained'; reason?: string };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): unknown {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function billingCleanupRevision(values: (Data | undefined)[]) { return digest(JSON.stringify(canonical(values.map(v => v ?? null)))); }
const revision = billingCleanupRevision;
function millis(value: unknown): number {
  if (!value || typeof value !== 'object' || !('toMillis' in value) || typeof value.toMillis !== 'function') return NaN;
  const result: unknown = value.toMillis();
  return typeof result === 'number' && Number.isSafeInteger(result) && result > 0 ? result : NaN;
}
function hasHold(data: Data | undefined) { return data?.retentionHold === true || data?.legalHold === true; }
function keyForUid(uid: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw Error('invalid_cleanup_identity');
  return digest(uid);
}
function validKey(key: string) { if (!KEY.test(key)) throw Error('invalid_cleanup_key'); }

export function createCoachAiBillingMaintenance(deps: MaintenanceDependencies) {
  const { db } = deps;
  const fenceRef = (key: string) => db.doc('coachAiBillingEnrollments/' + key);
  const queueRef = (key: string) => db.doc('coachAiBillingDeletionQueue/' + key);
  const eventRef = (key: string) => db.doc('coachAiBillingEvents/' + key);
  async function reviewedTransaction(proof: CleanupReview, action: (tx: FirebaseFirestore.Transaction) => Promise<Result>) {
    return db.runTransaction(async tx => {
      const consume = await deps.lockReview?.(tx, proof);
      const result = await action(tx);
      consume?.(result.status);
      await deps.beforeCommit?.();
      return result;
    }, { maxAttempts: 1 });
  }
  async function prepare(operation: Operation, key: string, request: Request, values: (Data | undefined)[]) {
    validKey(key);
    if (!REVIEW_ID.test(request.reviewId)) throw Error('invalid_cleanup_review');
    const role = await deps.authorize(request.actor);
    if (role !== 'primary' && role !== 'backup') throw Error('cleanup_operator_denied');
    const scope = { operation, key, revision: revision(values), reviewId: request.reviewId };
    const proof = await deps.inspect(scope, request.actor);
    function check(current: (Data | undefined)[]) {
      const now = deps.now();
      if (!Number.isSafeInteger(now) || now <= 0 || !Number.isSafeInteger(proof.checkedAtMs)
        || proof.checkedAtMs > now || now - proof.checkedAtMs > REVIEW_MAX_AGE_MS
        || proof.operation !== scope.operation || proof.key !== key || proof.reviewId !== scope.reviewId
        || proof.revision !== scope.revision || revision(current) !== scope.revision) throw Error('cleanup_review_stale');
      return now;
    }
    check(values);
    return { role, proof, check };
  }
  function exception(tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference,
    reason: string, role: Role, reviewId: string, now: number): Result {
    // Codes and opaque review references only, never evidence bodies or raw UIDs.
    tx.update(ref, { retentionException: { reason, owner: role, reviewId,
      reviewedAt: Timestamp.fromMillis(now), nextReviewAt: Timestamp.fromMillis(now + 7 * 86400000) } });
    return { status: 'retained', reason };
  }
  // Query reads participate in the same transaction as closure. Canonical child
  // reads also catch orphaned windows even when a parent document is absent.
  async function localResidue(tx: FirebaseFirestore.Transaction, uid: string) {
    const key = keyForUid(uid);
    const docs = await Promise.all(['users/' + uid, 'publicUserProfiles/' + uid,
      'coachAiBillingAccounts/sandbox_' + key, 'coachAiBillingAccounts/production_' + key]
      .map(path => tx.get(db.doc(path))));
    const queries = ['coachAiBillingAccounts', 'coachAiPaidRequests', 'coachAiBillingRateLimits',
      'coachAiBillingVerificationRates', 'coachAiRequests']
      .map(name => db.collection(name).where('userId', '==', uid).limit(1));
    queries.push(db.collection('coachAiBillingEvents').where('userIds', 'array-contains', uid).limit(1));
    for (const env of ['sandbox', 'production']) queries.push(db.collection('coachAiBillingAccounts/' + env + '_' + key + '/windows').limit(1));
    const results = await Promise.all(queries.map(query => tx.get(query)));
    return docs.some(doc => doc.exists) || results.some(result => !result.empty);
  }
  // Bounded hash-only reconciliation for expiry: no raw UID retained solely to
  // support a later check. Capacity overflow stops expiry, never truncates proof.
  async function hashResidue(tx: FirebaseFirestore.Transaction, key: string) {
    const names = ['users', 'publicUserProfiles', 'coachAiBillingAccounts', 'coachAiPaidRequests',
      'coachAiBillingRateLimits', 'coachAiBillingVerificationRates', 'coachAiRequests', 'coachAiBillingEvents'];
    const scans = await Promise.all(names.map(name => tx.get(db.collection(name).limit(SCAN_LIMIT + 1))));
    if (scans.some(scan => scan.size > SCAN_LIMIT)) return 'inventory_limit';
    for (let i = 0; i < scans.length; i++) {
      for (const doc of scans[i].docs) {
        const data = doc.data();
        const ids: unknown[] = i < 2 ? [doc.id] : [data.userId, ...(Array.isArray(data.userIds) ? data.userIds : [])];
        if (ids.some(uid => typeof uid === 'string' && digest(uid) === key)) return 'local_records_remain';
      }
    }
    const windows = await Promise.all(['sandbox', 'production'].map(env =>
      tx.get(db.collection('coachAiBillingAccounts/' + env + '_' + key + '/windows').limit(1))));
    const accounts = await Promise.all(['sandbox', 'production'].map(env =>
      tx.get(db.doc('coachAiBillingAccounts/' + env + '_' + key))));
    return windows.some(result => !result.empty) || accounts.some(doc => doc.exists) ? 'local_records_remain' : null;
  }
  return {
    async close(request: Request & { uid: string }): Promise<Result> {
      const key = keyForUid(request.uid), fence = fenceRef(key), queue = queueRef(key);
      const initial = await Promise.all([fence.get(), queue.get()]);
      const review = await prepare('close', key, request, initial.map(doc => doc.data()));
      return reviewedTransaction(review.proof, async tx => {
        const [f, q] = await Promise.all([tx.get(fence), tx.get(queue)]);
        const now = review.check([f.data(), q.data()]), fd = f.data(), qd = q.data(), p = review.proof;
        if (!f.exists || fd?.state !== 'deleting') throw Error('cleanup_fence_missing');
        if (qd?.status === 'closed') return { status: 'already_closed' };
        if (q.exists && qd?.userId !== request.uid) throw Error('cleanup_identity_mismatch');
        const residue = await localResidue(tx, request.uid);
        let reason: string | null = null;
        if (hasHold(fd) || hasHold(qd) || p.holdsClear !== true) reason = 'retention_hold';
        else if (!Number.isFinite(millis(fd?.localCleanupCompletedAt)) || millis(fd?.localCleanupCompletedAt) > now
          || p.authAbsent !== true || p.ordinaryCleanupComplete !== true || residue) reason = 'local_cleanup_incomplete';
        else if (p.sdkWorkSettled !== true || p.aliasesReconciled !== true || p.relatedWorkClear !== true) reason = 'reconciliation_incomplete';
        else if (typeof fd?.vendorCleanupRequired !== 'boolean'
          || fd.vendorCleanupRequired && (!q.exists || p.vendor !== 'absent')
          || !fd.vendorCleanupRequired && (q.exists || p.vendor !== 'not_required')) reason = 'vendor_completion_unverified';
        review.check([fd, qd]);
        if (reason) return exception(tx, fence, reason, review.role, request.reviewId, now);
        const closedAt = Timestamp.fromMillis(now), retentionDueAt = Timestamp.fromMillis(now + BILLING_RETENTION_MS);
        // Replacement, not merge: remove raw UID and arbitrary legacy fields.
        tx.set(queue, { status: 'closed', protocolVersion: 3, requiresCompletionCheck: false,
          vendorOutcome: p.vendor, closedAt, retentionDueAt, reviewerRole: review.role, reviewId: request.reviewId });
        tx.set(fence, { state: 'deleting', vendorCleanupRequired: fd!.vendorCleanupRequired,
          localCleanupCompletedAt: fd!.localCleanupCompletedAt, closedAt, retentionDueAt, protocolVersion: 3 });
        return { status: 'closed' };
      });
    },
    // A never-buyer fence intentionally retains no raw UID. Prove absence by
    // bounded hashes instead of asking staff to recover a deleted identifier.
    async closeNonbuyer(request: Request & { key: string }): Promise<Result> {
      validKey(request.key);
      const fence = fenceRef(request.key), queue = queueRef(request.key);
      const initial = await Promise.all([fence.get(), queue.get()]);
      const review = await prepare('close', request.key, request, initial.map(doc => doc.data()));
      return reviewedTransaction(review.proof, async tx => {
        const [f, q] = await Promise.all([tx.get(fence), tx.get(queue)]);
        const fd = f.data(), qd = q.data(), now = review.check([fd, qd]), p = review.proof;
        if (!f.exists || fd?.state !== 'deleting' || fd.vendorCleanupRequired !== false || q.exists) {
          throw Error('cleanup_identity_mismatch');
        }
        const residue = await hashResidue(tx, request.key);
        const reason = hasHold(fd) || p.holdsClear !== true ? 'retention_hold'
          : residue === 'inventory_limit' ? 'inventory_limit'
          : !Number.isFinite(millis(fd.localCleanupCompletedAt)) || millis(fd.localCleanupCompletedAt) > now
            || p.authAbsent !== true || p.ordinaryCleanupComplete !== true || residue ? 'local_cleanup_incomplete'
          : p.sdkWorkSettled !== true || p.aliasesReconciled !== true || p.relatedWorkClear !== true ? 'reconciliation_incomplete'
          : p.vendor !== 'not_required' ? 'vendor_completion_unverified' : null;
        review.check([fd, qd]);
        if (reason) return exception(tx, fence, reason, review.role, request.reviewId, now);
        const closedAt = Timestamp.fromMillis(now), retentionDueAt = Timestamp.fromMillis(now + BILLING_RETENTION_MS);
        tx.set(queue, { status: 'closed', protocolVersion: 3, requiresCompletionCheck: false,
          vendorOutcome: 'not_required', closedAt, retentionDueAt, reviewerRole: review.role, reviewId: request.reviewId });
        tx.set(fence, { state: 'deleting', vendorCleanupRequired: false,
          localCleanupCompletedAt: fd.localCleanupCompletedAt, closedAt, retentionDueAt, protocolVersion: 3 });
        return { status: 'closed' };
      });
    },
    async expireCleanup(request: Request & { key: string }): Promise<Result> {
      validKey(request.key);
      const fence = fenceRef(request.key), queue = queueRef(request.key);
      const initial = await Promise.all([fence.get(), queue.get()]);
      const review = await prepare('expire_cleanup', request.key, request, initial.map(doc => doc.data()));
      return reviewedTransaction(review.proof, async tx => {
        const [f, q] = await Promise.all([tx.get(fence), tx.get(queue)]);
        const now = review.check([f.data(), q.data()]), fd = f.data(), qd = q.data(), p = review.proof;
        if (!f.exists && !q.exists) return { status: 'absent' };
        const target = f.exists ? fence : queue;
        if (fd?.state !== 'deleting' || qd?.status !== 'closed' || fd?.protocolVersion !== 3 || qd?.protocolVersion !== 3
          || !Number.isFinite(millis(qd.closedAt)) || millis(fd.closedAt) !== millis(qd.closedAt)
          || millis(fd.retentionDueAt) !== millis(qd.closedAt) + BILLING_RETENTION_MS
          || millis(qd.retentionDueAt) !== millis(fd.retentionDueAt)) {
          return exception(tx, target, 'closure_unverified', review.role, request.reviewId, now);
        }
        if (now < millis(qd.retentionDueAt)) return { status: 'not_due' };
        const residue = await hashResidue(tx, request.key);
        const reason = hasHold(fd) || hasHold(qd) || p.holdsClear !== true ? 'retention_hold'
          : p.backupsClear !== true ? 'backup_dependency'
          : p.identityReuseBlocked !== true ? 'identity_reuse_unverified'
          : p.authAbsent !== true || p.ordinaryCleanupComplete !== true ? 'local_cleanup_incomplete'
          : p.sdkWorkSettled !== true || p.aliasesReconciled !== true || p.relatedWorkClear !== true ? 'reconciliation_incomplete'
          : p.vendor !== qd.vendorOutcome || !['absent', 'not_required'].includes(p.vendor) ? 'vendor_completion_unverified'
          : residue;
        review.check([fd, qd]);
        if (reason) return exception(tx, target, reason, review.role, request.reviewId, now);
        // One transaction removes both; no half-expired protection or raw-ID log.
        tx.delete(queue); tx.delete(fence);
        return { status: 'expired' };
      });
    },
    async expireEvent(request: Request & { key: string }): Promise<Result> {
      validKey(request.key);
      const ref = eventRef(request.key), initial = await ref.get();
      const review = await prepare('expire_event', request.key, request, [initial.data()]);
      return reviewedTransaction(review.proof, async tx => {
        const record = await tx.get(ref), data = record.data(), now = review.check([data]), p = review.proof;
        if (!record.exists) return { status: 'absent' };
        if (data?.status !== 'completed' || data.attemptState !== 'completed' || !Number.isFinite(millis(data.completedAt))) {
          return exception(tx, ref, 'event_unresolved', review.role, request.reviewId, now);
        }
        if (now < millis(data.completedAt) + BILLING_RETENTION_MS) return { status: 'not_due' };
        const ids: unknown = data.userIds;
        if (!Array.isArray(ids) || ids.some(uid => typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid))) throw Error('invalid_event_participants');
        const pending = await Promise.all((ids as string[]).flatMap(uid =>
          [tx.get(fenceRef(keyForUid(uid))), tx.get(queueRef(keyForUid(uid)))]));
        const reason = hasHold(data) || p.holdsClear !== true ? 'retention_hold'
          : p.relatedWorkClear !== true || p.sdkWorkSettled !== true
            || pending.some((doc, index) => index % 2 === 0 ? doc.data()?.state === 'deleting' : doc.exists) ? 'reconciliation_incomplete'
          : p.backupsClear !== true ? 'backup_dependency'
          : p.identityReuseBlocked !== true ? 'identity_reuse_unverified' : null;
        review.check([data]);
        if (reason) return exception(tx, ref, reason, review.role, request.reviewId, now);
        tx.delete(ref);
        return { status: 'expired' };
      });
    },
  };
}
