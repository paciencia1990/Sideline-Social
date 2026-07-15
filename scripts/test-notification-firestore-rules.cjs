const fs = require("node:fs");
const path = require("node:path");
const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } = require("firebase/firestore");

const projectId = "sideline-notification-rules-test";
const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");
const now = () => Timestamp.now();

async function seed(testEnv) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "userNotifications", "parent-a", "notifications", "friendRequest_request-1"), {
      recipientUserId: "parent-a",
      type: "friendRequest",
      titleKey: "notifications.types.friendRequestTitle",
      bodyKey: "notifications.types.friendRequestBody",
      params: { actorName: "Maria R." },
      createdAt: now(),
      readAt: null,
      isRead: false,
      dismissedAt: null,
      dismissReason: null,
      status: "active",
      actorUserId: "parent-b",
      teamId: null,
      announcementId: null,
      friendRequestId: "request-1",
      expiresAt: null,
    });
  });
}

async function run() {
  const testEnv = await initializeTestEnvironment({ projectId, firestore: { rules } });
  try {
    await testEnv.clearFirestore();
    await seed(testEnv);
    const ownerDb = testEnv.authenticatedContext("parent-a").firestore();
    const otherDb = testEnv.authenticatedContext("parent-b").firestore();
    const anonymousDb = testEnv.unauthenticatedContext().firestore();
    const notificationPath = ["userNotifications", "parent-a", "notifications", "friendRequest_request-1"];

    await assertSucceeds(getDoc(doc(ownerDb, ...notificationPath)));
    await assertSucceeds(getDocs(collection(ownerDb, "userNotifications", "parent-a", "notifications")));
    await assertFails(getDoc(doc(otherDb, ...notificationPath)));
    await assertFails(getDocs(collection(otherDb, "userNotifications", "parent-a", "notifications")));
    await assertFails(getDoc(doc(anonymousDb, ...notificationPath)));

    await assertFails(setDoc(doc(ownerDb, "userNotifications", "parent-a", "notifications", "injected"), {
      recipientUserId: "parent-a", type: "coachAnnouncement", createdAt: now(), readAt: null, isRead: false, status: "active",
    }));
    await assertFails(deleteDoc(doc(ownerDb, ...notificationPath)));
    await assertFails(updateDoc(doc(otherDb, ...notificationPath), { isRead: true, readAt: now() }));
    await assertFails(updateDoc(doc(ownerDb, ...notificationPath), { recipientUserId: "parent-b", isRead: true, readAt: now() }));
    await assertFails(updateDoc(doc(ownerDb, ...notificationPath), { type: "gameInvitation", isRead: true, readAt: now() }));
    await assertFails(updateDoc(doc(ownerDb, ...notificationPath), { isRead: false, readAt: now() }));
    await assertFails(updateDoc(doc(ownerDb, ...notificationPath), { isRead: true, readAt: now() }));
    await assertFails(updateDoc(doc(ownerDb, ...notificationPath), {
      isRead: true, readAt: now(), dismissedAt: now(), dismissReason: "opened",
    }));

    console.log("Notification Firestore recipient privacy and callable-only mutation rules tests passed.");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
