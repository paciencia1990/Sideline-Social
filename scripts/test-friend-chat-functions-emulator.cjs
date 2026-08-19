const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } = require("firebase/auth");
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require("firebase/functions");
const { connectStorageEmulator, getStorage, ref, uploadBytes } = require("firebase/storage");

const projectId = process.env.GCLOUD_PROJECT || "sideline-friend-chat-functions-test";
if (!admin.apps.length) admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const db = admin.firestore();
const bucket = admin.storage().bucket();

async function createClient(label) {
  const app = initializeApp({ apiKey: "demo-key", projectId }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const credential = await createUserWithEmailAndPassword(auth, `${label}@example.test`, "ValidPass123!");
  const callableFunctions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(callableFunctions, "127.0.0.1", 5001);
  const storage = getStorage(app, `gs://${projectId}.appspot.com`);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  return { call: (name, data = {}) => httpsCallable(callableFunctions, name)(data).then((result) => result.data), storage, uid: credential.user.uid };
}
function hasCode(code) { return (error) => String(error?.code).includes(code); }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function mediaRateDocId(uid) { return createHash("sha256").update(uid).digest("hex"); }
function forwardRateDocId(uid) { return createHash("sha256").update(uid).digest("hex"); }
function syntheticJpeg(width, height) {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
    0x00, 0xff, 0xd9,
  ]);
}
async function ageMediaReservationRateLimit(uid) {
  await db.collection("friendChatMediaReservationRateLimits").doc(mediaRateDocId(uid)).set({
    lastReservationCreatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 11_000),
  }, { merge: true });
}
async function ageForwardRateLimit(uid) {
  await db.collection("friendChatForwardRateLimits").doc(forwardRateDocId(uid)).set({
    lastForwardAt: admin.firestore.Timestamp.fromMillis(Date.now() - 6_000),
  }, { merge: true });
}
async function ageDestinationSendRateLimit(conversationId, uid) {
  await db.collection("friendConversations").doc(conversationId).collection("members").doc(uid).set({
    lastSentAt: admin.firestore.Timestamp.fromMillis(Date.now() - 2_000),
  }, { merge: true });
}

