import {
  equalTo,
  get,
  onValue,
  orderByChild,
  query,
  ref,
  remove,
  set,
  update,
  type DataSnapshot,
} from "firebase/database";
import { rtdb } from "@/config/firebase";

export type GameType = "bomb_defusal" | "spot_difference" | "trivia_blitz";
export type SessionStatus = "lobby" | "countdown" | "active" | "completed" | "failed";

export interface GamePlayer {
  displayName: string;
  avatarUrl: string | null;
  isReady: boolean;
  score: number;
  isConnected: boolean;
}

export interface GameSession {
  sessionId: string;
  gameType: GameType;
  squadId: string;
  hostUserId: string;
  players: Record<string, GamePlayer>;
  status: SessionStatus;
  startedAt: number | null;
  completedAt: number | null;
  gameState: Record<string, unknown>;
  minPlayers: number;
  maxPlayers: number;
  settings: Record<string, unknown>;
}

export const GAME_CONFIG: Record<
  GameType,
  { minPlayers: number; maxPlayers: number; defaultSettings: Record<string, unknown> }
> = {
  bomb_defusal: { minPlayers: 2, maxPlayers: 6, defaultSettings: { timerSeconds: 300 } },
  spot_difference: { minPlayers: 4, maxPlayers: 12, defaultSettings: { roundDuration: 420 } },
  trivia_blitz: { minPlayers: 2, maxPlayers: 20, defaultSettings: { questionCount: 10, timeLimitSeconds: 20 } },
};

function snapshotToSession(snapshot: DataSnapshot): GameSession | null {
  if (!snapshot.exists()) return null;
  return snapshot.val() as GameSession;
}

function getSessionsFromSnapshot(snapshot: DataSnapshot): GameSession[] {
  if (!snapshot.exists()) return [];

  const data = snapshot.val() as Record<string, GameSession> | null;
  return data ? Object.values(data) : [];
}

export async function setPlayerReady(sessionId: string, userId: string, ready: boolean): Promise<void> {
  try {
    await set(ref(rtdb, `gameSessions/${sessionId}/players/${userId}/isReady`), ready);
  } catch (error) {
    console.error("[GameService] setPlayerReady error:", error);
    throw error;
  }
}

export async function setPlayerConnected(sessionId: string, userId: string, connected: boolean): Promise<void> {
  try {
    await set(ref(rtdb, `gameSessions/${sessionId}/players/${userId}/isConnected`), connected);
  } catch (error) {
    console.error("[GameService] setPlayerConnected error:", error);
  }
}

export async function startCountdown(sessionId: string): Promise<void> {
  try {
    await set(ref(rtdb, `gameSessions/${sessionId}/status`), "countdown");
  } catch (error) {
    console.error("[GameService] startCountdown error:", error);
    throw error;
  }
}

export async function startGame(sessionId: string): Promise<void> {
  try {
    await update(ref(rtdb, `gameSessions/${sessionId}`), {
      status: "active",
      startedAt: Date.now(),
    });
  } catch (error) {
    console.error("[GameService] startGame error:", error);
    throw error;
  }
}

export async function completeGame(
  sessionId: string,
  outcome: "completed" | "failed",
  finalScores: Record<string, number>
): Promise<void> {
  try {
    const scoreUpdates: Record<string, unknown> = {
      status: outcome,
      completedAt: Date.now(),
    };

    Object.entries(finalScores).forEach(([uid, score]) => {
      scoreUpdates[`players/${uid}/score`] = score;
    });

    await update(ref(rtdb, `gameSessions/${sessionId}`), scoreUpdates);
  } catch (error) {
    console.error("[GameService] completeGame error:", error);
    throw error;
  }
}

export async function fetchActiveSquadSession(squadId: string): Promise<GameSession | null> {
  try {
    const sessionsQuery = query(ref(rtdb, "gameSessions"), orderByChild("squadId"), equalTo(squadId));
    const snapshot = await get(sessionsQuery);

    return getSessionsFromSnapshot(snapshot).find(
      (session) => session.status === "lobby" || session.status === "countdown" || session.status === "active"
    ) ?? null;
  } catch (error) {
    console.error("[GameService] fetchActiveSquadSession error:", error);
    return null;
  }
}

export function subscribeToSession(
  sessionId: string,
  callback: (session: GameSession | null) => void
): () => void {
  try {
    return onValue(
      ref(rtdb, `gameSessions/${sessionId}`),
      (snapshot) => callback(snapshotToSession(snapshot)),
      (error) => {
        console.error("[GameService] subscribeToSession error:", error);
        callback(null);
      }
    );
  } catch (error) {
    console.error("[GameService] subscribeToSession setup error:", error);
    callback(null);
    return () => {};
  }
}

export async function removePlayer(sessionId: string, userId: string): Promise<void> {
  try {
    await remove(ref(rtdb, `gameSessions/${sessionId}/players/${userId}`));
  } catch (error) {
    console.error("[GameService] removePlayer error:", error);
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await remove(ref(rtdb, `gameSessions/${sessionId}`));
  } catch (error) {
    console.error("[GameService] deleteSession error:", error);
  }
}

export async function updateGameState(
  sessionId: string,
  gameState: Record<string, unknown>
): Promise<void> {
  try {
    await update(ref(rtdb, `gameSessions/${sessionId}/gameState`), gameState);
  } catch (error) {
    console.error("[GameService] updateGameState error:", error);
    throw error;
  }
}

export function getGameLabel(gameType: GameType): string {
  switch (gameType) {
    case "bomb_defusal":
      return "Bomb Defusal";
    case "spot_difference":
      return "Spot the Differences";
    case "trivia_blitz":
      return "Trivia Blitz";
  }
}

export function getGameEmoji(gameType: GameType): string {
  switch (gameType) {
    case "bomb_defusal":
      return "\uD83D\uDCA3";
    case "spot_difference":
      return "\uD83D\uDD0D";
    case "trivia_blitz":
      return "\u26A1";
  }
}

