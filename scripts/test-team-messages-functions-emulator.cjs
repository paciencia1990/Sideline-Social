const assert = require("node:assert/strict");
const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } = require("firebase/auth");
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require("firebase/functions");
const { connectStorageEmulator, getStorage, ref, uploadBytes } = require("firebase/storage");

const projectId = process.env.GCLOUD_PROJECT || "sideline-team-messages-functions-test";
if (!admin.apps.length) admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const db = admin.firestore();

async function createClient(label) {
  const app = initializeApp({ apiKey: "demo-key", projectId }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const credential = await createUserWithEmailAndPassword(auth, `${label}@example.test`, "ValidPass123!");
  const callableFunctions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(callableFunctions, "127.0.0.1", 5001);
  const storage = getStorage(app, `gs://${projectId}.appspot.com`);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  return { uid: credential.user.uid, storage, call: (name, data = {}) => httpsCallable(callableFunctions, name)(data).then((result) => result.data) };
}
function hasCode(code) { return (error) => String(error?.code).includes(code); }

async function run() {
  const [coach, parent, secondCoach, outsider] = await Promise.all(["team-coach", "team-parent", "team-second-coach", "team-outsider"].map(createClient));
  await db.collection("teams").doc("team-1").set({ name: "Tigers", createdBy: coach.uid, coachIds: [coach.uid], parentIds: [parent.uid], status: "active" });
  await Promise.all([
    db.collection("teams").doc("team-1").collection("members").doc(coach.uid).set({ userId: coach.uid, teamId: "team-1", status: "active", role: "coach", roles: { coach: true, parent: false, staff: false }, displayName: "Coach C." }),
    db.collection("teams").doc("team-1").collection("members").doc(parent.uid).set({ userId: parent.uid, teamId: "team-1", status: "active", role: "parent", roles: { coach: false, parent: true, staff: false }, displayName: "Parent P." }),
    db.collection("teams").doc("team-1").collection("members").doc(secondCoach.uid).set({ userId: secondCoach.uid, teamId: "team-1", status: "active", role: "coach", roles: { coach: true, parent: false, staff: false }, displayName: "Coach S." }),
  ]);

  const textAnnouncement = await coach.call("createTeamAnnouncement", {
    teamId: "team-1", title: "Practice update", body: "Practice starts at six.", audience: "all", allowReplies: true,
  });
  assert.equal(textAnnouncement.status, "created");
  assert.equal((await db.collection("teams").doc("team-1").collection("announcements").doc(textAnnouncement.announcementId).get()).data().createdBy, coach.uid);
  await assert.rejects(() => parent.call("createTeamAnnouncement", {
    teamId: "team-1", title: "Unauthorized", body: "No", audience: "all", allowReplies: true,
  }), hasCode("permission-denied"));
  await assert.rejects(() => coach.call("createTeamAnnouncement", {
    teamId: "team-1", title: "Unsafe", body: "Go die", audience: "all", allowReplies: true,
  }), hasCode("failed-precondition"));

  const firstReport = await parent.call("reportTeamContent", {
    kind: "announcement", teamId: "team-1", parentId: textAnnouncement.announcementId,
    contentId: textAnnouncement.announcementId, reason: "offensive",
  });
  assert.equal(firstReport.reported, true);
  assert.equal(firstReport.alreadyReported, false);
  const duplicateReport = await parent.call("reportTeamContent", {
    kind: "announcement", teamId: "team-1", parentId: textAnnouncement.announcementId,
    contentId: textAnnouncement.announcementId, reason: "spam",
  });
  assert.equal(duplicateReport.alreadyReported, true, "one reporter cannot flood duplicate reports for the same content");
  await Promise.all([
    db.collection("users").doc(coach.uid).set({ displayName: "Coach C." }),
    db.collection("users").doc(parent.uid).set({ displayName: "Parent P." }),
  ]);

  const first = await coach.call("getOrCreatePrivateTeamConversation", { teamId: "team-1", parentUserId: parent.uid });
  const retry = await coach.call("getOrCreatePrivateTeamConversation", { teamId: "team-1", parentUserId: parent.uid });
  assert.equal(retry.conversationId, first.conversationId, "one deterministic conversation per coach-parent-team tuple");
  const secondCoachConversation = await secondCoach.call("getOrCreatePrivateTeamConversation", { teamId: "team-1", parentUserId: parent.uid });
  assert.notEqual(secondCoachConversation.conversationId, first.conversationId, "a different coach gets a separate private thread");
  await assert.rejects(() => secondCoach.call("markPrivateTeamConversationRead", { conversationId: first.conversationId }), hasCode("permission-denied"));
  await assert.rejects(() => parent.call("getOrCreatePrivateTeamConversation", { teamId: "team-1", parentUserId: outsider.uid }), hasCode("permission-denied"));
  await assert.rejects(() => outsider.call("getOrCreatePrivateTeamConversation", { teamId: "team-1", parentUserId: parent.uid }), hasCode("permission-denied"));

  const sent = await coach.call("sendPrivateTeamTextMessage", { conversationId: first.conversationId, text: "Private hello", clientMessageId: "client_001" });
  assert.equal(sent.status, "sent");
  assert.equal((await coach.call("sendPrivateTeamTextMessage", { conversationId: first.conversationId, text: "Private hello", clientMessageId: "client_001" })).status, "alreadySent");
  await assert.rejects(() => outsider.call("sendPrivateTeamTextMessage", { conversationId: first.conversationId, text: "Injected", clientMessageId: "outside_001" }), hasCode("permission-denied"));
  await parent.call("sendPrivateTeamTextMessage", { conversationId: first.conversationId, text: "Private reply", clientMessageId: "client_002" });
  await assert.rejects(() => coach.call("sendPrivateTeamTextMessage", {
    conversationId: first.conversationId, text: "Kill yourself", clientMessageId: "blocked_content_001",
  }), hasCode("failed-precondition"));
  assert.equal((await parent.call("reportTeamContent", {
    kind: "privateTeamMessage", teamId: "team-1", parentId: first.conversationId,
    contentId: sent.messageId, reason: "harassment",
  })).reported, true);
  await assert.rejects(() => outsider.call("reportTeamContent", {
    kind: "privateTeamMessage", teamId: "team-1", parentId: first.conversationId,
    contentId: sent.messageId, reason: "other",
  }), hasCode("permission-denied"));

  const voiceMemo = { durationMilliseconds: 1000, sizeBytes: 1024, mimeType: "audio/mp4" };
  await assert.rejects(() => parent.call("createTeamVoiceMemoUpload", {
    teamId: "team-1", kind: "announcement", title: "Unauthorized", summary: "Unauthorized", audience: "all", allowReplies: true, voiceMemo,
  }), hasCode("permission-denied"));
  await assert.rejects(() => coach.call("createTeamVoiceMemoUpload", {
    teamId: "team-1", kind: "announcement", title: "Invalid", summary: "Invalid", audience: "all", allowReplies: true,
    voiceMemo: { ...voiceMemo, sizeBytes: 2 * 1024 * 1024 + 1 },
  }), hasCode("invalid-argument"));
  const announcementReservation = await coach.call("createTeamVoiceMemoUpload", {
    teamId: "team-1", kind: "announcement", title: "Voice update", summary: "Practice starts at six.", audience: "all", allowReplies: true, voiceMemo,
  });
  assert.equal((await db.collection("teams").doc("team-1").collection("announcements").doc(announcementReservation.targetId).get()).exists, false, "reservation is not visible before finalize");
  await uploadBytes(ref(coach.storage, announcementReservation.storagePath), new Uint8Array(1024), { contentType: "audio/mp4" });
  assert.equal((await coach.call("finalizeTeamVoiceAnnouncement", { reservationId: announcementReservation.reservationId })).status, "sent");
  assert.equal((await coach.call("finalizeTeamVoiceAnnouncement", { reservationId: announcementReservation.reservationId })).status, "alreadyFinalized");
  const storedAnnouncement = (await db.collection("teams").doc("team-1").collection("announcements").doc(announcementReservation.targetId).get()).data();
  assert.equal(storedAnnouncement.contentType, "voice");
  assert.equal(storedAnnouncement.voiceMemo.storagePath, announcementReservation.storagePath);
  const announcementNotificationRef = db.collection("userNotifications").doc(parent.uid).collection("notifications").doc(`coachAnnouncement_team-1_${announcementReservation.targetId}`);
  await waitForDocument(announcementNotificationRef);
  const announcementNotification = (await announcementNotificationRef.get()).data();
  assert.equal(announcementNotification.type, "coachAnnouncement");
  assert.equal(JSON.stringify(announcementNotification).includes("Practice starts at six"), false, "push/inbox metadata excludes the written summary");

  const privateReservation = await parent.call("createTeamVoiceMemoUpload", {
    teamId: "team-1", kind: "privateMessage", conversationId: first.conversationId, clientMessageId: "voice_client_001", caption: "Private voice reply", voiceMemo,
  });
  await uploadBytes(ref(parent.storage, privateReservation.storagePath), new Uint8Array(1024), { contentType: "audio/mp4" });
  assert.equal((await parent.call("finalizePrivateTeamVoiceMessage", { reservationId: privateReservation.reservationId })).status, "sent");
  assert.equal((await parent.call("finalizePrivateTeamVoiceMessage", { reservationId: privateReservation.reservationId })).status, "alreadyFinalized");
  assert.equal((await db.collection("teamPrivateConversations").doc(first.conversationId).collection("messages").doc(privateReservation.targetId).get()).data().contentType, "voice");
  const privateNotificationId = `teamPrivateMessage_${first.conversationId}_${privateReservation.targetId}`;
  const privateNotification = (await db.collection("userNotifications").doc(coach.uid).collection("notifications").doc(privateNotificationId).get()).data();
  assert.equal(privateNotification.type, "teamPrivateMessage");
  assert.equal(JSON.stringify(privateNotification).includes("Private voice reply"), false, "private captions are excluded from notification records");

  const [audioExistsBeforeDelete] = await admin.storage().bucket().file(announcementReservation.storagePath).exists();
  assert.equal(audioExistsBeforeDelete, true);
  assert.equal((await coach.call("deleteTeamAnnouncement", { teamId: "team-1", announcementId: announcementReservation.targetId })).status, "deleted");
  const [audioExistsAfterDelete] = await admin.storage().bucket().file(announcementReservation.storagePath).exists();
  assert.equal(audioExistsAfterDelete, false, "deleting a voice announcement deletes its private audio object");
  assert.equal((await db.collection("teamVoiceUploadReservations").doc(announcementReservation.reservationId).get()).exists, false);

  const coachInbox = await coach.call("getTeamPrivateMessageInbox", { role: "coach" });
  const parentInbox = await parent.call("getTeamPrivateMessageInbox", { role: "parent", teamId: "team-1" });
  assert.equal(coachInbox.conversations.length, 1);
  assert.equal(parentInbox.conversations.length, 2);
  assert.equal(parentInbox.conversations.some((conversation) => conversation.conversationId === first.conversationId), true);
  await parent.call("markPrivateTeamConversationRead", { conversationId: first.conversationId });
  assert.equal((await db.collection("teamPrivateConversations").doc(first.conversationId).collection("members").doc(parent.uid).get()).data().unreadCount, 0);

  await db.collection("teams").doc("team-1").update({ status: "archived" });
  await assert.rejects(() => coach.call("sendPrivateTeamTextMessage", { conversationId: first.conversationId, text: "Blocked", clientMessageId: "client_003" }), hasCode("failed-precondition"));
  assert.equal((await db.collection("teamPrivateConversations").doc(first.conversationId).get()).data().status, "readOnly");
  console.log("Team Messages callable authorization, content safety/reporting, determinism, idempotency, reserved voice finalize, inbox, read state, and archived-team tests passed.");
}
async function waitForDocument(reference) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if ((await reference.get()).exists) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${reference.id}`);
}
run().catch((error) => { console.error(error); process.exit(1); });
