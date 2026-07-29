const assert = require("node:assert/strict");
const admin = require("../functions/node_modules/firebase-admin");
const { deleteApp, initializeApp } = require("firebase/app");
const {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInAnonymously,
} = require("firebase/auth");
const {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
} = require("firebase/firestore");
const {
  connectDatabaseEmulator,
  get,
  getDatabase,
  ref,
} = require("firebase/database");
const {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} = require("firebase/functions");

const projectId = process.env.GCLOUD_PROJECT || "sideline-game-security-functions-test";
const databaseURL = `https://${projectId}-default-rtdb.firebaseio.com`;
if (!admin.apps.length) {
  admin.initializeApp({
    projectId,
    databaseURL,
  });
}
const adminFirestore = admin.firestore();
const adminDatabase = admin.database();

async function createClient(label, authentication = "password") {
  const app = initializeApp({ apiKey: "demo-key", projectId, databaseURL }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  let uid = null;
  if (authentication === "password") {
    uid = (
      await createUserWithEmailAndPassword(
        auth,
        `${label}@example.test`,
        "ValidPass123!",
      )
    ).user.uid;
  } else if (authentication === "anonymous") {
    uid = (await signInAnonymously(auth)).user.uid;
  }

  const firestore = getFirestore(app);
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  const database = getDatabase(app);
  connectDatabaseEmulator(database, "127.0.0.1", 9000);
  const callableFunctions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(callableFunctions, "127.0.0.1", 5001);
  return {
    app,
    uid,
    auth,
    firestore,
    database,
    call: (name, data = {}) =>
      httpsCallable(callableFunctions, name)(data).then((result) => result.data),
  };
}

function rejectsCode(code, reason) {
  return (error) => {
    const codeMatches = String(error?.code).includes(code);
    const reasonMatches =
      reason == null ||
      error?.details?.reason === reason ||
      String(error?.message).includes(reason);
    return codeMatches && reasonMatches;
  };
}

async function assertDenied(operation, label) {
  await assert.rejects(
    operation,
    isPermissionDenied,
    label,
  );
}

function isPermissionDenied(error) {
  return /permission[-_ ]?denied|unauthenticated/i.test(
    `${String(error?.code)} ${String(error?.message)}`,
  );
}

async function run() {
  const clients = await Promise.all([
    createClient("game-host"),
    createClient("game-participant"),
    createClient("game-unrelated"),
    createClient("game-parent"),
    createClient("game-coach"),
    createClient("game-staff"),
    createClient("game-anonymous-a", "anonymous"),
    createClient("game-anonymous-b", "anonymous"),
    createClient("game-signed-out", "none"),
  ]);
  const [
    host,
    participant,
    unrelated,
    parent,
    coach,
    staff,
    anonymousA,
    anonymousB,
    signedOut,
  ] = clients;

  await assertDatabaseRulesLoaded();
  await assertRealtimeDatabaseIsolation({
    host,
    participant,
    unrelated,
    anonymousA,
    anonymousB,
    signedOut,
  });
  await seedSocialFixtures({ host, participant, parent, coach, staff, anonymousA, anonymousB });

  for (const anonymous of [anonymousA, anonymousB]) {
    for (const [label, operation] of [
      ["user profile", () => getDoc(doc(anonymous.firestore, "users", parent.uid))],
      ["user enumeration", () => getDocs(collection(anonymous.firestore, "users"))],
      ["public profile", () => getDoc(doc(anonymous.firestore, "publicUserProfiles", parent.uid))],
      ["public-profile enumeration", () => getDocs(collection(anonymous.firestore, "publicUserProfiles"))],
      ["Squad", () => getDoc(doc(anonymous.firestore, "squads", "privacy-squad"))],
      ["Squad enumeration", () => getDocs(collection(anonymous.firestore, "squads"))],
      ["membership", () => getDoc(doc(anonymous.firestore, "squadMemberships", `privacy-squad__${parent.uid}`))],
      ["child profile", () => getDoc(doc(anonymous.firestore, "users", parent.uid, "children", "child-a"))],
      ["friendship", () => getDoc(doc(anonymous.firestore, "friendships", "privacy-friendship"))],
      ["block", () => getDoc(doc(anonymous.firestore, "userBlocks", "privacy-block"))],
      ["report", () => getDoc(doc(anonymous.firestore, "contentReports", "privacy-report"))],
      ["conversation", () => getDoc(doc(anonymous.firestore, "friendConversations", "privacy-conversation"))],
      ["notification", () => getDoc(doc(anonymous.firestore, "userNotifications", parent.uid, "notifications", "privacy-notification"))],
    ]) {
      await assertDenied(operation, `Anonymous identity must not read ${label}`);
    }

    for (const callableName of [
      "getPublicUserProfiles",
      "searchPublicUserProfiles",
      "getActiveFriendRequests",
      "findNearbyVenueSportSquads",
      "searchVenueSportSquads",
      "getVenueSportSquadDetail",
      "createTriviaGameSession",
    ]) {
      await assert.rejects(
        () => anonymous.call(
          callableName,
          callableName === "getPublicUserProfiles"
            ? { userIds: [parent.uid] }
            : callableName === "searchPublicUserProfiles"
              ? { query: "parent" }
              : callableName === "findNearbyVenueSportSquads"
                ? { latitude: 40, longitude: -74, radiusMiles: 2 }
                : callableName === "searchVenueSportSquads"
                  ? { queryText: "Private" }
                  : callableName === "getVenueSportSquadDetail"
                    ? { squadId: "privacy-squad" }
              : {},
        ),
        rejectsCode("permission-denied", "permanent_account_required"),
      );
    }
  }

  await assert.rejects(
    () => signedOut.call("createTriviaGameSession"),
    rejectsCode("unauthenticated"),
  );
  assert.equal((await getDoc(doc(parent.firestore, "users", parent.uid))).exists(), true);
  assert.equal((await getDoc(doc(coach.firestore, "users", coach.uid))).exists(), true);
  assert.equal((await getDoc(doc(staff.firestore, "users", staff.uid))).exists(), true);
  assert.equal((await getDoc(doc(parent.firestore, "squads", "privacy-squad"))).exists(), true);
  for (const nonmember of [unrelated, coach, staff]) {
    await assertDenied(
      () => getDoc(doc(nonmember.firestore, "squads", "privacy-squad")),
      "Permanent social roles do not grant raw Squad access",
    );
    await assertDenied(
      () => getDocs(collection(nonmember.firestore, "squads")),
      "Permanent accounts cannot enumerate raw Squads",
    );
  }
  const publicDetail = await unrelated.call("getVenueSportSquadDetail", { squadId: "privacy-squad" });
  assert.deepEqual(
    Object.keys(publicDetail.squad).sort(),
    [
      "activityStatus",
      "activeMemberCount",
      "extraMemberCount",
      "isActive",
      "memberCount",
      "members",
      "sportDisplayName",
      "sportId",
      "squadId",
      "venueName",
      "viewerIsMember",
    ].sort(),
  );
  assert.equal(publicDetail.squad.viewerIsMember, false);
  assert.deepEqual(publicDetail.squad.members, []);
  assert.equal(JSON.stringify(publicDetail).includes(parent.uid), false);
  const memberDetail = await parent.call("getVenueSportSquadDetail", { squadId: "privacy-squad" });
  assert.equal(memberDetail.squad.viewerIsMember, true);
  assert.deepEqual(
    memberDetail.squad.members.map((member) => member.uid),
    [parent.uid],
  );
  const nearby = await unrelated.call("findNearbyVenueSportSquads", {
    latitude: 40,
    longitude: -74,
    radiusMiles: 2,
  });
  assert.deepEqual(
    Object.keys(nearby.squads[0]).sort(),
    [
      "activityStatus",
      "activeMemberCount",
      "distanceMiles",
      "isActive",
      "memberCount",
      "sportDisplayName",
      "sportId",
      "squadId",
      "venueLocation",
      "venueName",
    ].sort(),
  );
  const searched = await unrelated.call("searchVenueSportSquads", { queryText: "Private" });
  assert.deepEqual(
    Object.keys(searched.squads[0]).sort(),
    [
      "activityStatus",
      "activeMemberCount",
      "isActive",
      "memberCount",
      "sportDisplayName",
      "sportId",
      "squadId",
      "venueName",
    ].sort(),
  );

  const soloTrivia = await unrelated.call("createTriviaGameSession");
  await unrelated.call("createGameJoinCode", {
    gameType: "triviaBlitz",
    sessionId: soloTrivia.sessionId,
    idempotencyKey: "game-security-solo-trivia-code-1",
  });
  await unrelated.call("setTriviaPlayerReady", {
    sessionId: soloTrivia.sessionId,
    ready: true,
  });
  await assert.rejects(
    () => unrelated.call("startTriviaGameSession", {
      sessionId: soloTrivia.sessionId,
    }),
    rejectsCode("failed-precondition", "minimum_players_required"),
    "Trivia Blitz cannot start with only its host",
  );

  const created = await host.call("createTriviaGameSession");
  assert.equal(created.playerId, host.uid);
  assert.equal(created.isHost, true);
  const sessionId = created.sessionId;
  const parentPath = adminFirestore.collection("sessions").doc(sessionId);
  const gamePath = parentPath.collection("games").doc("triviaBlitz");
  const secretPath = adminFirestore.collection("triviaGameSecrets").doc(sessionId);
  const createdGame = (await gamePath.get()).data();
  const createdSecret = (await secretPath.get()).data();
  assert.equal(createdGame.questionCount, 10);
  assert.equal("selectedQuestions" in createdGame, false);
  assert.equal(createdSecret.selectedQuestions.length, 10);
  assert.equal(createdSecret.selectedQuestions.every((question) => Number.isInteger(question.answer)), true);

  await assert.rejects(
    () => unrelated.call("resumeTriviaGameSession", { sessionId }),
    rejectsCode("permission-denied", "not_participant"),
  );
  const code = await host.call("createGameJoinCode", {
    gameType: "triviaBlitz",
    sessionId,
    idempotencyKey: "game-security-trivia-code-1",
  });
  await participant.call("resolveAndJoinGameByCode", { code: code.joinCode });
  const resumed = await participant.call("resumeTriviaGameSession", { sessionId });
  assert.deepEqual(resumed, { sessionId, playerId: participant.uid, isHost: false });
  await participant.call("setTriviaPlayerReady", { sessionId, ready: true });
  await host.call("setTriviaPlayerReady", { sessionId, ready: true });
  await assert.rejects(
    () => participant.call("startTriviaGameSession", { sessionId }),
    rejectsCode("permission-denied", "host_required"),
  );
  await host.call("startTriviaGameSession", { sessionId });
  assert.equal(
    (await adminFirestore.collection("gameJoinCodes").doc(code.joinCode).get()).data().status,
    "started",
    "Trivia start and its routing state commit together",
  );

  let publicGame = (await gamePath.get()).data();
  assert.equal(publicGame.status, "playing");
  assert.equal(publicGame.currentQuestion != null, true);
  assert.equal("answer" in publicGame.currentQuestion, false);
  assert.equal("selectedQuestions" in publicGame, false);
  assert.equal(publicGame.answerResult, null);
  assert.equal(publicGame.hostPlayerId, host.uid);

  await assert.rejects(
    () => participant.call("submitTriviaAnswer", {
      sessionId,
      questionIndex: 0,
      answerIndex: 0,
      submissionId: "participant-out-of-turn-0001",
    }),
    rejectsCode("permission-denied", "not_active_player"),
  );

  const privateQuestions = (await secretPath.get()).data().selectedQuestions;
  const firstResult = await host.call("submitTriviaAnswer", {
    sessionId,
    questionIndex: 0,
    answerIndex: privateQuestions[0].answer,
    submissionId: "host-answer-idempotency-0001",
  });
  assert.equal(firstResult.correct, true);
  assert.equal(firstResult.pointsAwarded >= 10, true);
  assert.equal(firstResult.correctAnswerIndex, privateQuestions[0].answer);
  assert.deepEqual(
    await host.call("submitTriviaAnswer", {
      sessionId,
      questionIndex: 0,
      answerIndex: privateQuestions[0].answer,
      submissionId: "host-answer-idempotency-0001",
    }),
    firstResult,
  );
  await assert.rejects(
    () => host.call("submitTriviaAnswer", {
      sessionId,
      questionIndex: 0,
      answerIndex: privateQuestions[0].answer,
      submissionId: "host-second-answer-0002",
    }),
    rejectsCode("already-exists", "answer_already_submitted"),
  );
  await assert.rejects(
    () => participant.call("advanceTriviaGameSession", { sessionId, questionIndex: 0 }),
    rejectsCode("permission-denied", "host_required"),
  );
  await host.call("advanceTriviaGameSession", { sessionId, questionIndex: 0 });
  publicGame = (await gamePath.get()).data();
  assert.equal(publicGame.questionIndex, 1);
  assert.equal(publicGame.turnIndex, 1);
  assert.equal(publicGame.answerResult, null);
  assert.equal("answer" in publicGame.currentQuestion, false);

  for (let questionIndex = 1; questionIndex < privateQuestions.length; questionIndex += 1) {
    publicGame = (await gamePath.get()).data();
    const activePlayer = publicGame.turnIndex === 0 ? host : participant;
    const answerIndex =
      questionIndex === 1
        ? (privateQuestions[questionIndex].answer + 1) %
          privateQuestions[questionIndex].options_en.length
        : privateQuestions[questionIndex].answer;
    const result = await activePlayer.call("submitTriviaAnswer", {
      sessionId,
      questionIndex,
      answerIndex,
      submissionId: `lifecycle-answer-${String(questionIndex).padStart(2, "0")}-secure`,
    });
    assert.equal(result.correct, answerIndex === privateQuestions[questionIndex].answer);
    const revealed = (await gamePath.get()).data();
    assert.equal(revealed.answerResult.questionIndex, questionIndex);
    assert.equal(revealed.answerResult.correctAnswerIndex, privateQuestions[questionIndex].answer);
    await host.call("advanceTriviaGameSession", { sessionId, questionIndex });
  }

  publicGame = (await gamePath.get()).data();
  assert.equal(publicGame.status, "results");
  assert.equal(publicGame.answeredQuestions, 10);
  assert.equal(publicGame.currentQuestion, null);
  assert.equal((await parentPath.get()).data().status, "results");
  const playerScores = await gamePath.collection("players").get();
  assert.equal(playerScores.size, 2);
  assert.equal(playerScores.docs.every((snapshot) => snapshot.data().score === publicGame.totalPoints), true);

  await host.call("resetTriviaGameSession", { sessionId });
  const resetGame = (await gamePath.get()).data();
  assert.equal(resetGame.status, "lobby");
  assert.equal(resetGame.totalPoints, 0);
  assert.equal(resetGame.answerResult, null);
  assert.equal((await gamePath.collection("players").get()).docs.every((snapshot) => snapshot.data().score === 0), true);
  assert.equal(
    (await adminFirestore.collection("gameJoinCodes").doc(code.joinCode).get()).data().status,
    "lobby",
    "a server-authorized rematch reopens its routing state atomically",
  );

  await participant.call("setTriviaPlayerReady", { sessionId, ready: true });
  await host.call("setTriviaPlayerReady", { sessionId, ready: true });
  await host.call("startTriviaGameSession", { sessionId });
  await assert.rejects(
    () => host.call("submitTriviaAnswer", {
      sessionId,
      questionIndex: 0,
      answerIndex: privateQuestions[0].answer,
      submissionId: "host-answer-idempotency-0001",
    }),
    rejectsCode("already-exists", "submission_id_reused"),
    "submission IDs cannot replay a result from an earlier rematch round",
  );
  await gamePath.update({
    questionEndsAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000),
  });
  await assert.rejects(
    () => host.call("submitTriviaAnswer", {
      sessionId,
      questionIndex: 0,
      answerIndex: 0,
      submissionId: "expired-answer-window-0001",
    }),
    rejectsCode("deadline-exceeded", "answer_window_closed"),
  );
  await host.call("advanceTriviaGameSession", { sessionId, questionIndex: 0 });
  assert.equal((await gamePath.get()).data().answeredQuestions, 1);
  await host.call("endTriviaGameSession", { sessionId });

  await parentPath.update({
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000),
  });
  await assert.rejects(
    () => participant.call("resumeTriviaGameSession", { sessionId }),
    rejectsCode("failed-precondition", "session_expired"),
  );
  for (const [label, operation] of [
    [
      "ready",
      () => host.call("setTriviaPlayerReady", { sessionId, ready: true }),
    ],
    [
      "start",
      () => host.call("startTriviaGameSession", { sessionId }),
    ],
    [
      "reset",
      () => host.call("resetTriviaGameSession", { sessionId }),
    ],
    [
      "end",
      () => host.call("endTriviaGameSession", { sessionId }),
    ],
  ]) {
    await assert.rejects(
      operation,
      rejectsCode("failed-precondition", "session_expired"),
      `an expired Trivia session cannot ${label}`,
    );
  }
  await assert.rejects(
    () => host.call("createGameJoinCode", {
      gameType: "triviaBlitz",
      sessionId,
      idempotencyKey: "game-security-expired-trivia-code-2",
    }),
    rejectsCode("failed-precondition", "invalid_or_expired_code"),
    "an expired canonical Trivia session cannot receive another JOIN code",
  );
  await assert.rejects(
    () => participant.call("resolveAndJoinGameByCode", { code: code.joinCode }),
    rejectsCode("not-found", "invalid_or_expired_code"),
    "an expired participant cannot reconnect through a stale JOIN code",
  );

  console.log(
    "Permanent-account game security, anonymous isolation, server-authoritative Trivia lifecycle, replay, timing, host, turn, scoring, expiry, and safe-projection emulator checks passed.",
  );
  await Promise.all(clients.map((client) => deleteApp(client.app)));
  await admin.app().delete();
  process.exit(0);
}

