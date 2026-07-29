import { collection, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '@/config/firebase';

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
  | 'session_creation_failed';

export type CreateGameJoinCodeResult = {
  gameType: GameJoinCodeType;
  sessionId: string;
  joinCode: string;
  expiresAt: number;
};

export type ResolveGameJoinCodeResult = {
  gameType: GameJoinCodeType;
  sessionId: string;
  participantState: 'joined' | 'reconnected';
};

export function createGameJoinIdempotencyKey() {
  return doc(collection(db, 'gameJoinRequestIds')).id;
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
    { joinCode: string; status: GameJoinCodeStatus; expiresAt: number }
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
  differenceId: string;
}) {
  const callable = httpsCallable<typeof input, { foundCount: number }>(functions, 'recordSpotDifferenceFound');
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

export async function submitBombDefusalStep(input: {
  sessionId: string;
  stepIndex: number;
  action: Record<string, string | number>;
  submissionId: string;
}) {
  const callable = httpsCallable<
    typeof input,
    {
      correct: boolean;
      nextStepIndex: number;
      outcome: 'playing' | 'defused' | 'exploded';
      nextStep: Record<string, string | number> | null;
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
  ].includes(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
