const fs = require("node:fs");
const path = require("node:path");
const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { Timestamp, doc, setDoc } = require("firebase/firestore");

const projectId = "sideline-team-voice-storage-rules-test";
const firestoreRules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");
const storageRules = fs.readFileSync(path.join(process.cwd(), "storage.rules"), "utf8");
const bytes = new Uint8Array(1024);

async function seed(testEnv) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const common = {
      teamId: "team-1", userId: "coach", status: "pending", expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      voiceMemo: { durationMilliseconds: 1000, sizeBytes: bytes.byteLength, mimeType: "audio/mp4" },
    };
    await setDoc(doc(db, "teamVoiceUploadReservations", "announcement-reservation"), {
      ...common, reservationId: "announcement-reservation", kind: "announcement", targetId: "announcement-1",
      storagePath: "teamVoiceMemos/team-1/announcements/announcement-1/announcement-reservation/memo.m4a",
    });
    await setDoc(doc(db, "teamVoiceUploadReservations", "private-reservation"), {
      ...common, reservationId: "private-reservation", kind: "privateMessage", targetId: "message-1", conversationId: "conversation-1",
      storagePath: "teamVoiceMemos/team-1/privateConversations/conversation-1/message-1/private-reservation/memo.m4a",
    });
    await setDoc(doc(db, "teamVoiceUploadReservations", "expired-reservation"), {
      ...common, reservationId: "expired-reservation", kind: "announcement", targetId: "announcement-expired", expiresAt: Timestamp.fromMillis(Date.now() - 1000),
    });
    await setDoc(doc(db, "teamVoiceUploadReservations", "zero-reservation"), {
      ...common, reservationId: "zero-reservation", kind: "announcement", targetId: "announcement-zero",
      storagePath: "teamVoiceMemos/team-1/announcements/announcement-zero/zero-reservation/memo.m4a",
    });
  });
}

async function run() {
  const testEnv = await initializeTestEnvironment({ projectId, firestore: { rules: firestoreRules }, storage: { rules: storageRules } });
  try {
    await testEnv.clearFirestore(); await testEnv.clearStorage(); await seed(testEnv);
    const coachStorage = testEnv.authenticatedContext("coach").storage();
    const parentStorage = testEnv.authenticatedContext("parent").storage();
    const anonymousStorage = testEnv.unauthenticatedContext().storage();
    const announcementPath = "teamVoiceMemos/team-1/announcements/announcement-1/announcement-reservation/memo.m4a";
    const privatePath = "teamVoiceMemos/team-1/privateConversations/conversation-1/message-1/private-reservation/memo.m4a";
    await assertSucceeds(coachStorage.ref(announcementPath).put(bytes, { contentType: "audio/mp4" }));
    await assertSucceeds(coachStorage.ref(privatePath).put(bytes, { contentType: "audio/mp4" }));
    await assertFails(parentStorage.ref("teamVoiceMemos/team-1/announcements/announcement-1/announcement-reservation/memo.m4a").put(bytes, { contentType: "audio/mp4" }));
    await assertFails(anonymousStorage.ref("teamVoiceMemos/team-1/announcements/announcement-1/announcement-reservation/memo.m4a").put(bytes, { contentType: "audio/mp4" }));
    await assertFails(coachStorage.ref("teamVoiceMemos/team-1/announcements/wrong/announcement-reservation/memo.m4a").put(bytes, { contentType: "audio/mp4" }));
    await assertFails(coachStorage.ref("teamVoiceMemos/team-1/privateConversations/wrong/message-1/private-reservation/memo.m4a").put(bytes, { contentType: "audio/mp4" }));
    await assertFails(coachStorage.ref("teamVoiceMemos/team-1/announcements/announcement-expired/expired-reservation/memo.m4a").put(bytes, { contentType: "audio/mp4" }));
    await assertFails(coachStorage.ref("teamVoiceMemos/team-1/announcements/announcement-zero/zero-reservation/memo.m4a").put(new Uint8Array(0), { contentType: "audio/mp4" }));
    await assertFails(coachStorage.ref("teamVoiceMemos/team-1/announcements/announcement-1/announcement-reservation/memo.m4a").getDownloadURL());
    await assertFails(coachStorage.ref("other/path.m4a").put(bytes, { contentType: "audio/mp4" }));
    console.log("Team voice Storage reservation ownership, path, expiry, metadata, and direct-read denial tests passed.");
  } finally { await testEnv.cleanup(); }
}
run().catch((error) => { console.error(error); process.exit(1); });
