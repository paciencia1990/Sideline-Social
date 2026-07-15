const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { Timestamp, collection, doc, getDoc, getDocs, setDoc, updateDoc } = require("firebase/firestore");

const projectId = "sideline-squad-rules-test";
const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");

async function run() {
  const testEnv = await initializeTestEnvironment({ projectId, firestore: { rules } });
  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "users", "parent-a"), { displayName: "Parent A", squadIds: ["venue__baseball"], selectedSquadId: "venue__baseball", sidelineStars: 0 });
      await setDoc(doc(db, "users", "parent-b"), { displayName: "Parent B", squadIds: [], selectedSquadId: null, sidelineStars: 0 });
      await setDoc(doc(db, "squads", "venue__baseball"), { venueName: "Venue", sportId: "baseball", isActive: true, memberIds: ["parent-a"] });
      await setDoc(doc(db, "squadMemberships", "venue__baseball__parent-a"), { userId: "parent-a", squadId: "venue__baseball", membershipStatus: "active", presenceStatus: "away", lastSeenAt: Timestamp.now() });
      await setDoc(doc(db, "squads", "venue__baseball", "seasons", "spring"), {
        seasonId: "spring", squadId: "venue__baseball", name: "Spring", status: "active",
        startAt: Timestamp.now(), endAt: Timestamp.now(), timeZone: "America/New_York",
      });
      await setDoc(doc(db, "squads", "venue__baseball", "seasons", "spring", "memberTotals", "parent-a"), {
        userId: "parent-a", seasonStars: 5, rewardCount: 1,
      });
      await setDoc(doc(db, "squads", "venue__baseball", "seasons", "spring", "memberTotals", "parent-a", "contributions", "reward-1"), {
        rewardId: "reward-1", amount: 5,
      });
    });
    const parentA = testEnv.authenticatedContext("parent-a").firestore();
    const parentB = testEnv.authenticatedContext("parent-b").firestore();
    await assertSucceeds(getDoc(doc(parentA, "squads", "venue__baseball")));
    await assertSucceeds(getDocs(collection(parentA, "squads")));
    await assertSucceeds(getDoc(doc(parentA, "squadMemberships", "venue__baseball__parent-a")));
    await assertFails(getDoc(doc(parentA, "squads", "venue__baseball", "seasons", "spring")));
    await assertFails(getDoc(doc(parentB, "squads", "venue__baseball", "seasons", "spring")));
    await assertFails(setDoc(doc(parentA, "squads", "venue__baseball", "seasons", "fall"), { status: "active" }));
    await assertFails(updateDoc(doc(parentA, "squads", "venue__baseball"), { currentSeasonId: "fall" }));
    await assertFails(updateDoc(doc(parentA, "squads", "venue__baseball", "seasons", "spring"), { status: "closed" }));
    await assertFails(getDoc(doc(parentA, "squads", "venue__baseball", "seasons", "spring", "memberTotals", "parent-a")));
    await assertFails(updateDoc(doc(parentA, "squads", "venue__baseball", "seasons", "spring", "memberTotals", "parent-a"), { seasonStars: 500 }));
    await assertFails(setDoc(doc(parentA, "squads", "venue__baseball", "seasons", "spring", "memberTotals", "parent-a", "contributions", "fake"), { amount: 500 }));
    await assertFails(updateDoc(doc(parentA, "squadMemberships", "venue__baseball__parent-a"), { squadRole: "admin" }));
    await assertFails(getDoc(doc(parentB, "squadMemberships", "venue__baseball__parent-a")));
    await assertFails(setDoc(doc(parentB, "squadMemberships", "venue__baseball__parent-b"), { userId: "parent-b", squadId: "venue__baseball", membershipStatus: "active" }));
    await assertFails(updateDoc(doc(parentA, "squads", "venue__baseball"), { memberIds: ["parent-a", "parent-b"] }));
    await assertFails(updateDoc(doc(parentA, "users", "parent-a"), { squadIds: [] }));
    await assertFails(updateDoc(doc(parentA, "users", "parent-a"), { selectedSquadId: null }));
    await assertFails(updateDoc(doc(parentA, "users", "parent-a"), { sidelineStars: 100 }));
    await assertFails(updateDoc(doc(parentA, "users", "parent-a"), { sidelineStars: 1 }));
    await assertFails(updateDoc(doc(parentA, "users", "parent-a"), { sidelineStars: -1 }));
    await assertSucceeds(updateDoc(doc(parentA, "users", "parent-a"), { displayName: "Parent A Updated" }));
    await assertFails(setDoc(doc(parentB, "users", "new-account"), { sidelineStars: 999, squadIds: [] }));
    await assertFails(setDoc(doc(parentA, "gameRewardSessions", "spotDifferences_fake"), { status: "completed", participantIds: ["parent-a"] }));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await updateDoc(doc(db, "users", "parent-a"), { sidelineStars: 5 });
      await setDoc(doc(db, "users", "parent-a", "rewardTransactions", "weeklyChallenge_2026-07-13"), { amount: 5, sourceType: "weeklyChallenge" });
    });
    await assertSucceeds(getDoc(doc(parentA, "users", "parent-a", "rewardTransactions", "weeklyChallenge_2026-07-13")));
    assert.ok(true);
    console.log("Squad Firestore authorization tests passed.");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
