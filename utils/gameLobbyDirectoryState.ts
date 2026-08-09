import type {
  GameJoinCodeFailureReason,
  GameJoinCodeType,
  GameLobbyCreationBlockReason,
  GameLobbyDirectoryResult,
  GameLobbyJoinAction,
  GameLobbyStatus,
  GameLobbySummary,
} from "@/services/gameJoinCodeService";
import type { AccountStandingStatus } from "@/types/accountStanding";

export type GameLobbyDirectoryEligibilityKind =
  | "checking"
  | "eligible"
  | "creating"
  | "authRequired"
  | "accountUnavailable"
  | "accountRestricted"
  | "missingSquad"
  | "membershipUnavailable"
  | "inactiveMembership"
  | "activeLobby"
  | "lobbyLimit"
  | "directoryUnavailable";

export type GameLobbyDirectoryEligibility = {
  kind: GameLobbyDirectoryEligibilityKind;
};

export function resolveGameLobbyDirectoryEligibility(input: {
  authLoading: boolean;
  authenticated: boolean;
  accountLoading: boolean;
  accountError: boolean;
  accountStatus: AccountStandingStatus | null;
  membershipLoading: boolean;
  membershipError: boolean;
  squadId: string;
  selectedSquadId: string | null;
  hasActiveMembership: boolean;
  directoryLoading: boolean;
  directoryResolved: boolean;
  directoryError: GameJoinCodeFailureReason | null;
  directory: GameLobbyDirectoryResult;
  creating: boolean;
}): GameLobbyDirectoryEligibility {
  if (input.authLoading || input.accountLoading || input.membershipLoading) return { kind: "checking" };
  if (!input.authenticated) return { kind: "authRequired" };
  if (input.accountError || !input.accountStatus) return { kind: "accountUnavailable" };
  if (input.accountStatus !== "active") return { kind: "accountRestricted" };
  if (input.membershipError) return { kind: "membershipUnavailable" };
  if (!input.squadId || !input.selectedSquadId) return { kind: "missingSquad" };
  if (input.selectedSquadId !== input.squadId || !input.hasActiveMembership) {
    return { kind: "inactiveMembership" };
  }
  if (input.directoryLoading || !input.directoryResolved) return { kind: "checking" };
  if (input.directoryError === "not_authorized") return { kind: "inactiveMembership" };
  if (input.directoryError) return { kind: "directoryUnavailable" };
  if (
    input.directory.activeLobby ||
    input.directory.creationBlockReason === "active_lobby"
  ) return { kind: "activeLobby" };
  if (
    input.directory.creationBlockReason === "lobby_limit" ||
    input.directory.lobbies.length >= input.directory.maxLobbiesPerGame
  ) return { kind: "lobbyLimit" };
  if (input.creating) return { kind: "creating" };
  if (input.directory.canCreateLobby && input.directory.creationBlockReason === null) {
    return { kind: "eligible" };
  }
  return { kind: "directoryUnavailable" };
}

export function createEmptyGameLobbyDirectoryResult(): GameLobbyDirectoryResult {
  return {
    lobbies: [],
    canCreateLobby: false,
    activeLobbyId: null,
    activeLobby: null,
    creationBlockReason: "eligibility_unavailable",
    maxLobbiesPerGame: 3,
    serverNowMs: 0,
  };
}

export function normalizeGameLobbyDirectoryResult(value: unknown): GameLobbyDirectoryResult {
  const record = readRecord(value);
  const maxLobbiesPerGame = readPositiveInteger(record.maxLobbiesPerGame) ?? 3;
  const lobbies = Array.isArray(record.lobbies)
    ? record.lobbies.map(readLobbySummary).filter((lobby): lobby is GameLobbySummary => lobby !== null)
    : [];
  const activeLobby = readActiveLobby(record.activeLobby);
  const activeLobbyId = readIdentifier(record.activeLobbyId) ?? activeLobby?.lobbyId ?? null;
  const reportedBlockReason = readCreationBlockReason(record.creationBlockReason);
  const creationBlockReason: GameLobbyCreationBlockReason = activeLobby
    ? "active_lobby"
    : lobbies.length >= maxLobbiesPerGame
      ? "lobby_limit"
      : reportedBlockReason ?? (record.canCreateLobby === true ? null : "eligibility_unavailable");

  return {
    lobbies,
    canCreateLobby: record.canCreateLobby === true && creationBlockReason === null,
    activeLobbyId,
    activeLobby,
    creationBlockReason,
    maxLobbiesPerGame,
    serverNowMs: readFiniteNumber(record.serverNowMs) ?? 0,
  };
}

