const fs = require("node:fs");
const path = require("node:path");
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc, updateDoc } = require("firebase/firestore");

const projectId = "sideline-trivia-rules-test";
const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");

function parentPayload(sessionId, hostUid, memberIds = [hostUid]) {
  return {
    sessionId,
    gameId: "triviaBlitz",
    gameType: "triviaBlitz",
    hostPlayerId: hostUid,
    playerIds: memberIds,
    status: "lobby",
    createdAt: 1,
    updatedAt: 1,
  };
}

function triviaPayload(sessionId, hostUid) {
  return {
    status: "lobby",
    turnIndex: 0,
    questionIndex: 0,
    teamStreak: 0,
    totalPoints: 0,
    correctAnswers: 0,
    totalPlayers: 1,
    selectedQuestions: [
      {
        category: "Sports",
        question_en: "Question?",
        question_es: "Pregunta?",
        options_en: ["A", "B", "C", "D"],
        options_es: ["A", "B", "C", "D"],
        answer: 0,
      },
    ],
    allReady: false,
    currentSelection: null,
    selectionRevealed: false,
    hostPlayerId: hostUid,
    sessionCode: sessionId,
    createdAt: 1,
    updatedAt: 1,
  };
}

async function seed(testEnv, write) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await write(context.firestore());
  });
}

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });

  try {
    await testEnv.clearFirestore();

    const hostDb = testEnv.authenticatedContext("host-uid").firestore();
    const playerDb = testEnv.authenticatedContext("player-uid").firestore();
    const otherDb = testEnv.authenticatedContext("other-uid").firestore();
    const anonDb = testEnv.unauthenticatedContext().firestore();

    const parentRef = (db, id = "TEST1") => doc(db, "sessions", id);
    const childRef = (db, id = "TEST1", gameId = "triviaBlitz") =>
      doc(db, "sessions", id, "games", gameId);

    await assertFails(setDoc(parentRef(anonDb), parentPayload("TEST1", "host-uid")));
    await assertSucceeds(setDoc(parentRef(hostDb), parentPayload("TEST1", "host-uid")));
    await assertSucceeds(getDoc(parentRef(hostDb)));
    await assertSucceeds(setDoc(childRef(hostDb), triviaPayload("TEST1", "host-uid")));
    await assertSucceeds(getDoc(childRef(hostDb)));

    await testEnv.clearFirestore();
    await assertFails(setDoc(childRef(hostDb), triviaPayload("TEST1", "host-uid")));

    await testEnv.clearFirestore();
    await seed(testEnv, async (db) => {
      await setDoc(parentRef(db), parentPayload("TEST1", "other-uid", ["other-uid"]));
    });
    await assertFails(setDoc(childRef(hostDb), triviaPayload("TEST1", "host-uid")));

    await testEnv.clearFirestore();
    await seed(testEnv, async (db) => {
      await setDoc(parentRef(db), parentPayload("TEST1", "host-uid"));
    });
    await assertFails(setDoc(childRef(hostDb), triviaPayload("TEST1", "other-uid")));
    await assertFails(setDoc(childRef(hostDb, "TEST1", "trivia-blitz"), triviaPayload("TEST1", "host-uid")));
    await assertFails(setDoc(childRef(otherDb), triviaPayload("TEST1", "other-uid")));

    await assertSucceeds(updateDoc(parentRef(playerDb), {
      playerIds: ["host-uid", "player-uid"],
      updatedAt: 2,
    }));
    await assertSucceeds(getDoc(childRef(playerDb)));
    await assertFails(updateDoc(childRef(playerDb), {
      status: "results",
      updatedAt: 3,
    }));
    await assertSucceeds(updateDoc(childRef(playerDb), {
      currentSelection: {
        playerId: "player-uid",
        answerIndex: 0,
        selectedAt: 123,
      },
      selectionRevealed: false,
      updatedAt: 4,
    }));
    await assertFails(updateDoc(childRef(playerDb), {
      currentSelection: {
        playerId: "host-uid",
        answerIndex: 0,
        selectedAt: 124,
      },
      selectionRevealed: false,
      updatedAt: 5,
    }));

    await testEnv.clearFirestore();
    await assertSucceeds(setDoc(parentRef(hostDb, "SOLO1"), parentPayload("SOLO1", "host-uid")));
    await assertSucceeds(setDoc(childRef(hostDb, "SOLO1"), triviaPayload("SOLO1", "host-uid")));

    console.log("Trivia Firestore rules tests passed.");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
