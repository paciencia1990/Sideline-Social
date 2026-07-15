const fs = require("node:fs");
const path = require("node:path");
const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { Timestamp, addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, updateDoc, where } = require("firebase/firestore");

const projectId = "sideline-friend-chat-rules-test";
const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");
const joinedAt = Timestamp.fromMillis(2000);

async function seed(env) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "friendConversations", "group-1"), {
      conversationId: "group-1", conversationType: "group", activeParticipantIds: ["active-a", "active-b"],
      invitedParticipantIds: ["invited"], activeParticipantCount: 2, invitedParticipantCount: 1,
      lastMessageAt: Timestamp.fromMillis(3000), updatedAt: Timestamp.fromMillis(3000), status: "active",
    });
    for (const member of [
      ["active-a", "active", joinedAt], ["active-b", "active", Timestamp.fromMillis(1000)],
      ["invited", "invited", null], ["removed", "removed", Timestamp.fromMillis(1000)],
    ]) {
      await setDoc(doc(db, "friendConversations", "group-1", "members", member[0]), { userId: member[0], status: member[1], joinedAt: member[2], lastReadAt: member[2], muted: false });
      await setDoc(doc(db, "friendConversations", "group-1", "memberProfiles", member[0]), { userId: member[0], status: member[1], role: "member", displayNameSnapshot: `Parent ${member[0].slice(-1)}` });
    }
    await setDoc(doc(db, "friendConversations", "group-1", "messages", "before"), { conversationId: "group-1", senderUserId: "active-b", text: "before", createdAt: Timestamp.fromMillis(1500), visibleToUserIds: ["active-b"], status: "active" });
    await setDoc(doc(db, "friendConversations", "group-1", "messages", "after"), { conversationId: "group-1", senderUserId: "active-b", text: "after", createdAt: Timestamp.fromMillis(2500), visibleToUserIds: ["active-a", "active-b"], status: "active" });
  });
}

async function run() {
  const env = await initializeTestEnvironment({ projectId, firestore: { rules } });
  try {
    await env.clearFirestore(); await seed(env);
    const active = env.authenticatedContext("active-a").firestore();
    const invited = env.authenticatedContext("invited").firestore();
    const removed = env.authenticatedContext("removed").firestore();
    const outsider = env.authenticatedContext("outsider").firestore();
    const conversation = (db) => doc(db, "friendConversations", "group-1");
    await assertSucceeds(getDoc(conversation(active)));
    await assertSucceeds(getDocs(query(collection(active, "friendConversations"), where("activeParticipantIds", "array-contains", "active-a"), orderBy("lastMessageAt", "desc"), limit(25))));
    await assertFails(getDocs(collection(active, "friendConversations")));
    await assertSucceeds(getDoc(conversation(invited)));
    await assertSucceeds(getDocs(query(collection(invited, "friendConversations"), where("invitedParticipantIds", "array-contains", "invited"), orderBy("updatedAt", "desc"), limit(25))));
    await assertFails(getDoc(conversation(removed)));
    await assertFails(getDoc(conversation(outsider)));

    await assertFails(getDoc(doc(active, "friendConversations", "group-1", "members", "active-b")));
    await assertSucceeds(getDoc(doc(active, "friendConversations", "group-1", "memberProfiles", "active-b")));
    await assertSucceeds(getDoc(doc(invited, "friendConversations", "group-1", "members", "invited")));
    await assertSucceeds(getDocs(query(collection(invited, "friendConversations", "group-1", "memberProfiles"), where("status", "==", "active"), limit(10))));
    await assertFails(getDoc(doc(invited, "friendConversations", "group-1", "members", "removed")));
    await assertSucceeds(getDoc(doc(removed, "friendConversations", "group-1", "members", "removed")));

    const afterRef = doc(active, "friendConversations", "group-1", "messages", "after");
    await assertSucceeds(getDoc(afterRef));
    await assertFails(getDoc(doc(active, "friendConversations", "group-1", "messages", "before")));
    await assertSucceeds(getDocs(query(collection(active, "friendConversations", "group-1", "messages"), where("visibleToUserIds", "array-contains", "active-a"), orderBy("createdAt", "desc"), limit(50))));
    await assertFails(getDocs(query(collection(active, "friendConversations", "group-1", "messages"), orderBy("createdAt", "desc"), limit(50))));
    await assertFails(getDoc(doc(invited, "friendConversations", "group-1", "messages", "after")));
    await assertFails(getDoc(doc(removed, "friendConversations", "group-1", "messages", "after")));

    await assertFails(setDoc(doc(active, "friendConversations", "injected"), { activeParticipantIds: ["active-a"] }));
    await assertFails(updateDoc(conversation(active), { activeParticipantIds: ["active-a", "outsider"] }));
    await assertFails(addDoc(collection(active, "friendConversations", "group-1", "messages"), { senderUserId: "active-a", text: "injected", createdAt: Timestamp.now() }));
    await assertFails(updateDoc(afterRef, { text: "tampered" }));
    await assertFails(setDoc(doc(active, "userBlocks", "active-a", "blockedUsers", "outsider"), { status: "active" }));
    await assertFails(setDoc(doc(active, "chatModerationReports", "fake"), { reporterUserId: "active-a" }));
    console.log("Friend Chat membership, joined-at history, bounded query, outsider, revoked-member, and callable-only rules tests passed.");
  } finally { await env.cleanup(); }
}
run().catch((error) => { console.error(error); process.exit(1); });
