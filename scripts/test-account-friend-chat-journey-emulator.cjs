"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const admin = require("../functions/node_modules/firebase-admin");
const { deleteApp, initializeApp } = require("firebase/app");
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } = require("firebase/auth");
const { connectFirestoreEmulator, doc, getDoc, getFirestore, serverTimestamp, setDoc, terminate } = require("firebase/firestore");
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require("firebase/functions");

require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText, filename);
};

const { buildCanonicalAccountProfile } = require(path.join(__dirname, "..", "utils", "accountProfileCore.ts"));
const projectId = process.env.GCLOUD_PROJECT || "sideline-account-friend-chat-functions-test";
if (!admin.apps.length) admin.initializeApp({ projectId });
const adminDb = admin.firestore();
const ownedApps = [];
const ownedDatabases = [];

async function createAccount(label, firstName, lastName) {
  const app = initializeApp({ apiKey: "demo-key", projectId }, `journey-${label}`);
  ownedApps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const credential = await createUserWithEmailAndPassword(auth, `${label}@example.test`, "ValidPass123!");
  const db = getFirestore(app);
  ownedDatabases.push(db);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const timestamp = serverTimestamp();
  await setDoc(doc(db, "users", credential.user.uid), buildCanonicalAccountProfile({
    adultEligibilityConfirmed: true,
    email: credential.user.email,
    firstName,
    lastName,
    policiesAccepted: true,
    preferredLanguage: "en",
    sports: [],
    userId: credential.user.uid,
    zipCode: "",
  }, { createdAt: timestamp, updatedAt: timestamp }, "synthetic-current"));
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return {
    auth,
    db,
    uid: credential.user.uid,
    call: (name, data = {}) => httpsCallable(functions, name)(data).then((result) => result.data),
  };
}

async function waitFor(check, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for emulator state");
}

async function run() {
  const [reporter, affected] = await Promise.all([
    createAccount("reporter", "Riley", "Reporter"),
    createAccount("affected", "Avery", "Affected"),
  ]);
  const reporterProfile = await getDoc(doc(reporter.db, "users", reporter.uid));
  assert.equal(reporterProfile.data().accountOnboardingCompleted, true);
  assert.equal(reporterProfile.data().displayName, "Riley Reporter");

  await waitFor(async () => (await adminDb.collection("publicUserProfiles").doc(affected.uid).get()).exists);
  const search = await reporter.call("searchPublicUserProfiles", { query: "Avery", limit: 20 });
  assert.equal(search.results.length, 1);
  assert.equal(search.results[0].userId, affected.uid);
  assert.equal(search.results[0].displayName, "Avery Affected");

  const request = await reporter.call("sendFriendRequest", { targetUserId: affected.uid });
  assert.equal(request.status, "pending");
  const accepted = await affected.call("respondToFriendRequest", { requestId: request.requestId, response: "accept" });
  assert.equal(accepted.status, "accepted");
  const conversation = await reporter.call("createOrOpenDirectConversation", { friendUserId: affected.uid });
  assert.equal(conversation.status, "created");
  const message = await reporter.call("sendFriendChatMessage", {
    clientMessageId: "journey_message_001",
    conversationId: conversation.conversationId,
    text: "Synthetic end-to-end hello",
  });
  assert.equal(message.status, "sent");
  const stored = await adminDb.collection("friendConversations").doc(conversation.conversationId)
    .collection("messages").doc(message.messageId).get();
  assert.equal(stored.data().text, "Synthetic end-to-end hello");
  assert.deepEqual(new Set((await adminDb.collection("friendConversations").doc(conversation.conversationId).get()).data().activeParticipantIds), new Set([reporter.uid, affected.uid]));
  console.log("Client-auth account creation, canonical profiles, public search, friendship, direct conversation, and chat emulator journey passed.");
}

async function cleanup() {
  await Promise.allSettled(ownedDatabases.map((database) => terminate(database)));
  await Promise.allSettled(ownedApps.map((app) => deleteApp(app)));
  await Promise.allSettled(admin.apps.map((app) => app.delete()));
}

run()
  .then(cleanup)
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    await cleanup();
  });
