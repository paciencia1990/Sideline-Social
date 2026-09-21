"use strict";

const assert = require("node:assert/strict");
const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } = require("firebase/auth");
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require("firebase/functions");

const projectId = process.env.GCLOUD_PROJECT || "sideline-weekly-challenge-functions-test";
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();

async function run() {
  const app = initializeApp({ apiKey: "demo-key", projectId }, "weekly-parent");
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const credential = await createUserWithEmailAndPassword(auth, "weekly-parent@example.test", "ValidPass123!");
  const uid = credential.user.uid;
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  await db.collection("users").doc(uid).set({
    displayName: "Weekly Parent",
    sidelineStars: 10,
    timezone: "America/Los_Angeles",
  });

  const getWeekly = httpsCallable(functions, "getCurrentWeeklyChallenge");
  const completeWeekly = httpsCallable(functions, "completeWeeklyChallenge");
  const first = (await getWeekly({ timezone: "Europe/London" })).data.challenge;
  const second = (await getWeekly({ timezone: "America/New_York" })).data.challenge;
  assert.equal(first.timezone, "America/Los_Angeles", "the stored valid timezone takes precedence over a device hint");
  assert.equal(second.weekKey, first.weekKey, "reloading within the same local week returns the persisted assignment");
  assert.equal(second.challengeId, first.challengeId, "the persisted assignment remains stable");
  assert.equal((await db.collection("users").doc(uid).collection("weeklyChallenges").get()).size, 1, "loading creates only one weekly assignment");

  const completion = (await completeWeekly({ weekKey: first.weekKey })).data;
  assert.equal(completion.alreadyCompleted, false);
  assert.equal(completion.pointsAwarded, 5);
  assert.equal(completion.sidelineStars, 15);
  const duplicate = (await completeWeekly({ weekKey: first.weekKey })).data;
  assert.equal(duplicate.alreadyCompleted, true, "a second completion is recognized as already complete");
  assert.equal(duplicate.pointsAwarded, 0, "a second completion awards no points");
  assert.equal(duplicate.sidelineStars, 15, "a second completion cannot increment the balance");
  assert.equal((await db.collection("users").doc(uid).collection("rewardTransactions").get()).size, 1, "one week has one reward ledger entry");
  assert.equal((await db.collection("activity").where("userId", "==", uid).get()).size, 1, "one week has one completion activity");

  const expiredWeekKey = previousWeekKey(first.weekKey);
  await db.collection("users").doc(uid).collection("weeklyChallenges").doc(expiredWeekKey).set({
    ...first,
    weekKey: expiredWeekKey,
    completed: false,
    completedAt: null,
    pointsAwarded: false,
  });
  await assert.rejects(
    () => completeWeekly({ weekKey: expiredWeekKey }),
    (error) => String(error?.code).includes("failed-precondition"),
    "an expired weekly assignment cannot award points",
  );

  const anonymousApp = initializeApp({ apiKey: "demo-key", projectId }, "weekly-anonymous");
  const anonymousFunctions = getFunctions(anonymousApp, "us-central1");
  connectFunctionsEmulator(anonymousFunctions, "127.0.0.1", 5001);
  await assert.rejects(
    () => httpsCallable(anonymousFunctions, "getCurrentWeeklyChallenge")({}),
    (error) => String(error?.code).includes("unauthenticated"),
    "assignment requires authentication",
  );

  console.log("Weekly Challenge callable assignment, timezone, completion, expiry, and once-only reward checks passed.");
}

function previousWeekKey(weekKey) {
  const [year, month, day] = weekKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 7);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