async function assertDatabaseRulesLoaded() {
  const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  assert.equal(typeof emulatorHost, "string", "The Realtime Database emulator host is required");
  const response = await fetch(
    `http://${emulatorHost}/.settings/rules.json?ns=${projectId}-default-rtdb`,
    { headers: { authorization: "Bearer owner" } },
  );
  assert.equal(response.ok, true, "The loaded Realtime Database rules must be inspectable");
  const loaded = await response.json();
  assert.equal(
    loaded?.rules?.gameSessions?.$sessionId?.[".write"],
    false,
    "The isolated emulator namespace must load the deny-write game rules",
  );
  assert.equal(
    loaded?.rules?.gameSessionSecrets?.[".read"],
    false,
    "Bomb solution sequences must remain server-only",
  );
}

async function assertRealtimeDatabaseIsolation({
  host,
  participant,
  unrelated,
  anonymousA,
  anonymousB,
  signedOut,
}) {
  await adminDatabase.ref("gameSessions/anonymous-a").set({
    sessionId: "anonymous-a",
    gameType: "bomb_defusal",
    hostUserId: host.uid,
    players: {
      [host.uid]: { displayName: "Host", isReady: false },
      [anonymousA.uid]: { displayName: "Guest A", isReady: false },
    },
    status: "lobby",
    expiresAt: Date.now() + 60_000,
  });
  await adminDatabase.ref("gameSessions/anonymous-b").set({
    sessionId: "anonymous-b",
    gameType: "spot_difference",
    hostUserId: participant.uid,
    players: {
      [participant.uid]: { displayName: "Participant", isReady: false },
      [anonymousB.uid]: { displayName: "Guest B", isReady: false },
    },
    status: "lobby",
    expiresAt: Date.now() + 60_000,
  });
  await adminDatabase.ref("gameSessionSecrets/anonymous-a").set({
    expiresAt: Date.now() + 60_000,
    bombSteps: [{ type: "cut_wire", color: "blue" }],
  });
  assert.equal(
    (await anonymousA.auth.currentUser.getIdTokenResult()).signInProvider,
    "anonymous",
    "The real Auth emulator identity must carry the anonymous provider",
  );
  assert.equal(
    (await adminDatabase.ref("gameSessions/anonymous-a").once("value")).exists(),
    true,
    "The Admin SDK and web clients must use the same seeded emulator namespace",
  );
  await assertDenied(
    () => get(ref(signedOut.database, "gameSessions/anonymous-a")),
    "Signed-out callers cannot read Realtime Database game sessions",
  );
  await assertDenied(
    () => get(ref(unrelated.database, "gameSessions/anonymous-a")),
    "Unrelated permanent accounts cannot read Realtime Database game sessions",
  );
  await assertDenied(
    () => get(ref(anonymousA.database, "gameSessions/anonymous-a")),
    "Anonymous A cannot read a session even when legacy data lists its UID",
  );
  await assertDenied(
    () => get(ref(anonymousA.database, "gameSessions/anonymous-b")),
    "Anonymous A cannot read another session",
  );
  await assertDenied(
    () => get(ref(anonymousB.database, "gameSessions/anonymous-b")),
    "Anonymous B cannot read a session even when legacy data lists its UID",
  );
  await assertDenied(
    () => get(ref(host.database, "gameSessionSecrets/anonymous-a")),
    "Even the permanent host cannot read the server-only Bomb sequence",
  );
  await assertDenied(
    () => get(ref(anonymousA.database, "gameSessionSecrets/anonymous-a")),
    "Anonymous callers cannot read Bomb secrets",
  );
}

