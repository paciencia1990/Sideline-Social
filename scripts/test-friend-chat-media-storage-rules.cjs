const fs = require("node:fs");
const path = require("node:path");
const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { Timestamp, doc, setDoc } = require("firebase/firestore");

const projectId = "sideline-friend-chat-media-storage-rules-test";
const firestoreRules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");
const storageRules = fs.readFileSync(path.join(process.cwd(), "storage.rules"), "utf8");
const voiceBytes = new Uint8Array(2048);
const imageBytes = new Uint8Array(4096);
const thumbnailBytes = new Uint8Array(1024);
const oversizedV2ImageBytes = new Uint8Array((1024 * 1024) + 1);
const messageId = "message_" + "a".repeat(64);
const imageMessageId = "message_" + "b".repeat(64);
const expiredMessageId = "message_" + "c".repeat(64);
const restrictedMessageId = "message_" + "d".repeat(64);
const voiceReservationId = "media_" + "1".repeat(64);
const imageReservationId = "media_" + "2".repeat(64);
const expiredReservationId = "media_" + "3".repeat(64);
const restrictedReservationId = "media_" + "4".repeat(64);
const version2ReservationId = "media_" + "5".repeat(64);
const unknownProfileReservationId = "media_" + "6".repeat(64);
const oversizedV2ReservationId = "media_" + "7".repeat(64);
const version2MessageId = "message_" + "e".repeat(64);
const unknownProfileMessageId = "message_" + "f".repeat(64);
const oversizedV2MessageId = "message_" + "0".repeat(64);

function friendPath(targetMessageId, reservationId, fileName) {
  return `friendChatMedia/conversation-1/${targetMessageId}/${reservationId}/${fileName}`;
}

