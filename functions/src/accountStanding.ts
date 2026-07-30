import { createHash } from "node:crypto";

import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as firebaseFunctions from "firebase-functions";

import {
  permanentAccountFunctions,
  requirePermanentUid,
  resolveAccountStanding,
} from "./permanentAuth";

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

    const firestore = admin.firestore();
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
    const now = Timestamp.now();
    let alreadySubmitted = false;

    await firestore.runTransaction(async (transaction) => {
      const [currentCase, existingAppeal, rateSnapshot] = await Promise.all([
        transaction.get(caseSnapshot.ref),
        transaction.get(appealReference),
        transaction.get(rateReference),
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
      if (existingAppeal.exists) {
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
        status: "submitted",
        source: "mobile",
        createdAt: now,
      });
      transaction.update(caseSnapshot.ref, {
        status: "appealed",
        appealState: "submitted",
        updatedAt: now,
      });
    });

    if (!alreadySubmitted) {
      const auditReference = firestore.collection("moderationAuditEvents").doc();
      await auditReference.create({
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
    const uid = context.params.uid;
    const firestore = admin.firestore();
    const publicReference = firestore
      .collection("accountStandingPublic")
      .doc(uid);

    if (!change.after.exists) {
      await Promise.all([
        publicReference.delete(),
        admin.database().ref(`accountStanding/${uid}`).remove(),
      ]);
      return;
    }

    const data = change.after.data() ?? {};
    const standing = await resolveAccountStanding(uid);
    const publicReasonCode = readPublicReasonCode(data.reasonCode);
    const effectiveAt = timestampValue(data.effectiveAt) ??
      timestampValue(data.updatedAt) ??
      Timestamp.now();
    const expiresAt = timestampValue(data.expiresAt);
    const revision = standing.revision;
    const projection = {
      status: standing.effective,
      effectiveAt,
      expiresAt,
      publicReasonCode,
      revision,
      updatedAt: FieldValue.serverTimestamp(),
    };

    await Promise.all([
      publicReference.set(projection),
      admin.database().ref(`accountStanding/${uid}`).set({
        status: standing.effective,
        expiresAt: standing.expiresAtMillis,
        revision,
        updatedAt: Date.now(),
      }),
      cancelRestrictedArtifacts(uid, standing.effective),
    ]);

    if (
      standing.effective === "suspended" ||
      standing.effective === "banned"
    ) {
      await admin.auth().revokeRefreshTokens(uid);
    }
  });

async function readSafeStanding(uid: string) {
  const firestore = admin.firestore();
  const [standing, canonical] = await Promise.all([
    resolveAccountStanding(uid),
    firestore.collection("accountStanding").doc(uid).get(),
  ]);
  const data = canonical.data() ?? {};
  const appealCase = standing.effective === "active"
    ? null
    : await findAppealCase(uid);
  const appealState = readAppealState(appealCase?.data()?.appealState);

  return {
    status: standing.effective,
    effectiveAt: isoTime(data.effectiveAt ?? data.updatedAt),
    expiresAt: standing.expiresAtMillis === null
      ? null
      : new Date(standing.expiresAtMillis).toISOString(),
    publicReasonCode: readPublicReasonCode(data.reasonCode),
    revision: standing.revision,
    appeal: {
      available: Boolean(
        appealCase &&
        appealState === "none" &&
        ["actioned", "closed"].includes(String(appealCase.data()?.status)),
      ),
      status: appealState,
    },
  };
}

async function findAppealCase(uid: string) {
  const firestore = admin.firestore();
  const canonical = await firestore.collection("accountStanding").doc(uid).get();
  const data = canonical.data() ?? {};
  const caseId = typeof data.caseId === "string"
    ? data.caseId
    : caseIdFromActionReference(data.actionReference);
  if (caseId) {
    const direct = await firestore.collection("moderationCases").doc(caseId).get();
    if (direct.exists && direct.data()?.reportedUserId === uid) return direct;
  }

  const snapshot = await firestore
    .collection("moderationCases")
    .where("reportedUserId", "==", uid)
    .limit(50)
    .get();
  return snapshot.docs
    .filter((entry) => ["actioned", "closed", "appealed"].includes(
      String(entry.data()?.status),
    ))
    .sort((left, right) =>
      (timestampMillis(right.data()?.updatedAt) ?? 0) -
      (timestampMillis(left.data()?.updatedAt) ?? 0),
    )[0] ?? null;
}

async function cancelRestrictedArtifacts(
  uid: string,
  standing: "active" | "messagingRestricted" | "suspended" | "banned",
) {
  if (standing === "active") return;
  const firestore = admin.firestore();
  const [uploadReservations, outgoingRequests] = await Promise.all([
    firestore.collection("teamVoiceUploadReservations")
      .where("userId", "==", uid)
      .limit(200)
      .get(),
    firestore.collection("friendRequests")
      .where("fromUserId", "==", uid)
      .limit(200)
      .get(),
  ]);
  const writer = firestore.bulkWriter();
  uploadReservations.docs
    .filter((entry) => entry.data()?.status === "pending")
    .forEach((entry) => writer.set(entry.ref, {
      status: "canceled",
      canceledAt: FieldValue.serverTimestamp(),
      cancelReason: "accountStanding",
    }, { merge: true }));
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

function hashId(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
