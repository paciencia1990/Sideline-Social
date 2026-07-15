const assert = require("node:assert/strict");
const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } = require("firebase/auth");
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require("firebase/functions");

const projectId = process.env.GCLOUD_PROJECT || "sideline-friend-request-functions-test";
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();

async function createClient(label) {
  const app = initializeApp({ apiKey: "demo-key", projectId }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const credential = await createUserWithEmailAndPassword(auth, `${label}@example.test`, "ValidPass123!");
  const callableFunctions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(callableFunctions, "127.0.0.1", 5001);
  return {
    uid: credential.user.uid,
    call: (name, data = {}) => httpsCallable(callableFunctions, name)(data).then((result) => result.data),
  };
}
function hasCode(code) { return (error) => String(error?.code).includes(code); }
async function waitFor(check, timeout = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for emulator trigger");
}

async function run() {
  const [a, b, c, outsider, incomplete] = await Promise.all(
    ["request-a", "request-b", "request-c", "request-outsider", "request-incomplete"].map(createClient),
  );
  await Promise.all([
    db.collection("users").doc(a.uid).set({ firstName: "Alex", lastName: "Anderson", displayName: "Alex Anderson", friendIds: [] }),
    db.collection("users").doc(b.uid).set({ FirstName: "Bailey", LastName: "Brown", friendIds: [] }),
    db.collection("users").doc(c.uid).set({ name: "Casey Carter", friendIds: [] }),
    db.collection("users").doc(outsider.uid).set({ displayName: "Other Olson", friendIds: [] }),
    db.collection("users").doc(incomplete.uid).set({ firstName: "Single", lastName: "", displayName: "Single", friendIds: [] }),
  ]);

  await assert.rejects(() => incomplete.call("sendFriendRequest", { targetUserId: c.uid }), hasCode("failed-precondition"));
  const sent = await a.call("sendFriendRequest", { targetUserId: b.uid });
  assert.equal(sent.status, "pending");
  const requestRef = db.collection("friendRequests").doc(sent.requestId);
  let request = (await requestRef.get()).data();
  assert.equal(request.fromDisplayName, "Alex Anderson");
  assert.equal(request.toDisplayName, "Bailey Brown", "legacy field casing resolves");
  assert.equal(request.expiresAt.toMillis() - request.createdAt.toMillis(), 30 * 24 * 60 * 60 * 1000);
  for (const field of ["respondedAt", "acceptedAt", "declinedAt", "canceledAt", "expiredAt"]) assert.equal(request[field], null);
  assert.equal((await a.call("getActiveFriendRequests")).outgoing.length, 1);
  assert.equal((await b.call("getActiveFriendRequests")).incoming.length, 1);
  await assert.rejects(() => c.call("respondToFriendRequest", { requestId: sent.requestId, decision: "declined" }), hasCode("permission-denied"));

  assert.equal((await b.call("respondToFriendRequest", { requestId: sent.requestId, decision: "declined" })).status, "declined");
  assert.equal((await b.call("respondToFriendRequest", { requestId: sent.requestId, decision: "declined" })).status, "declined", "decline retry is idempotent");
  request = (await requestRef.get()).data();
  assert.equal(request.status, "declined");
  assert.ok(request.respondedAt instanceof admin.firestore.Timestamp);
  assert.ok(request.declinedAt instanceof admin.firestore.Timestamp);
  assert.deepEqual((await a.call("getActiveFriendRequests")).outgoing, []);
  assert.deepEqual((await b.call("getActiveFriendRequests")).incoming, []);
  assert.deepEqual((await db.collection("users").doc(a.uid).get()).data().friendIds, []);

  const second = await a.call("sendFriendRequest", { targetUserId: b.uid });
  assert.equal(second.requestId, sent.requestId, "deterministic request ID is retained");
  assert.equal((await requestRef.get()).data().priorOutcomes.at(-1).status, "declined", "declined attempt remains in the private audit history");
  assert.equal((await b.call("respondToFriendRequest", { requestId: second.requestId, response: "accept" })).status, "accepted");
  assert.equal((await b.call("respondToFriendRequest", { requestId: second.requestId, response: "accept" })).status, "accepted");
  request = (await requestRef.get()).data();
  assert.equal(request.status, "accepted");
  assert.ok(request.acceptedAt instanceof admin.firestore.Timestamp);
  assert.equal((await db.collection("users").doc(a.uid).get()).data().friendIds.includes(b.uid), true);
  assert.equal((await db.collection("users").doc(b.uid).get()).data().friendIds.includes(a.uid), true);
  const direct = await a.call("createOrOpenDirectConversation", { friendUserId: b.uid });
  assert.equal(direct.status, "created", "accepted friendship remains Chat-eligible");

  const cancelable = await c.call("sendFriendRequest", { targetUserId: b.uid });
  await assert.rejects(() => b.call("cancelFriendRequest", { requestId: cancelable.requestId }), hasCode("permission-denied"));
  assert.equal((await c.call("cancelFriendRequest", { requestId: cancelable.requestId })).status, "canceled");
  assert.equal((await c.call("cancelFriendRequest", { requestId: cancelable.requestId })).status, "canceled", "cancel retry is idempotent");
  assert.equal((await db.collection("friendRequests").doc(cancelable.requestId).get()).data().status, "canceled");

  const oldCreatedAt = admin.firestore.Timestamp.fromMillis(Date.now() - 31 * 24 * 60 * 60 * 1000);
  const oldExpiresAt = admin.firestore.Timestamp.fromMillis(oldCreatedAt.toMillis() + 30 * 24 * 60 * 60 * 1000);
  const expiredId = `${outsider.uid}__${c.uid}`;
  await db.collection("friendRequests").doc(expiredId).set({
    fromUserId: outsider.uid, fromDisplayName: "Other Olson", toUserId: c.uid, toDisplayName: "Casey Carter",
    status: "pending", createdAt: oldCreatedAt, updatedAt: oldCreatedAt, expiresAt: oldExpiresAt,
    respondedAt: null, acceptedAt: null, declinedAt: null, canceledAt: null, expiredAt: null,
    notificationId: `friendRequest_${expiredId}_old`,
  });
  await db.collection("userNotifications").doc(c.uid).collection("notifications").doc(`friendRequest_${expiredId}_old`).set({
    recipientUserId: c.uid, type: "friendRequest", friendRequestId: expiredId, status: "active",
    isRead: false, readAt: null, dismissedAt: null, dismissReason: null, createdAt: oldCreatedAt,
  });
  assert.deepEqual((await c.call("getActiveFriendRequests")).incoming, []);
  assert.equal((await db.collection("friendRequests").doc(expiredId).get()).data().status, "expired");
  assert.equal((await db.collection("userNotifications").doc(c.uid).collection("notifications").doc(`friendRequest_${expiredId}_old`).get()).data().dismissReason, "resolved");

  const pendingBeforeBlock = await outsider.call("sendFriendRequest", { targetUserId: c.uid });
  await c.call("blockFriendChatUser", { blockedUserId: outsider.uid });
  assert.equal((await db.collection("friendRequests").doc(pendingBeforeBlock.requestId).get()).data().status, "canceled");
  assert.deepEqual((await c.call("getActiveFriendRequests")).incoming, []);
  await assert.rejects(() => c.call("createOrOpenDirectConversation", { friendUserId: outsider.uid }), hasCode("permission-denied"));

  const publicNames = await a.call("getPublicUserProfiles", { userIds: [b.uid, c.uid] });
  assert.deepEqual(publicNames.profiles.map((profile) => profile.displayName).sort(), ["Bailey Brown", "Casey Carter"]);
  publicNames.profiles.forEach((profile) => {
    for (const privateField of ["email", "phoneNumber", "children", "location", "friendIds"]) assert.equal(Object.hasOwn(profile, privateField), false);
  });

  await waitFor(async () => {
    const notifications = await db.collection("userNotifications").doc(a.uid).collection("notifications")
      .where("type", "==", "friendRequestAccepted").get();
    return notifications.size > 0;
  });
  const declineNotifications = await db.collection("userNotifications").doc(a.uid).collection("notifications")
    .where("type", "==", "friendRequest").get();
  assert.equal(declineNotifications.docs.every((document) => document.data().dismissedAt != null), true);

  console.log("Friend request send/decline/accept/cancel/expiry/name/block/notification/Chat emulator tests passed.");
}
run().catch((error) => { console.error(error); process.exit(1); });
