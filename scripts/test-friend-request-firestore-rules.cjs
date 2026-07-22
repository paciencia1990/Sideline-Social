const fs = require("node:fs");
const path = require("node:path");
const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } = require("firebase/firestore");

const projectId = "sideline-friend-request-rules-test";
const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");
const now = () => Timestamp.now();

async function seed(testEnv) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "friendRequests", "sender__recipient"), {
      fromUserId: "sender",
      fromDisplayName: "Sam S.",
      toUserId: "recipient",
      toDisplayName: "Riley R.",
      status: "pending",
      createdAt: now(),
      updatedAt: now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000),
      respondedAt: null, acceptedAt: null, declinedAt: null, canceledAt: null, expiredAt: null,
    });
    await setDoc(doc(db, "publicUserProfiles", "sender"), {
      userId: "sender", firstName: "Sam", lastName: "Sender", displayName: "Sam Sender",
      photoURL: null, updatedAt: now(),
    });
    await setDoc(doc(db, "users", "sender"), {
      displayName: "Sam Sender", email: "sam.private@example.test", phone: "+15555550100",
    });
  });
}

async function run() {
  const testEnv = await initializeTestEnvironment({ projectId, firestore: { rules } });
  try {
    await testEnv.clearFirestore();
    await seed(testEnv);
    const senderDb = testEnv.authenticatedContext("sender").firestore();
    const recipientDb = testEnv.authenticatedContext("recipient").firestore();
    const outsiderDb = testEnv.authenticatedContext("outsider").firestore();
    const guestDb = testEnv.unauthenticatedContext().firestore();
    const requestRef = (db) => doc(db, "friendRequests", "sender__recipient");

    await assertSucceeds(getDoc(requestRef(senderDb)));
    await assertSucceeds(getDoc(requestRef(recipientDb)));
    await assertFails(getDoc(requestRef(outsiderDb)));
    await assertSucceeds(getDocs(query(collection(senderDb, "friendRequests"), where("fromUserId", "==", "sender"), where("status", "==", "pending"))));
    await assertSucceeds(getDocs(query(collection(recipientDb, "friendRequests"), where("toUserId", "==", "recipient"), where("status", "==", "pending"))));
    await assertFails(getDocs(query(collection(outsiderDb, "friendRequests"), where("status", "==", "pending"))));

    const injectedRequest = {
      fromUserId: "sender", fromDisplayName: "Sam S.", toUserId: "outsider",
      toDisplayName: "Other O.", status: "pending", createdAt: now(), updatedAt: now(),
    };
    await assertFails(setDoc(doc(senderDb, "friendRequests", "injected"), injectedRequest));
    await assertFails(setDoc(doc(outsiderDb, "friendRequests", "impersonated"), { ...injectedRequest, fromUserId: "sender" }));
    await assertFails(updateDoc(requestRef(recipientDb), { status: "accepted", updatedAt: now() }));
    await assertFails(updateDoc(requestRef(senderDb), { expiresAt: Timestamp.fromMillis(Date.now() + 60 * 24 * 60 * 60 * 1000) }));
    await assertFails(deleteDoc(requestRef(senderDb)));

    await assertSucceeds(getDoc(doc(recipientDb, "publicUserProfiles", "sender")));
    await assertSucceeds(getDoc(doc(outsiderDb, "publicUserProfiles", "sender")));
    await assertFails(getDoc(doc(guestDb, "publicUserProfiles", "sender")));
    await assertFails(getDocs(collection(recipientDb, "publicUserProfiles")));
    await assertSucceeds(getDoc(doc(senderDb, "users", "sender")));
    await assertFails(getDoc(doc(outsiderDb, "users", "sender")));
    await assertFails(getDocs(collection(senderDb, "users")));
    await assertFails(setDoc(doc(recipientDb, "publicUserProfiles", "recipient"), {
      userId: "recipient", firstName: "Riley", lastName: "Recipient", displayName: "Riley Recipient",
      photoURL: null, updatedAt: now(),
    }));
    await assertFails(updateDoc(doc(senderDb, "publicUserProfiles", "sender"), { displayName: "Spoofed Name" }));

    console.log("Friend request participant-read and callable-only mutation rules tests passed.");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
