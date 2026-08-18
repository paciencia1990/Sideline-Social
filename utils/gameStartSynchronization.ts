import type { GameJoinCodeType } from "@/services/gameJoinCodeService";

export const GAME_START_SCHEMA_VERSION = 1;
export const GAME_START_SAFETY_LEAD_MS = 2_500;
export const GAME_START_COUNTDOWN_MS = 3_800;
export const GAME_START_READY_TIMEOUT_MS = 20_000;

export type GameStartServerPhase = "preparing" | "activating" | "scheduled" | "failed";
export type GameStartVisiblePhase = "preparing" | "timedOut" | "3" | "2" | "1" | "go" | "active" | "updateRequired";

export type GameStartState = {
  schemaVersion: number;
  gameType: GameJoinCodeType;
  sessionId: string;
  lobbyId: string;
  hostUserId: string;
  startAttemptId: string;
  phase: GameStartServerPhase;
  participantCount: number;
  acknowledgedCount: number;
  readinessDeadlineAtMs: number;
  countdownStartsAtMs: number | null;
  gameplayStartsAtMs: number | null;
  failureReason: string | null;
};

export function gameStartStateId(gameType: GameJoinCodeType, sessionId: string) {
  return `${gameType}__${sessionId}`;
}

export function serverAdjustedNow(localNowMs: number, serverTimeOffsetMs: number) {
  return localNowMs + (Number.isFinite(serverTimeOffsetMs) ? serverTimeOffsetMs : 0);
}

export function deriveGameStartVisiblePhase(
  state: GameStartState | null,
  serverNowMs: number,
): GameStartVisiblePhase {
  if (!state || state.schemaVersion !== GAME_START_SCHEMA_VERSION) return "updateRequired";
  if (state.phase === "failed") return "timedOut";
  if (
    (state.phase === "preparing" || state.phase === "activating") &&
    serverNowMs >= state.readinessDeadlineAtMs
  ) return "timedOut";
  if (state.phase !== "scheduled" || !state.countdownStartsAtMs || !state.gameplayStartsAtMs) {
    return "preparing";
  }
  if (serverNowMs >= state.gameplayStartsAtMs) return "active";
  if (serverNowMs < state.countdownStartsAtMs) return "preparing";

  const elapsedMs = serverNowMs - state.countdownStartsAtMs;
  if (elapsedMs < 1_000) return "3";
  if (elapsedMs < 2_000) return "2";
  if (elapsedMs < 3_000) return "1";
  return "go";
}

export function normalizeGameStartState(value: unknown): GameStartState | null {
  const data = asRecord(value);
  const gameType = data.gameType;
  const phase = data.phase;
  if (
    data.schemaVersion !== GAME_START_SCHEMA_VERSION ||
    (gameType !== "bombDefusal" && gameType !== "spotTheDifferences" && gameType !== "triviaBlitz") ||
    (phase !== "preparing" && phase !== "activating" && phase !== "scheduled" && phase !== "failed") ||
    typeof data.sessionId !== "string" ||
    typeof data.lobbyId !== "string" ||
    typeof data.hostUserId !== "string" ||
    typeof data.startAttemptId !== "string" ||
    !isFiniteNumber(data.participantCount) ||
    !isFiniteNumber(data.acknowledgedCount) ||
    !isFiniteNumber(data.readinessDeadlineAtMs)
  ) return null;
  return {
    schemaVersion: GAME_START_SCHEMA_VERSION,
    gameType,
    sessionId: data.sessionId,
    lobbyId: data.lobbyId,
    hostUserId: data.hostUserId,
    startAttemptId: data.startAttemptId,
    phase,
    participantCount: data.participantCount,
    acknowledgedCount: data.acknowledgedCount,
    readinessDeadlineAtMs: data.readinessDeadlineAtMs,
    countdownStartsAtMs: isFiniteNumber(data.countdownStartsAtMs) ? data.countdownStartsAtMs : null,
    gameplayStartsAtMs: isFiniteNumber(data.gameplayStartsAtMs) ? data.gameplayStartsAtMs : null,
    failureReason: typeof data.failureReason === "string" ? data.failureReason : null,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
