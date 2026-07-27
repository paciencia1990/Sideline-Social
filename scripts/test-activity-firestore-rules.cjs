"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  assertFails,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");
const {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} = require("firebase/firestore");

const projectId = "sideline-activity-rules-test";
const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");
const activityPath = ["activity", "weeklyChallenge_2026-07-27_parent-a"];

async function seedTrustedActivity(testEnvironment) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), ...activityPath), {
      type: "complete_challenge",
      userId: "parent-a",
      displayName: "Parent A",
      avatarUrl: null,
      squadId: null,
      challengeId: "challenge-1",
      weekKey: "2026-07-27",
      message: "Parent A completed this week's challenge!",
      message_es: "Parent A completó el reto de esta semana.",
      createdAt: Timestamp.now(),
    });
  });
}

async function run() {
  const testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });

  try {
    await testEnvironment.clearFirestore();
    await seedTrustedActivity(testEnvironment);

    const anonymousDb = testEnvironment.unauthenticatedContext().firestore();
    const parentADb = testEnvironment.authenticatedContext("parent-a").firestore();
    const parentBDb = testEnvironment.authenticatedContext("parent-b").firestore();

    await assertFails(getDoc(doc(anonymousDb, ...activityPath)));
    await assertFails(getDocs(collection(anonymousDb, "activity")));
    await assertFails(setDoc(doc(anonymousDb, "activity", "anonymous"), {
      type: "complete_challenge",
      userId: "anonymous",
      createdAt: Timestamp.now(),
    }));

    await assertFails(getDoc(doc(parentADb, ...activityPath)));
    await assertFails(getDocs(collection(parentADb, "activity")));
    await assertFails(getDoc(doc(parentBDb, ...activityPath)));
    await assertFails(getDocs(collection(parentBDb, "activity")));

    await assertFails(setDoc(doc(parentADb, "activity", "self-attributed"), {
      type: "complete_challenge",
      userId: "parent-a",
      createdAt: Timestamp.now(),
    }));
    await assertFails(setDoc(doc(parentADb, "activity", "cross-user"), {
      type: "complete_challenge",
      userId: "parent-b",
      createdAt: Timestamp.now(),
    }));
    await assertFails(setDoc(doc(parentADb, "activity", "injected-fields"), {
      type: "complete_challenge",
      userId: "parent-a",
      arbitraryAdminField: true,
      createdAt: Timestamp.now(),
    }));

    await assertFails(updateDoc(doc(parentADb, ...activityPath), {
      message: "client mutation",
    }));
    await assertFails(deleteDoc(doc(parentADb, ...activityPath)));
    await assertFails(updateDoc(doc(parentBDb, ...activityPath), {
      userId: "parent-b",
    }));
    await assertFails(deleteDoc(doc(parentBDb, ...activityPath)));

    console.log("Global activity Firestore rules deny all anonymous and authenticated client access.");
  } finally {
    await testEnvironment.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