async function run() {
  const [a, b, c, outsider] = await Promise.all(["chat-a", "chat-b", "chat-c", "chat-outsider"].map(createClient));
  await Promise.all([
    db.collection("users").doc(a.uid).set({ displayName: "Alex Anderson", friendIds: [b.uid, c.uid] }),
    db.collection("users").doc(b.uid).set({ displayName: "Bailey Brown", friendIds: [a.uid] }),
    db.collection("users").doc(c.uid).set({ displayName: "Casey Carter", friendIds: [a.uid] }),
    db.collection("users").doc(outsider.uid).set({ displayName: "Other Olson", friendIds: [] }),
  ]);

  const direct = await a.call("createOrOpenDirectConversation", { friendUserId: b.uid });
  assert.equal(direct.status, "created");
  assert.equal((await b.call("createOrOpenDirectConversation", { friendUserId: a.uid })).conversationId, direct.conversationId, "direct conversation is deterministic");
  await assert.rejects(() => outsider.call("createOrOpenDirectConversation", { friendUserId: a.uid }), hasCode("permission-denied"));

  const firstDirect = await a.call("sendFriendChatMessage", { conversationId: direct.conversationId, text: "Hello friend", clientMessageId: "direct_message_001" });
  assert.equal(firstDirect.status, "sent");
  assert.equal((await a.call("sendFriendChatMessage", { conversationId: direct.conversationId, text: "Hello friend", clientMessageId: "direct_message_001" })).status, "alreadySent", "retry is idempotent");
  await assert.rejects(() => a.call("sendFriendChatMessage", { conversationId: direct.conversationId, text: "Too fast", clientMessageId: "direct_message_002" }), hasCode("resource-exhausted"));
  await assert.rejects(() => outsider.call("sendFriendChatMessage", { conversationId: direct.conversationId, text: "Injected", clientMessageId: "outside_message_01" }), hasCode("permission-denied"));

  const group = await a.call("createFriendGroupConversation", { friendUserIds: [b.uid, c.uid], groupName: "Weekend Crew" });
  assert.equal(group.invitedCount, 2);
  const groupDoc = db.collection("friendConversations").doc(group.conversationId);
  assert.deepEqual((await groupDoc.get()).data().activeParticipantIds, [a.uid]);
  assert.equal((await b.call("respondToFriendGroupInvitation", { conversationId: group.conversationId, response: "accept" })).status, "accepted");
  assert.equal((await b.call("respondToFriendGroupInvitation", { conversationId: group.conversationId, response: "accept" })).alreadyResponded, true);
  assert.equal((await c.call("respondToFriendGroupInvitation", { conversationId: group.conversationId, response: "decline" })).status, "declined");
  assert.deepEqual(new Set((await groupDoc.get()).data().activeParticipantIds), new Set([a.uid, b.uid]));
  await assert.rejects(() => b.call("renameFriendGroupConversation", { conversationId: group.conversationId, groupName: "Nope" }), hasCode("permission-denied"));
  await a.call("renameFriendGroupConversation", { conversationId: group.conversationId, groupName: "Saturday Crew" });
  await a.call("setFriendGroupAdminRole", { conversationId: group.conversationId, memberUserId: b.uid, makeAdmin: true });
  assert.equal((await groupDoc.collection("members").doc(b.uid).get()).data().role, "admin");

  const groupMessage = await a.call("sendFriendChatMessage", { conversationId: group.conversationId, text: "Welcome to the group", clientMessageId: "group_message_001" });
  assert.equal((await b.call("toggleFriendChatReaction", { conversationId: group.conversationId, messageId: groupMessage.messageId, emoji: "👍" })).updated, true);
  let reactedMessage = (await groupDoc.collection("messages").doc(groupMessage.messageId).get()).data();
  assert.deepEqual(reactedMessage.reactionCounts, { "👍": 1 });
  assert.equal((await groupDoc.collection("messages").doc(groupMessage.messageId).collection("reactions").doc(b.uid).get()).data().emoji, "👍");
  await b.call("toggleFriendChatReaction", { conversationId: group.conversationId, messageId: groupMessage.messageId, emoji: "❤️" });
  reactedMessage = (await groupDoc.collection("messages").doc(groupMessage.messageId).get()).data();
  assert.deepEqual(reactedMessage.reactionCounts, { "❤️": 1 }, "reaction changes are counted without unbounded arrays");
  await b.call("toggleFriendChatReaction", { conversationId: group.conversationId, messageId: groupMessage.messageId, emoji: "❤️" });
  reactedMessage = (await groupDoc.collection("messages").doc(groupMessage.messageId).get()).data();
  assert.deepEqual(reactedMessage.reactionCounts, {}, "tapping the same reaction removes it");
  await assert.rejects(() => outsider.call("toggleFriendChatReaction", { conversationId: group.conversationId, messageId: groupMessage.messageId, emoji: "👍" }), hasCode("permission-denied"));
  await assert.rejects(() => b.call("toggleFriendChatReaction", { conversationId: group.conversationId, messageId: groupMessage.messageId, emoji: "💩" }), hasCode("invalid-argument"));
  assert.equal((await b.call("setFriendChatMessagesStarred", { conversationId: group.conversationId, messageIds: [groupMessage.messageId], starred: true })).updated, 1);
  assert.equal((await groupDoc.collection("userMessageStates").doc(b.uid).collection("messages").doc(groupMessage.messageId).get()).data().starred, true);
  assert.equal((await b.call("setFriendChatMessagesStarred", { conversationId: group.conversationId, messageIds: [groupMessage.messageId], starred: false })).updated, 1);
  assert.equal((await groupDoc.collection("userMessageStates").doc(b.uid).collection("messages").doc(groupMessage.messageId).get()).data().starred, false);
  const reply = await b.call("sendFriendChatMessage", { conversationId: group.conversationId, text: "Replying with context", clientMessageId: "group_reply_001", replyToMessageId: groupMessage.messageId });
  assert.equal((await groupDoc.collection("messages").doc(reply.messageId).get()).data().replyTo.messageId, groupMessage.messageId);
  await a.call("pinFriendChatMessage", { conversationId: group.conversationId, messageId: groupMessage.messageId, duration: "7d" });
  assert.equal((await groupDoc.get()).data().pinnedMessage.messageId, groupMessage.messageId);
  await b.call("unpinFriendChatMessage", { conversationId: group.conversationId, messageId: groupMessage.messageId });
  assert.equal((await groupDoc.get()).data().pinnedMessage, undefined);
  await ageDestinationSendRateLimit(direct.conversationId, a.uid);
  const textForwardInput = {
    clientForwardId: "forward_text_operation_001",
    conversationId: group.conversationId,
    destinationConversationIds: [direct.conversationId],
    messageIds: [groupMessage.messageId],
  };
  assert.equal((await a.call("forwardFriendChatMessages", textForwardInput)).forwarded, 1);
  const forwardedMessages = await db.collection("friendConversations").doc(direct.conversationId).collection("messages").where("forwarded", "==", true).get();
  assert.equal(forwardedMessages.size, 1);
  assert.equal(forwardedMessages.docs[0].data().text, "Welcome to the group");
  assert.equal(forwardedMessages.docs[0].data().forwardedFrom.messageType, "text");
  assert.equal((await a.call("forwardFriendChatMessages", textForwardInput)).forwarded, 1, "the same forward operation is idempotent");
  assert.equal((await db.collection("friendConversations").doc(direct.conversationId).collection("messages").where("forwarded", "==", true).get()).size, 1, "an idempotent retry does not duplicate the message");
  await assert.rejects(() => a.call("forwardFriendChatMessages", {
    ...textForwardInput,
    clientForwardId: "forward_text_operation_002",
  }), hasCode("resource-exhausted"));
  await ageForwardRateLimit(a.uid);
  await ageDestinationSendRateLimit(direct.conversationId, a.uid);
  assert.equal((await a.call("forwardFriendChatMessages", {
    conversationId: group.conversationId,
    destinationConversationIds: [direct.conversationId],
    messageIds: [reply.messageId],
  })).forwarded, 1, "installed clients without operation IDs retain legacy forwarding compatibility");
  const messageReport = await b.call("reportFriendChatMessage", {
    conversationId: group.conversationId,
    messageId: groupMessage.messageId,
    reason: "offensive",
  });
  assert.equal(messageReport.reported, true);
  assert.equal((await db.collection("chatModerationReports").doc(messageReport.reportId).get()).data().reason, "offensive");
  assert.equal((await b.call("deleteFriendChatMessagesForMe", { conversationId: group.conversationId, messageIds: [groupMessage.messageId] })).hidden, 1);
  assert.equal((await groupDoc.collection("userMessageStates").doc(b.uid).collection("messages").doc(groupMessage.messageId).get()).data().hiddenForMe, true);
  await assert.rejects(() => outsider.call("deleteFriendChatMessagesForMe", { conversationId: group.conversationId, messageIds: [groupMessage.messageId] }), hasCode("permission-denied"));
  await a.call("pinFriendChatMessage", { conversationId: group.conversationId, messageId: groupMessage.messageId, duration: "7d" });
  await b.call("toggleFriendChatReaction", { conversationId: group.conversationId, messageId: groupMessage.messageId, emoji: "👍" });
  await assert.rejects(() => a.call("removeOwnFriendChatMessage", { conversationId: direct.conversationId, messageId: groupMessage.messageId }), hasCode("permission-denied"), "a sender cannot remove a message through another conversation path");
  await a.call("removeOwnFriendChatMessage", { conversationId: group.conversationId, messageId: groupMessage.messageId });
  const removed = (await groupDoc.collection("messages").doc(groupMessage.messageId).get()).data();
  assert.equal(removed.status, "removed"); assert.equal(removed.text, "");
  assert.equal(removed.moderationEvidenceRetained, true, "a reported message records its retention requirement before deletion");
  assert.equal((await groupDoc.get()).data().pinnedMessage, undefined, "deleting a pinned message clears the shared pin");
  assert.equal((await groupDoc.collection("messages").doc(groupMessage.messageId).collection("reactions").get()).empty, true, "deleting for everyone clears reaction documents");
  assert.equal((await groupDoc.collection("userMessageStates").doc(b.uid).collection("messages").doc(groupMessage.messageId).get()).exists, false, "deleting for everyone clears private stars and hidden state");
  assert.equal((await groupDoc.collection("messages").doc(reply.messageId).get()).data().replyTo.textExcerpt, null, "reply previews cannot retain deleted content");
  await assert.rejects(() => b.call("removeOwnFriendChatMessage", { conversationId: group.conversationId, messageId: groupMessage.messageId }), hasCode("permission-denied"));
  await assert.rejects(() => b.call("toggleFriendChatReaction", { conversationId: group.conversationId, messageId: groupMessage.messageId, emoji: "👍" }), hasCode("permission-denied"));

  await wait(800);
  const imageBytes = new Uint8Array(4096);
  const thumbnailBytes = new Uint8Array(1024);
  const imageReservation = await a.call("createFriendChatImageUpload", {
    caption: "Post-game photo",
    clientMessageId: "group_image_001",
    conversationId: group.conversationId,
    image: {
      main: { height: 900, mimeType: "image/jpeg", sizeBytes: imageBytes.byteLength, width: 1600 },
      sourceMimeType: "image/png",
      sourceSizeBytes: 4096,
      thumbnail: { height: 288, mimeType: "image/jpeg", sizeBytes: thumbnailBytes.byteLength, width: 512 },
    },
  });
  assert.equal((await a.call("createFriendChatImageUpload", {
    caption: "Post-game photo",
    clientMessageId: "group_image_001",
    conversationId: group.conversationId,
    image: {
      main: { height: 900, mimeType: "image/jpeg", sizeBytes: imageBytes.byteLength, width: 1600 },
      sourceMimeType: "image/png",
      sourceSizeBytes: 4096,
      thumbnail: { height: 288, mimeType: "image/jpeg", sizeBytes: thumbnailBytes.byteLength, width: 512 },
    },
  })).reservationId, imageReservation.reservationId, "image upload reservation retries are idempotent");
  await assert.rejects(() => a.call("createFriendChatVoiceUpload", {
    caption: "Trying to switch types",
    clientMessageId: "group_voice_rate_limited_a",
    conversationId: group.conversationId,
    voiceMemo: { durationMilliseconds: 10_000, mimeType: "audio/mp4", sizeBytes: 256 },
  }), hasCode("resource-exhausted"), "immediate image-to-voice reservation switching is rate-limited");
  const bFirstMediaReservation = await b.call("createFriendChatVoiceUpload", {
    caption: "Independent user media",
    clientMessageId: "group_voice_rate_seed_b",
    conversationId: group.conversationId,
    voiceMemo: { durationMilliseconds: 10_000, mimeType: "audio/mp4", sizeBytes: 256 },
  });
  assert.equal((await b.call("createFriendChatVoiceUpload", {
    caption: "Independent user media",
    clientMessageId: "group_voice_rate_seed_b",
    conversationId: group.conversationId,
    voiceMemo: { durationMilliseconds: 10_000, mimeType: "audio/mp4", sizeBytes: 256 },
  })).reservationId, bFirstMediaReservation.reservationId, "same media reservation retry stays idempotent while the throttle is active");
  await ageMediaReservationRateLimit(a.uid);
  const afterCooldownReservation = await a.call("createFriendChatVoiceUpload", {
    caption: "After cooldown",
    clientMessageId: "group_voice_after_cooldown_a",
    conversationId: group.conversationId,
    voiceMemo: { durationMilliseconds: 10_000, mimeType: "audio/mp4", sizeBytes: 256 },
  });
  assert.match(afterCooldownReservation.reservationId, /^media_[a-f0-9]{64}$/u, "media reservations work again after cooldown");
  await uploadBytes(ref(a.storage, imageReservation.fullPath), imageBytes, { contentType: "image/jpeg" });
  await uploadBytes(ref(a.storage, imageReservation.thumbnailPath), thumbnailBytes, { contentType: "image/jpeg" });
  const imageFinalize = await a.call("finalizeFriendChatImageMessage", { reservationId: imageReservation.reservationId });
  assert.equal(imageFinalize.status, "sent");
  assert.equal((await a.call("finalizeFriendChatImageMessage", { reservationId: imageReservation.reservationId })).status, "alreadyFinalized");
  const imageMessage = (await groupDoc.collection("messages").doc(imageFinalize.messageId).get()).data();
  assert.equal(imageMessage.messageType, "image");
  assert.equal(imageMessage.caption, "Post-game photo");
  assert.equal(imageMessage.image.fullPath, imageReservation.fullPath);
  assert.equal(imageMessage.image.thumbnailPath, imageReservation.thumbnailPath);
  assert.deepEqual(imageMessage.mediaStoragePaths, [imageReservation.fullPath, imageReservation.thumbnailPath]);
  await assert.rejects(() => a.call("createFriendChatImageUpload", {
    clientMessageId: "group_image_unknown_profile",
    conversationId: group.conversationId,
    image: {
      main: { height: 1080, mimeType: "image/jpeg", sizeBytes: 1000, width: 1440 },
      mediaProfileVersion: 99,
      sourceMimeType: "image/jpeg",
      sourceSizeBytes: 2000,
      thumbnail: { height: 360, mimeType: "image/jpeg", sizeBytes: 500, width: 480 },
    },
  }), hasCode("invalid-argument"), "unknown image profiles are rejected before reservation");
  await ageMediaReservationRateLimit(a.uid);
  const v2FullBytes = syntheticJpeg(1440, 1080);
  const v2ThumbnailBytes = syntheticJpeg(480, 360);
  const v2Reservation = await a.call("createFriendChatImageUpload", {
    caption: "Version two photo",
    clientMessageId: "group_image_v2_001",
    conversationId: group.conversationId,
    image: {
      main: { height: 1080, mimeType: "image/jpeg", sizeBytes: v2FullBytes.byteLength, width: 1440 },
      mediaProfileVersion: 2,
      sourceMimeType: "image/heic",
      sourceSizeBytes: 4096,
      thumbnail: { height: 360, mimeType: "image/jpeg", sizeBytes: v2ThumbnailBytes.byteLength, width: 480 },
    },
  });
  await uploadBytes(ref(a.storage, v2Reservation.fullPath), v2FullBytes, { contentType: "image/jpeg" });
  await uploadBytes(ref(a.storage, v2Reservation.thumbnailPath), v2ThumbnailBytes, { contentType: "image/jpeg" });
  await wait(800);
  const v2Finalize = await a.call("finalizeFriendChatImageMessage", { reservationId: v2Reservation.reservationId });
  assert.equal(v2Finalize.status, "sent");
  const v2Message = (await groupDoc.collection("messages").doc(v2Finalize.messageId).get()).data();
  assert.equal(v2Message.image.mediaProfileVersion, 2);
  assert.equal(v2Message.image.width, 1440);

  await ageMediaReservationRateLimit(a.uid);
  const spoofedFullBytes = syntheticJpeg(1, 1);
  const spoofedReservation = await a.call("createFriendChatImageUpload", {
    clientMessageId: "group_image_v2_spoofed_dimensions",
    conversationId: group.conversationId,
    image: {
      main: { height: 1080, mimeType: "image/jpeg", sizeBytes: spoofedFullBytes.byteLength, width: 1440 },
      mediaProfileVersion: 2,
      sourceMimeType: "image/jpeg",
      sourceSizeBytes: 4096,
      thumbnail: { height: 360, mimeType: "image/jpeg", sizeBytes: v2ThumbnailBytes.byteLength, width: 480 },
    },
  });
  await uploadBytes(ref(a.storage, spoofedReservation.fullPath), spoofedFullBytes, { contentType: "image/jpeg" });
  await uploadBytes(ref(a.storage, spoofedReservation.thumbnailPath), v2ThumbnailBytes, { contentType: "image/jpeg" });
  await wait(800);
  await assert.rejects(
    () => a.call("finalizeFriendChatImageMessage", { reservationId: spoofedReservation.reservationId }),
    hasCode("failed-precondition"),
    "v2 finalization rejects uploaded JPEG dimensions that do not match the reservation",
  );

  await ageMediaReservationRateLimit(a.uid);
  const missingObjectReservation = await a.call("createFriendChatImageUpload", {
    clientMessageId: "group_image_v2_missing_thumbnail",
    conversationId: group.conversationId,
    image: {
      main: { height: 1080, mimeType: "image/jpeg", sizeBytes: v2FullBytes.byteLength, width: 1440 },
      mediaProfileVersion: 2,
      sourceMimeType: "image/jpeg",
      sourceSizeBytes: 4096,
      thumbnail: { height: 360, mimeType: "image/jpeg", sizeBytes: v2ThumbnailBytes.byteLength, width: 480 },
    },
  });
  await uploadBytes(ref(a.storage, missingObjectReservation.fullPath), v2FullBytes, { contentType: "image/jpeg" });
  await wait(800);
  await assert.rejects(
    () => a.call("finalizeFriendChatImageMessage", { reservationId: missingObjectReservation.reservationId }),
    undefined,
    "finalization rejects an upload when either reserved Storage object is missing",
  );
  const imageUrl = await b.call("getFriendChatMediaDownloadUrl", { messageId: imageFinalize.messageId, storagePath: imageReservation.thumbnailPath });
  assert.match(imageUrl.url, /127\.0\.0\.1:9199|localhost:9199/u);
  await assert.rejects(() => outsider.call("getFriendChatMediaDownloadUrl", { messageId: imageFinalize.messageId, storagePath: imageReservation.thumbnailPath }), hasCode("permission-denied"));
  const imageReport = await b.call("reportFriendChatMessage", {
    conversationId: group.conversationId,
    messageId: imageFinalize.messageId,
    reason: "privacy",
  });
  const imageReportData = (await db.collection("chatModerationReports").doc(imageReport.reportId).get()).data();
  assert.equal(imageReportData.contentSnapshot.messageType, "image");
  assert.equal(imageReportData.attachmentEvidence.image.fullPath, imageReservation.fullPath);
  assert.equal((await groupDoc.collection("messages").doc(imageFinalize.messageId).get()).data().moderationEvidenceRetained, true);
  await assert.rejects(() => outsider.call("forwardFriendChatMessages", {
    clientForwardId: "forward_outsider_image_001",
    conversationId: group.conversationId,
    destinationConversationIds: [direct.conversationId],
    messageIds: [imageFinalize.messageId],
  }), hasCode("permission-denied"), "a non-member cannot forward protected image media");

  await ageForwardRateLimit(a.uid);
  await ageDestinationSendRateLimit(direct.conversationId, a.uid);
  const imageForwardInput = {
    clientForwardId: "forward_image_operation_001",
    conversationId: group.conversationId,
    destinationConversationIds: [direct.conversationId],
    messageIds: [imageFinalize.messageId],
  };
  assert.equal((await a.call("forwardFriendChatMessages", imageForwardInput)).forwarded, 1);
  const directMessagesAfterImageForward = await db.collection("friendConversations").doc(direct.conversationId).collection("messages").get();
  const forwardedImageDocuments = directMessagesAfterImageForward.docs.filter((document) => {
    const data = document.data();
    return data.forwarded === true && data.messageType === "image";
  });
  assert.equal(forwardedImageDocuments.length, 1);
  const forwardedImageDocument = forwardedImageDocuments[0];
  const forwardedImage = forwardedImageDocument.data();
  assert.equal(forwardedImage.caption, "Post-game photo");
  assert.deepEqual(forwardedImage.forwardedFrom, { messageType: "image" });
  assert.equal("sourceConversationId" in forwardedImage.forwardedFrom, false);
  assert.equal("originalSenderUserId" in forwardedImage, false);
  assert.equal(forwardedImage.image.fullPath.includes(direct.conversationId), true);
  assert.equal(forwardedImage.image.thumbnailPath.includes(direct.conversationId), true);
  assert.notEqual(forwardedImage.image.fullPath, imageReservation.fullPath);
  assert.notEqual(forwardedImage.image.thumbnailPath, imageReservation.thumbnailPath);
  assert.deepEqual((await bucket.file(forwardedImage.image.fullPath).download())[0], Buffer.from(imageBytes));
  assert.deepEqual((await bucket.file(forwardedImage.image.thumbnailPath).download())[0], Buffer.from(thumbnailBytes));
  const forwardedReservationId = forwardedImage.image.fullPath.split("/")[3];
  const forwardedReservation = (await db.collection("friendChatUploadReservations").doc(forwardedReservationId).get()).data();
  assert.equal(forwardedReservation.status, "finalized");
  assert.equal(forwardedReservation.conversationId, direct.conversationId);
  assert.match((await b.call("getFriendChatMediaDownloadUrl", {
    messageId: forwardedImageDocument.id,
    storagePath: forwardedImage.image.fullPath,
  })).url, /127\.0\.0\.1:9199|localhost:9199/u);
  assert.equal((await a.call("forwardFriendChatMessages", imageForwardInput)).forwarded, 1, "image forward retries are idempotent");
  const imageForwardRetrySnapshot = await db.collection("friendConversations").doc(direct.conversationId).collection("messages").get();
  assert.equal(imageForwardRetrySnapshot.docs.filter((document) => document.data().forwarded === true && document.data().messageType === "image").length, 1);
  await assert.rejects(() => a.call("forwardFriendChatMessages", {
    ...imageForwardInput,
    clientForwardId: "forward_image_operation_002",
  }), hasCode("resource-exhausted"));

  await a.call("removeOwnFriendChatMessage", { conversationId: direct.conversationId, messageId: forwardedImageDocument.id });
  assert.equal((await bucket.file(forwardedImage.image.fullPath).exists())[0], false, "removing the destination message deletes only its full copy");
  assert.equal((await bucket.file(forwardedImage.image.thumbnailPath).exists())[0], false, "removing the destination message deletes only its thumbnail copy");
  assert.equal((await bucket.file(imageReservation.fullPath).exists())[0], true, "the source full image remains intact");
  assert.equal((await bucket.file(imageReservation.thumbnailPath).exists())[0], true, "the source thumbnail remains intact");

  await b.call("blockFriendChatUser", { blockedUserId: a.uid });
  await ageForwardRateLimit(a.uid);
  await assert.rejects(() => a.call("forwardFriendChatMessages", {
    ...imageForwardInput,
    clientForwardId: "forward_image_blocked_001",
  }), hasCode("permission-denied"), "blocking either participant prevents forwarding protected source media");
  await b.call("unblockFriendChatUser", { blockedUserId: a.uid });
  await Promise.all([
    db.collection("users").doc(a.uid).update({ friendIds: admin.firestore.FieldValue.arrayUnion(b.uid) }),
    db.collection("users").doc(b.uid).update({ friendIds: admin.firestore.FieldValue.arrayUnion(a.uid) }),
  ]);

  await a.call("removeOwnFriendChatMessage", { conversationId: group.conversationId, messageId: imageFinalize.messageId });
  assert.equal((await bucket.file(imageReservation.fullPath).exists())[0], true, "reported full media remains available only as moderation evidence");
  assert.equal((await bucket.file(imageReservation.thumbnailPath).exists())[0], true, "reported thumbnails remain available only as moderation evidence");
  await assert.rejects(() => b.call("getFriendChatMediaDownloadUrl", { messageId: imageFinalize.messageId, storagePath: imageReservation.fullPath }), hasCode("permission-denied"), "participants cannot request new grants after deletion");

  await ageMediaReservationRateLimit(b.uid);
  const voiceBytes = new Uint8Array(2048);
  const voiceReservation = await b.call("createFriendChatVoiceUpload", {
    caption: "Quick note",
    clientMessageId: "group_voice_001",
    conversationId: group.conversationId,
    voiceMemo: { durationMilliseconds: 45_000, mimeType: "audio/mp4", sizeBytes: voiceBytes.byteLength },
  });
  await uploadBytes(ref(b.storage, voiceReservation.storagePath), voiceBytes, { contentType: "audio/mp4" });
  const voiceFinalize = await b.call("finalizeFriendChatVoiceMessage", { reservationId: voiceReservation.reservationId });
  assert.equal(voiceFinalize.status, "sent");
  const voiceMessage = (await groupDoc.collection("messages").doc(voiceFinalize.messageId).get()).data();
  assert.equal(voiceMessage.messageType, "voice");
  assert.equal(voiceMessage.caption, "Quick note");
  assert.equal(voiceMessage.voiceMemo.storagePath, voiceReservation.storagePath);
  assert.deepEqual(voiceMessage.mediaStoragePaths, [voiceReservation.storagePath]);
  await assert.rejects(() => a.call("forwardFriendChatMessages", {
    clientForwardId: "forward_voice_operation_001",
    conversationId: group.conversationId,
    destinationConversationIds: [direct.conversationId],
    messageIds: [voiceFinalize.messageId],
  }), hasCode("failed-precondition"), "voice forwarding remains disabled");
  await a.call("toggleFriendChatReaction", { conversationId: group.conversationId, messageId: voiceFinalize.messageId, emoji: "🙏" });
  assert.deepEqual((await groupDoc.collection("messages").doc(voiceFinalize.messageId).get()).data().reactionCounts, { "🙏": 1 });
  const voiceUrl = await a.call("getFriendChatMediaDownloadUrl", { messageId: voiceFinalize.messageId, storagePath: voiceReservation.storagePath });
  assert.match(voiceUrl.url, /127\.0\.0\.1:9199|localhost:9199/u);
  const voiceReport = await a.call("reportFriendChatMessage", {
    conversationId: group.conversationId,
    messageId: voiceFinalize.messageId,
    reason: "other",
  });
  assert.equal((await db.collection("chatModerationReports").doc(voiceReport.reportId).get()).data().attachmentEvidence.voiceMemo.storagePath, voiceReservation.storagePath);
  await b.call("removeOwnFriendChatMessage", { conversationId: group.conversationId, messageId: voiceFinalize.messageId });
  assert.equal((await bucket.file(voiceReservation.storagePath).exists())[0], true, "reported voice evidence is retained while normal playback is revoked");

  await db.collection("users").doc(a.uid).update({ friendIds: admin.firestore.FieldValue.arrayRemove(b.uid) });
  await db.collection("users").doc(b.uid).update({ friendIds: admin.firestore.FieldValue.arrayRemove(a.uid) });
  await assert.rejects(() => a.call("sendFriendChatMessage", { conversationId: direct.conversationId, text: "After friendship", clientMessageId: "direct_message_003" }), hasCode("failed-precondition"));
  await db.collection("users").doc(a.uid).update({ friendIds: admin.firestore.FieldValue.arrayUnion(b.uid) });
  await db.collection("users").doc(b.uid).update({ friendIds: admin.firestore.FieldValue.arrayUnion(a.uid) });

  await b.call("blockFriendChatUser", { blockedUserId: a.uid });
  assert.equal((await b.call("getBlockedFriendChatUserIds")).blockedUserIds.includes(a.uid), true);
  await assert.rejects(() => a.call("createOrOpenDirectConversation", { friendUserId: b.uid }), hasCode("permission-denied"));
  await assert.rejects(() => a.call("sendFriendRequest", { targetUserId: b.uid }), hasCode("permission-denied"));
  await a.call("reportFriendChatUser", { conversationId: group.conversationId, reportedUserId: b.uid });
  assert.equal((await db.collection("chatModerationReports").where("reporterUserId", "==", a.uid).get()).empty, false);

  const anonymousApp = initializeApp({ apiKey: "demo-key", projectId }, "chat-anonymous");
  const anonymousFunctions = getFunctions(anonymousApp, "us-central1");
  connectFunctionsEmulator(anonymousFunctions, "127.0.0.1", 5001);
  await assert.rejects(() => httpsCallable(anonymousFunctions, "createOrOpenDirectConversation")({ friendUserId: a.uid }), hasCode("unauthenticated"));
  console.log("Friend Chat direct/group lifecycle, selection actions, replies, forwarding, pinning, starring, delete-for-me, media, report, blocking, and auth emulator tests passed.");
}
run().catch((error) => { console.error(error); process.exit(1); });
