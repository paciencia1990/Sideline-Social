const fs = require("node:fs");
const path = require("node:path");
const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc } = require("firebase/firestore");

const projectId = "sideline-weekly-challenge-rules-test";
const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");

async function run() {
  const testEnv = await initializeTestEnvironment({ projectId, firestore: { rules } });
  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "users", "parent-a"), { sidelineStars: 100 });
      await setDoc(doc(db, "users", "parent-b"), { sidelineStars: 50 });
      await setDoc(doc(db, "users", "parent-a", "weeklyChallenges", "2026-07-06"), {
        weekKey: "2026-07-06",
        challengeId: "meet-new-parent",
        title: "Meet Someone New",
        description: "Introduce yourself to one parent you have not met before.",
        points: 50,
        category: "sidelineConnection",
        isActive: true,
        completed: false,
        completedAt: null,
        pointsAwarded: false,
        timezone: "America/New_York",
      });
      await setDoc(doc(db, "users", "parent-a", "rewardTransactions", "weeklyChallenge_2026-07-06"), {
        type: "weekly_challenge",
        points: 50,
      });
    });

    const ownDb = testEnv.authenticatedContext("parent-a").firestore();
    const otherDb = testEnv.authenticatedContext("parent-b").firestore();
    const anonDb = testEnv.unauthenticatedContext().firestore();
    const challengePath = (db) => doc(db, "users", "parent-a", "weeklyChallenges", "2026-07-06");
    const rewardPath = (db) => doc(db, "users", "parent-a", "rewardTransactions", "weeklyChallenge_2026-07-06");

    await assertSucceeds(getDoc(challengePath(ownDb)));
    await assertFails(getDoc(challengePath(otherDb)));
    await assertFails(getDoc(challengePath(anonDb)));
    await assertFails(setDoc(challengePath(ownDb), { completed: true }, { merge: true }));
    await assertSucceeds(getDoc(rewardPath(ownDb)));
    await assertFails(getDoc(rewardPath(otherDb)));
    await assertFails(setDoc(rewardPath(ownDb), { points: 999 }, { merge: true }));

    console.log("Weekly Challenge Firestore rules tests passed.");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});