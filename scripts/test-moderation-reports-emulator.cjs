"use strict";

const assert = require("node:assert/strict");
const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } = require("firebase/auth");
const { connectFirestoreEmulator, doc, getDoc, getFirestore } = require("firebase/firestore");
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require("firebase/functions");

const projectId = process.env.GCLOUD_PROJECT || "sideline-moderation-reports-test";
if (!admin.apps.length) {
  admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
}
const adminDb = admin.firestore();

async function createClient(label) {
  const app = initializeApp({
    apiKey: "synthetic-key",
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: `${projectId}.appspot.com`,
  }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const credential = await createUserWithEmailAndPassword(auth, `${label}@example.test`, "SyntheticPass123!");
  const firestore = getFirestore(app);
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return {
    firestore,
    uid: credential.user.uid,
    call: (name, data) => httpsCallable(functions, name)(data).then((result) => result.data),
  };
}

async function expectRejected(promise, code) {
  await assert.rejects(promise, (error) => String(error?.code).includes(code));
}

function reportInput(clientRequestId, target, reason = "harassment_bullying") {
  return {
    blockRequested: false,
    clientRequestId,
    explanation: "Synthetic report context only.",
    reason,
    target,
  };
}

async function main() {
  const reporter = await createClient("synthetic-reporter");
  const subject = await createClient("synthetic-subject");
  const outsider = await createClient("synthetic-outsider");
  const now = admin.firestore.Timestamp.now();
  for (const client of [reporter, subject, outsider]) {
    await adminDb.collection("users").doc(client.uid).set({
      adultEligibilityConfirmed: true,
      communityGuidelinesAcceptedAt: now,
      displayName: `Synthetic ${client.uid.slice(0, 6)} Member`,
      firstName: "Synthetic",
      lastName: "Member",
      legalAssentVersion: "1.0.0-2026-08-14",
      termsOfUseAcceptedAt: now,
    }, { merge: true });
  }
  await adminDb.collection("publicUserProfiles").doc(subject.uid).set({
    displayName: "Synthetic Member",
    photoURL: null,
    profileState: "active",
    updatedAt: now,
  });

  const conversationId = "syntheticConversation";
  const messageId = "syntheticImageMessage";
  const conversation = adminDb.collection("friendConversations").doc(conversationId);
  await conversation.set({
    activeParticipantIds: [reporter.uid, subject.uid],
    conversationType: "direct",
    status: "active",
  });
  await Promise.all([
    conversation.collection("members").doc(reporter.uid).set({ status: "active" }),
    conversation.collection("members").doc(subject.uid).set({ status: "active" }),
  ]);
  const fullPath = `friendChatMedia/${conversationId}/${messageId}/syntheticReservation/image.jpg`;
  const thumbnailPath = `friendChatMedia/${conversationId}/${messageId}/syntheticReservation/thumbnail.jpg`;
  await Promise.all([
    admin.storage().bucket().file(fullPath).save(Buffer.from("benign synthetic image bytes")),
    admin.storage().bucket().file(thumbnailPath).save(Buffer.from("benign synthetic thumbnail bytes")),
  ]);
  const messageReference = conversation.collection("messages").doc(messageId);
  await messageReference.set({
    caption: "Benign synthetic caption",
    conversationId,
    image: { fullPath, thumbnailPath, mimeType: "image/jpeg", sizeBytes: 28 },
    mediaStoragePaths: [fullPath, thumbnailPath],
    messageType: "image",
    senderUserId: subject.uid,
    status: "active",
    visibleToUserIds: [reporter.uid, subject.uid],
  });

  const first = await reporter.call("submitModerationReportV2", reportInput(
    "synthetic_request_001",
    { type: "friendMessage", conversationId, messageId },
  ));
  assert.match(first.receiptNumber, /^SS-[A-F0-9]{12}$/u);
  assert.equal(first.alreadyReported, false);

  const duplicate = await reporter.call("submitModerationReportV2", reportInput(
    "synthetic_request_002",
    { type: "friendMessage", conversationId, messageId },
  ));
  assert.equal(duplicate.alreadyReported, true);
  assert.equal(duplicate.reportId, first.reportId);
  assert.equal(duplicate.receiptNumber, first.receiptNumber);

  const sourceAfterReport = await messageReference.get();
  assert.equal(sourceAfterReport.data().moderationEvidenceRetained, true);
  const canonical = await adminDb.collection("moderationReports").doc(first.reportId).get();
  const reporterLink = await adminDb.collection("moderationReporterLinks").doc(first.reportId).get();
  const captureQueue = await adminDb.collection("moderationEvidenceCaptureQueue").doc(first.reportId).get();
  assert.equal(canonical.data().reporterUserId, undefined, "canonical reports do not contain raw reporter identity");
  assert.equal(typeof canonical.data().reporterHash, "string");
  assert.equal(reporterLink.data().reporterUserId, reporter.uid);
  assert.deepEqual(captureQueue.data().attachmentPaths.sort(), [fullPath, thumbnailPath].sort());
  await adminDb.collection("moderationReporterIdentityRequests").doc("rir_synthetic_rules_test").set({
    requestNumber: "rir_synthetic_rules_test",
    caseId: "synthetic-case",
    reasonCategory: "criticalSafetyFollowUp",
    justification: "Synthetic request document used only for local Rules denial verification.",
    requestingLeadId: "synthetic-lead",
    recentAuthenticationVerified: true,
    status: "pending",
    requestedAt: now,
    auditCorrelationId: "audit_synthetic_rules_test",
  });

  const mine = await reporter.call("listMyModerationReports", {});
  assert.equal(mine.reports.some((report) => report.reportId === first.reportId), true);
  await expectRejected(getDoc(doc(reporter.firestore, "moderationReporterLinks", first.reportId)), "permission-denied");
  await expectRejected(
    getDoc(doc(reporter.firestore, "moderationReporterIdentityRequests", "rir_synthetic_rules_test")),
    "permission-denied",
  );
  await expectRejected(getDoc(doc(reporter.firestore, "moderationReports", first.reportId)), "permission-denied");

  await expectRejected(
    outsider.call("submitModerationReportV2", reportInput(
      "synthetic_outsider_001",
      { type: "friendMessage", conversationId, messageId },
    )),
    "permission-denied",
  );
  await expectRejected(
    subject.call("submitModerationReportV2", reportInput(
      "synthetic_self_001",
      { type: "friendMessage", conversationId, messageId },
    )),
    "failed-precondition",
  );
  await expectRejected(
    reporter.call("submitModerationReportV2", {
      ...reportInput("synthetic_short_001", { type: "conduct" }),
      explanation: "too short",
    }),
    "invalid-argument",
  );

  const profileReport = await reporter.call("submitModerationReportV2", reportInput(
    "synthetic_profile_001",
    { type: "userProfile", reportedUserId: subject.uid, conversationId },
    "spam_scam_impersonation",
  ));
  assert.match(profileReport.receiptNumber, /^SS-/u);

  const deletion = await subject.call("removeOwnFriendChatMessage", { conversationId, messageId });
  assert.equal(deletion.storageCleanup, "retainedForModeration");
  assert.equal((await admin.storage().bucket().file(fullPath).exists())[0], true);
  assert.equal((await admin.storage().bucket().file(thumbnailPath).exists())[0], true);
  const removed = await messageReference.get();
  assert.equal(removed.data().status, "removed");
  assert.equal(removed.data().image, null);

  console.log("Synthetic moderation submission, dedupe, privacy, authorization, retention, status, Rules, and deletion tests passed.");
}

main()
  .then(async () => {
    await Promise.all(admin.apps.map((app) => app.delete()));
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await Promise.all(admin.apps.map((app) => app.delete()));
    process.exit(1);
  });