function readLobbySummary(value: unknown): GameLobbySummary | null {
  const record = readRecord(value);
  const lobbyId = readIdentifier(record.lobbyId);
  const sessionId = readIdentifier(record.sessionId);
  const gameType = readGameType(record.gameType);
  const lobbyNumber = readPositiveInteger(record.lobbyNumber);
  const hostDisplayName = readNonEmptyString(record.hostDisplayName);
  const status = readStatus(record.status);
  const activePlayerCount = readNonNegativeInteger(record.activePlayerCount);
  const queuedPlayerCount = readNonNegativeInteger(record.queuedPlayerCount);
  const capacity = readPositiveInteger(record.capacity);
  const callerState = record.callerState === "none" || record.callerState === "active" || record.callerState === "queued"
    ? record.callerState
    : null;
  const joinAction = readJoinAction(record.joinAction);
  if (
    !lobbyId || !sessionId || !gameType || !lobbyNumber || !hostDisplayName || !status ||
    activePlayerCount === null || queuedPlayerCount === null || !capacity || !callerState || !joinAction
  ) return null;
  return {
    lobbyId,
    sessionId,
    gameType,
    lobbyNumber,
    isMain: record.isMain === true,
    hostDisplayName,
    status,
    activePlayerCount,
    queuedPlayerCount,
    capacity,
    callerState,
    callerIsHost: record.callerIsHost === true,
    joinAction,
  };
}

function readActiveLobby(value: unknown): GameLobbyDirectoryResult["activeLobby"] {
  const record = readRecord(value);
  const lobbyId = readIdentifier(record.lobbyId);
  const sessionId = readIdentifier(record.sessionId);
  const squadId = readIdentifier(record.squadId);
  const gameType = readGameType(record.gameType);
  const state = record.state === "joining" || record.state === "active" || record.state === "queued" || record.state === "leaving"
    ? record.state
    : null;
  if (!lobbyId || !sessionId || !squadId || !gameType || !state) return null;
  return {
    lobbyId,
    sessionId,
    squadId,
    gameType,
    state,
    activePlayerCount: record.activePlayerCount === null
      ? null
      : readNonNegativeInteger(record.activePlayerCount),
    callerIsHost: record.callerIsHost === true,
  };
}

function readCreationBlockReason(value: unknown): GameLobbyCreationBlockReason {
  return value === "active_lobby" || value === "lobby_limit" || value === "eligibility_unavailable"
    ? value
    : null;
}

function readGameType(value: unknown): GameJoinCodeType | null {
  return value === "bombDefusal" || value === "spotTheDifferences" || value === "triviaBlitz"
    ? value
    : null;
}

function readStatus(value: unknown): GameLobbyStatus | null {
  return value === "waiting" || value === "starting" || value === "inProgress" ||
    value === "results" || value === "waitingForRematch"
    ? value
    : null;
}

function readJoinAction(value: unknown): GameLobbyJoinAction | null {
  return value === "join" || value === "reconnect" || value === "joinNextRound" ||
    value === "queued" || value === "full" || value === "unavailable"
    ? value
    : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readIdentifier(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,360}$/.test(value) ? value : null;
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readFiniteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readPositiveInteger(value: unknown) {
  const number = readFiniteNumber(value);
  return number !== null && Number.isInteger(number) && number > 0 ? number : null;
}

function readNonNegativeInteger(value: unknown) {
  const number = readFiniteNumber(value);
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null;
}
