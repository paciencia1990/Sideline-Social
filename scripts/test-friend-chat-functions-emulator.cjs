const assert = require("node:assert/strict");
const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } = require("firebase/auth");
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require("firebase/functions");

const projectId = process.env.GCLOUD_PROJECT || "sideline-friend-chat-functions-test";
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();

async function createClient(label) {
  const app = initializeApp({ apiKey: "demo-key", projectId }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const credential = await createUserWithEmailAndPassword(auth, `${label}@example.test`, "ValidPass123!");
  const callableFunctions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(callableFunctions, "127.0.0.1", 5001);
  return { call: (name, data = {}) => httpsCallable(callableFunctions, name)(data).then((result) => result.data), uid: credential.user.uid };
}
function hasCode(code) { return (error) => String(error?.code).includes(code); }

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
  const messageReport = await b.call("reportFriendChatMessage", {
    conversationId: group.conversationId,
    messageId: groupMessage.messageId,
    reason: "offensive",
  });
  assert.equal(messageReport.reported, true);
  assert.equal((await db.collection("chatModerationReports").doc(messageReport.reportId).get()).data().reason, "offensive");
  await a.call("removeOwnFriendChatMessage", { conversationId: group.conversationId, messageId: groupMessage.messageId });
  const removed = (await groupDoc.collection("messages").doc(groupMessage.messageId).get()).data();
  assert.equal(removed.status, "removed"); assert.equal(removed.text, "");
  await assert.rejects(() => b.call("removeOwnFriendChatMessage", { conversationId: group.conversationId, messageId: groupMessage.messageId }), hasCode("permission-denied"));

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
  console.log("Friend Chat direct/group lifecycle, invitation, role, send, idempotency, rate-limit, removal, friendship, blocking, report, and auth emulator tests passed.");
}
run().catch((error) => { console.error(error); process.exit(1); });
