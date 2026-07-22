const assert = require("node:assert/strict");
const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } = require("firebase/auth");
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require("firebase/functions");

const projectId = process.env.GCLOUD_PROJECT || "sideline-stars-functions-test";
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();

async function createClient(label) {
  const app = initializeApp({ apiKey: "demo-key", projectId }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const credential = await createUserWithEmailAndPassword(auth, `${label}@example.test`, "ValidPass123!");
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { functions, uid: credential.user.uid };
}

async function run() {
  const parentA = await createClient("parent-a");
  const parentB = await createClient("parent-b");
  const outsider = await createClient("outsider");
  const squadId = "dr-phillips__baseball";
  const secondSquadId = "ymca__basketball";
  const fallFixtureSquadId = "fall-fixture__baseball";
  await Promise.all([
    db.collection("squads").doc(squadId).set({ venueName: "Dr. Phillips Little League", sportId: "baseball", sportDisplayName: "Baseball", isActive: true, createdBy: parentA.uid, currentSeasonId: null }),
    db.collection("squads").doc(secondSquadId).set({ venueName: "YMCA", sportId: "basketball", sportDisplayName: "Basketball", isActive: true, createdBy: parentA.uid, currentSeasonId: null }),
    db.collection("squads").doc(fallFixtureSquadId).set({ venueName: "Fixture Venue", sportId: "baseball", sportDisplayName: "Baseball", isActive: true, createdBy: parentA.uid, currentSeasonId: null }),
    db.collection("users").doc(parentA.uid).set({ displayName: "Joann Pollard", sidelineStars: 10 }),
    db.collection("users").doc(parentB.uid).set({ firstName: "Maria", lastName: "Garcia", email: "private@example.test", sidelineStars: 20 }),
    db.collection("users").doc(outsider.uid).set({ displayName: "Outside Person", sidelineStars: 999 }),
  ]);
  await Promise.all([
    membership(squadId, parentA.uid, "active", "away"),
    membership(squadId, parentB.uid, "active", "recent"),
    membership(squadId, outsider.uid, "left", "away"),
    membership(secondSquadId, parentA.uid, "active", "away"),
    membership(secondSquadId, parentB.uid, "active", "recent"),
    membership(fallFixtureSquadId, parentA.uid, "active", "away"),
  ]);

  const createSeason = httpsCallable(parentA.functions, "createSquadSeason");
  const today = calendarDate(new Date());
  const endDate = calendarDate(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000));
  const firstSeason = (await createSeason({
    squadId, name: "Spring Test", startDate: today, endDate,
    timeZone: "America/New_York", startNow: true, idempotencyKey: "spring-season-request-1",
  })).data;
  const firstSeasonRetry = (await createSeason({
    squadId, name: "Spring Test", startDate: today, endDate,
    timeZone: "America/New_York", startNow: true, idempotencyKey: "spring-season-request-1",
  })).data;
  const secondSeason = (await createSeason({
    squadId: secondSquadId, name: "Basketball Test", startDate: today, endDate,
    timeZone: "America/New_York", startNow: true, idempotencyKey: "basketball-season-request-1",
  })).data;
  assert.equal(firstSeason.status, "active");
  assert.equal(firstSeasonRetry.seasonId, firstSeason.seasonId, "a retried season request is idempotent");
  assert.equal(firstSeasonRetry.alreadyCreated, true);
  assert.equal((await db.collection("squads").doc(squadId).collection("seasons").get()).size, 1);
  assert.equal(secondSeason.status, "active");
  const fallFixture = (await createSeason({
    squadId: fallFixtureSquadId,
    name: "Fall 2026",
    startDate: "2026-09-12",
    endDate: "2026-11-20",
    timeZone: "America/New_York",
    idempotencyKey: "fall-2026-fixture-request",
  })).data;
  const fallDocument = (await db.collection("squads").doc(fallFixtureSquadId).collection("seasons").doc(fallFixture.seasonId).get()).data();
  assert.equal(fallDocument.startDateKey, "2026-09-12");
  assert.equal(fallDocument.endDateKey, "2026-11-20");
  assert.equal(fallDocument.timeZone, "America/New_York");
  assert.equal(typeof fallDocument.startAt.toDate, "function", "Firestore stores canonical Timestamp values");
  const fallResponse = (await httpsCallable(parentA.functions, "getSquadSeasons")({ squadId: fallFixtureSquadId })).data;
  assert.equal(fallResponse.seasons[0].startDateKey, "2026-09-12");
  assert.equal(fallResponse.seasons[0].endDateKey, "2026-11-20");
  assert.equal(typeof fallResponse.seasons[0].startAtMs, "number", "callables return method-free timestamps as milliseconds");
  await membership(fallFixtureSquadId, parentA.uid, "left", "away");
  await assert.rejects(
    () => httpsCallable(parentB.functions, "createSquadSeason")({
      squadId, name: "Coach Cannot Create", startDate: today, endDate,
      timeZone: "America/New_York", startNow: true,
    }),
    (error) => String(error?.code).includes("permission-denied"),
  );

  const getLeaderboardA = httpsCallable(parentA.functions, "getSquadLeaderboard");
  const initial = (await getLeaderboardA({ squadId })).data;
  assert.equal(initial.squad.venueName, "Dr. Phillips Little League");
  assert.equal(initial.squad.sportDisplayName, "Baseball");
  assert.equal(initial.season.name, "Spring Test");
  assert.deepEqual(initial.entries.map((entry) => entry.displayName), ["Joann P.", "Maria G."]);
  assert.ok(initial.entries.every((entry) => entry.seasonStars === 0), "a new season begins at zero");
  assert.equal(initial.currentUserLifetimeStars, 10, "lifetime Stars remain separate");
  assert.ok(initial.entries.some((entry) => entry.isCurrentUser), "current user is highlighted");
  assert.equal(initial.entries.some((entry) => entry.userId === outsider.uid), false, "left members are excluded");
  assert.equal(initial.entries.some((entry) => "email" in entry || "children" in entry), false, "complete profiles are never returned");

  const getSeasonsA = httpsCallable(parentA.functions, "getSquadSeasons");
  const getSeasonsB = httpsCallable(parentB.functions, "getSquadSeasons");
  assert.equal((await getSeasonsA({ squadId })).data.canManageSeasons, true, "the recorded creator is the initial Squad Admin");
  assert.equal((await getSeasonsB({ squadId })).data.canManageSeasons, false, "ordinary members do not receive management controls");
  const updateSeason = httpsCallable(parentA.functions, "updateSquadSeason");
  await assert.rejects(
    () => updateSeason({ squadId, seasonId: firstSeason.seasonId, startDate: today }),
    (error) => String(error?.code).includes("failed-precondition"),
  );
  await assert.rejects(
    () => updateSeason({ squadId, seasonId: firstSeason.seasonId, endDate: today }),
    (error) => String(error?.code).includes("failed-precondition"),
  );
  const extendedEndDate = calendarDate(new Date(Date.now() + 120 * 24 * 60 * 60 * 1000));
  await updateSeason({ squadId, seasonId: firstSeason.seasonId, name: "Spring Test Extended", endDate: extendedEndDate });
  await assert.rejects(
    () => createSeason({
      squadId, name: "Overlapping Season", startDate: calendarDate(new Date(Date.now() + 24 * 60 * 60 * 1000)), endDate,
      timeZone: "America/New_York", idempotencyKey: "overlapping-season-request-1",
    }),
    (error) => String(error?.code).includes("already-exists"),
  );

  const outsiderLeaderboard = httpsCallable(outsider.functions, "getSquadLeaderboard");
  await assert.rejects(
    () => outsiderLeaderboard({ squadId }),
    (error) => String(error?.code).includes("permission-denied"),
  );

  const anonymousApp = initializeApp({ apiKey: "demo-key", projectId }, "anonymous");
  const anonymousFunctions = getFunctions(anonymousApp, "us-central1");
  connectFunctionsEmulator(anonymousFunctions, "127.0.0.1", 5001);
  await assert.rejects(
    () => httpsCallable(anonymousFunctions, "getSquadLeaderboard")({ squadId }),
    (error) => String(error?.code).includes("unauthenticated"),
  );
  await assert.rejects(
    () => httpsCallable(anonymousFunctions, "createSquadSeason")({
      squadId, name: "Anonymous", startDate: today, endDate, timeZone: "America/New_York", startNow: true,
    }),
    (error) => String(error?.code).includes("unauthenticated"),
  );

  const createSession = httpsCallable(parentA.functions, "createGameRewardSession");
  const recordResult = httpsCallable(parentA.functions, "recordGameSessionResult");
  const finalize = httpsCallable(parentA.functions, "finalizeGameReward");
  const firstSession = (await createSession({ gameType: "spotDifferences", sourceSquadId: squadId })).data.sessionId;
  await recordResult({ gameType: "spotDifferences", sessionId: firstSession, outcome: "timeExpired", foundCount: 6, totalDifferences: 10 });
  const firstReward = (await finalize({ gameType: "spotDifferences", sessionId: firstSession, starsAwarded: 999 })).data;
  assert.equal(firstReward.status, "awarded");
  assert.equal(firstReward.starsAwarded, 11);
  assert.equal(firstReward.totalSidelineStars, 21);
  const duplicate = (await finalize({ gameType: "spotDifferences", sessionId: firstSession })).data;
  assert.equal(duplicate.status, "alreadyAwarded");
  assert.equal(duplicate.totalSidelineStars, 21);

  const nonparticipantFinalize = httpsCallable(parentB.functions, "finalizeGameReward");
  const deniedReward = (await nonparticipantFinalize({ gameType: "spotDifferences", sessionId: firstSession })).data;
  assert.equal(deniedReward.status, "notEligible");
  assert.equal(deniedReward.starsAwarded, 0);

  const secondSession = (await createSession({ gameType: "spotDifferences" })).data.sessionId;
  await recordResult({ gameType: "spotDifferences", sessionId: secondSession, outcome: "completed", foundCount: 10, totalDifferences: 10 });
  const secondReward = (await finalize({ gameType: "spotDifferences", sessionId: secondSession })).data;
  assert.equal(secondReward.starsAwarded, 15, "a different session remains independently rewardable");
  assert.equal(secondReward.totalSidelineStars, 36);

  const explodedBombSession = (await createSession({ gameType: "bombDefusal" })).data.sessionId;
  await recordResult({ gameType: "bombDefusal", sessionId: explodedBombSession, outcome: "exploded", firstAttemptCorrectStepCount: 3, totalSteps: 5 });
  const explodedBombReward = (await finalize({ gameType: "bombDefusal", sessionId: explodedBombSession })).data;
  assert.equal(explodedBombReward.starsAwarded, 8);
  assert.equal(explodedBombReward.breakdown.performanceStars, 3);
  assert.equal(explodedBombReward.totalSidelineStars, 44);

  const defusedBombSession = (await createSession({ gameType: "bombDefusal" })).data.sessionId;
  await recordResult({ gameType: "bombDefusal", sessionId: defusedBombSession, outcome: "defused", firstAttemptCorrectStepCount: 5, totalSteps: 5 });
  const defusedBombReward = (await finalize({ gameType: "bombDefusal", sessionId: defusedBombSession })).data;
  assert.equal(defusedBombReward.starsAwarded, 15);
  assert.equal(defusedBombReward.breakdown.achievementStars, 5);
  assert.equal(defusedBombReward.totalSidelineStars, 59);

  const triviaId = "TRIVIA10";
  await db.collection("sessions").doc(triviaId).set({
    sessionId: triviaId, gameId: "triviaBlitz", gameType: "triviaBlitz", hostPlayerId: parentA.uid,
    playerIds: [parentA.uid], status: "results",
  });
  await db.collection("sessions").doc(triviaId).collection("games").doc("triviaBlitz").set({
    status: "results", questionIndex: 9, answeredQuestions: 10, correctAnswers: 7,
    selectedQuestions: Array.from({ length: 10 }, (_, index) => ({ index })),
  });
  await db.collection("sessions").doc(triviaId).collection("games").doc("triviaBlitz").collection("players").doc(parentA.uid).set({ ready: true });
  const triviaReward = (await finalize({ gameType: "triviaBlitz", sessionId: triviaId })).data;
  assert.equal(triviaReward.starsAwarded, 12);
  assert.equal(triviaReward.totalSidelineStars, 71);

  const getWeekly = httpsCallable(parentA.functions, "getCurrentWeeklyChallenge");
  const completeWeekly = httpsCallable(parentA.functions, "completeWeeklyChallenge");
  const assignment = (await getWeekly({ timezone: "America/New_York" })).data.challenge;
  assert.equal(assignment.points, 5);
  const weeklyReward = (await completeWeekly({ weekKey: assignment.weekKey })).data;
  assert.equal(weeklyReward.pointsAwarded, 5);
  assert.equal(weeklyReward.sidelineStars, 76);
  assert.equal((await completeWeekly({ weekKey: assignment.weekKey })).data.pointsAwarded, 0);

  const secondLeaderboard = (await getLeaderboardA({ squadId: secondSquadId })).data;
  await waitForSeasonStars(squadId, firstSeason.seasonId, parentA.uid, 66);
  await waitForSeasonStars(secondSquadId, secondSeason.seasonId, parentA.uid, 66);
  const projectedFirstLeaderboard = (await getLeaderboardA({ squadId })).data;
  const projectedSecondLeaderboard = (await getLeaderboardA({ squadId: secondSquadId })).data;
  assert.equal(projectedFirstLeaderboard.currentUserEntry.seasonStars, 66);
  assert.equal(projectedSecondLeaderboard.currentUserEntry.seasonStars, 66, "one global reward projects to every eligible Squad season");
  assert.equal(projectedSecondLeaderboard.currentUserLifetimeStars, 76, "lifetime Stars increment only once");
  const rewardDocs = await db.collection("users").doc(parentA.uid).collection("rewardTransactions").get();
  assert.equal(rewardDocs.size, 6, "more than three game sessions remain rewardable and each source has one ledger entry");
  assert.ok(rewardDocs.docs.every((document) => document.data().seasonEligibleSquadIds.length === 2), "each reward stores the trusted membership snapshot");
  const contributionDocs = await db.collection("squads").doc(squadId).collection("seasons").doc(firstSeason.seasonId)
    .collection("memberTotals").doc(parentA.uid).collection("contributions").get();
  assert.equal(contributionDocs.size, 6, "each reward contributes exactly once");

  const endSeason = httpsCallable(parentA.functions, "endSquadSeason");
  await endSeason({ squadId, seasonId: firstSeason.seasonId });
  const noActive = (await getLeaderboardA({ squadId })).data;
  assert.equal(noActive.season, null);
  assert.equal(noActive.currentUserLifetimeStars, 76);
  const finalStandings = (await getLeaderboardA({ squadId, seasonId: firstSeason.seasonId })).data;
  assert.equal(finalStandings.season.status, "closed");
  assert.equal(finalStandings.currentUserEntry.seasonStars, 66);
  await assert.rejects(
    () => updateSeason({ squadId, seasonId: firstSeason.seasonId, name: "Changed History" }),
    (error) => String(error?.code).includes("failed-precondition"),
  );
  const newSeason = (await createSeason({
    squadId, name: "Summer Test", startDate: today, endDate,
    timeZone: "America/New_York", startNow: true, idempotencyKey: "summer-season-request-1",
  })).data;
  const resetLeaderboard = (await getLeaderboardA({ squadId })).data;
  assert.equal(resetLeaderboard.season.seasonId, newSeason.seasonId);
  assert.equal(resetLeaderboard.currentUserEntry.seasonStars, 0, "a new season is zero-based");
  assert.equal(resetLeaderboard.currentUserLifetimeStars, 76, "starting a season never resets lifetime Stars");

  await membership(squadId, parentA.uid, "left", "away");
  const starsAfterLeave = (await db.collection("users").doc(parentA.uid).get()).data().sidelineStars;
  assert.equal(starsAfterLeave, 76, "leaving preserves lifetime Stars");
  await assert.rejects(
    () => getLeaderboardA({ squadId }),
    (error) => String(error?.code).includes("permission-denied"),
  );

  console.log("Sideline Stars Functions emulator integration tests passed.");
}

function membership(squadId, userId, membershipStatus, presenceStatus) {
  return db.collection("squadMemberships").doc(`${squadId}__${userId}`).set({
    squadId, userId, membershipStatus, presenceStatus,
  });
}

function calendarDate(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

async function waitForSeasonStars(squadId, seasonId, userId, expected) {
  const ref = db.collection("squads").doc(squadId).collection("seasons").doc(seasonId).collection("memberTotals").doc(userId);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const snapshot = await ref.get();
    if (snapshot.data()?.seasonStars === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const snapshot = await ref.get();
  assert.equal(snapshot.data()?.seasonStars, expected, "season projection did not settle before timeout");
}

run().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
