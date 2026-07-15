import { signInAnonymously } from "firebase/auth";
import { collection, doc } from "firebase/firestore";

import { auth, db } from "@/config/firebase";
import type { PlayerIdentity } from "./types";

export function getTriviaParentSessionPath(sessionId: string) {
  return `sessions/${sessionId}`;
}

export function getTriviaSessionPath(sessionId: string) {
  return `${getTriviaParentSessionPath(sessionId)}/games/triviaBlitz`;
}

export function getTriviaPlayersPath(sessionId: string) {
  return `${getTriviaSessionPath(sessionId)}/players`;
}

export function getTriviaPlayerPath(sessionId: string, playerId: string) {
  return `${getTriviaPlayersPath(sessionId)}/${playerId}`;
}

export function getTriviaParentSessionRef(sessionId: string) {
  return doc(db, "sessions", sessionId);
}

export function getTriviaSessionRef(sessionId: string) {
  return doc(db, "sessions", sessionId, "games", "triviaBlitz");
}

export function getTriviaPlayersRef(sessionId: string) {
  return collection(db, "sessions", sessionId, "games", "triviaBlitz", "players");
}

export function getTriviaPlayerRef(sessionId: string, playerId: string) {
  return doc(db, "sessions", sessionId, "games", "triviaBlitz", "players", playerId);
}

export async function getCurrentPlayer(defaultName = "Player"): Promise<PlayerIdentity> {
  const existingUser = auth.currentUser;
  if (existingUser) {
    return {
      id: existingUser.uid,
      name: existingUser.displayName || existingUser.email?.split("@")[0] || defaultName,
      isAuthenticated: true,
    };
  }

  try {
    const credential = await signInAnonymously(auth);
    return {
      id: credential.user.uid,
      name: credential.user.displayName || defaultName,
      isAuthenticated: true,
    };
  } catch (error) {
    logTriviaFirebaseError("anonymousSignIn", { path: "auth/anonymous" }, error);
    throw new Error("Please sign in before starting Trivia Blitz.");
  }
}

export function getFirebaseErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong while contacting Firebase.";
}

export function getFirebaseErrorCode(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code?: unknown }).code);
  }

  return "unknown";
}

export function logTriviaFirebaseError(
  operation: string,
  _details: Record<string, unknown>,
  error: unknown,
) {
  if (!__DEV__) {
    return;
  }

  console.error("[TriviaBlitz] Firebase operation failed", {
    operation,
    code: getFirebaseErrorCode(error),
  });
}
