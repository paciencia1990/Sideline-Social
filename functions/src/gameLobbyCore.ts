import type { GameJoinCodeType } from './gameJoinCodeCore';

export const MAX_DISCOVERABLE_GAME_LOBBIES = 3;
export const GAME_LOBBY_SCHEMA_VERSION = 1;

export const GAME_LOBBY_STATUSES = [
  'provisioning',
  'waiting',
  'starting',
  'inProgress',
  'results',
  'waitingForRematch',
  'closed',
  'expired',
] as const;

export type GameLobbyStatus = (typeof GAME_LOBBY_STATUSES)[number];
export type GameLobbyCallerState = 'none' | 'active' | 'queued';
export type GameLobbyJoinAction =
  | 'join'
  | 'reconnect'
  | 'joinNextRound'
  | 'queued'
  | 'full'
  | 'unavailable';

export type GameLobbyDirectoryEntry = {
  lobbyId: string;
  sessionId: string;
  gameType: GameJoinCodeType;
  squadId: string;
  lobbyNumber: number;
  hostUserId: string;
  hostDisplayName: string;
  status: GameLobbyStatus;
  activePlayerCount: number;
  queuedPlayerCount: number;
  capacity: number;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
};

export type GameLobbyDirectoryState = {
  schemaVersion: number;
  squadId: string;
  gameType: GameJoinCodeType;
  mainLobbyId: string | null;
  nextLobbyNumber: number;
  lobbies: Record<string, GameLobbyDirectoryEntry>;
};

export function createEmptyGameLobbyDirectory(
  squadId: string,
  gameType: GameJoinCodeType,
): GameLobbyDirectoryState {
  return {
    schemaVersion: GAME_LOBBY_SCHEMA_VERSION,
    squadId,
    gameType,
    mainLobbyId: null,
    nextLobbyNumber: 1,
    lobbies: {},
  };
}

export function normalizeGameLobbyDirectory(
  value: unknown,
  squadId: string,
  gameType: GameJoinCodeType,
  nowMs: number,
): GameLobbyDirectoryState {
  const record = readRecord(value);
  const rawLobbies = readRecord(record.lobbies);
  const lobbies = Object.fromEntries(
    Object.entries(rawLobbies).flatMap(([lobbyId, entryValue]) => {
      const entry = normalizeLobbyEntry(entryValue, lobbyId, squadId, gameType);
      return entry && isDiscoverableLobby(entry, nowMs) ? [[lobbyId, entry]] : [];
    }),
  );
  const nextLobbyNumber = Math.max(
    readPositiveInteger(record.nextLobbyNumber) ?? 1,
    ...Object.values(lobbies).map((entry) => entry.lobbyNumber + 1),
  );
  const requestedMain = typeof record.mainLobbyId === 'string' ? record.mainLobbyId : null;
  const mainLobbyId = requestedMain && lobbies[requestedMain]
    ? requestedMain
    : earliestLobby(lobbies)?.lobbyId ?? null;
  return {
    schemaVersion: GAME_LOBBY_SCHEMA_VERSION,
    squadId,
    gameType,
    mainLobbyId,
    nextLobbyNumber,
    lobbies,
  };
}

export function addGameLobbyToDirectory(
  directory: GameLobbyDirectoryState,
  entry: GameLobbyDirectoryEntry,
): GameLobbyDirectoryState {
  if (Object.keys(directory.lobbies).length >= MAX_DISCOVERABLE_GAME_LOBBIES) {
    throw new GameLobbyLimitError();
  }
  if (directory.lobbies[entry.lobbyId]) return directory;
  const lobbies = { ...directory.lobbies, [entry.lobbyId]: entry };
  return {
    ...directory,
    mainLobbyId: directory.mainLobbyId ?? entry.lobbyId,
    nextLobbyNumber: Math.max(directory.nextLobbyNumber, entry.lobbyNumber + 1),
    lobbies,
  };
}

export function removeGameLobbyFromDirectory(
  directory: GameLobbyDirectoryState,
  lobbyId: string,
): GameLobbyDirectoryState {
  if (!directory.lobbies[lobbyId]) return directory;
  const lobbies = { ...directory.lobbies };
  delete lobbies[lobbyId];
  const mainLobbyId = directory.mainLobbyId === lobbyId
    ? earliestLobby(lobbies)?.lobbyId ?? null
    : directory.mainLobbyId && lobbies[directory.mainLobbyId]
      ? directory.mainLobbyId
      : earliestLobby(lobbies)?.lobbyId ?? null;
  return { ...directory, lobbies, mainLobbyId };
}

