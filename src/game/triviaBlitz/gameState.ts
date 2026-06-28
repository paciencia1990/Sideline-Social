import {
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
import {
  getCurrentPlayer,
  getTriviaPlayerRef,
  getTriviaPlayersRef,
  getTriviaSessionRef,
} from "./firebaseUtils";
import type { PlayerIdentity, TriviaPlayer, TriviaQuestion, TriviaSession } from "./types";

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
  await initializeFirestoreSession(sessionId, host);
  await upsertPlayer(sessionId, host, hostName || host.name, 0);
  await updateSessionAllReady(sessionId);
  return { sessionId, playerId: host.id };
}

export async function joinGameSession(sessionId: string, playerName: string) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const player = await getCurrentPlayer(playerName || "Player");
  const sessionRef = getTriviaSessionRef(normalizedSessionId);
  const sessionSnap = await getDoc(sessionRef);

  if (!sessionSnap.exists()) {
    await initializeFirestoreSession(normalizedSessionId, player);
  } else {
    const session = sessionSnap.data() as TriviaSession;
    if (session.status !== "lobby") {
      throw new Error("This Trivia Blitz session has already started or ended.");
    }
  }

  const players = await getPlayers(normalizedSessionId);
  const existingPlayer = players.find((candidate) => candidate.id === player.id);
  await upsertPlayer(
    normalizedSessionId,
    player,
    playerName || player.name,
    existingPlayer?.playerIndex ?? players.length,
  );
  await updateSessionAllReady(normalizedSessionId);
  return { sessionId: normalizedSessionId, playerId: player.id };
}

export async function startGameSession(sessionId: string) {
  const sessionRef = getTriviaSessionRef(sessionId);
  const sessionSnap = await getDoc(sessionRef);

  if (!sessionSnap.exists()) {
    throw new Error("Trivia Blitz session was not found.");
  }

  const session = sessionSnap.data() as TriviaSession;
  if (session.status !== "lobby") {
    return;
  }

  await updateDoc(sessionRef, {
    status: "playing",
    turnIndex: 0,
    questionIndex: 0,
    currentSelection: null,
    selectionRevealed: false,
    updatedAt: serverTimestamp(),
  });
}

export async function togglePlayerReady(sessionId: string, playerId: string, ready: boolean) {
  await updateDoc(getTriviaPlayerRef(sessionId, playerId), {
    ready,
  });
  await updateSessionAllReady(sessionId);
}

export async function updateSessionAllReady(sessionId: string) {
  const players = await getPlayers(sessionId);
  const allReady = players.length > 0 && players.every((player) => player.ready);

  await updateDoc(getTriviaSessionRef(sessionId), {
    allReady,
    totalPlayers: players.length,
    updatedAt: serverTimestamp(),
  });
}

export async function initializeFirestoreSession(sessionId: string, host?: PlayerIdentity) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const sessionRef = getTriviaSessionRef(normalizedSessionId);
  const sessionSnap = await getDoc(sessionRef);

  if (sessionSnap.exists()) {
    return normalizedSessionId;
  }

  const session: TriviaSession = {
    status: "lobby",
    turnIndex: 0,
    questionIndex: 0,
    teamStreak: 0,
    totalPoints: 0,
    correctAnswers: 0,
    totalPlayers: host ? 1 : 0,
    selectedQuestions: getRandomQuestions(),
    allReady: false,
    currentSelection: null,
    selectionRevealed: false,
    hostPlayerId: host?.id,
    sessionCode: normalizedSessionId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(sessionRef, session);
  return normalizedSessionId;
}

export async function submitSessionSelection(
  sessionId: string,
  playerId: string,
  answerIndex: number,
) {
  await updateDoc(getTriviaSessionRef(sessionId), {
    currentSelection: {
      playerId,
      answerIndex,
      selectedAt: Date.now(),
    },
    selectionRevealed: false,
    updatedAt: serverTimestamp(),
  });
}

export async function resetGameSession(sessionId: string) {
  const sessionRef = getTriviaSessionRef(sessionId);
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

  players.forEach((player) => {
    batch.update(getTriviaPlayerRef(sessionId, player.id), {
      score: 0,
      ready: false,
    });
  });

  await batch.commit();
}

export async function forceEndGameSession(sessionId: string) {
  await updateDoc(getTriviaSessionRef(sessionId), {
    status: "results",
    currentSelection: null,
    selectionRevealed: false,
    updatedAt: serverTimestamp(),
  });
}

export async function getPlayers(sessionId: string): Promise<TriviaPlayer[]> {
  const playersQuery = query(getTriviaPlayersRef(sessionId), orderBy("playerIndex", "asc"));
  const playersSnap = await getDocs(playersQuery);

  return playersSnap.docs.map((playerDoc) => ({
    id: playerDoc.id,
    ...(playerDoc.data() as Omit<TriviaPlayer, "id">),
  }));
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

function normalizeSessionId(sessionId: string) {
  return sessionId.trim().toUpperCase();
}
