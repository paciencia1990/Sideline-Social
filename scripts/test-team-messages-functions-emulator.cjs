const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword } = require("firebase/auth");
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
function createUnauthenticatedClient(label) {
  const app = initializeApp({ apiKey: "demo-key", projectId }, label);
  const callableFunctions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(callableFunctions, "127.0.0.1", 5001);
  return { call: (name, data = {}) => httpsCallable(callableFunctions, name)(data).then((result) => result.data) };
}
async function createExistingClient(label, email) {
  const app = initializeApp({ apiKey: "demo-key", projectId }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const credential = await signInWithEmailAndPassword(auth, email, "ValidPass123!");
  const callableFunctions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(callableFunctions, "127.0.0.1", 5001);
  return {
    uid: credential.user.uid,
    call: (name, data = {}) => httpsCallable(callableFunctions, name)(data).then((result) => result.data),
  };
}
function hasCode(code) { return (error) => String(error?.code).includes(code); }

async function run() {
  const unauthenticated = createUnauthenticatedClient("team-unauthenticated");
  const [coach, parent, secondCoach, outsider, joannStaff, otherParent] = await Promise.all([
    "team-coach",
    "team-parent",
    "team-second-coach",
    "team-outsider",
    "team-joann-staff",
    "team-other-parent",
  ].map(createClient));
  await db.collection("teams").doc("team-1").set({ name: "Tigers", createdBy: coach.uid, coachIds: [coach.uid], parentIds: [parent.uid, joannStaff.uid, otherParent.uid], status: "active" });
  await Promise.all([
    db.collection("teams").doc("team-1").collection("members").doc(coach.uid).set({ userId: coach.uid, teamId: "team-1", status: "active", role: "coach", roles: { coach: true, parent: false, staff: false }, displayName: "Coach C." }),
    db.collection("teams").doc("team-1").collection("members").doc(parent.uid).set({ userId: parent.uid, teamId: "team-1", status: "active", role: "parent", roles: { coach: false, parent: true, staff: false }, displayName: "Parent P." }),
    db.collection("teams").doc("team-1").collection("members").doc(secondCoach.uid).set({ userId: secondCoach.uid, teamId: "team-1", status: "active", role: "coach", roles: { coach: true, parent: false, staff: false }, displayName: "Coach S." }),
    db.collection("teams").doc("team-1").collection("members").doc(joannStaff.uid).set({ userId: joannStaff.uid, teamId: "team-1", status: "active", role: "parent", roles: { coach: false, parent: true, staff: true }, displayName: "Staff J." }),
    db.collection("teams").doc("team-1").collection("members").doc(otherParent.uid).set({ userId: otherParent.uid, teamId: "team-1", status: "active", role: "parent", roles: { coach: false, parent: true, staff: false }, displayName: "Parent O." }),
    db.collection("teams").doc("team-1").collection("members").doc("staff-only-uid").set({ userId: "staff-only-uid", teamId: "team-1", status: "active", role: "assistantCoach", roles: { coach: false, parent: false, staff: true }, displayName: "Staff Only" }),
    db.collection("teams").doc("team-1").collection("members").doc("inactive-parent-uid").set({ userId: "inactive-parent-uid", teamId: "team-1", status: "removed", role: "parent", roles: { coach: false, parent: true, staff: false }, displayName: "Inactive Parent" }),
    db.collection("users").doc(parent.uid).collection("teamChildLinks").doc("team-1").set({ teamId: "team-1", childIds: ["child-parent"], status: "active" }),
    db.collection("users").doc(joannStaff.uid).collection("teamChildLinks").doc("team-1").set({ teamId: "team-1", childIds: ["child-joann"], status: "active" }),
    db.collection("users").doc(otherParent.uid).collection("teamChildLinks").doc("team-1").set({ teamId: "team-1", childIds: ["child-other"], status: "active" }),
    db.collection("users").doc(coach.uid).set({ coachTeamIds: ["team-1"] }, { merge: true }),
    db.collection("users").doc(parent.uid).set({ parentTeamIds: ["team-1"] }, { merge: true }),
  ]);
  await db.collection("teams").doc("team-2").set({ name: "Unrelated Team", createdBy: secondCoach.uid, status: "active" });
  await Promise.all([
    db.collection("teams").doc("team-2").collection("members").doc(secondCoach.uid).set({ userId: secondCoach.uid, teamId: "team-2", status: "active", role: "coach", roles: { coach: true, parent: false, staff: false }, displayName: "Coach S." }),
    db.collection("teams").doc("team-2").collection("members").doc(outsider.uid).set({ userId: outsider.uid, teamId: "team-2", status: "active", role: "parent", roles: { coach: false, parent: true, staff: false }, displayName: "Unrelated Parent" }),
    db.collection("users").doc(outsider.uid).collection("teamChildLinks").doc("team-2").set({ teamId: "team-2", childIds: ["unrelated-child"], status: "active" }),
  ]);

  const initialRecipientCounts = await coach.call("getTeamAnnouncementRecipientCounts", { teamId: "team-1" });
  assert.deepEqual(initialRecipientCounts.counts, { all: 5, staff: 3 });
  await assert.rejects(
    () => parent.call("getTeamAnnouncementRecipientCounts", { teamId: "team-1" }),
    hasCode("permission-denied"),
  );
  await db.collection("teams").doc("team-empty").set({ name: "Solo Coach", createdBy: coach.uid, status: "active" });
  await db.collection("teams").doc("team-empty").collection("members").doc(coach.uid).set({
    userId: coach.uid, teamId: "team-empty", status: "active", role: "coach",
    roles: { coach: true, parent: false, staff: false }, displayName: "Coach C.",
  });
  assert.deepEqual(
    (await coach.call("getTeamAnnouncementRecipientCounts", { teamId: "team-empty" })).counts,
    { all: 0, staff: 0 },
  );
  await assert.rejects(() => coach.call("createTeamAnnouncement", {
    teamId: "team-empty", title: "No recipients", body: "This must not be stored.", audience: "all", allowReplies: true,
  }), hasCode("failed-precondition"));
  assert.equal((await db.collection("teams").doc("team-empty").collection("announcements").get()).empty, true);

  const textAnnouncement = await coach.call("createTeamAnnouncement", {
    teamId: "team-1", title: "Practice update", body: "Practice starts at six.", audience: "all", allowReplies: true,
  });
  assert.equal(textAnnouncement.status, "created");
  const textAnnouncementData = (await db.collection("teams").doc("team-1").collection("announcements").doc(textAnnouncement.announcementId).get()).data();
  assert.equal(textAnnouncementData.createdBy, coach.uid);
  assert.equal(textAnnouncementData.recipientCount, 5);
  assert.deepEqual(
    [...textAnnouncementData.recipientUserIds].sort(),
    [parent.uid, secondCoach.uid, joannStaff.uid, otherParent.uid, "staff-only-uid"].sort(),
    "the stored audience snapshot exactly matches the preview and excludes the sender",
  );
  const staffAnnouncement = await coach.call("createTeamAnnouncement", {
    teamId: "team-1", title: "Staff update", body: "Staff-only coordination.", audience: "staff", allowReplies: false,
  });
  const staffAnnouncementData = (await db.collection("teams").doc("team-1").collection("announcements")
    .doc(staffAnnouncement.announcementId).get()).data();
  assert.equal(staffAnnouncementData.recipientCount, 3);
  assert.deepEqual(
    [...staffAnnouncementData.recipientUserIds].sort(),
    [secondCoach.uid, joannStaff.uid, "staff-only-uid"].sort(),
    "Staff delivery matches the preview and excludes parent-only members",
  );
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
    db.collection("users").doc(coach.uid).set({ displayName: "Coach C." }, { merge: true }),
    db.collection("users").doc(parent.uid).set({ displayName: "Parent P." }, { merge: true }),
    db.collection("users").doc(joannStaff.uid).set({ displayName: "Staff J." }, { merge: true }),
    db.collection("users").doc(otherParent.uid).set({ displayName: "Parent O." }, { merge: true }),
  ]);
  const parentReply = await parent.call("createTeamAnnouncementReply", {
    teamId: "team-1",
    announcementId: textAnnouncement.announcementId,
    body: "We will be there.",
    replyType: "team",
  });
  await assert.rejects(() => otherParent.call("deleteTeamAnnouncementReply", {
    teamId: "team-1",
    announcementId: textAnnouncement.announcementId,
    replyId: parentReply.reply.id,
  }), hasCode("permission-denied"));
  assert.equal((await parent.call("deleteTeamAnnouncementReply", {
    teamId: "team-1",
    announcementId: textAnnouncement.announcementId,
    replyId: parentReply.reply.id,
  })).deleted, true);
  assert.equal((await parent.call("deleteTeamAnnouncementReply", {
    teamId: "team-1",
    announcementId: textAnnouncement.announcementId,
    replyId: parentReply.reply.id,
  })).deleted, false, "repeated reply deletion is idempotent");
  const deletedReply = (await db.collection("teams").doc("team-1").collection("announcements")
    .doc(textAnnouncement.announcementId).collection("replies").doc(parentReply.reply.id).get()).data();
  assert.equal(deletedReply.isDeleted, true);
  assert.equal(deletedReply.body, null);
  assert.equal(deletedReply.deletedBy, parent.uid);
  await assert.rejects(() => otherParent.call("deleteTeamAnnouncement", {
    teamId: "team-1",
    announcementId: textAnnouncement.announcementId,
  }), hasCode("permission-denied"));
  assert.equal((await coach.call("deleteTeamAnnouncement", {
    teamId: "team-1",
    announcementId: textAnnouncement.announcementId,
  })).status, "deleted");
  assert.equal((await coach.call("deleteTeamAnnouncement", {
    teamId: "team-1",
    announcementId: textAnnouncement.announcementId,
  })).status, "alreadyDeleted", "repeated text announcement deletion is idempotent");
  const deletedTextAnnouncement = (await db.collection("teams").doc("team-1").collection("announcements")
    .doc(textAnnouncement.announcementId).get()).data();
  assert.equal(deletedTextAnnouncement.isDeleted, true);
  assert.equal(deletedTextAnnouncement.title, null);
  assert.equal(deletedTextAnnouncement.body, null);
  assert.equal(deletedTextAnnouncement.voiceMemo, null);
  assert.equal((await db.collection("teams").doc("team-1").collection("announcements")
    .doc(textAnnouncement.announcementId).collection("replies").doc(parentReply.reply.id).get()).exists, true);

  await assert.rejects(() => outsider.call("setTeamStaffRole", {
    teamId: "team-1", targetUserId: parent.uid, isStaff: true,
  }), hasCode("permission-denied"));
  await assert.rejects(() => parent.call("setTeamStaffRole", {
    teamId: "team-1", targetUserId: secondCoach.uid, isStaff: false,
  }), hasCode("permission-denied"));
  await assert.rejects(() => secondCoach.call("setTeamStaffRole", {
    teamId: "team-1", targetUserId: coach.uid, isStaff: false,
  }), hasCode("failed-precondition"));
  const promoted = await coach.call("setTeamStaffRole", {
    teamId: "team-1", targetUserId: parent.uid, isStaff: true,
  });
  assert.deepEqual(promoted.roles, { parent: true, coach: false, staff: true });
  assert.equal((await db.collection("teams").doc("team-1").collection("members").doc(parent.uid).get()).data().roles.staff, true);
  const repeatedPromotion = await coach.call("setTeamStaffRole", {
    teamId: "team-1", targetUserId: parent.uid, isStaff: true,
  });
  assert.equal(repeatedPromotion.roles.staff, true, "repeated promotion remains idempotent");
  const removed = await coach.call("setTeamStaffRole", {
    teamId: "team-1", targetUserId: parent.uid, isStaff: false,
  });
  assert.deepEqual(removed.roles, { parent: true, coach: false, staff: false });
  assert.equal(removed.role, "parent");
  const parentMembershipAfterRemoval = (await db.collection("teams").doc("team-1").collection("members").doc(parent.uid).get()).data();
  assert.equal(parentMembershipAfterRemoval.status, "active", "staff removal preserves active Team membership");
  assert.deepEqual(parentMembershipAfterRemoval.roles, { parent: true, coach: false, staff: false });
  const joannRemoved = await coach.call("setTeamStaffRole", {
    teamId: "team-1", targetUserId: joannStaff.uid, isStaff: false,
  });
  assert.deepEqual(joannRemoved.roles, { parent: true, coach: false, staff: false });
  const joannMembershipAfterRemoval = (await db.collection("teams").doc("team-1").collection("members").doc(joannStaff.uid).get()).data();
  assert.equal(joannMembershipAfterRemoval.userId, joannStaff.uid, "the second staff mutation targets Joann's distinct UID");
  assert.equal(joannMembershipAfterRemoval.status, "active", "the second staff removal preserves parent membership");
  assert.equal((await db.collection("teams").doc("team-1").collection("members").doc(secondCoach.uid).get()).data().roles.coach, true, "staff changes never alter coach authority");

  const eligibleParents = await coach.call("getEligiblePrivateTeamParents", { teamId: "team-1" });
  assert.deepEqual(
    eligibleParents.parents.map((entry) => entry.userId).sort(),
    [parent.uid, joannStaff.uid, otherParent.uid].sort(),
    "only active team parents with an authorized child relationship are returned",
  );
  await assert.rejects(
    () => outsider.call("getEligiblePrivateTeamParents", { teamId: "team-1" }),
    hasCode("permission-denied"),
  );

  const first = await coach.call("getOrCreatePrivateTeamConversation", { teamId: "team-1", parentUserId: parent.uid });
  const retry = await coach.call("getOrCreatePrivateTeamConversation", { teamId: "team-1", parentUserId: parent.uid });
  assert.equal(retry.conversationId, first.conversationId, "one deterministic conversation per coach-parent-team tuple");
  const secondCoachConversation = await secondCoach.call("getOrCreatePrivateTeamConversation", { teamId: "team-1", parentUserId: parent.uid });
  assert.notEqual(secondCoachConversation.conversationId, first.conversationId, "a different coach gets a separate private thread");
  await assert.rejects(() => secondCoach.call("markPrivateTeamConversationRead", { conversationId: first.conversationId }), hasCode("permission-denied"));
  await assert.rejects(() => parent.call("getOrCreatePrivateTeamConversation", { teamId: "team-1", parentUserId: outsider.uid }), hasCode("permission-denied"));
  await assert.rejects(() => outsider.call("getOrCreatePrivateTeamConversation", { teamId: "team-1", parentUserId: parent.uid }), hasCode("permission-denied"));
  const blockedConversation = await coach.call("getOrCreatePrivateTeamConversation", { teamId: "team-1", parentUserId: otherParent.uid });
  await db.collection("userBlocks").doc(coach.uid).collection("blockedUsers").doc(otherParent.uid).set({
    blockerUserId: coach.uid,
    blockedUserId: otherParent.uid,
    status: "active",
  });
  await assert.rejects(
    () => coach.call("sendPrivateTeamTextMessage", {
      conversationId: blockedConversation.conversationId,
      text: "This must not send",
      clientMessageId: "blocked_private_001",
    }),
    hasCode("failed-precondition"),
  );
  await assert.rejects(
    () => coach.call("getOrCreatePrivateTeamConversation", { teamId: "team-1", parentUserId: otherParent.uid }),
    hasCode("permission-denied"),
  );
  assert.equal(
    (await coach.call("getEligiblePrivateTeamParents", { teamId: "team-1" })).parents
      .some((entry) => entry.userId === otherParent.uid),
    false,
    "blocked relationships are removed from the picker",
  );

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
  await assert.rejects(
    () => unauthenticated.call("hidePrivateTeamMessageForCurrentUser", {
      conversationId: first.conversationId,
      messageId: sent.messageId,
    }),
    hasCode("unauthenticated"),
  );
  await assert.rejects(
    () => outsider.call("hidePrivateTeamMessageForCurrentUser", {
      conversationId: first.conversationId,
      messageId: sent.messageId,
    }),
    hasCode("permission-denied"),
  );
  await assert.rejects(
    () => coach.call("hidePrivateTeamMessageForCurrentUser", {
      conversationId: first.conversationId,
      messageId: sent.messageId,
    }),
    hasCode("permission-denied"),
  );
  assert.equal((await parent.call("hidePrivateTeamMessageForCurrentUser", {
    conversationId: first.conversationId,
    messageId: sent.messageId,
    targetUserId: outsider.uid,
  })).status, "hidden");
  assert.equal((await parent.call("hidePrivateTeamMessageForCurrentUser", {
    conversationId: first.conversationId,
    messageId: sent.messageId,
  })).status, "alreadyHidden", "repeated receiver hiding is idempotent");
  const hiddenTextRef = db.collection("teamPrivateConversations").doc(first.conversationId)
    .collection("members").doc(parent.uid).collection("hiddenMessages").doc(sent.messageId);
  assert.equal((await hiddenTextRef.get()).exists, true, "receiver visibility persists in Firestore");
  const parentSecondDevice = await createExistingClient("team-parent-second-device", "team-parent@example.test");
  assert.equal(parentSecondDevice.uid, parent.uid);
  assert.equal((await parentSecondDevice.call("hidePrivateTeamMessageForCurrentUser", {
    conversationId: first.conversationId,
    messageId: sent.messageId,
  })).status, "alreadyHidden", "hidden state persists in a fresh authenticated app session");
  assert.equal((await db.collection("teamPrivateConversations").doc(first.conversationId)
    .collection("members").doc(outsider.uid).collection("hiddenMessages").doc(sent.messageId).get()).exists, false, "client target UID is ignored");
  const textAfterReceiverHide = (await db.collection("teamPrivateConversations").doc(first.conversationId)
    .collection("messages").doc(sent.messageId).get()).data();
  assert.equal(textAfterReceiverHide.text, "Private hello", "receiver hiding does not mutate canonical content");
  const parentAfterTextHide = (await db.collection("teamPrivateConversations").doc(first.conversationId)
    .collection("members").doc(parent.uid).get()).data();
  assert.equal(parentAfterTextHide.lastVisibleMessagePreview, "Private reply");
  assert.equal(parentAfterTextHide.unreadCount, 0, "hidden incoming text no longer contributes to unread");
  await assert.rejects(
    () => parent.call("deletePrivateTeamMessage", {
      conversationId: first.conversationId,
      messageId: sent.messageId,
      senderUserId: coach.uid,
    }),
    hasCode("permission-denied"),
  );
  await assert.rejects(
    () => unauthenticated.call("deletePrivateTeamMessage", {
      conversationId: first.conversationId,
      messageId: sent.messageId,
    }),
    hasCode("unauthenticated"),
  );
  assert.equal((await coach.call("deletePrivateTeamMessage", {
    conversationId: first.conversationId,
    messageId: sent.messageId,
  })).status, "deleted");
  assert.equal((await coach.call("deletePrivateTeamMessage", {
    conversationId: first.conversationId,
    messageId: sent.messageId,
  })).status, "alreadyDeleted", "repeated private text deletion is idempotent");
  const deletedPrivateText = (await db.collection("teamPrivateConversations").doc(first.conversationId)
    .collection("messages").doc(sent.messageId).get()).data();
  assert.equal(deletedPrivateText.isDeleted, true);
  assert.equal(deletedPrivateText.deletedBy, coach.uid);
  assert.equal(deletedPrivateText.text, null);
  assert.equal(deletedPrivateText.caption, null);
  assert.equal(deletedPrivateText.voiceMemo, null);

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
  assert.equal(JSON.stringify(storedAnnouncement).includes("file://"), false, "persisted announcements never retain the local draft URI");
  const announcementPlaybackRequest = {
    messageId: announcementReservation.targetId,
    messageKind: "announcement",
    storagePath: announcementReservation.storagePath,
  };
  let announcementPlaybackUrl;
  for (const authorized of [coach, parent, joannStaff]) {
    const playback = await authorized.call("getTeamVoiceMemoDownloadUrl", announcementPlaybackRequest);
    assert.equal(typeof playback.url, "string");
    assert.equal(playback.expiresAtMillis > Date.now(), true);
    announcementPlaybackUrl ??= playback.url;
  }
  const announcementAudio = await fetch(announcementPlaybackUrl);
  assert.equal(announcementAudio.ok, true, "authorized announcement URL returns the stored audio bytes");
  assert.equal(announcementAudio.headers.get("content-type"), "audio/mp4");
  assert.equal((await announcementAudio.arrayBuffer()).byteLength, 1024);
  await assert.rejects(
    () => outsider.call("getTeamVoiceMemoDownloadUrl", announcementPlaybackRequest),
    hasCode("permission-denied"),
  );
  await assert.rejects(
    () => unauthenticated.call("getTeamVoiceMemoDownloadUrl", announcementPlaybackRequest),
    hasCode("unauthenticated"),
  );
  await assert.rejects(
    () => coach.call("getTeamVoiceMemoDownloadUrl", {
      ...announcementPlaybackRequest,
      storagePath: "teamVoiceMemos/team-1/announcements/arbitrary/reservation/memo.m4a",
    }),
    hasCode("not-found"),
  );
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
  const storedPrivateMessage = (await db.collection("teamPrivateConversations").doc(first.conversationId).collection("messages").doc(privateReservation.targetId).get()).data();
  assert.equal(storedPrivateMessage.contentType, "voice");
  assert.equal(storedPrivateMessage.voiceMemo.storagePath, privateReservation.storagePath);
  assert.equal(JSON.stringify(storedPrivateMessage).includes("file://"), false, "persisted private messages never retain the local draft URI");
  const privatePlaybackRequest = {
    messageId: privateReservation.targetId,
    messageKind: "privateMessage",
    storagePath: privateReservation.storagePath,
  };
  let privatePlaybackUrl;
  for (const authorized of [parent, coach]) {
    const playback = await authorized.call("getTeamVoiceMemoDownloadUrl", privatePlaybackRequest);
    assert.equal(typeof playback.url, "string");
    assert.equal(playback.expiresAtMillis > Date.now(), true);
    privatePlaybackUrl ??= playback.url;
  }
  const privateAudio = await fetch(privatePlaybackUrl);
  assert.equal(privateAudio.ok, true, "authorized private URL returns the stored audio bytes");
  assert.equal(privateAudio.headers.get("content-type"), "audio/mp4");
  assert.equal((await privateAudio.arrayBuffer()).byteLength, 1024);
  await assert.rejects(
    () => joannStaff.call("getTeamVoiceMemoDownloadUrl", privatePlaybackRequest),
    hasCode("permission-denied"),
  );
  await assert.rejects(
    () => outsider.call("getTeamVoiceMemoDownloadUrl", privatePlaybackRequest),
    hasCode("permission-denied"),
  );
  await assert.rejects(
    () => parent.call("getTeamVoiceMemoDownloadUrl", { ...privatePlaybackRequest, messageId: "another-message" }),
    hasCode("not-found"),
  );

  const coachVoiceReservation = await coach.call("createTeamVoiceMemoUpload", {
    teamId: "team-1", kind: "privateMessage", conversationId: first.conversationId,
    clientMessageId: "voice_client_coach_001", caption: "Coach voice reply", voiceMemo,
  });
  await uploadBytes(ref(coach.storage, coachVoiceReservation.storagePath), new Uint8Array(1024), { contentType: "audio/mp4" });
  await coach.call("finalizePrivateTeamVoiceMessage", { reservationId: coachVoiceReservation.reservationId });
  const coachVoicePlaybackRequest = {
    messageId: coachVoiceReservation.targetId,
    messageKind: "privateMessage",
    storagePath: coachVoiceReservation.storagePath,
  };
  await coach.call("getTeamVoiceMemoDownloadUrl", coachVoicePlaybackRequest);
  await parent.call("getTeamVoiceMemoDownloadUrl", coachVoicePlaybackRequest);
  const hiddenPlaybackToken = "b".repeat(64);
  const hiddenPlaybackGrantId = createHash("sha256").update(hiddenPlaybackToken).digest("hex");
  await db.collection("teamVoicePlaybackGrants").doc(hiddenPlaybackGrantId).set({
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60_000),
    messageId: coachVoiceReservation.targetId,
    messageKind: "privateMessage",
    storagePath: coachVoiceReservation.storagePath,
    userId: parent.uid,
  });
  assert.equal((await fetch(
    `http://127.0.0.1:5001/${projectId}/us-central1/streamTeamVoiceMemo?grant=${hiddenPlaybackToken}`,
  )).status, 200, "receiver grant works before hiding");
  assert.equal((await parent.call("hidePrivateTeamMessageForCurrentUser", {
    conversationId: first.conversationId,
    messageId: coachVoiceReservation.targetId,
  })).status, "hidden");
  assert.equal((await parent.call("hidePrivateTeamMessageForCurrentUser", {
    conversationId: first.conversationId,
    messageId: coachVoiceReservation.targetId,
  })).status, "alreadyHidden");
  const canonicalCoachVoice = (await db.collection("teamPrivateConversations").doc(first.conversationId)
    .collection("messages").doc(coachVoiceReservation.targetId).get()).data();
  assert.equal(canonicalCoachVoice.voiceMemo.storagePath, coachVoiceReservation.storagePath);
  assert.equal((await admin.storage().bucket().file(coachVoiceReservation.storagePath).exists())[0], true, "Delete for Me preserves server Storage");
  await coach.call("getTeamVoiceMemoDownloadUrl", coachVoicePlaybackRequest);
  await assert.rejects(
    () => parent.call("getTeamVoiceMemoDownloadUrl", coachVoicePlaybackRequest),
    hasCode("permission-denied"),
  );
  assert.equal((await fetch(
    `http://127.0.0.1:5001/${projectId}/us-central1/streamTeamVoiceMemo?grant=${hiddenPlaybackToken}`,
  )).status, 404, "hiding revokes the receiver's already-issued production playback grant");
  const privateNotificationId = `teamPrivateMessage_${first.conversationId}_${privateReservation.targetId}`;
  const privateNotification = (await db.collection("userNotifications").doc(coach.uid).collection("notifications").doc(privateNotificationId).get()).data();
  assert.equal(privateNotification.type, "teamPrivateMessage");
  assert.equal(JSON.stringify(privateNotification).includes("Private voice reply"), false, "private captions are excluded from notification records");

  const playbackGrantToken = "a".repeat(64);
  const playbackGrantId = createHash("sha256").update(playbackGrantToken).digest("hex");
  await db.collection("teamVoicePlaybackGrants").doc(playbackGrantId).set({
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60_000),
    messageId: privateReservation.targetId,
    messageKind: "privateMessage",
    storagePath: privateReservation.storagePath,
    userId: coach.uid,
  });
  const streamedPrivateAudio = await fetch(
    `http://127.0.0.1:5001/${projectId}/us-central1/streamTeamVoiceMemo?grant=${playbackGrantToken}`,
    { headers: { Range: "bytes=0-15" } },
  );
  assert.equal(streamedPrivateAudio.status, 206, "authorized media grants support physical-player byte ranges");
  assert.equal(streamedPrivateAudio.headers.get("content-type"), "audio/mp4");
  assert.equal((await streamedPrivateAudio.arrayBuffer()).byteLength, 16);

  await assert.rejects(() => coach.call("deletePrivateTeamMessage", {
    conversationId: first.conversationId,
    messageId: privateReservation.targetId,
  }), hasCode("permission-denied"));
  assert.equal((await parent.call("deletePrivateTeamMessage", {
    conversationId: first.conversationId,
    messageId: privateReservation.targetId,
  })).status, "deleted");
  assert.equal((await parent.call("deletePrivateTeamMessage", {
    conversationId: first.conversationId,
    messageId: privateReservation.targetId,
  })).status, "alreadyDeleted");
  const deletedPrivateVoice = (await db.collection("teamPrivateConversations").doc(first.conversationId)
    .collection("messages").doc(privateReservation.targetId).get()).data();
  assert.equal(deletedPrivateVoice.isDeleted, true);
  assert.equal(deletedPrivateVoice.caption, null);
  assert.equal(deletedPrivateVoice.voiceMemo, null);
  assert.equal((await admin.storage().bucket().file(privateReservation.storagePath).exists())[0], false);
  await assert.rejects(
    () => coach.call("getTeamVoiceMemoDownloadUrl", privatePlaybackRequest),
    hasCode("not-found"),
  );
  assert.equal((await fetch(
    `http://127.0.0.1:5001/${projectId}/us-central1/streamTeamVoiceMemo?grant=${playbackGrantToken}`,
  )).status, 404, "an issued media grant is revoked by the message tombstone");

  assert.equal((await coach.call("deletePrivateTeamMessage", {
    conversationId: first.conversationId,
    messageId: coachVoiceReservation.targetId,
  })).status, "deleted");
  assert.equal((await coach.call("deletePrivateTeamMessage", {
    conversationId: first.conversationId,
    messageId: coachVoiceReservation.targetId,
  })).status, "alreadyDeleted", "global deletion remains idempotent after receiver hiding");
  assert.equal((await admin.storage().bucket().file(coachVoiceReservation.storagePath).exists())[0], false, "sender Delete for Everyone removes server Storage after receiver hiding");
  const conversationAfterLatestDelete = (await db.collection("teamPrivateConversations")
    .doc(first.conversationId).get()).data();
  assert.equal(conversationAfterLatestDelete.lastMessageType, "text");
  assert.equal(conversationAfterLatestDelete.lastMessagePreview, "Private reply");
  assert.equal(conversationAfterLatestDelete.lastSenderUserId, parent.uid);
  for (const userId of [coach.uid, parent.uid]) {
    const memberPreview = (await db.collection("teamPrivateConversations").doc(first.conversationId)
      .collection("members").doc(userId).get()).data();
    assert.equal(memberPreview.lastVisibleMessagePreview, "Private reply");
    assert.equal(memberPreview.lastVisibleMessageType, "text");
    assert.equal(memberPreview.lastVisibleSenderUserId, parent.uid);
  }

  const [audioExistsBeforeDelete] = await admin.storage().bucket().file(announcementReservation.storagePath).exists();
  assert.equal(audioExistsBeforeDelete, true);
  assert.equal((await coach.call("deleteTeamAnnouncement", { teamId: "team-1", announcementId: announcementReservation.targetId })).status, "deleted");
  const [audioExistsAfterDelete] = await admin.storage().bucket().file(announcementReservation.storagePath).exists();
  assert.equal(audioExistsAfterDelete, false, "deleting a voice announcement deletes its private audio object");
  assert.equal((await db.collection("teamVoiceUploadReservations").doc(announcementReservation.reservationId).get()).exists, false);
  const deletedVoiceAnnouncement = (await db.collection("teams").doc("team-1").collection("announcements")
    .doc(announcementReservation.targetId).get()).data();
  assert.equal(deletedVoiceAnnouncement.isDeleted, true);
  assert.equal(deletedVoiceAnnouncement.title, null);
  assert.equal(deletedVoiceAnnouncement.body, null);
  assert.equal(deletedVoiceAnnouncement.voiceMemo, null);
  await assert.rejects(
    () => parent.call("getTeamVoiceMemoDownloadUrl", announcementPlaybackRequest),
    hasCode("not-found"),
  );

  const coachInbox = await coach.call("getTeamPrivateMessageInbox", { role: "coach" });
  const parentInbox = await parent.call("getTeamPrivateMessageInbox", { role: "parent", teamId: "team-1" });
  assert.equal(coachInbox.conversations.length, 1);
  assert.equal(coachInbox.conversations.some((conversation) => conversation.conversationId === first.conversationId), true);
  assert.equal(coachInbox.conversations.some((conversation) => conversation.conversationId === blockedConversation.conversationId), false, "read-only blocked conversations stay out of the active coach inbox");
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
