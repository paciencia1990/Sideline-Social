const assert = require("node:assert/strict");
const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } = require("firebase/auth");
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require("firebase/functions");

const projectId = process.env.GCLOUD_PROJECT || "sideline-account-deletion-functions-test";
if (!admin.apps.length) {
  admin.initializeApp({
    projectId,
    databaseURL: `https://${projectId}.firebaseio.com`,
  });
}
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

function hasCode(code) {
  return (error) => String(error?.code).includes(code);
}

async function run() {
  const [deletingUser, friend, soleOwner] = await Promise.all([
    createClient("delete-account-user"),
    createClient("delete-account-friend"),
    createClient("delete-account-owner"),
  ]);

  await Promise.all([
    db.collection("users").doc(deletingUser.uid).set({ displayName: "Delete Me", friendIds: [friend.uid] }),
    db.collection("users").doc(deletingUser.uid).collection("children").doc("child-1").set({ firstName: "Child" }),
    db.collection("publicUserProfiles").doc(deletingUser.uid).set({ displayName: "Delete D." }),
    db.collection("notificationTokens").doc("delete-token").set({ uid: deletingUser.uid, token: "redacted-test-token" }),
    db.collection("users").doc(friend.uid).set({ displayName: "Friend", friendIds: [deletingUser.uid] }),
    db.collection("userNotifications").doc(friend.uid).collection("notifications").doc("actor-reference").set({
      actorName: "Delete Me", actorUserId: deletingUser.uid, recipientUserId: friend.uid,
    }),
    db.collection("chatModerationReports").doc("chat-report").set({ reporterUserId: deletingUser.uid, reportedUserId: friend.uid }),
    db.collection("contentModerationReports").doc("team-report").set({ reporterUserId: friend.uid, reportedUserId: deletingUser.uid }),
    admin.database().ref(`gameSessions/test-session/players/${deletingUser.uid}`).set({ score: 10 }),
  ]);

  const result = await deletingUser.call("deleteOwnAccount");
  assert.equal(result.deleted, true);
  assert.equal((await db.collection("users").doc(deletingUser.uid).get()).exists, false);
  assert.equal((await db.collection("publicUserProfiles").doc(deletingUser.uid).get()).exists, false);
  assert.equal((await db.collection("notificationTokens").doc("delete-token").get()).exists, false);
  assert.deepEqual((await db.collection("users").doc(friend.uid).get()).data().friendIds, []);
  const notification = (await db.collection("userNotifications").doc(friend.uid).collection("notifications").doc("actor-reference").get()).data();
  assert.equal(notification.actorUserId, null);
  assert.equal(notification.actorName, "Deleted user");
  assert.equal((await db.collection("chatModerationReports").doc("chat-report").get()).data().reporterUserId, null);
  assert.equal((await db.collection("contentModerationReports").doc("team-report").get()).data().reportedUserId, null);
  assert.equal((await admin.database().ref(`gameSessions/test-session/players/${deletingUser.uid}`).get()).exists(), false);
  await assert.rejects(() => admin.auth().getUser(deletingUser.uid), (error) => error?.code === "auth/user-not-found");

  await Promise.all([
    db.collection("users").doc(soleOwner.uid).set({ displayName: "Sole Owner" }),
    db.collection("teams").doc("sole-owner-team").set({ createdBy: soleOwner.uid, name: "Solo Team", status: "active" }),
    db.collection("teams").doc("sole-owner-team").collection("members").doc(soleOwner.uid).set({
      role: "coach", roles: { coach: true, parent: false, staff: false }, status: "active", userId: soleOwner.uid,
    }),
  ]);
  await assert.rejects(() => soleOwner.call("deleteOwnAccount"), hasCode("failed-precondition"));
  assert.equal((await admin.auth().getUser(soleOwner.uid)).uid, soleOwner.uid);
  assert.equal((await db.collection("users").doc(soleOwner.uid).get()).exists, true);

  console.log("Account deletion cleanup, anonymization, Auth-last behavior, Realtime Database cleanup, and sole-owner blocking tests passed.");
}

run()
  .then(async () => {
    await Promise.all(admin.apps.map((app) => app.delete()));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
