import {
  arrayUnion,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

import questions from "@/assets/triviaBlitz/questions.json";
import { auth } from "@/config/firebase";
import {
  getCurrentPlayer,
  getFirebaseErrorCode,
  getTriviaParentSessionPath,
  getTriviaParentSessionRef,
  getTriviaPlayerPath,
  getTriviaPlayerRef,
  getTriviaPlayersPath,
  getTriviaPlayersRef,
  getTriviaSessionPath,
  getTriviaSessionRef,
  logTriviaFirebaseError,
} from "./firebaseUtils";
import type {
  PlayerIdentity,
  TriviaParentSession,
  TriviaPlayer,
  TriviaQuestion,
  TriviaSession,
} from "./types";

const SESSION_CODE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_QUESTION_COUNT = 10;

const questionBank = questions as TriviaQuestion[];

export function getRandomQuestions(count = DEFAULT_QUESTION_COUNT): TriviaQuestion[] {
  const shuffledQuestions = [...questionBank].sort(() => Math.random() - 0.5);
  return shuffledQuestions.slice(0, Math.min(count, shuffledQuestions.length));
}

export function generateSessionCode() {
  let code = "";

  for (let index = 0; index < 5; index += 1) {
    code += SESSION_CODE_CHARACTERS[Math.floor(Math.random() * SESSION_CODE_CHARACTERS.length)];
  }

  return code;
}

export async function createGameSession(hostName: string) {
  const host = await getCurrentPlayer(hostName || "Host");
  const sessionId = generateSessionCode();

  try {
    await initializeFirestoreSession(sessionId, host);
    await upsertPlayer(sessionId, host, hostName || host.name, 0);
    await updateSessionAllReady(sessionId);
    return { sessionId, playerId: host.id };
  } catch (error) {
    logTriviaFirebaseError("createGameSession", { sessionId, path: getTriviaSessionPath(sessionId) }, error);
    throw error;
  }
}

export async function joinGameSession(sessionId: string, playerName: string) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const player = await getCurrentPlayer(playerName || "Player");
  const sessionRef = getTriviaSessionRef(normalizedSessionId);

  try {
    const parentMembership = await joinTriviaParentSession(normalizedSessionId, player.id);
    if (!parentMembership.isExistingPlayer) {
      throw new Error("This Trivia Blitz session has already started or ended.");
    }

    const sessionSnap = await getDoc(sessionRef);

    if (!sessionSnap.exists()) {
      throw new Error("Trivia Blitz session was not found.");
    }

    const session = sessionSnap.data() as TriviaSession;
    const players = await getPlayers(normalizedSessionId);
    const existingPlayer = players.find((candidate) => candidate.id === player.id);
    const canResumeActiveGame = Boolean(existingPlayer) ||
      canCurrentUserAccessActiveGame({
        authUid: player.id,
        hostPlayerId: session.hostPlayerId ?? parentMembership.parentSessionData?.hostPlayerId,
        playerIds: parentMembership.parentSessionData?.playerIds,
      });

    if (session.status !== "lobby") {
      if (canResumeActiveGame) {
        if (__DEV__) {
          console.log("[TriviaBlitz:resumeExistingPlayer]", {
            sessionId: normalizedSessionId,
            authUid: auth.currentUser?.uid ?? null,
            playerId: player.id,
            gameStatus: session.status,
            hasPlayerDoc: Boolean(existingPlayer),
          });
        }
        return { sessionId: normalizedSessionId, playerId: player.id };
      }

      throw new Error("This Trivia Blitz session has already started or ended.");
    }

    await upsertPlayer(
      normalizedSessionId,
      player,
      playerName || player.name,
      existingPlayer?.playerIndex ?? players.length,
    );
    await updateSessionAllReadyBestEffort(normalizedSessionId);
    return { sessionId: normalizedSessionId, playerId: player.id };
  } catch (error) {
    logTriviaFirebaseError(
      "joinGameSession",
      { sessionId: normalizedSessionId, path: getTriviaSessionPath(normalizedSessionId) },
      error,
    );
    throw error;
  }
}

