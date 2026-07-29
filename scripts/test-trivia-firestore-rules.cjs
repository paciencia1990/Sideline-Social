const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");
const {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} = require("firebase/firestore");

const projectId = "sideline-trivia-rules-test";
const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");
const permanentClaims = { firebase: { sign_in_provider: "password" } };
const anonymousClaims = { firebase: { sign_in_provider: "anonymous" } };

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });

  try {
    await testEnv.clearFirestore();
    const nowMs = Date.now();
    await seedSession(testEnv, "ACTIVE1", { expiresAtMs: nowMs + 60_000 });
    await seedSession(testEnv, "EXPIRED1", { expiresAtMs: nowMs - 1000 });
    await seedSession(testEnv, "RESULTS1", {
      expiresAtMs: nowMs + 600_000,
      status: "results",
      completedAtMs: nowMs - 1000,
    });
    await seedSession(testEnv, "STALE_RESULTS1", {
      expiresAtMs: nowMs + 600_000,
      status: "results",
      completedAtMs: nowMs - 301_000,
    });

    const hostDb = testEnv.authenticatedContext("host-uid", permanentClaims).firestore();
    const playerDb = testEnv.authenticatedContext("player-uid", permanentClaims).firestore();
    const otherDb = testEnv.authenticatedContext("other-uid", permanentClaims).firestore();
    const anonymousDb = testEnv.authenticatedContext("anonymous-uid", anonymousClaims).firestore();
    const signedOutDb = testEnv.unauthenticatedContext().firestore();

    const parent = (db, id = "ACTIVE1") => doc(db, "sessions", id);
    const game = (db, id = "ACTIVE1") =>
      doc(db, "sessions", id, "games", "triviaBlitz");
    const players = (db, id = "ACTIVE1") =>
      collection(db, "sessions", id, "games", "triviaBlitz", "players");
    const player = (db, uid, id = "ACTIVE1") =>
      doc(db, "sessions", id, "games", "triviaBlitz", "players", uid);
    const secret = (db, id = "ACTIVE1") => doc(db, "triviaGameSecrets", id);

    await assertSucceeds(getDoc(parent(hostDb)));
    await assertSucceeds(getDoc(game(hostDb)));
    await assertSucceeds(getDocs(players(hostDb)));
    await assertSucceeds(getDoc(parent(playerDb)));
    await assertSucceeds(getDoc(game(playerDb)));
    await assertSucceeds(getDocs(players(playerDb)));

    const visibleGame = (await getDoc(game(playerDb))).data();
    assert.equal("selectedQuestions" in visibleGame, false);
    assert.equal("answer" in visibleGame.currentQuestion, false);
    assert.equal(visibleGame.answerResult, null);

    for (const db of [otherDb, anonymousDb, signedOutDb]) {
      await assertFails(getDoc(parent(db)));
      await assertFails(getDoc(game(db)));
      await assertFails(getDocs(players(db)));
      await assertFails(getDoc(secret(db)));
    }
    await assertFails(getDoc(secret(hostDb)));
    await assertFails(getDoc(secret(playerDb)));
    await assertFails(getDoc(parent(hostDb, "EXPIRED1")));
    await assertFails(getDoc(game(playerDb, "EXPIRED1")));
    await assertSucceeds(getDoc(parent(hostDb, "RESULTS1")));
    await assertSucceeds(getDoc(game(playerDb, "RESULTS1")));
    await assertFails(getDoc(parent(hostDb, "STALE_RESULTS1")));
    await assertFails(getDoc(game(playerDb, "STALE_RESULTS1")));

    for (const db of [hostDb, playerDb, anonymousDb]) {
      await assertFails(setDoc(parent(db, "CLIENT1"), { hostPlayerId: "host-uid" }));
      await assertFails(updateDoc(parent(db), { status: "results" }));
      await assertFails(updateDoc(game(db), { totalPoints: 9999 }));
      await assertFails(updateDoc(game(db), {
        currentSelection: { playerId: "player-uid", answerIndex: 0 },
      }));
      await assertFails(updateDoc(player(db, "player-uid"), { score: 9999 }));
      await assertFails(updateDoc(player(db, db === hostDb ? "host-uid" : "player-uid"), {
        ready: true,
      }));
      await assertFails(setDoc(secret(db, "CLIENT1"), { selectedQuestions: [] }));
    }

    console.log(
      "Trivia Firestore rules enforce permanent participant reads, server-only writes, private answers, and expiry.",
    );
  } finally {
    await testEnv.cleanup();
  }
}

async function seedSession(
  testEnv,
  sessionId,
  { expiresAtMs, status = "playing", completedAtMs = null },
) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const now = Timestamp.now();
    await setDoc(doc(db, "sessions", sessionId), {
      sessionId,
      gameId: "triviaBlitz",
      gameType: "triviaBlitz",
      hostPlayerId: "host-uid",
      playerIds: ["host-uid", "player-uid"],
      status,
      completedAt:
        completedAtMs == null ? null : Timestamp.fromMillis(completedAtMs),
      expiresAt: Timestamp.fromMillis(expiresAtMs),
      createdAt: now,
      updatedAt: now,
    });
    await setDoc(doc(db, "sessions", sessionId, "games", "triviaBlitz"), {
      status,
      turnIndex: 1,
      questionIndex: 0,
      questionCount: 10,
      teamStreak: 0,
      totalPoints: 0,
      correctAnswers: 0,
      answeredQuestions: 0,
      totalPlayers: 2,
      allReady: true,
      currentQuestion: {
        id: "question-safe",
        category: "Sports",
        question_en: "Question?",
        question_es: "¿Pregunta?",
        options_en: ["A", "B"],
        options_es: ["A", "B"],
      },
      currentSelection: null,
      answerResult: null,
      hostPlayerId: "host-uid",
      questionStartedAt: now,
      questionEndsAt: Timestamp.fromMillis(Date.now() + 30_000),
      createdAt: now,
      updatedAt: now,
    });
    for (const [uid, playerIndex] of [["host-uid", 0], ["player-uid", 1]]) {
      await setDoc(
        doc(db, "sessions", sessionId, "games", "triviaBlitz", "players", uid),
        {
          name: uid,
          playerIndex,
          score: 0,
          ready: true,
          createdAt: now,
          updatedAt: now,
        },
      );
    }
    await setDoc(doc(db, "triviaGameSecrets", sessionId), {
      selectedQuestions: [{ ...((await getDoc(doc(db, "sessions", sessionId, "games", "triviaBlitz"))).data().currentQuestion), answer: 0 }],
    });
  });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
