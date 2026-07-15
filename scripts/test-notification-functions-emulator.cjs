const assert = require("node:assert/strict");
const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } = require("firebase/auth");
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require("firebase/functions");

const projectId = process.env.GCLOUD_PROJECT || "sideline-notifications-functions-test";
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();

async function createClient(label) {
  const app = initializeApp({ apiKey: "demo-key", projectId }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const credential = await createUserWithEmailAndPassword(auth, `${label}@example.test`, "ValidPass123!");
  const callableFunctions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(callableFunctions, "127.0.0.1", 5001);
  return { functions: callableFunctions, uid: credential.user.uid };
}

function notification(overrides = {}) {
  return {
    recipientUserId: "",
    type: "friendRequest",
    titleKey: "notifications.types.friendRequestTitle",
    bodyKey: "notifications.types.friendRequestBody",
    params: { actorName: "Test Parent" },
    createdAt: admin.firestore.Timestamp.now(),
    isRead: false,
    readAt: null,
    dismissedAt: null,
    dismissReason: null,
    status: "active",
    protectedContent: "unchanged",
    ...overrides,
  };
}

async function run() {
  const parentA = await createClient("notification-parent-a");
  const parentB = await createClient("notification-parent-b");
  const collectionA = db.collection("userNotifications").doc(parentA.uid).collection("notifications");
  const collectionB = db.collection("userNotifications").doc(parentB.uid).collection("notifications");
  const preservedReadAt = admin.firestore.Timestamp.fromMillis(Date.now() - 123456);

  await Promise.all([
    collectionA.doc("open-me").set(notification({ recipientUserId: parentA.uid })),
    collectionA.doc("preserve-read-at").set(notification({
      recipientUserId: parentA.uid, isRead: true, readAt: preservedReadAt,
    })),
    collectionB.doc("open-me").set(notification({ recipientUserId: parentB.uid })),
  ]);

  const acknowledgeA = httpsCallable(parentA.functions, "acknowledgeNotificationOpened");
  assert.deepEqual((await acknowledgeA({ notificationId: "open-me" })).data, { status: "dismissed" });
  assert.deepEqual((await acknowledgeA({ notificationId: "open-me" })).data, { status: "alreadyDismissed" });
  assert.deepEqual((await acknowledgeA({ notificationId: "missing" })).data, { status: "notFound" });
  await assert.rejects(() => acknowledgeA({ notificationId: "bad/path" }), (error) => String(error?.code).includes("invalid-argument"));

  const opened = (await collectionA.doc("open-me").get()).data();
  assert.equal(opened.isRead, true);
  assert.equal(opened.dismissReason, "opened");
  assert.ok(opened.dismissedAt instanceof admin.firestore.Timestamp);
  assert.equal(opened.protectedContent, "unchanged");
  assert.equal((await collectionB.doc("open-me").get()).data().dismissedAt, null, "another recipient is untouched");

  assert.equal((await acknowledgeA({ notificationId: "preserve-read-at" })).data.status, "dismissed");
  assert.equal((await collectionA.doc("preserve-read-at").get()).data().readAt.toMillis(), preservedReadAt.toMillis());

  const writes = [];
  for (let index = 0; index < 405; index += 1) {
    writes.push(collectionA.doc(`clear-${String(index).padStart(3, "0")}`).set(notification({ recipientUserId: parentA.uid })));
  }
  await Promise.all(writes);
  await collectionA.doc("legacy-read-hidden").set({
    ...notification({ recipientUserId: parentA.uid, isRead: true, readAt: admin.firestore.Timestamp.now() }),
    dismissedAt: admin.firestore.FieldValue.delete(),
    dismissReason: admin.firestore.FieldValue.delete(),
  }, { merge: true });

  const clearA = httpsCallable(parentA.functions, "clearUserNotifications");
  assert.equal((await clearA({})).data.clearedCount, 405);
  assert.equal((await clearA({})).data.clearedCount, 0, "Clear all is idempotent");
  const cleared = (await collectionA.doc("clear-404").get()).data();
  assert.equal(cleared.dismissReason, "clearAll");
  assert.ok(cleared.dismissedAt instanceof admin.firestore.Timestamp);

  const anonymousApp = initializeApp({ apiKey: "demo-key", projectId }, "notification-anonymous");
  const anonymousFunctions = getFunctions(anonymousApp, "us-central1");
  connectFunctionsEmulator(anonymousFunctions, "127.0.0.1", 5001);
  await assert.rejects(
    () => httpsCallable(anonymousFunctions, "acknowledgeNotificationOpened")({ notificationId: "open-me" }),
    (error) => String(error?.code).includes("unauthenticated"),
  );

  console.log("Notification acknowledgement, ownership, idempotency, pagination, and Clear all function tests passed.");
}

run().catch((error) => { console.error(error); process.exit(1); });