async function seed(testEnv) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "accountStanding", "restricted"), {
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      messagingRestricted: true,
      status: "active",
    });
    await setDoc(doc(db, "friendChatUploadReservations", voiceReservationId), {
      conversationId: "conversation-1",
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      kind: "voice",
      reservationId: voiceReservationId,
      status: "pending",
      storagePath: friendPath(messageId, voiceReservationId, "voice.m4a"),
      targetId: messageId,
      userId: "active-a",
      voiceMemo: { durationMilliseconds: 15_000, mimeType: "audio/mp4", sizeBytes: voiceBytes.byteLength },
    });
    await setDoc(doc(db, "friendChatUploadReservations", imageReservationId), {
      conversationId: "conversation-1",
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      fullPath: friendPath(imageMessageId, imageReservationId, "image.jpg"),
      image: {
        main: { height: 900, mimeType: "image/jpeg", sizeBytes: imageBytes.byteLength, width: 1600 },
        sourceMimeType: "image/png",
        sourceSizeBytes: 5 * 1024 * 1024,
        thumbnail: { height: 288, mimeType: "image/jpeg", sizeBytes: thumbnailBytes.byteLength, width: 512 },
      },
      kind: "image",
      reservationId: imageReservationId,
      status: "pending",
      targetId: imageMessageId,
      thumbnailPath: friendPath(imageMessageId, imageReservationId, "thumbnail.jpg"),
      userId: "active-a",
    });
    await setDoc(doc(db, "friendChatUploadReservations", expiredReservationId), {
      conversationId: "conversation-1",
      expiresAt: Timestamp.fromMillis(Date.now() - 1000),
      kind: "voice",
      reservationId: expiredReservationId,
      status: "pending",
      storagePath: friendPath(expiredMessageId, expiredReservationId, "voice.m4a"),
      targetId: expiredMessageId,
      userId: "active-a",
      voiceMemo: { durationMilliseconds: 1000, mimeType: "audio/mp4", sizeBytes: voiceBytes.byteLength },
    });
    await setDoc(doc(db, "friendChatUploadReservations", restrictedReservationId), {
      conversationId: "conversation-1",
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      kind: "voice",
      reservationId: restrictedReservationId,
      status: "pending",
      storagePath: friendPath(restrictedMessageId, restrictedReservationId, "voice.m4a"),
      targetId: restrictedMessageId,
      userId: "restricted",
      voiceMemo: { durationMilliseconds: 1000, mimeType: "audio/mp4", sizeBytes: voiceBytes.byteLength },
    });
    for (const [reservationId, targetId, mediaProfileVersion, fullSize] of [
      [version2ReservationId, version2MessageId, 2, imageBytes.byteLength],
      [unknownProfileReservationId, unknownProfileMessageId, 3, imageBytes.byteLength],
      [oversizedV2ReservationId, oversizedV2MessageId, 2, oversizedV2ImageBytes.byteLength],
    ]) {
      await setDoc(doc(db, "friendChatUploadReservations", reservationId), {
        conversationId: "conversation-1",
        expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
        fullPath: friendPath(targetId, reservationId, "image.jpg"),
        image: {
          main: { height: 900, mimeType: "image/jpeg", sizeBytes: fullSize, width: 1440 },
          mediaProfileVersion,
          sourceMimeType: "image/jpeg",
          sourceSizeBytes: Math.min(fullSize, 5 * 1024 * 1024),
          thumbnail: { height: 300, mimeType: "image/jpeg", sizeBytes: thumbnailBytes.byteLength, width: 480 },
        },
        kind: "image",
        reservationId,
        status: "pending",
        targetId,
        thumbnailPath: friendPath(targetId, reservationId, "thumbnail.jpg"),
        userId: "active-a",
      });
    }
  });
}

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: firestoreRules },
    storage: { rules: storageRules },
  });
  try {
    await testEnv.clearFirestore();
    await testEnv.clearStorage();
    await seed(testEnv);
    const activeStorage = testEnv.authenticatedContext("active-a").storage();
    const otherStorage = testEnv.authenticatedContext("active-b").storage();
    const restrictedStorage = testEnv.authenticatedContext("restricted").storage();
    const anonymousStorage = testEnv.unauthenticatedContext().storage();
    const voicePath = friendPath(messageId, voiceReservationId, "voice.m4a");
    const imagePath = friendPath(imageMessageId, imageReservationId, "image.jpg");
    const thumbnailPath = friendPath(imageMessageId, imageReservationId, "thumbnail.jpg");

    await assertSucceeds(activeStorage.ref(voicePath).put(voiceBytes, { contentType: "audio/mp4" }));
    await assertSucceeds(activeStorage.ref(imagePath).put(imageBytes, { contentType: "image/jpeg" }));
    await assertSucceeds(activeStorage.ref(thumbnailPath).put(thumbnailBytes, { contentType: "image/jpeg" }));
    await assertSucceeds(activeStorage.ref(friendPath(version2MessageId, version2ReservationId, "image.jpg")).put(imageBytes, { contentType: "image/jpeg" }));
    await assertSucceeds(activeStorage.ref(friendPath(version2MessageId, version2ReservationId, "thumbnail.jpg")).put(thumbnailBytes, { contentType: "image/jpeg" }));
    await assertFails(activeStorage.ref(friendPath(version2MessageId, version2ReservationId, "image.jpg")).put(imageBytes, { contentType: "image/webp" }));
    await assertFails(activeStorage.ref(friendPath(unknownProfileMessageId, unknownProfileReservationId, "image.jpg")).put(imageBytes, { contentType: "image/jpeg" }));
    await assertFails(activeStorage.ref(friendPath(oversizedV2MessageId, oversizedV2ReservationId, "image.jpg")).put(oversizedV2ImageBytes, { contentType: "image/jpeg" }));
    await assertFails(activeStorage.ref(voicePath).getDownloadURL());
    await assertFails(activeStorage.ref(imagePath).getDownloadURL());
    await assertFails(otherStorage.ref(voicePath).put(voiceBytes, { contentType: "audio/mp4" }));
    await assertFails(anonymousStorage.ref(voicePath).put(voiceBytes, { contentType: "audio/mp4" }));
    await assertFails(activeStorage.ref(friendPath("wrong-message", voiceReservationId, "voice.m4a")).put(voiceBytes, { contentType: "audio/mp4" }));
    await assertFails(activeStorage.ref(friendPath(messageId, voiceReservationId, "voice.m4a")).put(new Uint8Array(1), { contentType: "audio/mp4" }));
    await assertFails(activeStorage.ref(friendPath(messageId, voiceReservationId, "voice.m4a")).put(voiceBytes, { contentType: "audio/mpeg" }));
    await assertFails(activeStorage.ref(friendPath(expiredMessageId, expiredReservationId, "voice.m4a")).put(voiceBytes, { contentType: "audio/mp4" }));
    await assertFails(restrictedStorage.ref(friendPath(restrictedMessageId, restrictedReservationId, "voice.m4a")).put(voiceBytes, { contentType: "audio/mp4" }));
    await assertFails(activeStorage.ref("friendChatMedia/conversation-1/freeform.jpg").put(imageBytes, { contentType: "image/jpeg" }));
    console.log("Friend Chat media Storage reservation ownership, path, expiry, metadata, standing, and direct-read denial tests passed.");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