export function updateGameLobbyInDirectory(
  directory: GameLobbyDirectoryState,
  entry: GameLobbyDirectoryEntry,
): GameLobbyDirectoryState {
  if (!directory.lobbies[entry.lobbyId]) return directory;
  return {
    ...directory,
    lobbies: { ...directory.lobbies, [entry.lobbyId]: entry },
  };
}

export function nextGameLobbyNumber(directory: GameLobbyDirectoryState) {
  return Math.max(1, directory.nextLobbyNumber);
}

export function resolveGameLobbyJoinAction(input: {
  callerState: GameLobbyCallerState;
  status: GameLobbyStatus;
  activePlayerCount: number;
  queuedPlayerCount: number;
  capacity: number;
}): GameLobbyJoinAction {
  if (input.callerState === 'active') return 'reconnect';
  if (input.callerState === 'queued') return 'queued';
  if (input.status === 'waiting') {
    return input.activePlayerCount >= input.capacity ? 'full' : 'join';
  }
  if (input.status === 'inProgress' || input.status === 'starting' || input.status === 'results') {
    return input.activePlayerCount + input.queuedPlayerCount >= input.capacity
      ? 'full'
      : 'joinNextRound';
  }
  return 'unavailable';
}

export function isDiscoverableLobby(entry: GameLobbyDirectoryEntry, nowMs: number) {
  return entry.expiresAtMs > nowMs &&
    entry.status !== 'closed' &&
    entry.status !== 'expired';
}

export function sortGameLobbies(entries: GameLobbyDirectoryEntry[]) {
  return [...entries].sort((left, right) => {
    if (left.lobbyNumber !== right.lobbyNumber) return left.lobbyNumber - right.lobbyNumber;
    if (left.createdAtMs !== right.createdAtMs) return left.createdAtMs - right.createdAtMs;
    return left.lobbyId.localeCompare(right.lobbyId);
  });
}

export class GameLobbyLimitError extends Error {
  constructor() {
    super('The Squad already has the maximum number of discoverable lobbies for this game.');
    this.name = 'GameLobbyLimitError';
  }
}

function earliestLobby(lobbies: Record<string, GameLobbyDirectoryEntry>) {
  return sortGameLobbies(Object.values(lobbies))[0] ?? null;
}

function normalizeLobbyEntry(
  value: unknown,
  lobbyId: string,
  squadId: string,
  gameType: GameJoinCodeType,
): GameLobbyDirectoryEntry | null {
  const record = readRecord(value);
  const status = readLobbyStatus(record.status);
  const sessionId = readIdentifier(record.sessionId);
  const storedLobbyId = readIdentifier(record.lobbyId) ?? lobbyId;
  const hostUserId = readIdentifier(record.hostUserId);
  const hostDisplayName = typeof record.hostDisplayName === 'string'
    ? record.hostDisplayName.trim().slice(0, 120)
    : '';
  const lobbyNumber = readPositiveInteger(record.lobbyNumber);
  const capacity = readPositiveInteger(record.capacity);
  const createdAtMs = readPositiveNumber(record.createdAtMs);
  const updatedAtMs = readPositiveNumber(record.updatedAtMs);
  const expiresAtMs = readPositiveNumber(record.expiresAtMs);
  if (
    !status ||
    !sessionId ||
    !storedLobbyId ||
    !hostUserId ||
    !hostDisplayName ||
    !lobbyNumber ||
    !capacity ||
    !createdAtMs ||
    !updatedAtMs ||
    !expiresAtMs ||
    record.squadId !== squadId ||
    record.gameType !== gameType
  ) return null;
  return {
    lobbyId: storedLobbyId,
    sessionId,
    gameType,
    squadId,
    lobbyNumber,
    hostUserId,
    hostDisplayName,
    status,
    activePlayerCount: readNonNegativeInteger(record.activePlayerCount),
    queuedPlayerCount: readNonNegativeInteger(record.queuedPlayerCount),
    capacity,
    createdAtMs,
    updatedAtMs,
    expiresAtMs,
  };
}

function readLobbyStatus(value: unknown): GameLobbyStatus | null {
  return GAME_LOBBY_STATUSES.includes(value as GameLobbyStatus)
    ? value as GameLobbyStatus
    : null;
}

function readIdentifier(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9_-]{1,360}$/.test(normalized) ? normalized : null;
}

function readPositiveInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function readNonNegativeInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function readPositiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