async function seedSocialFixtures({
  host,
  participant,
  parent,
  coach,
  staff,
  anonymousA,
  anonymousB,
}) {
  const batch = adminFirestore.batch();
  for (const [client, role] of [
    [host, "host"],
    [participant, "participant"],
    [parent, "parent"],
    [coach, "coach"],
    [staff, "staff"],
  ]) {
    batch.set(adminFirestore.collection("users").doc(client.uid), {
      displayName: `${role} fixture`,
      role,
    });
    batch.set(adminFirestore.collection("publicUserProfiles").doc(client.uid), {
      displayName: `${role} fixture`,
      firstName: role,
      lastName: "fixture",
      searchText: `${role} fixture`,
    });
  }
  batch.set(adminFirestore.collection("squads").doc("privacy-squad"), {
    venueName: "Private Field",
    normalizedVenueName: "private field",
    sportId: "baseball",
    sportDisplayName: "Baseball",
    venueLocation: new admin.firestore.GeoPoint(40.0, -74.0),
    venueGeohash: "dr57s1fbgh",
    venueSportKey: "private-internal-key",
    memberIds: [parent.uid],
    memberCount: 1,
    activeMemberCount: 1,
    createdBy: coach.uid,
    creatorId: coach.uid,
    isActive: true,
  });
  batch.set(
    adminFirestore.collection("squadMemberships").doc(`privacy-squad__${parent.uid}`),
    {
      squadId: "privacy-squad",
      userId: parent.uid,
      membershipStatus: "active",
      squadRole: "member",
    },
  );
  batch.set(
    adminFirestore.collection("users").doc(parent.uid).collection("children").doc("child-a"),
    { displayName: "Child Fixture" },
  );
  batch.set(adminFirestore.collection("friendships").doc("privacy-friendship"), {
    userIds: [parent.uid, participant.uid],
    status: "active",
  });
  batch.set(adminFirestore.collection("userBlocks").doc("privacy-block"), {
    blockerId: parent.uid,
    blockedId: participant.uid,
  });
  batch.set(adminFirestore.collection("contentReports").doc("privacy-report"), {
    reporterId: parent.uid,
    targetUserId: participant.uid,
    status: "open",
  });
  batch.set(adminFirestore.collection("friendConversations").doc("privacy-conversation"), {
    participantUserIds: [parent.uid, participant.uid],
    status: "active",
  });
  batch.set(
    adminFirestore
      .collection("userNotifications")
      .doc(parent.uid)
      .collection("notifications")
      .doc("privacy-notification"),
    { recipientUserId: parent.uid, status: "active" },
  );
  batch.set(adminFirestore.collection("sessions").doc("anonymous-fixture-a"), {
    sessionId: "anonymous-fixture-a",
    gameId: "triviaBlitz",
    gameType: "triviaBlitz",
    hostPlayerId: host.uid,
    playerIds: [host.uid, anonymousA.uid],
    status: "playing",
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60_000),
  });
  batch.set(adminFirestore.collection("sessions").doc("anonymous-fixture-b"), {
    sessionId: "anonymous-fixture-b",
    gameId: "triviaBlitz",
    gameType: "triviaBlitz",
    hostPlayerId: participant.uid,
    playerIds: [participant.uid, anonymousB.uid],
    status: "playing",
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60_000),
  });
  await batch.commit();
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
