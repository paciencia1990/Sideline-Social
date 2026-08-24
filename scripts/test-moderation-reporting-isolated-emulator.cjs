"use strict";

const assert = require("node:assert/strict");
const admin = require("../moderation-reporting-staging/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } = require("firebase/auth");
const { connectFirestoreEmulator, doc, getDoc, getFirestore } = require("firebase/firestore");
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require("firebase/functions");

const projectId = process.env.GCLOUD_PROJECT || "demo-sideline-moderation-reporting-isolation";
if (!admin.apps.length) admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
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
    call: (data) => httpsCallable(functions, "submitModerationReportV2")(data).then((result) => result.data),
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
  const reporter = await createClient("synthetic-isolated-reporter");
  const subject = await createClient("synthetic-isolated-subject");
  const outsider = await createClient("synthetic-isolated-outsider");
  const now = admin.firestore.Timestamp.now();
  for (const client of [reporter, subject, outsider]) {
    await adminDb.collection("users").doc(client.uid).set({
      adultEligibilityConfirmed: true,
      communityGuidelinesAcceptedAt: now,
      displayName: "Synthetic Member",
      firstName: "Synthetic",
      lastName: "Member",
      legalAssentVersion: "1.0.0-2026-08-14",
      termsOfUseAcceptedAt: now,
    });
  }
  await adminDb.collection("publicUserProfiles").doc(subject.uid).set({
    displayName: "Synthetic Member",
    photoURL: null,
    profileState: "active",
    updatedAt: now,
  });

  const conversationId = "syntheticIsolatedConversation";
  const messageId = "syntheticIsolatedImageMessage";
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

  const first = await reporter.call(reportInput(
    "isolated_request_001",
    { type: "friendMessage", conversationId, messageId },
  ));
  assert.match(first.receiptNumber, /^SS-[A-F0-9]{12}$/u);
  assert.equal(first.alreadyReported, false);
  const duplicate = await reporter.call(reportInput(
    "isolated_request_002",
    { type: "friendMessage", conversationId, messageId },
  ));
  assert.equal(duplicate.alreadyReported, true);
  assert.equal(duplicate.reportId, first.reportId);

  const canonical = await adminDb.collection("moderationReports").doc(first.reportId).get();
  const reporterLink = await adminDb.collection("moderationReporterLinks").doc(first.reportId).get();
  const captureQueue = await adminDb.collection("moderationEvidenceCaptureQueue").doc(first.reportId).get();
  assert.equal(canonical.data().reporterUserId, undefined);
  assert.equal(typeof canonical.data().reporterHash, "string");
  assert.equal(reporterLink.data().reporterUserId, reporter.uid);
  assert.deepEqual(captureQueue.data().attachmentPaths.sort(), [fullPath, thumbnailPath].sort());
  assert.equal((await messageReference.get()).data().moderationEvidenceRetained, true);

  await expectRejected(getDoc(doc(reporter.firestore, "moderationReporterLinks", first.reportId)), "permission-denied");
  await expectRejected(getDoc(doc(reporter.firestore, "moderationReports", first.reportId)), "permission-denied");
  await expectRejected(
    outsider.call(reportInput("isolated_outsider_001", { type: "friendMessage", conversationId, messageId })),
    "permission-denied",
  );
  await expectRejected(
    subject.call(reportInput("isolated_self_001", { type: "friendMessage", conversationId, messageId })),
    "failed-precondition",
  );
  await expectRejected(reporter.call({
    ...reportInput("isolated_short_001", { type: "conduct" }),
    explanation: "too short",
  }), "invalid-argument");

  const profileReport = await reporter.call(reportInput(
    "isolated_profile_001",
    { type: "userProfile", reportedUserId: subject.uid, conversationId },
    "spam_scam_impersonation",
  ));
  assert.match(profileReport.receiptNumber, /^SS-/u);

  await adminDb.collection("accountStanding").doc(reporter.uid).set({ status: "suspended", updatedAt: now });
  await expectRejected(
    reporter.call(reportInput("isolated_suspended_001", { type: "conduct" })),
    "permission-denied",
  );

  console.log("Isolated synthetic moderation submission, dedupe, privacy, authorization, retention, account-standing, and Rules tests passed.");
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
