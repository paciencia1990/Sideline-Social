import { collection, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '@/config/firebase';
import { normalizeGameLobbyDirectoryResult } from '@/utils/gameLobbyDirectoryState';

export type GameJoinCodeType = 'bombDefusal' | 'triviaBlitz' | 'spotTheDifferences';
export type GameJoinCodeStatus = 'lobby' | 'started' | 'ended' | 'canceled' | 'expired';
export type GameJoinCodeFailureReason =
  | 'invalid_code_format'
  | 'invalid_or_expired_code'
  | 'game_not_found'
  | 'game_already_started'
  | 'game_full'
  | 'minimum_players_required'
  | 'not_authorized'
  | 'already_joined'
  | 'host_cannot_join_as_player'
  | 'rate_limited'
  | 'network_unavailable'
  | 'code_reservation_failed'
  | 'session_creation_failed'
  | 'lobby_closed_or_expired'
  | 'already_participating_elsewhere'
  | 'lobby_limit_reached'
  | 'round_in_progress'
  | 'round_not_in_progress'
  | 'round_not_finished'
  | 'finish_active_round_first'
  | 'host_must_transfer'
  | 'lobby_leave_in_progress'
  | 'bomb_not_defuser'
  | 'bomb_command_stale'
  | 'client_update_required';

export type GameLobbyStatus =
  | 'waiting'
  | 'starting'
  | 'inProgress'
  | 'results'
  | 'waitingForRematch';

export type GameLobbyJoinAction =
  | 'join'
  | 'reconnect'
  | 'joinNextRound'
  | 'queued'
  | 'full'
  | 'unavailable';

export type GameLobbyCreationBlockReason =
  | 'active_lobby'
  | 'lobby_limit'
  | 'eligibility_unavailable'
  | null;

export type GameLobbySummary = {
  lobbyId: string;
  sessionId: string;
  gameType: GameJoinCodeType;
  lobbyNumber: number;
  isMain: boolean;
  hostDisplayName: string;
  status: GameLobbyStatus;
  activePlayerCount: number;
  queuedPlayerCount: number;
  capacity: number;
  callerState: 'none' | 'active' | 'queued';
  callerIsHost: boolean;
  joinAction: GameLobbyJoinAction;
};

export type GameLobbyDirectoryResult = {
  lobbies: GameLobbySummary[];
  canCreateLobby: boolean;
  activeLobbyId: string | null;
  activeLobby: {
    lobbyId: string;
    sessionId: string;
    squadId: string;
    gameType: GameJoinCodeType;
    state: 'joining' | 'active' | 'queued' | 'leaving';
    activePlayerCount: number | null;
    callerIsHost: boolean;
  } | null;
  creationBlockReason: GameLobbyCreationBlockReason;
  maxLobbiesPerGame: number;
  serverNowMs: number;
};

export type CreateGameJoinCodeResult = {
  gameType: GameJoinCodeType;
  sessionId: string;
  joinCode: string;
  expiresAt: number;
};

export type ResolveGameJoinCodeResult = {
  gameType: GameJoinCodeType;
  sessionId: string;
  lobbyId: string;
  lobbyNumber: number;
  participantState: 'joined' | 'reconnected';
};

export type CreateGameLobbyResult = ResolveGameJoinCodeResult & {
  joinCode: string;
  expiresAt: number;
};

export function createGameJoinIdempotencyKey() {
  return doc(collection(db, 'gameJoinRequestIds')).id;
}

export async function listGameLobbies(input: {
  squadId: string;
  gameType?: GameJoinCodeType;
}) {
  const callable = httpsCallable<typeof input, unknown>(functions, 'listGameLobbies');
  return normalizeGameLobbyDirectoryResult((await callable(input)).data);
}

export async function createGameLobby(input: {
  squadId: string;
  gameType: GameJoinCodeType;
  idempotencyKey: string;
}) {
  const callable = httpsCallable<typeof input, CreateGameLobbyResult>(functions, 'createGameLobby');
  return (await callable(input)).data;
}

export async function joinGameLobbyById(input: {
  squadId: string;
  gameType: GameJoinCodeType;
  lobbyId: string;
}) {
  const callable = httpsCallable<typeof input, ResolveGameJoinCodeResult>(functions, 'joinGameLobbyById');
  return (await callable(input)).data;
}

export async function joinGameLobbyNextRound(input: {
  squadId: string;
  gameType: GameJoinCodeType;
  lobbyId: string;
}) {
  const callable = httpsCallable<typeof input, ResolveGameJoinCodeResult>(functions, 'joinGameLobbyNextRound');
  return (await callable(input)).data;
}

export async function reconnectGameLobby() {
  const callable = httpsCallable<Record<string, never>, ResolveGameJoinCodeResult | null>(functions, 'reconnectGameLobby');
  return (await callable({})).data;
}

export async function leaveGameLobby(input: { lobbyId: string }) {
  const callable = httpsCallable<typeof input, { status: 'left' | 'closed'; hostChanged: boolean }>(
    functions,
    'leaveGameLobby',
  );
  return (await callable(input)).data;
}

export async function closeGameLobby(input: { lobbyId: string }) {
  const callable = httpsCallable<typeof input, { status: 'closed'; clearedParticipantCount: number }>(functions, 'closeGameLobby');
  return (await callable(input)).data;
}

export async function startGameLobbyRematch(input: { lobbyId: string }) {
  const callable = httpsCallable<typeof input, CreateGameLobbyResult>(functions, 'startGameLobbyRematch');
  return (await callable(input)).data;
}

export async function createGameJoinCode(input: {
  gameType: GameJoinCodeType;
  sessionId?: string | null;
  idempotencyKey: string;
  squadId?: string | null;
}) {
  const callable = httpsCallable<typeof input, CreateGameJoinCodeResult>(functions, 'createGameJoinCode');
  return (await callable(input)).data;
}

export async function resolveAndJoinGameByCode(code: string) {
  const callable = httpsCallable<{ code: string }, ResolveGameJoinCodeResult>(functions, 'resolveAndJoinGameByCode');
  return (await callable({ code })).data;
}

export async function getGameJoinCodeForSession(input: {
  gameType: GameJoinCodeType;
  sessionId: string;
}) {
  const callable = httpsCallable<
    typeof input,
    { joinCode: string; lobbyId: string; lobbyNumber: number; status: GameJoinCodeStatus; expiresAt: number }
  >(functions, 'getGameJoinCodeForSession');
  return (await callable(input)).data;
}

export async function updateGameJoinCodeStatus(input: {
  gameType: GameJoinCodeType;
  sessionId: string;
  status: 'started' | 'ended' | 'canceled';
}) {
  const callable = httpsCallable<typeof input, { status: GameJoinCodeStatus }>(functions, 'updateGameJoinCodeStatus');
  return (await callable(input)).data;
}

export async function releaseGameJoinCode(input: {
  gameType: GameJoinCodeType;
  sessionId: string;
}) {
  const callable = httpsCallable<typeof input, { status: 'canceled' }>(functions, 'releaseGameJoinCode');
  return (await callable(input)).data;
}

export async function recordSpotDifferenceFound(input: {
  sessionId: string;
  x: number;
  y: number;
}) {
  const callable = httpsCallable<
    typeof input,
    {
      found: boolean;
      alreadyFound: boolean;
      foundCount: number;
      totalDifferences: number;
      teamId: 'A' | 'B';
      differenceId: string | null;
      foundByName: string | null;
    }
  >(functions, 'recordSpotDifferenceFound');
  return (await callable(input)).data;
}

export async function leaveRealtimeGameSession(input: {
  gameType: Exclude<GameJoinCodeType, 'triviaBlitz'>;
  sessionId: string;
}) {
  const callable = httpsCallable<typeof input, { status: 'left' | 'unchanged' }>(
    functions,
    'leaveRealtimeGameSession',
  );
  return (await callable(input)).data;
}

export async function setRealtimeGamePlayerReady(input: {
  sessionId: string;
  ready: boolean;
}) {
  const callable = httpsCallable<typeof input, { ready: boolean }>(
    functions,
    'setRealtimeGamePlayerReady',
  );
  return (await callable(input)).data;
}

export type BombPlayerRole = 'defuser' | 'expert' | 'support';

export type BombPrivateInstruction =
  | { type: 'cut_wire'; color: 'red' | 'blue' | 'yellow' | 'green' }
  | { type: 'press_button'; label: 'A' | 'B' | 'C' | 'D' }
  | { type: 'rotate_dial'; target: number }
  | { type: 'enter_code'; code: number };

export type BombPublicOption = {
  id: string;
  value: string | number;
  number: number;
  marker: string;
};

export type BombPublicCommand = {
  commandId: string;
  commandIndex: number;
  type: BombPrivateInstruction['type'];
  options: BombPublicOption[];
};

export type BombDefusalPlayerView = {
  schemaVersion: number;
  sessionId: string;
  role: BombPlayerRole;
  commandId: string;
  commandIndex: number;
  totalCommands: number;
  publicCommand: BombPublicCommand;
  instruction: BombPrivateInstruction | null;
  defuserUserId: string;
  defuserDisplayName: string;
  expertUserId: string;
  expertDisplayName: string;
  strikeCount: number;
  maxStrikes: number;
  correctCommandCount: number;
  outcome: 'playing' | 'defused' | 'exploded' | 'abandoned';
  lastResult: {
    commandId: string;
    correct: boolean;
    reason: string;
    resolvedAt: number;
  } | null;
  endsAtMs: number;
  serverNowMs: number;
};

export async function getBombDefusalPlayerView(input: { sessionId: string }) {
  const callable = httpsCallable<typeof input, BombDefusalPlayerView>(functions, 'getBombDefusalPlayerView');
  return (await callable(input)).data;
}

export async function submitBombDefusalStep(input: {
  sessionId: string;
  commandId: string;
  action: Record<string, string | number>;
  submissionId: string;
}) {
  const callable = httpsCallable<
    typeof input,
    {
      correct: boolean;
      commandId: string;
      nextCommandIndex: number;
      strikeCount: number;
      outcome: 'playing' | 'defused' | 'exploded';
    }
  >(functions, 'submitBombDefusalStep');
  return (await callable(input)).data;
}

export function readGameJoinCodeFailureReason(error: unknown): GameJoinCodeFailureReason {
  if (isRecord(error)) {
    const details = isRecord(error.details) ? error.details : null;
    if (details && isGameJoinCodeFailureReason(details.reason)) return details.reason;
    const code = typeof error.code === 'string' ? error.code : '';
    if (code.includes('network-request-failed') || code.includes('unavailable')) return 'network_unavailable';
  }
  return 'invalid_or_expired_code';
}

function isGameJoinCodeFailureReason(value: unknown): value is GameJoinCodeFailureReason {
  return [
    'invalid_code_format',
    'invalid_or_expired_code',
    'game_not_found',
    'game_already_started',
    'game_full',
    'minimum_players_required',
    'not_authorized',
    'already_joined',
    'host_cannot_join_as_player',
    'rate_limited',
    'network_unavailable',
    'code_reservation_failed',
    'session_creation_failed',
    'lobby_closed_or_expired',
    'already_participating_elsewhere',
    'lobby_limit_reached',
    'round_in_progress',
    'round_not_in_progress',
    'round_not_finished',
    'finish_active_round_first',
    'host_must_transfer',
    'lobby_leave_in_progress',
    'bomb_not_defuser',
    'bomb_command_stale',
    'client_update_required',
  ].includes(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
