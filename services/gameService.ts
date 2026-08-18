import {
  onValue,
  ref,
  type DataSnapshot,
} from "firebase/database";
import { httpsCallable } from "firebase/functions";
import { functions, rtdb } from "@/config/firebase";

export type GameType = "bomb_defusal" | "spot_difference" | "trivia_blitz";
export type SessionStatus =
  | "lobby"
  | "countdown"
  | "active"
  | "completed"
  | "failed"
  | "canceled"
  | "expired";
export type SpotTeamId = "A" | "B";

export interface GamePlayer {
  displayName: string;
  avatarUrl: string | null;
  isReady: boolean;
  joinOrder?: number;
  teamId?: SpotTeamId;
  previousTeamId?: SpotTeamId;
  teamReassignedAt?: number;
  teamAssignmentNoticeId?: string;
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
  countdownStartsAt?: number | null;
  gameplayStartsAt?: number | null;
  endsAt?: number | null;
  startAttemptId?: string | null;
  completedAt: number | null;
  updatedAt?: number;
  gameState: Record<string, unknown>;
  minPlayers: number;
  maxPlayers: number;
  settings: Record<string, unknown>;
}

export interface SpotTeamDiscoveryState {
  teamId: SpotTeamId;
  foundDifferenceIds: string[];
  foundCount: number;
  latestDiscovery?: {
    differenceId: string;
    playerName: string;
    foundAt: number;
  } | null;
}

export type ActiveGameSession = Pick<GameSession, "sessionId" | "gameType" | "status"> & {
  callerIsParticipant: boolean;
  endsAtMs: number;
  expiresAtLocalMs: number;
};

export type ActiveSquadSessionFetchResult =
  | { status: "ready"; session: ActiveGameSession | null }
  | { status: "permission-error" }
  | { status: "network-error" };

const activeSquadSessionRequests = new Map<string, Promise<ActiveSquadSessionFetchResult>>();

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

export function fetchActiveSquadSession(squadId: string): Promise<ActiveSquadSessionFetchResult> {
  const key = squadId.trim();
  const existing = activeSquadSessionRequests.get(key);
  if (existing) return existing;

  const request = requestActiveSquadSession(key).finally(() => {
    if (activeSquadSessionRequests.get(key) === request) activeSquadSessionRequests.delete(key);
  });
  activeSquadSessionRequests.set(key, request);
  return request;
}

async function requestActiveSquadSession(squadId: string): Promise<ActiveSquadSessionFetchResult> {
  if (!squadId) return { status: "ready", session: null };
  try {
    const callable = httpsCallable<{ squadId: string }, unknown>(functions, "getActiveSquadGameSession");
    const rawResult = asRecord((await callable({ squadId })).data);
    if (rawResult.session == null) return { status: "ready", session: null };
    const session = asRecord(rawResult.session);
    const sessionId = typeof session.sessionId === "string" ? session.sessionId.trim() : "";
    const gameType = session.gameType;
    const status = session.status;
    const endsAtMs = typeof session.endsAtMs === "number" && Number.isFinite(session.endsAtMs)
      ? session.endsAtMs
      : 0;
    const serverNowMs = typeof rawResult.serverNowMs === "number" && Number.isFinite(rawResult.serverNowMs)
      ? rawResult.serverNowMs
      : 0;
    if (
      !sessionId ||
      (gameType !== "bomb_defusal" && gameType !== "spot_difference") ||
      (status !== "lobby" && status !== "countdown" && status !== "active") ||
      endsAtMs <= 0 ||
      serverNowMs <= 0
    ) {
      return { status: "network-error" };
    }
    return {
      status: "ready",
      session: {
        sessionId,
        gameType,
        status,
        callerIsParticipant: session.callerIsParticipant === true,
        endsAtMs,
        expiresAtLocalMs: Date.now() + Math.max(0, endsAtMs - serverNowMs),
      },
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return code.includes("permission-denied") || code.includes("unauthenticated")
      ? { status: "permission-error" }
      : { status: "network-error" };
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

export function subscribeToSpotTeamState(
  sessionId: string,
  teamId: SpotTeamId,
  callback: (state: SpotTeamDiscoveryState | null) => void,
): () => void {
  try {
    return onValue(
      ref(rtdb, `gameSessionTeamState/${sessionId}/${teamId}`),
      (snapshot) => {
        if (!snapshot.exists()) {
          callback(null);
          return;
        }
        const value = asRecord(snapshot.val());
        callback({
          teamId,
          foundDifferenceIds: Array.isArray(value.foundDifferenceIds)
            ? value.foundDifferenceIds.filter((id): id is string => typeof id === "string")
            : [],
          foundCount: typeof value.foundCount === "number" && Number.isFinite(value.foundCount)
            ? Math.max(0, Math.floor(value.foundCount))
            : 0,
          latestDiscovery: normalizeLatestSpotDiscovery(value.latestDiscovery),
        });
      },
      (error) => {
        console.error("[GameService] subscribeToSpotTeamState error:", error);
        callback(null);
      },
    );
  } catch (error) {
    console.error("[GameService] subscribeToSpotTeamState setup error:", error);
    callback(null);
    return () => {};
  }
}

export function getGameLabelKey(gameType: GameType): string {
  switch (gameType) {
    case "bomb_defusal":
      return "games.bombDefusal.title";
    case "spot_difference":
      return "games.spotDifference.title";
    case "trivia_blitz":
      return "games.triviaBlitz.title";
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeLatestSpotDiscovery(value: unknown): SpotTeamDiscoveryState["latestDiscovery"] {
  const record = asRecord(value);
  return typeof record.differenceId === "string" &&
    typeof record.playerName === "string" &&
    typeof record.foundAt === "number" &&
    Number.isFinite(record.foundAt)
    ? {
      differenceId: record.differenceId,
      playerName: record.playerName,
      foundAt: record.foundAt,
    }
    : null;
}

