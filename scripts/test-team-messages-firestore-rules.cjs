const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { Timestamp, collection, doc, getDoc, getDocs, setDoc, updateDoc } = require("firebase/firestore");

const projectId = "sideline-team-messages-rules-test";
const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");
const now = () => Timestamp.now();

async function seed(testEnv) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "teams", "team-1"), { name: "Tigers", createdBy: "coach", coachIds: ["coach"], parentIds: ["parent"], status: "active" });
    for (const member of [
      { uid: "coach", role: "coach", roles: { coach: true, parent: false, staff: false } },
      { uid: "parent", role: "parent", roles: { coach: false, parent: true, staff: false } },
      { uid: "staff", role: "teamParent", roles: { coach: false, parent: false, staff: true } },
    ]) await setDoc(doc(db, "teams", "team-1", "members", member.uid), { userId: member.uid, teamId: "team-1", status: "active", ...member, createdAt: now() });
    await setDoc(doc(db, "teamPrivateConversations", "conversation-1"), {
      conversationId: "conversation-1", teamId: "team-1", coachUserId: "coach", parentUserId: "parent",
      participantUserIds: ["coach", "parent"], status: "active", lastMessageAt: now(),
    });
    await setDoc(doc(db, "teamPrivateConversations", "conversation-1", "members", "coach"), { userId: "coach", role: "coach", unreadCount: 0 });
    await setDoc(doc(db, "teamPrivateConversations", "conversation-1", "members", "parent"), { userId: "parent", role: "parent", unreadCount: 1 });
    await setDoc(doc(db, "teamPrivateConversations", "conversation-1", "messages", "message-1"), {
      messageId: "message-1", conversationId: "conversation-1", teamId: "team-1", senderUserId: "coach", senderRole: "coach", contentType: "text", text: "Private", createdAt: now(),
    });
    await setDoc(doc(db, "teamVoiceUploadReservations", "reservation-1"), { userId: "coach", status: "pending" });
    await setDoc(doc(db, "teamMessageRateLimits", "coach_voice"), { userId: "coach", count: 1 });
  });
}

async function run() {
  const testEnv = await initializeTestEnvironment({ projectId, firestore: { rules } });
  try {
    await testEnv.clearFirestore(); await seed(testEnv);
    const coach = testEnv.authenticatedContext("coach").firestore();
    const parent = testEnv.authenticatedContext("parent").firestore();
    const outsider = testEnv.authenticatedContext("outsider").firestore();
    const staff = testEnv.authenticatedContext("staff").firestore();
    for (const db of [coach, parent]) {
      await assertSucceeds(getDoc(doc(db, "teamPrivateConversations", "conversation-1")));
      await assertSucceeds(getDocs(collection(db, "teamPrivateConversations", "conversation-1", "messages")));
    }
    await assertSucceeds(getDoc(doc(parent, "teamPrivateConversations", "conversation-1", "members", "parent")));
    await assertFails(getDoc(doc(parent, "teamPrivateConversations", "conversation-1", "members", "coach")));
    await assertFails(getDoc(doc(outsider, "teamPrivateConversations", "conversation-1")));
    await assertFails(getDoc(doc(staff, "teamPrivateConversations", "conversation-1")));
    await assertFails(getDocs(collection(outsider, "teamPrivateConversations", "conversation-1", "messages")));
    await assertFails(setDoc(doc(coach, "teamPrivateConversations", "injected"), { participantUserIds: ["coach", "outsider"] }));
    await assertFails(setDoc(doc(parent, "teamPrivateConversations", "conversation-1", "messages", "injected"), { text: "bypass" }));
    await assertFails(updateDoc(doc(coach, "teamPrivateConversations", "conversation-1"), { participantUserIds: ["coach", "outsider"] }));
    await assertFails(getDoc(doc(coach, "teamVoiceUploadReservations", "reservation-1")));
    await assertFails(getDoc(doc(coach, "teamMessageRateLimits", "coach_voice")));

    const baseAnnouncement = { title: "Text", body: "Allowed legacy text", audience: "all", allowReplies: true, createdBy: "coach", createdAt: now(), updatedAt: now() };
    await assertSucceeds(setDoc(doc(coach, "teams", "team-1", "announcements", "text"), baseAnnouncement));
    await assertFails(setDoc(doc(coach, "teams", "team-1", "announcements", "forged-voice"), { ...baseAnnouncement, contentType: "voice", voiceMemo: { storagePath: "forged" } }));
    await assertFails(updateDoc(doc(coach, "teams", "team-1", "announcements", "text"), { contentType: "voice", voiceMemo: { storagePath: "forged" } }));
    console.log("Team Messages Firestore participant isolation, server-only writes, and voice-forgery rules tests passed.");
  } finally { await testEnv.cleanup(); }
}
run().catch((error) => { console.error(error); process.exit(1); });
