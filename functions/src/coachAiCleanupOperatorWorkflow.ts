import { createHash, randomUUID } from 'node:crypto';
import type { Auth } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { billingCleanupRevision, createCoachAiBillingMaintenance, type CleanupOperation, type CleanupReview, type ReviewScope } from './coachAiBillingMaintenance';
import { verifyRevenueCatCustomerAbsent } from './coachAiRevenueCatV2';

// Internal server API only. No index.ts export, callable or default live binding.
// Approval is a documented human attestation, never a substitute for the
// automatic Auth, RevenueCat, local-residue and transaction checks below.
const FACTS = ['ordinaryCleanupComplete', 'aliasesReconciled', 'sdkWorkSettled',
  'holdsClear', 'backupsClear', 'identityReuseBlocked', 'relatedWorkClear'] as const;
export type CleanupAttestations = Record<typeof FACTS[number], boolean>;
type Draft = ReviewScope & { draftedAtMs: number };
type Role = 'primary' | 'backup';
const ROSTER = { primary: 'info@joinsidelinesocial.com', backup: 'joann@joinsidelinesocial.com' } as const;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function age(value: number, now: number, max: number) {
  return Number.isSafeInteger(value) && value > 0 && value <= now && now - value <= max;
}
function scopeValid(scope: ReviewScope) {
  if (!['close', 'expire_cleanup', 'expire_event'].includes(scope.operation)
    || !/^[a-f0-9]{64}$/.test(scope.key) || !/^[a-f0-9]{64}$/.test(scope.revision) || !ID.test(scope.reviewId)) throw Error('invalid_cleanup_review');
}
function sameScope(a: ReviewScope, b: ReviewScope) {
  return a.operation === b.operation && a.key === b.key && a.revision === b.revision && a.reviewId === b.reviewId;
}
export function createCoachAiCleanupOperatorWorkflow(options: {
  db: FirebaseFirestore.Firestore; auth: Auth; now?: () => number;
  verificationKey: () => string; fetcher?: typeof fetch;
  operatorPins: Readonly<{ primaryUid: string; backupUid: string }>;
}) {
  const { db, auth } = options, now = options.now ?? Date.now;
  const projectId: unknown = 'projectId' in db ? db.projectId : undefined;
  if (typeof projectId !== 'string' || auth.app.options.projectId !== projectId
    || projectId !== 'sideline-social-staging-2026' && !projectId.startsWith('demo-')) throw Error('cleanup_project_mismatch');
  // Copy deployment-controlled pins. Request data and mutable roster cannot widen access.
  const pins = Object.freeze({ ...options.operatorPins });
  if (![pins.primaryUid, pins.backupUid].every(uid => typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid))
    || pins.primaryUid === pins.backupUid) throw Error('cleanup_operator_pins_required');
  const ref = (id: string) => db.doc('coachAiInternalConfig/cleanupReviews/items/' + id);
  async function currentIdentity(token: string) {
    const decoded = await auth.verifyIdToken(token, true);
    const current = await auth.getUser(decoded.uid);
    const role = (Object.keys(ROSTER) as Role[]).find(candidate =>
      pins[candidate === 'primary' ? 'primaryUid' : 'backupUid'] === decoded.uid && current.email?.toLowerCase() === ROSTER[candidate]);
    if (!role || current.disabled || current.emailVerified !== true
      || decoded.email_verified !== true || decoded.email?.toLowerCase() !== current.email?.toLowerCase()
      || !decoded.firebase?.sign_in_second_factor || !age(decoded.auth_time * 1000, now(), 15 * 60_000)) {
      throw Error('cleanup_operator_denied');
    }
    return { role, uid: decoded.uid };
  }
  async function authorize(token: string, tx?: FirebaseFirestore.Transaction) {
    const identity = await currentIdentity(token);
    const rosterRef = db.doc('coachAiInternalConfig/cleanupOperators');
    const roster = (await (tx ? tx.get(rosterRef) : rosterRef.get())).data();
    if (roster?.enabled !== true || roster.primaryUid !== pins.primaryUid || roster.backupUid !== pins.backupUid) throw Error('cleanup_operator_denied');
    return identity;
  }
  async function records(operation: CleanupOperation, key: string) {
    return operation === 'expire_event'
      ? [(await db.doc('coachAiBillingEvents/' + key).get()).data()]
      : await Promise.all(['coachAiBillingEnrollments/', 'coachAiBillingDeletionQueue/'].map(async prefix => (await db.doc(prefix + key).get()).data()));
  }
  async function authAbsent(key: string, uid?: string) {
    if (uid) {
      try { await auth.getUser(uid); return false; }
      catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'auth/user-not-found') return true;
        throw Error('cleanup_auth_check_unavailable');
      }
    }
    // A closed receipt has no raw UID. Never recreate it just for verification.
    const page = await auth.listUsers(1000);
    if (page.pageToken) throw Error('cleanup_auth_inventory_limit');
    return !page.users.some(user => digest(user.uid) === key);
  }
  return {
    // Internal adapters may authenticate reads; this returns no token or roster data.
    authorizeRead: (token: string) => authorize(token),
    async expireReview(token: string, reviewId: string, proof?: { expectedRevision: string; backupsClear: boolean }) {
      await authorize(token);
      if (!ID.test(reviewId) || proof && (!/^[a-f0-9]{64}$/.test(proof.expectedRevision)
        || typeof proof.backupsClear !== 'boolean')) throw Error('invalid_cleanup_review');
      return db.runTransaction(async tx => {
        await authorize(token, tx);
        const reference = ref(reviewId), record = await tx.get(reference), data = record.data();
        if (proof && billingCleanupRevision([data]) !== proof.expectedRevision) throw Error('cleanup_review_stale');
        if (!record.exists) return 'absent';
        if (data?.retentionHold === true || data?.legalHold === true) return 'retained';
        if (data?.status === 'approved') {
          if (!Number.isSafeInteger(data.approvedAtMs) || data.approvedAtMs <= 0
            || now() < data.approvedAtMs + 15 * 60_000) return 'retained';
        } else if (data?.status === 'consumed') {
          if (proof?.backupsClear !== true) return 'retained';
          if (!data.consumedAt?.toMillis || !data.retentionDueAt?.toMillis
            || data.retentionDueAt.toMillis() !== data.consumedAt.toMillis() + 90 * 86400000
            || now() < data.retentionDueAt.toMillis() || !/^[a-f0-9]{64}$/.test(data.key)) return 'retained';
          const related = await Promise.all(['coachAiBillingEnrollments/', 'coachAiBillingDeletionQueue/', 'coachAiBillingEvents/']
            .map(prefix => tx.get(db.doc(prefix + data.key))));
          if (related.some(doc => doc.exists)) return 'retained';
        } else return 'retained';
        await currentIdentity(token);
        tx.delete(reference);
        return 'expired';
      }, { maxAttempts: 1 });
    },
    async draft(token: string, operation: CleanupOperation, key: string): Promise<Draft> {
      await authorize(token);
      if (!['close', 'expire_cleanup', 'expire_event'].includes(operation) || !/^[a-f0-9]{64}$/.test(key)) throw Error('invalid_cleanup_target');
      return { operation, key, revision: billingCleanupRevision(await records(operation, key)), reviewId: randomUUID(), draftedAtMs: now() };
    },
    async approve(token: string, draft: Draft, facts: CleanupAttestations) {
      const operator = await authorize(token);
      scopeValid(draft);
      if (!age(draft.draftedAtMs, now(), 15 * 60_000) || !facts || Object.keys(facts).length !== FACTS.length
        || FACTS.some(key => typeof facts[key] !== 'boolean')) throw Error('invalid_cleanup_attestation');
      const paths = draft.operation === 'expire_event' ? ['coachAiBillingEvents/' + draft.key]
        : ['coachAiBillingEnrollments/' + draft.key, 'coachAiBillingDeletionQueue/' + draft.key];
      await db.runTransaction(async tx => {
        await authorize(token, tx);
        const current = await Promise.all(paths.map(path => tx.get(db.doc(path))));
        if (billingCleanupRevision(current.map(doc => doc.data())) !== draft.revision) throw Error('cleanup_review_stale');
        await currentIdentity(token);
        tx.create(ref(draft.reviewId), { operation: draft.operation, key: draft.key, revision: draft.revision,
          reviewId: draft.reviewId, status: 'approved', reviewerUid: operator.uid, reviewerRole: operator.role,
          facts, approvedAtMs: now(), expiresAt: Timestamp.fromMillis(now() + 15 * 60_000) });
      }, { maxAttempts: 1 });
    },
    async execute(token: string, target: { operation: CleanupOperation; key: string; reviewId: string; uid?: string }) {
      // No caller-supplied outcomes or facts are accepted here.
      if (Object.keys(target).some(key => !['operation', 'key', 'reviewId', 'uid'].includes(key))
        || !['close', 'expire_cleanup', 'expire_event'].includes(target.operation)
        || !/^[a-f0-9]{64}$/.test(target.key) || !ID.test(target.reviewId)
        || target.operation === 'close' && target.uid !== undefined
          && (!/^[A-Za-z0-9_-]{1,128}$/.test(target.uid) || digest(target.uid) !== target.key)
        || target.operation !== 'close' && target.uid !== undefined) throw Error('invalid_cleanup_target');
      const operator = await authorize(token);
      if (target.operation === 'close' && target.uid === undefined) {
        const [fence, queue] = await records('close', target.key);
        if (fence?.vendorCleanupRequired !== false || queue !== undefined) throw Error('cleanup_identity_required');
      }
      let approved: FirebaseFirestore.DocumentData | undefined;
      const service = createCoachAiBillingMaintenance({ db, now,
        authorize: async () => operator.role,
        inspect: async scope => {
          approved = (await ref(scope.reviewId).get()).data();
          if (!approved || !sameScope(scope, approved as ReviewScope) || approved.status !== 'approved'
            || approved.reviewerUid !== operator.uid || approved.reviewerRole !== operator.role
            || !age(approved.approvedAtMs, now(), 15 * 60_000)
            || !approved.facts || FACTS.some(key => typeof approved!.facts[key] !== 'boolean')) throw Error('cleanup_review_unapproved');
          const checkedAtMs = now();
          let vendor: CleanupReview['vendor'] = 'unknown', absent = false;
          if (scope.operation !== 'expire_event') {
            absent = await authAbsent(scope.key, target.uid);
            const [fence, queue] = await records(scope.operation, scope.key);
            if (scope.operation === 'close') {
              if (fence?.vendorCleanupRequired === false && !queue) vendor = 'not_required';
              else if (fence?.vendorCleanupRequired === true && queue?.userId === target.uid) {
                vendor = await verifyRevenueCatCustomerAbsent(target.uid!, options.verificationKey(), { fetcher: options.fetcher, now }) ? 'absent' : 'present';
              }
            } else if (queue?.status === 'closed' && ['absent', 'not_required'].includes(queue.vendorOutcome)) {
              // Reconcile subsequent activity via the approved human facts;
              // do not recover/persist deleted identifiers to repeat vendor GET.
              vendor = queue.vendorOutcome;
            }
          }
          return { ...scope, ...approved.facts, checkedAtMs, authAbsent: absent, vendor } as CleanupReview;
        },
        lockReview: async (tx, proof) => {
          await authorize(token, tx);
          const reference = ref(proof.reviewId), stored = (await tx.get(reference)).data();
          if (!approved || !stored || billingCleanupRevision([stored]) !== billingCleanupRevision([approved])
            || stored.status !== 'approved' || !age(stored.approvedAtMs, now(), 15 * 60_000)) throw Error('cleanup_review_changed');
          return status => tx.set(reference, { status: 'consumed', operation: proof.operation,
            key: proof.key, reviewId: proof.reviewId, reviewerRole: operator.role, result: status,
            consumedAt: Timestamp.fromMillis(now()), retentionDueAt: Timestamp.fromMillis(now() + 90 * 86400000) });
        },
        beforeCommit: async () => { await currentIdentity(token); },
      });
      const request = { actor: operator.uid, reviewId: target.reviewId };
      if (target.operation === 'close') return target.uid === undefined
        ? service.closeNonbuyer({ ...request, key: target.key })
        : service.close({ ...request, uid: target.uid });
      if (target.operation === 'expire_cleanup') return service.expireCleanup({ ...request, key: target.key });
      return service.expireEvent({ ...request, key: target.key });
    },
  };
}
