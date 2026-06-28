import AsyncStorage from "@react-native-async-storage/async-storage";
import { signInAnonymously } from "firebase/auth";
import { collection, doc } from "firebase/firestore";

import { auth, db } from "@/config/firebase";
import type { PlayerIdentity } from "./types";

const GUEST_PLAYER_KEY = "triviaBlitzGuestPlayerId";

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
  } catch {
    const guestId = await getStableGuestPlayerId();
    return {
      id: guestId,
      name: defaultName,
      isAuthenticated: false,
    };
  }
}

export function getFirebaseErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong while contacting Firebase.";
}

async function getStableGuestPlayerId() {
  const existingId = await AsyncStorage.getItem(GUEST_PLAYER_KEY);
  if (existingId) {
    return existingId;
  }

  const nextId = `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await AsyncStorage.setItem(GUEST_PLAYER_KEY, nextId);
  return nextId;
}
