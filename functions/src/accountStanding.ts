import { lifecyclePatch } from './moderationRetentionCore';
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { orderedStandingProjection, deleteStandingProjection } from './standingProjection';
import { observeStandingDelivery } from './standingObservation';
import { createHash } from "node:crypto";

import { getApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as firebaseFunctions from "firebase-functions/v1";

import {
  permanentAccountFunctions,
  requirePermanentUid,
  resolveAccountStanding,
  resolveAccountStandingData,
} from "./permanentAuth";
import { parseFriendChatMediaStoragePath } from "./friendChatCore";
import { completedAppealableAction } from "./accountStandingAppeal";

const safetyFunctions = permanentAccountFunctions(
  firebaseFunctions,
  "safety",
).region("us-central1");

const PUBLIC_REASON_CODES = new Set([
  "credibleThreat",
  "childExploitation",
  "communityGuidelines",
  "harassment",
  "immediateDanger",
  "privacy",
  "safety",
  "sexualContent",
  "spam",
]);

type AppealState = "none" | "submitted" | "resolved";

export const getMyAccountStanding = safetyFunctions.https.onCall(
  async (_data, context) => {
    const uid = requirePermanentUid(context);
    return readSafeStanding(uid);
  },
);

export const acknowledgeMyModerationWarning = safetyFunctions.https.onCall(
  async (data, context) => {
    const uid = requirePermanentUid(context);
    const warningId = typeof data?.warningId === "string"
      ? data.warningId.trim()
      : "";
    if (!/^[A-Za-z0-9_-]{1,200}$/u.test(warningId)) {
      throw new firebaseFunctions.https.HttpsError(
        "invalid-argument",
        "A valid warning reference is required.",
        { reason: "invalid_warning_reference" },
      );
    }

    const reference = getFirestore().collection("moderationUserNotices").doc(uid);
    let alreadyAcknowledged = false;
    await getFirestore().runTransaction(async (transaction) => {
      const current = await transaction.get(reference);
      if (!current.exists || current.data()?.warningId !== warningId) {
        throw new firebaseFunctions.https.HttpsError(
          "failed-precondition",
          "This warning is no longer current. Refresh your account status.",
          { reason: "warning_changed" },
        );
      }
      if (current.data()?.acknowledgedAt) {
        alreadyAcknowledged = true;
        return;
      }
      transaction.update(reference, {
        acknowledgedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return { acknowledged: true, alreadyAcknowledged };
  },
);

export const submitMyModerationAppeal = safetyFunctions.https.onCall(
  async (data, context) => {
    const uid = requirePermanentUid(context);
    const standing = await resolveAccountStanding(uid);
    if (standing.effective === "active") {
      throw new firebaseFunctions.https.HttpsError(
        "failed-precondition",
        "This account does not have an appealable restriction.",
        { reason: "appeal_not_available" },
      );
    }

    const requestedRevision = Number(data?.revision);
    if (
      !Number.isInteger(requestedRevision) ||
      requestedRevision !== standing.revision
    ) {
      throw new firebaseFunctions.https.HttpsError(
        "failed-precondition",
        "The account restriction changed. Refresh and try again.",
        { reason: "standing_changed" },
      );
    }

    const explanation = typeof data?.explanation === "string"
      ? data.explanation.trim()
      : "";
    if (explanation.length < 20 || explanation.length > 1500) {
      throw new firebaseFunctions.https.HttpsError(
        "invalid-argument",
        "An appeal explanation between 20 and 1500 characters is required.",
        { reason: "invalid_appeal_explanation" },
      );
    }

    const firestore = getFirestore();
    const caseSnapshot = await findAppealCase(uid);
    if (!caseSnapshot) {
      throw new firebaseFunctions.https.HttpsError(
        "failed-precondition",
        "An appeal is not available for this restriction.",
        { reason: "appeal_not_available" },
      );
    }

    const appealReference = caseSnapshot.ref
      .collection("appeals")
      .doc(`mobile_${uid}_r${standing.revision}`);
    const rateReference = firestore
      .collection("moderationRateLimits")
      .doc(hashId(`${uid}:mobile-appeal`));
    const standingReference = firestore.collection("accountStanding").doc(uid);
    const auditReference = firestore.collection("moderationAuditEvents")
      .doc(hashId(`appeal-submitted:${caseSnapshot.id}:${uid}:${standing.revision}`));
    const now = Timestamp.now();
    let alreadySubmitted = false;

    await firestore.runTransaction(async (transaction) => {
      const [currentCase, currentStanding, existingAppeal, rateSnapshot, auditSnapshot] = await Promise.all([
        transaction.get(caseSnapshot.ref),
        transaction.get(standingReference),
        transaction.get(appealReference),
        transaction.get(rateReference),
        transaction.get(auditReference),
      ]);
      if (
        !currentCase.exists ||
        currentCase.data()?.reportedUserId !== uid
      ) {
        throw new firebaseFunctions.https.HttpsError(
          "not-found",
          "Eligible moderation case not found.",
        );
      }
      const currentStandingCaseId = typeof currentStanding.data()?.caseId === "string"
        ? currentStanding.data()?.caseId
        : caseIdFromActionReference(currentStanding.data()?.actionReference);
      const originalActionPath = actionReferenceForCase(
        currentStanding.data()?.actionReference,
        caseSnapshot.id,
      );
      if (
        !currentStanding.exists ||
        currentStandingCaseId !== caseSnapshot.id ||
        !originalActionPath ||
        Number(currentStanding.data()?.revision) !== standing.revision ||
        (
          currentStanding.data()?.status === "active" &&
          currentStanding.data()?.messagingRestricted !== true
        )
      ) {
        throw new firebaseFunctions.https.HttpsError(
          "aborted",
          "The account restriction changed. Refresh and try again.",
          { reason: "standing_changed" },
        );
      }
      const originalAction = await transaction.get(firestore.doc(originalActionPath));
      if (!originalAction.exists || !completedAppealableAction(originalAction.data())) {
        throw new firebaseFunctions.https.HttpsError(
          "failed-precondition",
          "The completed appealable enforcement is unavailable.",
          { reason: "original_enforcement_unavailable" },
        );
      }
      if (existingAppeal.exists) {
        if (
          existingAppeal.data()?.submittedBy !== uid ||
          existingAppeal.data()?.standingRevision !== standing.revision
        ) {
          throw new firebaseFunctions.https.HttpsError(
            "failed-precondition",
            "The existing appeal conflicts with this restriction.",
            { reason: "appeal_conflict" },
          );
        }
        alreadySubmitted = true;
        return;
      }
      if (currentCase.data()?.appealState === "submitted") {
        alreadySubmitted = true;
        return;
      }

      const windowStartedAt = timestampMillis(rateSnapshot.data()?.windowStartedAt);
      const inCurrentWindow = windowStartedAt !== null &&
        Date.now() - windowStartedAt < 24 * 60 * 60 * 1000;
      const count = inCurrentWindow ? Number(rateSnapshot.data()?.count ?? 0) : 0;
      if (count >= 3) {
        throw new firebaseFunctions.https.HttpsError(
          "resource-exhausted",
          "Too many appeal attempts. Try again later.",
        );
      }
      const currentCaseVersion = storedCaseVersion(currentCase.data()?.caseVersion);
      if (currentCaseVersion === null || currentCaseVersion === Number.MAX_SAFE_INTEGER) {
        throw new firebaseFunctions.https.HttpsError(
          "failed-precondition",
          "Case version metadata is unavailable.",
          { reason: "partial_case_metadata" },
        );
      }

      transaction.set(rateReference, {
        uidHash: hashId(uid),
        operation: "mobileAppeal",
        count: count + 1,
        windowStartedAt: inCurrentWindow
          ? rateSnapshot.data()?.windowStartedAt
          : now,
        updatedAt: now,
      });
      transaction.create(appealReference, {
        appealId: appealReference.id,
        submittedBy: uid,
        explanation,
        standingRevision: standing.revision,
        originalActionReference: originalActionPath,
        originalActionType: typeof originalAction.data()?.type === "string"
          ? originalAction.data()?.type
          : null,
        status: "submitted",
        source: "mobile",
        createdAt: now,
      });
      transaction.update(caseSnapshot.ref, {
        ...lifecyclePatch(currentCase.data()!, 'open', now.toMillis(), appealReference.path),
        status: "appealed",
        appealState: "submitted",
        caseVersion: currentCaseVersion + 1,
        updatedAt: now,
      });
      if (!auditSnapshot.exists) {
        transaction.create(auditReference, {
          eventId: auditReference.id,
          actorId: uid,
          eventType: "appealSubmitted",
          caseId: caseSnapshot.id,
          targetId: uid,
          reasonCode: null,
          outcome: "submitted",
          metadata: { source: "mobile", standingRevision: standing.revision },
          createdAt: now,
        });
      }
    });

    return {
      appealStatus: "submitted" as const,
      alreadySubmitted,
    };
  },
);

export const onAccountStandingChanged = firebaseFunctions
  .region("us-central1")
  .firestore.document("accountStanding/{uid}")
  .onWrite(async (change, context) => {
    return observeStandingDelivery(context.eventId, context.params.uid, async () => {
    const uid = context.params.uid;
    const firestore = getFirestore();
    const publicReference = firestore
      .collection("accountStandingPublic")
      .doc(uid);

    // Read authoritative standing inside the same transaction that writes the
    // Firestore projection; event payloads can be arbitrarily old or reordered.
    const snapshot = await firestore.runTransaction(async transaction => {
      const current = await transaction.get(firestore.collection('accountStanding').doc(uid));
      const publicSnapshot = await transaction.get(publicReference);
      const deletionFence = await transaction.get(firestore.collection('moderationAccountDeletionFences').doc(uid));
      if (deletionFence.exists) {
        if (publicSnapshot.exists) transaction.delete(publicReference);
        if (!deletionFence.updateTime) throw new Error('deletion_fence_version_missing');
        return { deleted: true as const, version: `${deletionFence.updateTime.seconds}:${deletionFence.updateTime.nanoseconds}` };
      }
      if (!current.exists) {
        if (publicSnapshot.exists) transaction.delete(publicReference);
        return null;
      }
      const data = current.data() ?? {};
      const standing = resolveAccountStandingData(data);
      // The canonical read participates in this transaction. Its server version,
      // not a possibly stale projection revision, fences concurrent writes and
      // correctly handles a new canonical document whose revision restarts at 1.
        transaction.set(publicReference, {
          status: standing.effective,
          effectiveAt: timestampValue(data.effectiveAt) ?? timestampValue(data.updatedAt) ?? Timestamp.now(),
          expiresAt: timestampValue(data.expiresAt), publicReasonCode: readPublicReasonCode(data.reasonCode),
          revision: standing.revision, updatedAt: FieldValue.serverTimestamp(),
        });
      if (!current.updateTime) throw new Error('standing_version_missing');
      return { data, standing, version: `${current.updateTime.seconds}:${current.updateTime.nanoseconds}` };
    });
    if (!snapshot) {
      const beforeRevision = Number(change.before.data()?.revision);
      if (Number.isSafeInteger(beforeRevision) && beforeRevision > 0) {
        if (!change.before.updateTime) throw new Error('standing_version_missing');
        const deletedVersion = `${change.before.updateTime.seconds}:${change.before.updateTime.nanoseconds}`;
        await getDatabase().ref(`accountStanding/${uid}`).transaction(
          current => deleteStandingProjection(current, beforeRevision, deletedVersion), undefined, false,
        );
      }
      return;
    }
    if ('deleted' in snapshot) {
      await getDatabase().ref(`accountStanding/${uid}`).transaction(current => orderedStandingProjection(current, {
        status: 'deleted', deleted: true, messagingRestricted: false, expiresAt: null, revision: 1,
        version: snapshot.version, updatedAt: Date.now(),
      }), undefined, false);
      return;
    }
    const { standing } = snapshot;
    await getDatabase().ref(`accountStanding/${uid}`).transaction(current => orderedStandingProjection(current, {
      status: standing.effective,
      messagingRestricted: standing.effective === 'messagingRestricted',
      expiresAt: standing.expiresAtMillis, revision: standing.revision, updatedAt: Date.now(), version: snapshot.version,
    }), undefined, false);
    await cancelRestrictedArtifacts(uid, standing.effective);

    if (
      standing.effective === "suspended" ||
      standing.effective === "banned"
    ) {
      await getAuth().revokeRefreshTokens(uid);
    }
    });
  });

async function readSafeStanding(uid: string) {
  const firestore = getFirestore();
  const [standing, canonical, notice] = await Promise.all([
    resolveAccountStanding(uid),
    firestore.collection("accountStanding").doc(uid).get(),
    firestore.collection("moderationUserNotices").doc(uid).get(),
  ]);
  const data = canonical.data() ?? {};
  const appealCase = standing.effective === "active"
    ? null
    : await findAppealCase(uid);
  const appealState = readAppealState(appealCase?.data()?.appealState);
  const actionReference = appealCase
    ? actionReferenceForCase(data.actionReference, appealCase.id)
    : null;
  const originalAction = actionReference
    ? await firestore.doc(actionReference).get()
    : null;
  const appealableActionConfirmed = Boolean(
    originalAction?.exists && completedAppealableAction(originalAction.data()),
  );

  return {
    status: standing.effective,
    effectiveAt: isoTime(data.effectiveAt ?? data.updatedAt),
    expiresAt: standing.expiresAtMillis === null
      ? null
      : new Date(standing.expiresAtMillis).toISOString(),
    publicReasonCode: readPublicReasonCode(data.reasonCode),
    revision: standing.revision,
    warning: safePendingWarning(notice),
    appeal: {
      available: Boolean(
        appealCase &&
        appealState === "none" &&
        appealableActionConfirmed &&
        ["actioned", "closed"].includes(String(appealCase.data()?.status)),
      ),
      status: appealState,
    },
  };
}

function safePendingWarning(snapshot: FirebaseFirestore.DocumentSnapshot) {
  if (!snapshot.exists || snapshot.data()?.acknowledgedAt) return null;
  const warningId = typeof snapshot.data()?.warningId === "string"
    ? snapshot.data()?.warningId
    : "";
  if (!/^[A-Za-z0-9_-]{1,200}$/u.test(warningId)) return null;
  return {
    pending: true as const,
    id: warningId,
    publicReasonCode: readPublicReasonCode(snapshot.data()?.reasonCode),
    effectiveAt: isoTime(snapshot.data()?.effectiveAt ?? snapshot.data()?.createdAt),
  };
}

async function findAppealCase(uid: string) {
  const firestore = getFirestore();
  const canonical = await firestore.collection("accountStanding").doc(uid).get();
  const data = canonical.data() ?? {};
  const caseId = typeof data.caseId === "string"
    ? data.caseId
    : caseIdFromActionReference(data.actionReference);
  const actionReference = caseId ? actionReferenceForCase(data.actionReference, caseId) : null;
  if (caseId && actionReference) {
    const direct = await firestore.collection("moderationCases").doc(caseId).get();
    if (direct.exists && direct.data()?.reportedUserId === uid) return direct;
  }
  return null;
}

async function cancelRestrictedArtifacts(
  uid: string,
  standing: "active" | "messagingRestricted" | "suspended" | "banned",
) {
  if (standing === "active") return;
  const firestore = getFirestore();
  const [uploadReservations, friendMediaReservations, friendMediaGrants, outgoingRequests] = await Promise.all([
    firestore.collection("teamVoiceUploadReservations")
      .where("userId", "==", uid)
      .limit(200)
      .get(),
    firestore.collection("friendChatUploadReservations")
      .where("userId", "==", uid)
      .limit(200)
      .get(),
    firestore.collection("friendChatMediaPlaybackGrants")
      .where("userId", "==", uid)
      .limit(500)
      .get(),
    firestore.collection("friendRequests")
      .where("fromUserId", "==", uid)
      .limit(200)
      .get(),
  ]);
  const friendMediaStoragePaths = new Set<string>();
  const writer = firestore.bulkWriter();
  uploadReservations.docs
    .filter((entry) => entry.data()?.status === "pending")
    .forEach((entry) => writer.set(entry.ref, {
      status: "canceled",
      canceledAt: FieldValue.serverTimestamp(),
      cancelReason: "accountStanding",
    }, { merge: true }));
  friendMediaReservations.docs
    .filter((entry) => entry.data()?.status === "pending")
    .forEach((entry) => {
      friendMediaReservationStoragePaths(entry.data()).forEach((storagePath) => {
        friendMediaStoragePaths.add(storagePath);
      });
      writer.set(entry.ref, {
        status: "deletePending",
        canceledAt: FieldValue.serverTimestamp(),
        cancelReason: "accountStanding",
        expiresAt: Timestamp.now(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  friendMediaGrants.docs.forEach((entry) => writer.delete(entry.ref));
  outgoingRequests.docs
    .filter((entry) => entry.data()?.status === "pending")
    .forEach((entry) => writer.set(entry.ref, {
      status: "canceled",
      canceledAt: FieldValue.serverTimestamp(),
      cancelReason: "accountStanding",
    }, { merge: true }));

  if (standing === "suspended" || standing === "banned") {
    const [tokens, notifications] = await Promise.all([
      firestore.collection("notificationTokens").where("uid", "==", uid).limit(50).get(),
      firestore.collection("userNotifications").doc(uid)
        .collection("notifications").limit(500).get(),
    ]);
    tokens.docs.forEach((entry) => writer.delete(entry.ref));
    notifications.docs
      .filter((entry) => entry.data()?.status === "active")
      .forEach((entry) => writer.set(entry.ref, {
        status: "dismissed",
        dismissedAt: FieldValue.serverTimestamp(),
        dismissReason: "accountStanding",
        isRead: true,
      }, { merge: true }));
  }
  await writer.close();
  await Promise.allSettled(Array.from(friendMediaStoragePaths).map((storagePath) =>
    getStorage().bucket().file(storagePath).delete({ ignoreNotFound: true })));
}

function friendMediaReservationStoragePaths(data: FirebaseFirestore.DocumentData | undefined) {
  if (!data) return [];
  return [
    typeof data.storagePath === "string" ? data.storagePath : "",
    typeof data.fullPath === "string" ? data.fullPath : "",
    typeof data.thumbnailPath === "string" ? data.thumbnailPath : "",
  ].filter((storagePath) => Boolean(parseFriendChatMediaStoragePath(storagePath)));
}

function readPublicReasonCode(value: unknown) {
  return typeof value === "string" && PUBLIC_REASON_CODES.has(value)
    ? value
    : "communityGuidelines";
}

function readAppealState(value: unknown): AppealState {
  return value === "submitted" || value === "resolved" ? value : "none";
}

function caseIdFromActionReference(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^moderationCases\/([^/]+)\/actions\/[^/]+$/u.exec(value);
  return match?.[1] ?? null;
}

function isoTime(value: unknown) {
  const milliseconds = timestampMillis(value);
  return milliseconds === null ? null : new Date(milliseconds).toISOString();
}

function timestampValue(value: unknown) {
  return value instanceof Timestamp ? value : null;
}

function timestampMillis(value: unknown) {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return null;
}

function actionReferenceForCase(value: unknown, caseId: string) {
  if (typeof value !== "string") return null;
  const match = /^moderationCases\/([^/]+)\/actions\/[^/]+$/u.exec(value);
  return match?.[1] === caseId ? value : null;
}

function storedCaseVersion(value: unknown) {
  if (value == null) return 0;
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function hashId(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