export async function startGameSession(sessionId: string) {
  const sessionRef = getTriviaSessionRef(sessionId);

  try {
    const sessionSnap = await getDoc(sessionRef);

    if (!sessionSnap.exists()) {
      throw new Error("Trivia Blitz session was not found.");
    }

    const session = sessionSnap.data() as TriviaSession;
    if (session.status !== "lobby") {
      return;
    }

    const batch = writeBatch(sessionRef.firestore);
    batch.update(sessionRef, {
      status: "playing",
      turnIndex: 0,
      questionIndex: 0,
      currentSelection: null,
      selectionRevealed: false,
      updatedAt: serverTimestamp(),
    });
    batch.update(getTriviaParentSessionRef(sessionId), {
      status: "playing",
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    logTriviaFirebaseError("startGameSession", { sessionId, path: getTriviaSessionPath(sessionId) }, error);
    throw error;
  }
}

export async function togglePlayerReady(sessionId: string, playerId: string, ready: boolean) {
  try {
    await updateDoc(getTriviaPlayerRef(sessionId, playerId), {
      ready,
    });
    await updateSessionAllReadyBestEffort(sessionId);
  } catch (error) {
    logTriviaFirebaseError("togglePlayerReady", { sessionId, path: getTriviaPlayerPath(sessionId, playerId) }, error);
    throw error;
  }
}

export async function updateSessionAllReady(sessionId: string) {
  try {
    const players = await getPlayers(sessionId);
    const allReady = players.length > 0 && players.every((player) => player.ready);

    await updateDoc(getTriviaSessionRef(sessionId), {
      allReady,
      totalPlayers: players.length,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    logTriviaFirebaseError("updateSessionAllReady", { sessionId, path: getTriviaSessionPath(sessionId) }, error);
    throw error;
  }
}

export async function initializeFirestoreSession(sessionId: string, host: PlayerIdentity) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const sessionRef = getTriviaSessionRef(normalizedSessionId);
  const parentDebug = await createFirestoreSessionParent(normalizedSessionId, host);
  const childSnapshot = await getDoc(sessionRef);

  const session: TriviaSession = {
    status: "lobby",
    turnIndex: 0,
    questionIndex: 0,
    teamStreak: 0,
    totalPoints: 0,
    correctAnswers: 0,
    totalPlayers: 1,
    selectedQuestions: getRandomQuestions(),
    allReady: false,
    currentSelection: null,
    selectionRevealed: false,
    hostPlayerId: host.id,
    sessionCode: normalizedSessionId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (__DEV__) {
    console.log("[TriviaBlitz:writeMode]", {
      sessionId: normalizedSessionId,
      parentExistsBeforeWrite: parentDebug.parentExistsBeforeWrite,
      childExistsBeforeWrite: childSnapshot.exists(),
      parentOperation: parentDebug.parentOperation,
      childOperation: childSnapshot.exists() ? "update" : "create",
    });
  }

  if (childSnapshot.exists()) {
    return normalizedSessionId;
  }

  if (__DEV__) {
    console.log("[TriviaBlitz:createChild:attempt]", {
      sessionId: normalizedSessionId,
      authUid: auth.currentUser?.uid ?? null,
      parentPath: getTriviaParentSessionPath(normalizedSessionId),
      path: getTriviaSessionPath(normalizedSessionId),
      parentSessionExists: parentDebug.parentSessionExists,
      parentSessionData: parentDebug.parentSessionData,
      payload: toLoggableTriviaPayload(session),
    });
  }

  try {
    await setDoc(sessionRef, session);
    if (__DEV__) {
      console.log("[TriviaBlitz:createChild:success]", {
        sessionId: normalizedSessionId,
        authUid: auth.currentUser?.uid ?? null,
        path: getTriviaSessionPath(normalizedSessionId),
      });
    }
  } catch (error) {
    console.error("[TriviaBlitz:createChild:error]", {
      sessionId: normalizedSessionId,
      authUid: auth.currentUser?.uid ?? null,
      parentPath: getTriviaParentSessionPath(normalizedSessionId),
      path: getTriviaSessionPath(normalizedSessionId),
      parentSessionExists: parentDebug.parentSessionExists,
      parentSessionData: parentDebug.parentSessionData,
      payload: toLoggableTriviaPayload(session),
      code: getFirebaseErrorCode(error),
      message: error instanceof Error ? error.message : "Unknown Firestore error",
    });
    throw new Error("Trivia Blitz could not create the game session. Please try again.");
  }

  return normalizedSessionId;
}
export async function submitSessionSelection(
  sessionId: string,
  playerId: string,
  answerIndex: number,
) {
  try {
    await updateDoc(getTriviaSessionRef(sessionId), {
      currentSelection: {
        playerId,
        answerIndex,
        selectedAt: Date.now(),
      },
      selectionRevealed: false,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    logTriviaFirebaseError("submitSessionSelection", { sessionId, path: getTriviaSessionPath(sessionId), playerId }, error);
    throw error;
  }
}

export async function resetGameSession(sessionId: string) {
  const sessionRef = getTriviaSessionRef(sessionId);

  try {
    const players = await getPlayers(sessionId);
    const batch = writeBatch(sessionRef.firestore);

    batch.update(sessionRef, {
      status: "lobby",
      turnIndex: 0,
      questionIndex: 0,
      teamStreak: 0,
      totalPoints: 0,
      correctAnswers: 0,
      selectedQuestions: getRandomQuestions(),
      allReady: false,
      currentSelection: null,
      selectionRevealed: false,
      updatedAt: serverTimestamp(),
    });

    batch.update(getTriviaParentSessionRef(sessionId), {
      status: "lobby",
      updatedAt: serverTimestamp(),
    });

    players.forEach((player) => {
      batch.update(getTriviaPlayerRef(sessionId, player.id), {
        score: 0,
        ready: false,
      });
    });

    await batch.commit();
  } catch (error) {
    logTriviaFirebaseError("resetGameSession", { sessionId, path: getTriviaSessionPath(sessionId) }, error);
    throw error;
  }
}

export async function forceEndGameSession(sessionId: string) {
  try {
    const sessionRef = getTriviaSessionRef(sessionId);
    const batch = writeBatch(sessionRef.firestore);
    batch.update(sessionRef, {
      status: "results",
      currentSelection: null,
      selectionRevealed: false,
      updatedAt: serverTimestamp(),
    });
    batch.update(getTriviaParentSessionRef(sessionId), {
      status: "results",
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    logTriviaFirebaseError("forceEndGameSession", { sessionId, path: getTriviaSessionPath(sessionId) }, error);
    throw error;
  }
}

export async function getPlayers(sessionId: string): Promise<TriviaPlayer[]> {
  try {
    const playersQuery = query(getTriviaPlayersRef(sessionId), orderBy("playerIndex", "asc"));
    const playersSnap = await getDocs(playersQuery);

    return playersSnap.docs.map((playerDoc) => ({
      id: playerDoc.id,
      ...(playerDoc.data() as Omit<TriviaPlayer, "id">),
    }));
  } catch (error) {
    logTriviaFirebaseError("getPlayers", { sessionId, path: getTriviaPlayersPath(sessionId) }, error);
    throw error;
  }
}

async function createFirestoreSessionParent(sessionId: string, host: PlayerIdentity) {
  const parentRef = getTriviaParentSessionRef(sessionId);
  const parentSession: TriviaParentSession = {
    sessionId,
    gameId: "triviaBlitz",
    gameType: "triviaBlitz",
    hostPlayerId: host.id,
    playerIds: [host.id],
    status: "lobby",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (__DEV__) {
    console.log("[TriviaBlitz:createParent:attempt]", {
      sessionId,
      authUid: auth.currentUser?.uid ?? null,
      path: getTriviaParentSessionPath(sessionId),
      payload: toLoggableParentPayload(parentSession),
    });
  }

  try {
    await setDoc(parentRef, parentSession);
    if (__DEV__) {
      console.log("[TriviaBlitz:createParent:success]", {
        sessionId,
        authUid: auth.currentUser?.uid ?? null,
        path: getTriviaParentSessionPath(sessionId),
      });
    }
  } catch (error) {
    console.error("[TriviaBlitz:createParent:error]", {
      sessionId,
      authUid: auth.currentUser?.uid ?? null,
      path: getTriviaParentSessionPath(sessionId),
      payload: toLoggableParentPayload(parentSession),
      code: getFirebaseErrorCode(error),
      message: error instanceof Error ? error.message : "Unknown Firestore error",
    });
    throw error;
  }

  let createdParentSnap;
  try {
    createdParentSnap = await getDoc(parentRef);
  } catch (error) {
    console.error("[TriviaBlitz:createParent:verifyError]", {
      sessionId,
      authUid: auth.currentUser?.uid ?? null,
      path: getTriviaParentSessionPath(sessionId),
      code: getFirebaseErrorCode(error),
      message: error instanceof Error ? error.message : "Unknown Firestore error",
    });
    throw error;
  }

  const parentSessionData = createdParentSnap.exists()
    ? summarizeParentSession(createdParentSnap.data() as Partial<TriviaParentSession>)
    : summarizeParentSession(parentSession);

  if (__DEV__) {
    console.log("[TriviaBlitz:createParent:verified]", {
      sessionId,
      path: getTriviaParentSessionPath(sessionId),
      exists: createdParentSnap.exists(),
      data: parentSessionData,
    });
  }

  if (!createdParentSnap.exists()) {
    throw new Error(`Firestore parent session ${sessionId} was not created`);
  }

  return {
    parentExistsBeforeWrite: false,
    parentOperation: "create" as const,
    parentSessionExists: true,
    parentSessionData,
  };
}
async function joinTriviaParentSession(sessionId: string, playerId: string) {
  const parentRef = getTriviaParentSessionRef(sessionId);

  try {
    const parentSnap = await getDoc(parentRef);
    if (parentSnap.exists()) {
      const parentData = parentSnap.data() as Partial<TriviaParentSession>;
      const isExistingPlayer = canCurrentUserAccessActiveGame({
        authUid: playerId,
        hostPlayerId: parentData.hostPlayerId,
        playerIds: parentData.playerIds,
      });

      if (isExistingPlayer) {
        return {
          isExistingPlayer: true,
          joinedLobby: false,
          parentSessionData: summarizeParentSession(parentData),
        };
      }

      if (parentData.status !== "lobby") {
        return {
          isExistingPlayer: false,
          joinedLobby: false,
          parentSessionData: summarizeParentSession(parentData),
        };
      }
    }
  } catch (error) {
    if (__DEV__ && getFirebaseErrorCode(error) !== "permission-denied") {
      logTriviaFirebaseError("joinTriviaParentSessionRead", { sessionId, path: getTriviaParentSessionPath(sessionId) }, error);
    }
  }

  try {
    await updateDoc(parentRef, {
      playerIds: arrayUnion(playerId),
      updatedAt: serverTimestamp(),
    });

    let parentSessionData: ReturnType<typeof summarizeParentSession> | null = null;
    try {
      const updatedParentSnap = await getDoc(parentRef);
      parentSessionData = updatedParentSnap.exists()
        ? summarizeParentSession(updatedParentSnap.data() as Partial<TriviaParentSession>)
        : null;
    } catch (error) {
      if (__DEV__) {
        logTriviaFirebaseError("joinTriviaParentSessionVerify", { sessionId, path: getTriviaParentSessionPath(sessionId) }, error);
      }
    }

    return {
      isExistingPlayer: true,
      joinedLobby: true,
      parentSessionData,
    };
  } catch (error) {
    logTriviaFirebaseError("joinTriviaParentSession", { sessionId, path: getTriviaParentSessionPath(sessionId) }, error);
    return {
      isExistingPlayer: false,
      joinedLobby: false,
      parentSessionData: null,
    };
  }
}

async function updateSessionAllReadyBestEffort(sessionId: string) {
  try {
    await updateSessionAllReady(sessionId);
  } catch (error) {
    if (getFirebaseErrorCode(error) !== "permission-denied") {
      throw error;
    }
  }
}

async function upsertPlayer(
  sessionId: string,
  player: PlayerIdentity,
  playerName: string,
  playerIndex: number,
) {
  await setDoc(
    getTriviaPlayerRef(sessionId, player.id),
    {
      name: playerName || player.name,
      playerIndex,
      score: 0,
      ready: false,
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
}


function canCurrentUserAccessActiveGame({
  authUid,
  hostPlayerId,
  playerIds,
}: {
  authUid: string;
  hostPlayerId?: string | null;
  playerIds?: string[] | null;
}) {
  return authUid === hostPlayerId || Boolean(playerIds?.includes(authUid));
}
function summarizeParentSession(parentSession: Partial<TriviaParentSession>) {
  return {
    sessionId: parentSession.sessionId ?? null,
    gameId: parentSession.gameId ?? null,
    gameType: parentSession.gameType ?? null,
    hostPlayerId: parentSession.hostPlayerId ?? null,
    playerIds: parentSession.playerIds ?? [],
    status: parentSession.status ?? null,
    createdAt: formatTimestampForLog(parentSession.createdAt),
    updatedAt: formatTimestampForLog(parentSession.updatedAt),
  };
}

function toLoggableParentPayload(parentSession: TriviaParentSession) {
  return {
    sessionId: parentSession.sessionId,
    gameId: parentSession.gameId,
    gameType: parentSession.gameType,
    hostPlayerId: parentSession.hostPlayerId,
    playerIds: parentSession.playerIds,
    status: parentSession.status,
    createdAt: "serverTimestamp()",
    updatedAt: "serverTimestamp()",
  };
}

function toLoggableTriviaPayload(session: TriviaSession) {
  return {
    status: session.status,
    turnIndex: session.turnIndex,
    questionIndex: session.questionIndex,
    teamStreak: session.teamStreak,
    totalPoints: session.totalPoints,
    correctAnswers: session.correctAnswers,
    totalPlayers: session.totalPlayers,
    selectedQuestions: session.selectedQuestions,
    allReady: session.allReady,
    currentSelection: session.currentSelection,
    selectionRevealed: session.selectionRevealed,
    hostPlayerId: session.hostPlayerId,
    sessionCode: session.sessionCode,
    createdAt: "serverTimestamp()",
    updatedAt: "serverTimestamp()",
  };
}

function formatTimestampForLog(value: unknown) {
  if (!value) {
    return null;
  }

  if (typeof value === "object" && "toDate" in value) {
    return "Timestamp";
  }

  return value;
}

function normalizeSessionId(sessionId: string) {
  return sessionId.trim().toUpperCase();
}
