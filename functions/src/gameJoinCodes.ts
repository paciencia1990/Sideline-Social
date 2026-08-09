import { createHash, randomBytes, randomInt } from 'node:crypto';

import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as firebaseFunctions from 'firebase-functions';

import {
  GameJoinCodeReservationError,
  generateSecureGameJoinCode,
  legacyRealtimeGameType,
  normalizeGameJoinCode,
  readGameJoinCodeType,
  retryGameJoinCodeReservation,
  type GameJoinCodeStatus,
  type GameJoinCodeType,
} from './gameJoinCodeCore';
import {
  MAX_DISCOVERABLE_GAME_LOBBIES,
  addGameLobbyToDirectory,
  createEmptyGameLobbyDirectory,
  nextGameLobbyNumber,
  normalizeGameLobbyDirectory,
  removeGameLobbyFromDirectory,
  resolveGameLobbyJoinAction,
  sortGameLobbies,
  updateGameLobbyInDirectory,
  type GameLobbyCallerState,
  type GameLobbyDirectoryEntry,
  type GameLobbyStatus,
} from './gameLobbyCore';
import {
  activeGameLobbyMemberships,
  gameLobbyCreateRequests,
  gameLobbyCreationRateLimits,
  gameLobbyDirectories,
  gameLobbyDirectoryRef,
  removeGameLobbyDirectoryEntry,
  setGameLobbyLifecycleForSession,
} from './gameLobbyStore';
import { resolveJoinableGameSession } from './gameJoinSessionState';
import { accountCanCommunicate, permanentAccountFunctions } from './permanentAuth';
import { resolveCanonicalPublicName } from './publicUserProfileCore';
import {
  EXPECTED_SPOT_DIFFERENCES,
  SPOT_TEAM_IDS,
  findCanonicalSpotDifference,
  getCanonicalSpotScene,
  isSpotTeamId,
  normalizeSpotTeamId,
  resolveSpotRoundResult,
  teamForSpotJoinIndex,
  teamForSpotJoinOrder,
  type SpotRoundResult,
  type SpotTeamId,
} from './spotDifferenceCore';
import {
  provisionTriviaLobbySession,
  type TriviaLobbyParticipant,
} from './triviaGame';

const functions = permanentAccountFunctions(firebaseFunctions, "communication");
const JOIN_CODE_TTL_MS = 2 * 60 * 60 * 1000;
const JOIN_ATTEMPT_WINDOW_MS = 60 * 1000;
const JOIN_ATTEMPT_LIMIT = 12;
const JOIN_RATE_LIMIT_MS = 5 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 200;
const RESULTS_GRACE_MS = 5 * 60 * 1000;
const TRIVIA_MIN_PLAYERS = 2;
const LOBBY_CREATE_WINDOW_MS = 10 * 60 * 1000;
const LOBBY_CREATE_LIMIT = 4;
const LOBBY_CREATE_BLOCK_MS = 10 * 60 * 1000;
const PROVISIONING_TIMEOUT_MS = 60 * 1000;
const FIRESTORE_CONTENTION_RETRY_LIMIT = 4;

function isRetryableFirestoreContention(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === 10 ||
    candidate.code === 'aborted' ||
    (typeof candidate.message === 'string' && /ABORTED|Transaction lock timeout/i.test(candidate.message));
}

async function withFirestoreContentionRetry<T>(
  operation: string,
  task: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < FIRESTORE_CONTENTION_RETRY_LIMIT; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (!isRetryableFirestoreContention(error) || attempt === FIRESTORE_CONTENTION_RETRY_LIMIT - 1) {
        throw error;
      }
      functions.logger.warn('game_lobby_firestore_contention_retry', {
        operation,
        attempt: attempt + 1,
      });
      const backoffMs = 75 * (2 ** attempt) + randomInt(25, 126);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw new Error('unreachable');
}

const registry = () => admin.firestore().collection('gameJoinCodes');
const sessionLinks = () => admin.firestore().collection('gameJoinSessionLinks');
const requests = () => admin.firestore().collection('gameJoinRequests');
const rateLimits = () => admin.firestore().collection('gameJoinRateLimits');

type JoinResult = {
  gameType: GameJoinCodeType;
  sessionId: string;
  participantState: 'joined' | 'reconnected';
};

type ReservationResult = {
  gameType: GameJoinCodeType;
  sessionId: string;
  joinCode: string;
  expiresAt: number;
};

type LobbyJoinResult = JoinResult & {
  lobbyId: string;
  lobbyNumber: number;
};

type LobbyCreateResult = LobbyJoinResult & {
  joinCode: string;
  expiresAt: number;
};

type PublicLobbySummary = {
  lobbyId: string;
  sessionId: string;
  gameType: GameJoinCodeType;
  lobbyNumber: number;
  isMain: boolean;
  hostDisplayName: string;
  status: Exclude<GameLobbyStatus, 'provisioning' | 'closed' | 'expired'>;
  activePlayerCount: number;
  queuedPlayerCount: number;
  capacity: number;
  callerState: GameLobbyCallerState;
  callerIsHost: boolean;
  joinAction: ReturnType<typeof resolveGameLobbyJoinAction>;
};

type ActiveSquadGameSession = {
  sessionId: string;
  gameType: 'bomb_defusal' | 'spot_difference';
  status: 'lobby' | 'countdown' | 'active';
  callerIsParticipant: boolean;
  endsAtMs: number;
};

type BombStepRecord = Record<string, string | number>;

export type FinalizedSpotDifferenceRound = SpotRoundResult & {
  resolvedAt: number;
  teamByPlayerId: Record<string, SpotTeamId>;
};

export const listGameLobbies = functions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const requestedGameType = data?.gameType == null ? null : requireGameType(data.gameType);
  const squadId = await requireAuthorizedSquadId(uid, data?.squadId);
  const gameTypes = requestedGameType
    ? [requestedGameType]
    : ['bombDefusal', 'spotTheDifferences', 'triviaBlitz'] as GameJoinCodeType[];
  const directories = await Promise.all(
    gameTypes.map((gameType) => listAuthorizedLobbyDirectory(uid, squadId, gameType)),
  );
  const membership = await reconcileActiveLobbyMembership(uid);
  return {
    lobbies: directories.flatMap((directory) => directory.lobbies),
    canCreateLobby: membership == null,
    activeLobbyId: membership?.lobbyId ?? null,
    maxLobbiesPerGame: MAX_DISCOVERABLE_GAME_LOBBIES,
    serverNowMs: Date.now(),
  };
});

export const createGameLobby = functions.https.onCall(async (data, context): Promise<LobbyCreateResult> => {
  const uid = requireUid(context);
  const gameType = requireGameType(data?.gameType);
  const squadId = await requireAuthorizedSquadId(uid, data?.squadId);
  const idempotencyKey = readIdempotencyKey(data?.idempotencyKey);
  await reconcileActiveLobbyMembership(uid);
  await consumeLobbyCreateAttempt(uid);
  const hostDisplayName = await resolvePlayerDisplayName(uid, context.auth?.token);
  return explicitlyCreateGameLobby({
    uid,
    gameType,
    squadId,
    idempotencyKey,
    hostDisplayName,
  });
});

export const joinGameLobbyById = functions.https.onCall(async (data, context): Promise<LobbyJoinResult> => {
  const uid = requireUid(context);
  await consumeJoinAttempt(uid);
  const gameType = requireGameType(data?.gameType);
  const squadId = await requireAuthorizedSquadId(uid, data?.squadId);
  const lobbyId = readLobbyId(data?.lobbyId);
  const displayName = await resolvePlayerDisplayName(uid, context.auth?.token);
  return joinExistingGameLobby({
    uid,
    gameType,
    squadId,
    lobbyId,
    displayName,
    mode: 'currentRound',
  });
});

export const joinGameLobbyNextRound = functions.https.onCall(async (data, context): Promise<LobbyJoinResult> => {
  const uid = requireUid(context);
  await consumeJoinAttempt(uid);
  const gameType = requireGameType(data?.gameType);
  const squadId = await requireAuthorizedSquadId(uid, data?.squadId);
  const lobbyId = readLobbyId(data?.lobbyId);
  const displayName = await resolvePlayerDisplayName(uid, context.auth?.token);
  return joinExistingGameLobby({
    uid,
    gameType,
    squadId,
    lobbyId,
    displayName,
    mode: 'nextRound',
  });
});

export const reconnectGameLobby = functions.https.onCall(async (_data, context): Promise<LobbyJoinResult | null> => {
  const uid = requireUid(context);
  const membership = await reconcileActiveLobbyMembership(uid);
  if (!membership) return null;
  const squadId = await requireAuthorizedSquadId(uid, membership.squadId);
  const displayName = await resolvePlayerDisplayName(uid, context.auth?.token);
  return joinExistingGameLobby({
    uid,
    gameType: membership.gameType,
    squadId,
    lobbyId: membership.lobbyId,
    displayName,
    mode: membership.state === 'queued' ? 'nextRound' : 'currentRound',
  });
});

export const leaveGameLobby = functions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const lobbyId = readLobbyId(data?.lobbyId);
  return leaveCanonicalGameLobby(uid, lobbyId);
});

export const closeGameLobby = functions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const lobbyId = readLobbyId(data?.lobbyId);
  return closeCanonicalGameLobby(uid, lobbyId);
});

export const startGameLobbyRematch = functions.https.onCall(async (data, context): Promise<LobbyCreateResult> => {
  const uid = requireUid(context);
  const lobbyId = readLobbyId(data?.lobbyId);
  return createNextLobbyRound(uid, lobbyId);
});

export const createGameJoinCode = functions.https.onCall(async (data, context): Promise<ReservationResult> => {
  const uid = requireUid(context);
  await consumeJoinAttempt(uid);
  const gameType = requireGameType(data?.gameType);
  const idempotencyKey = readIdempotencyKey(data?.idempotencyKey);
  const requestedSessionId = data?.sessionId == null ? null : readSessionId(data.sessionId);
  if (!requestedSessionId) {
    throw safeError('failed-precondition', 'client_update_required');
  }
  const preallocatedLink = await sessionLinks()
    .doc(hashIdentifier(`${gameType}:${requestedSessionId}`))
    .get();
  if (
    !preallocatedLink.exists ||
    preallocatedLink.data()?.sessionId !== requestedSessionId ||
    preallocatedLink.data()?.gameType !== gameType ||
    preallocatedLink.data()?.hostUserId !== uid ||
    typeof preallocatedLink.data()?.lobbyId !== 'string' ||
    typeof preallocatedLink.data()?.squadId !== 'string'
  ) {
    throw safeError('failed-precondition', 'client_update_required');
  }
  const sourceSquadId = await readAuthorizedSquadId(uid, data?.squadId);
  if (!sourceSquadId || sourceSquadId !== preallocatedLink.data()?.squadId) {
    throw safeError('permission-denied', 'not_authorized');
  }
  const requestId = hashIdentifier(`${uid}:${idempotencyKey}`);
  const existingRequest = await requests().doc(requestId).get();
  const existingRequestData = existingRequest.data();
  if (
    existingRequest.exists &&
    existingRequestData?.hostUserId === uid &&
    existingRequestData?.gameType === gameType &&
    (!requestedSessionId || existingRequestData?.sessionId === requestedSessionId) &&
    typeof existingRequestData?.code === 'string' &&
    typeof existingRequestData?.sessionId === 'string'
  ) {
    const existingMapping = await registry().doc(existingRequestData.code).get();
    if (isRegistryForSession(existingMapping.data(), {
      gameType,
      hostUserId: uid,
      sessionId: existingRequestData.sessionId,
    }, Date.now())) {
      await assertHostOwnsCanonicalSession(
        uid,
        gameType,
        existingRequestData.sessionId,
      );
      return {
        gameType,
        sessionId: existingRequestData.sessionId,
        joinCode: existingRequestData.code,
        expiresAt: readTimestampMillis(existingMapping.data()?.expiresAt),
      };
    }
  }

  let sessionId = requestedSessionId;
  let createdRealtimeSession = false;
  if (!sessionId && gameType !== 'triviaBlitz') {
    sessionId = await createRealtimeSession({ gameType, hostUserId: uid, sourceSquadId });
    createdRealtimeSession = true;
  }
  if (!sessionId) {
    throw safeError('failed-precondition', 'session_creation_failed');
  }

  await assertHostOwnsCanonicalSession(uid, gameType, sessionId);
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + JOIN_CODE_TTL_MS);
  const linkId = hashIdentifier(`${gameType}:${sessionId}`);

  try {
    return await retryGameJoinCodeReservation(async (candidate) => {
      const firestore = admin.firestore();
      return firestore.runTransaction(async (transaction): Promise<ReservationResult | null> => {
        const requestRef = requests().doc(requestId);
        const linkRef = sessionLinks().doc(linkId);
        const candidateRef = registry().doc(candidate);
        const [requestSnapshot, linkSnapshot, candidateSnapshot] = await Promise.all([
          transaction.get(requestRef),
          transaction.get(linkRef),
          transaction.get(candidateRef),
        ]);

        const requestData = requestSnapshot.data();
        if (
          requestSnapshot.exists &&
          requestData?.hostUserId === uid &&
          requestData?.gameType === gameType &&
          requestData?.sessionId === sessionId &&
          typeof requestData?.code === 'string'
        ) {
          const existingRegistry = await transaction.get(registry().doc(requestData.code));
          if (isRegistryForSession(existingRegistry.data(), {
            gameType,
            hostUserId: uid,
            sessionId,
          }, now.toMillis())) {
            return {
              gameType,
              sessionId,
              joinCode: requestData.code,
              expiresAt: readTimestampMillis(existingRegistry.data()?.expiresAt),
            };
          }
        }

        const linkData = linkSnapshot.data();
        if (
          linkSnapshot.exists &&
          linkData?.hostUserId === uid &&
          linkData?.gameType === gameType &&
          linkData?.sessionId === sessionId &&
          typeof linkData?.code === 'string'
        ) {
          const existingRegistry = await transaction.get(registry().doc(linkData.code));
          if (isRegistryForSession(existingRegistry.data(), {
            gameType,
            hostUserId: uid,
            sessionId,
          }, now.toMillis())) {
            transaction.set(requestRef, {
              code: linkData.code,
              gameType,
              hostUserId: uid,
              sessionId,
              createdAt: now,
              expiresAt: existingRegistry.data()?.expiresAt ?? expiresAt,
            });
            return {
              gameType,
              sessionId,
              joinCode: linkData.code,
              expiresAt: readTimestampMillis(existingRegistry.data()?.expiresAt),
            };
          }
        }

        if (candidateSnapshot.exists && readTimestampMillis(candidateSnapshot.data()?.expiresAt) > now.toMillis()) {
          return null;
        }

        const registryPayload = {
          code: candidate,
          gameType,
          sessionId,
          hostUserId: uid,
          status: 'lobby' as const,
          createdAt: now,
          updatedAt: now,
          expiresAt,
        };
        transaction.set(candidateRef, registryPayload);
        transaction.set(linkRef, registryPayload);
        transaction.set(requestRef, registryPayload);
        return { gameType, sessionId, joinCode: candidate, expiresAt: expiresAt.toMillis() };
      });
    });
  } catch (error) {
    if (createdRealtimeSession) {
      await admin.database().ref().update({
        [`gameSessions/${sessionId}`]: null,
        [`gameSessionSecrets/${sessionId}`]: null,
      }).catch(() => undefined);
    }
    if (error instanceof GameJoinCodeReservationError) {
      throw safeError('resource-exhausted', 'code_reservation_failed');
    }
    throw error;
  }
});

export const resolveAndJoinGameByCode = functions.https.onCall(async (data, context): Promise<LobbyJoinResult> => {
  const uid = requireUid(context);
  await consumeJoinAttempt(uid);
  const code = normalizeGameJoinCode(data?.code);
  if (!code) throw safeError('invalid-argument', 'invalid_code_format');

  const mappingSnapshot = await registry().doc(code).get();
  const mapping = mappingSnapshot.data();
  const now = Date.now();
  if (!mappingSnapshot.exists || !isResolvableRegistry(mapping, now)) {
    throw safeError('not-found', 'invalid_or_expired_code');
  }

  const gameType = readGameJoinCodeType(mapping?.gameType);
  const sessionId = readStoredSessionId(mapping?.sessionId);
  const lobbyId = readStoredSessionId(mapping?.lobbyId);
  const squadId = readStoredSessionId(mapping?.squadId);
  if (!gameType || !sessionId || !lobbyId || !squadId) {
    throw safeError('not-found', 'invalid_or_expired_code');
  }
  await requireAuthorizedSquadId(uid, squadId);
  const displayName = await resolvePlayerDisplayName(uid, context.auth?.token);

  try {
    return await joinExistingGameLobby({
      uid,
      gameType,
      squadId,
      lobbyId,
      displayName,
      mode: 'auto',
    });
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    throw safeError('not-found', 'invalid_or_expired_code');
  }
});

export const getGameJoinCodeForSession = functions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const gameType = requireGameType(data?.gameType);
  const sessionId = readSessionId(data?.sessionId);
  await assertParticipant(uid, gameType, sessionId);
  const linkSnapshot = await sessionLinks().doc(hashIdentifier(`${gameType}:${sessionId}`)).get();
  const code = normalizeGameJoinCode(linkSnapshot.data()?.code);
  if (!code) throw safeError('not-found', 'invalid_or_expired_code');
  const mappingSnapshot = await registry().doc(code).get();
  if (!isRegistryForSession(mappingSnapshot.data(), { gameType, sessionId }, Date.now())) {
    throw safeError('not-found', 'invalid_or_expired_code');
  }
  const lobbyId = readStoredSessionId(mappingSnapshot.data()?.lobbyId);
  const lobbyNumber = mappingSnapshot.data()?.lobbyNumber;
  if (!lobbyId || !Number.isInteger(lobbyNumber) || Number(lobbyNumber) <= 0) {
    throw safeError('failed-precondition', 'client_update_required');
  }
  return {
    joinCode: code,
    lobbyId,
    lobbyNumber: Number(lobbyNumber),
    status: mappingSnapshot.data()?.status as GameJoinCodeStatus,
    expiresAt: readTimestampMillis(mappingSnapshot.data()?.expiresAt),
  };
});

export const getActiveSquadGameSession = functions.https.onCall(async (data, context): Promise<{
  session: ActiveSquadGameSession | null;
  serverNowMs: number;
}> => {
  const uid = requireUid(context);
  const serverNowMs = Date.now();
  const requestedSquadId = typeof data?.squadId === 'string' ? data.squadId.trim() : '';
  const squadId = await readAuthorizedSquadId(uid, requestedSquadId);
  if (!squadId) throw safeError('permission-denied', 'not_authorized');

  const snapshot = await admin.database()
    .ref('/gameSessions')
    .orderByChild('squadId')
    .equalTo(squadId)
    .once('value');
  const rawSessions = snapshot.val();
  if (!rawSessions || typeof rawSessions !== 'object' || Array.isArray(rawSessions)) {
    return { session: null, serverNowMs };
  }

  const candidates = Object.entries(rawSessions as Record<string, unknown>)
    .flatMap(([documentId, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const session = value as Record<string, unknown>;
      const gameTypeValue = session.gameType;
      const statusValue = session.status;
      if (gameTypeValue !== 'bomb_defusal' && gameTypeValue !== 'spot_difference') return [];
      if (statusValue !== 'lobby' && statusValue !== 'countdown' && statusValue !== 'active') return [];
      const gameType: ActiveSquadGameSession['gameType'] = gameTypeValue;
      const status: ActiveSquadGameSession['status'] = statusValue;
      const sessionId = typeof session.sessionId === 'string' && session.sessionId.trim()
        ? session.sessionId.trim()
        : documentId;
      const createdAt = typeof session.createdAt === 'number' && Number.isFinite(session.createdAt)
        ? session.createdAt
        : 0;
      const candidate = {
        sessionId,
        gameType,
        status,
        createdAt,
        raw: session,
      };
      return [candidate];
    })
    .sort((left, right) => right.createdAt - left.createdAt);

  for (const candidate of candidates) {
    if (Array.isArray(readRecord(candidate.raw.gameState).bombSteps)) continue;
    const joinCodeType = candidate.gameType === 'bomb_defusal' ? 'bombDefusal' : 'spotTheDifferences';
    const linkSnapshot = await sessionLinks().doc(hashIdentifier(`${joinCodeType}:${candidate.sessionId}`)).get();
    const link = linkSnapshot.data();
    const code = normalizeGameJoinCode(link?.code);
    if (
      !linkSnapshot.exists ||
      link?.sessionId !== candidate.sessionId ||
      link?.gameType !== joinCodeType ||
      !code
    ) {
      continue;
    }

    const players = readRecord(candidate.raw.players);
    const callerIsParticipant = Boolean(players[uid]);
    const durationSeconds = readRealtimeDurationSeconds(candidate.gameType, candidate.raw.settings);
    const hardExpiresAtMs = earliestPositiveNumber(
      readPositiveNumber(candidate.raw.expiresAt),
      readTimestampMillis(link?.expiresAt),
    );
    if (hardExpiresAtMs != null && hardExpiresAtMs <= serverNowMs) {
      await expireRealtimeGameSession(joinCodeType, candidate.sessionId, serverNowMs);
      continue;
    }
    const result = resolveJoinableGameSession({
      status: candidate.status,
      startedAtMs: readPositiveNumber(candidate.raw.startedAt),
      endsAtMs: candidate.status === 'active'
        ? readPositiveNumber(candidate.raw.endsAt)
        : earliestPositiveNumber(readPositiveNumber(candidate.raw.endsAt), hardExpiresAtMs),
      durationSeconds,
      joinCodeStatus: typeof link?.status === 'string' ? link.status : null,
      participantCount: Object.keys(players).length,
      capacity: readPositiveNumber(candidate.raw.maxPlayers),
      callerIsParticipant,
      nowMs: serverNowMs,
    });

    if (result.isExpired) {
      await expireRealtimeGameSession(joinCodeType, candidate.sessionId, serverNowMs);
      continue;
    }
    if (!result.isJoinable || result.endsAtMs == null) continue;
    return {
      session: {
        sessionId: candidate.sessionId,
        gameType: candidate.gameType,
        status: candidate.status,
        callerIsParticipant,
        endsAtMs: result.endsAtMs,
      },
      serverNowMs,
    };
  }
  return { session: null, serverNowMs };
});

export const updateGameJoinCodeStatus = functions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const gameType = requireGameType(data?.gameType);
  const sessionId = readSessionId(data?.sessionId);
  const status = readLifecycleStatus(data?.status);
  await assertHostOwnsCanonicalSession(uid, gameType, sessionId, true);
  if (status === 'started') {
    await assertCanonicalSessionCanStart(gameType, sessionId);
    if (gameType === 'triviaBlitz') {
      await assertPlayersReadyForStart(gameType, sessionId);
    }
  }
  let realtimeStart: { startedNow: boolean; startedAtMs: number } | null = null;
  if (gameType !== 'triviaBlitz' && status === 'started') {
    realtimeStart = await startRealtimeGameSession(sessionId);
  }
  try {
    await setJoinCodeStatus(gameType, sessionId, uid, status);
  } catch (error) {
    if (
      gameType !== 'triviaBlitz' &&
      status === 'started' &&
      realtimeStart?.startedNow
    ) {
      const mappingStarted = await isGameJoinCodeStatusStarted(gameType, sessionId);
      if (mappingStarted) {
        return { status };
      }
      await rollbackRealtimeGameSessionStart(sessionId, realtimeStart.startedAtMs);
    }
    throw error;
  }
  if (gameType !== 'triviaBlitz') {
    if (status !== 'started') {
      const serverNowMs = Date.now();
      await admin.database().ref(`/gameSessions/${sessionId}`).update({
        status: status === 'ended' ? 'completed' : 'failed',
        completedAt: serverNowMs,
        updatedAt: serverNowMs,
      });
    }
  }
  await setGameLobbyLifecycleForSession(
    gameType,
    sessionId,
    status === 'started' ? 'inProgress' : status === 'ended' ? 'waitingForRematch' : 'closed',
  );
  return { status };
});

export const releaseGameJoinCode = functions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const gameType = requireGameType(data?.gameType);
  const sessionId = readSessionId(data?.sessionId);
  await assertHostOwnsCanonicalSession(uid, gameType, sessionId, true);
  await setJoinCodeStatus(gameType, sessionId, uid, 'canceled');
  if (gameType === 'triviaBlitz') {
    const parentRef = admin.firestore().collection('sessions').doc(sessionId);
    await admin.firestore().runTransaction(async (transaction) => {
      const parent = await transaction.get(parentRef);
      const now = Timestamp.now();
      const currentExpiry = readTimestampMillis(parent.data()?.expiresAt);
      transaction.set(parentRef, {
        status: 'results',
        completedAt: now,
        expiresAt: Timestamp.fromMillis(Math.min(
          currentExpiry || now.toMillis() + RESULTS_GRACE_MS,
          now.toMillis() + RESULTS_GRACE_MS,
        )),
        updatedAt: now,
      }, { merge: true });
      transaction.set(
        parentRef.collection('games').doc('triviaBlitz'),
        { status: 'results', updatedAt: now },
        { merge: true },
      );
    });
  } else {
    await admin.database().ref(`/gameSessions/${sessionId}`).update({ status: 'failed', completedAt: Date.now() });
  }
  return { status: 'canceled' as const };
});

export const setRealtimeGamePlayerReady = functions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const sessionId = readSessionId(data?.sessionId);
  if (typeof data?.ready !== 'boolean') {
    throw safeError('invalid-argument', 'not_authorized');
  }
  const ready = data.ready;
  let reason: string | null = null;
  const reference = admin.database().ref(`/gameSessions/${sessionId}`);
  const initialSnapshot = await reference.once('value');
  if (!initialSnapshot.exists()) throw safeError('not-found', 'game_not_found');
  const initialSession = initialSnapshot.val();
  if (
    typeof initialSession?.expiresAt !== 'number' ||
    initialSession.expiresAt <= Date.now() ||
    Array.isArray(initialSession?.gameState?.bombSteps)
  ) {
    throw safeError('failed-precondition', 'invalid_or_expired_code');
  }
  let mayUseInitialCacheFallback = true;
  const result = await reference.transaction((cachedSession) => {
    const session = cachedSession ?? (mayUseInitialCacheFallback ? initialSession : null);
    mayUseInitialCacheFallback = false;
    if (!session || typeof session !== 'object') {
      reason = 'game_not_found';
      return;
    }
    if (
      (session.gameType !== 'bomb_defusal' && session.gameType !== 'spot_difference') ||
      session.status !== 'lobby' ||
      typeof session.expiresAt !== 'number' ||
      session.expiresAt <= Date.now() ||
      Array.isArray(session.gameState?.bombSteps) ||
      !session.players?.[uid]
    ) {
      reason = session.status === 'lobby' ? 'not_authorized' : 'game_already_started';
      return;
    }
    return {
      ...session,
      players: {
        ...session.players,
        [uid]: {
          ...session.players[uid],
          isReady: ready,
        },
      },
      updatedAt: Date.now(),
    };
  });
  if (!result.committed) {
    throw safeError(
      reason === 'game_not_found' ? 'not-found' : 'failed-precondition',
      reason ?? 'not_authorized',
    );
  }
  return { ready };
});

export const leaveRealtimeGameSession = functions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const gameType = requireGameType(data?.gameType);
  if (gameType === 'triviaBlitz') {
    throw safeError('invalid-argument', 'not_authorized');
  }
  const sessionId = readSessionId(data?.sessionId);
  let reason: string | null = null;
  let changed = false;
  const reference = admin.database().ref(`/gameSessions/${sessionId}`);
  const initialSnapshot = await reference.once('value');
  if (!initialSnapshot.exists()) throw safeError('not-found', 'game_not_found');
  const initialSession = initialSnapshot.val();
  let mayUseInitialCacheFallback = true;
  const result = await reference.transaction((cachedSession) => {
    const session = cachedSession ?? (mayUseInitialCacheFallback ? initialSession : null);
    mayUseInitialCacheFallback = false;
    if (!session || session.gameType !== legacyRealtimeGameType(gameType)) {
      reason = 'game_not_found';
      return;
    }
    if (
      session.status !== 'lobby' ||
      typeof session.expiresAt !== 'number' ||
      session.expiresAt <= Date.now() ||
      !session.players?.[uid]
    ) {
      reason = session.players?.[uid] ? 'game_already_started' : 'not_authorized';
      return;
    }
    if (session.hostUserId === uid) {
      reason = 'not_authorized';
      return;
    }

    const players = readRecord(session.players);
    delete players[uid];
    changed = true;
    if (gameType !== 'spotTheDifferences') {
      return { ...session, players, updatedAt: Date.now() };
    }

    const rebalanced = rebalanceSpotLobbyPlayers(players, Date.now());
    return {
      ...session,
      players: rebalanced.players,
      gameState: {
        ...session.gameState,
        teamAssignmentVersion: rebalanced.assignmentVersion,
      },
      updatedAt: Date.now(),
    };
  });
  if (!result.committed) {
    throw safeError(
      reason === 'game_not_found' ? 'not-found' : 'failed-precondition',
      reason ?? 'not_authorized',
    );
  }
  return { status: changed ? 'left' as const : 'unchanged' as const };
});

export const recordSpotDifferenceFound = functions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const sessionId = readSessionId(data?.sessionId);
  const tap = readSpotTapPoint(data);
  let reason: string | null = null;
  let alreadyFound = false;
  let found = false;
  let foundCount = 0;
  let matchedDifferenceId = '';
  let teamId: SpotTeamId | null = null;
  let foundByName = '';
  const reference = admin.database().ref(`/gameSessions/${sessionId}`);
  const initialSnapshot = await reference.once('value');
  if (!initialSnapshot.exists()) throw safeError('not-found', 'game_not_found');
  const initialSession = initialSnapshot.val() as Record<string, unknown>;
  const linkSnapshot = await sessionLinks()
    .doc(hashIdentifier(`spotTheDifferences:${sessionId}`))
    .get();
  const joinCodeStatus = linkSnapshot.data()?.status;
  const initialState = resolveRealtimeJoinState(initialSession, joinCodeStatus, uid, Date.now());
  if (!initialState.isJoinable) {
    if (initialState.isExpired) {
      await expireRealtimeGameSession('spotTheDifferences', sessionId, Date.now());
    }
    throw safeError('failed-precondition', 'game_already_started');
  }
  const players = readRecord(initialSession.players);
  const player = readRecord(players[uid]);
  teamId = normalizeSpotTeamId(player.teamId);
  foundByName = typeof player.displayName === 'string' && player.displayName.trim()
    ? player.displayName.trim()
    : await resolvePlayerDisplayName(uid, context.auth?.token);
  const gameState = readRecord(initialSession.gameState);
  const sceneId = typeof gameState.sceneId === 'string' ? gameState.sceneId : '';
  const scene = getCanonicalSpotScene(sceneId);
  const match = findCanonicalSpotDifference(sceneId, tap);
  if (
    !teamId ||
    !scene ||
    scene.differences.length !== EXPECTED_SPOT_DIFFERENCES ||
    gameState.teamAssignmentsFrozen !== true ||
    initialSession.status !== 'active'
  ) {
    throw safeError('failed-precondition', 'game_already_started');
  }
  if (!match) {
    const teamSnapshot = await admin.database().ref(`/gameSessionTeamState/${sessionId}/${teamId}`).once('value');
    foundCount = readSpotFoundIds(teamSnapshot.val()).length;
    return {
      found: false,
      alreadyFound: false,
      foundCount,
      totalDifferences: EXPECTED_SPOT_DIFFERENCES,
      teamId,
      differenceId: null,
      foundByName: null,
    };
  }

  matchedDifferenceId = match.id;
  const teamReference = admin.database().ref(`/gameSessionTeamState/${sessionId}/${teamId}`);
  const result = await teamReference.transaction((stateValue) => {
    const state = readRecord(stateValue);
    if (readPositiveNumber(state.expiresAt) != null && Number(state.expiresAt) <= Date.now()) {
      reason = 'game_already_started';
      return;
    }
    const current = readSpotFoundIds(state);
    if (current.includes(matchedDifferenceId)) {
      alreadyFound = true;
      foundCount = current.length;
      return stateValue ?? createEmptySpotTeamState(teamId, readPositiveNumber(initialSession.expiresAt) ?? Date.now());
    }
    const next = [...current, matchedDifferenceId].slice(0, EXPECTED_SPOT_DIFFERENCES);
    const serverNowMs = Date.now();
    found = true;
    foundCount = next.length;
    return {
      ...state,
      teamId,
      expiresAt: readPositiveNumber(state.expiresAt) ?? readPositiveNumber(initialSession.expiresAt) ?? serverNowMs + RESULTS_GRACE_MS,
      foundDifferenceIds: next,
      foundCount,
      completionAt: next.length >= EXPECTED_SPOT_DIFFERENCES
        ? readPositiveNumber(state.completionAt) ?? serverNowMs
        : readPositiveNumber(state.completionAt) ?? null,
      latestDiscovery: {
        differenceId: matchedDifferenceId,
        playerName: foundByName,
        foundAt: serverNowMs,
      },
      discoveredBy: {
        ...readRecord(state.discoveredBy),
        [matchedDifferenceId]: {
          playerId: uid,
          playerName: foundByName,
          foundAt: serverNowMs,
        },
      },
      updatedAt: serverNowMs,
    };
  });
  if (!result.committed) {
    throw safeError('permission-denied', reason ?? 'not_authorized');
  }
  if (found && foundCount >= EXPECTED_SPOT_DIFFERENCES) {
    await finalizeSpotDifferenceRoundForRewards(sessionId, uid).catch((error) => {
      firebaseFunctions.logger.warn('spot_difference_completion_finalize_failed', {
        sessionId,
        errorCode: readErrorCode(error),
      });
    });
  }
  return {
    found,
    alreadyFound,
    foundCount,
    totalDifferences: EXPECTED_SPOT_DIFFERENCES,
    teamId,
    differenceId: matchedDifferenceId || null,
    foundByName: found ? foundByName : null,
  };
});

export const submitBombDefusalStep = functions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const sessionId = readSessionId(data?.sessionId);
  const stepIndex = Number.isInteger(data?.stepIndex) ? data.stepIndex as number : -1;
  const submissionId =
    typeof data?.submissionId === 'string' ? data.submissionId.trim() : '';
  if (stepIndex < 0 || stepIndex > 4 || !/^[A-Za-z0-9_-]{10,200}$/.test(submissionId)) {
    throw safeError('invalid-argument', 'not_authorized');
  }
  const action = readBombAction(data?.action);
  const actionHash = hashIdentifier(JSON.stringify(action));
  const submissionKey = hashIdentifier(`${uid}:${submissionId}`);
  const reference = admin.database().ref(`/gameSessions/${sessionId}`);
  const secretReference = admin.database().ref(`/gameSessionSecrets/${sessionId}`);
  const [initialSnapshot, secretSnapshot] = await Promise.all([
    reference.once('value'),
    secretReference.once('value'),
  ]);
  if (!initialSnapshot.exists()) throw safeError('not-found', 'game_not_found');
  const initialSession = initialSnapshot.val() as Record<string, unknown>;
  const secret = readRecord(secretSnapshot.val());
  const bombSteps = Array.isArray(secret.bombSteps)
    ? secret.bombSteps
    : [];
  if (bombSteps.length !== 5 || bombSteps.some((step) => !isSafeBombStep(step))) {
    throw safeError('failed-precondition', 'game_not_found');
  }

  const linkSnapshot = await sessionLinks()
    .doc(hashIdentifier(`bombDefusal:${sessionId}`))
    .get();
  const joinCodeStatus = linkSnapshot.data()?.status;
  const initialState = resolveRealtimeJoinState(initialSession, joinCodeStatus, uid, Date.now());
  if (!initialState.isJoinable || initialSession.status !== 'active') {
    if (initialState.isExpired) {
      await expireRealtimeGameSession('bombDefusal', sessionId, Date.now());
    }
    throw safeError('failed-precondition', 'game_already_started');
  }
  const existingResult = readBombSubmissionResult(
    initialSession,
    submissionKey,
    uid,
    stepIndex,
    actionHash,
  );
  if (existingResult) return existingResult;

  let resultPayload: {
    correct: boolean;
    nextStepIndex: number;
    outcome: 'playing' | 'defused' | 'exploded';
    nextStep: BombStepRecord | null;
  } | null = null;
  let reason: string | null = null;
  let mayUseInitialCacheFallback = true;
  let expiredDuringSubmission = false;
  const transactionResult = await reference.transaction((cachedSession) => {
    const session = cachedSession ?? (mayUseInitialCacheFallback ? initialSession : null);
    mayUseInitialCacheFallback = false;
    if (!session || session.gameType !== 'bomb_defusal' || !session.players?.[uid]) {
      reason = 'not_authorized';
      return;
    }
    const repeated = readBombSubmissionResult(
      session,
      submissionKey,
      uid,
      stepIndex,
      actionHash,
    );
    if (repeated) {
      resultPayload = repeated;
      return session;
    }
    if (
      session.status !== 'active' ||
      typeof session.expiresAt !== 'number' ||
      session.expiresAt <= Date.now()
    ) {
      expiredDuringSubmission =
        typeof session.expiresAt !== 'number' || session.expiresAt <= Date.now();
      reason = 'game_already_started';
      return;
    }
    const currentStepIndex = Number.isInteger(session.gameState?.currentStepIndex)
      ? session.gameState.currentStepIndex
      : 0;
    if (stepIndex !== currentStepIndex || !bombSteps[stepIndex]) {
      reason = 'not_authorized';
      return;
    }

    const correct = bombActionMatches(bombSteps[stepIndex], action);
    const isComplete = correct && stepIndex + 1 >= bombSteps.length;
    const nextStepIndex = correct ? Math.min(stepIndex + 1, bombSteps.length) : stepIndex;
    const outcome = correct ? (isComplete ? 'defused' : 'playing') : 'exploded';
    const nextStep = outcome === 'playing' ? bombSteps[nextStepIndex] as BombStepRecord : null;
    resultPayload = { correct, nextStepIndex, outcome, nextStep };
    const now = Date.now();
    const safeGameState = Object.fromEntries(
      Object.entries(readRecord(session.gameState)).filter(([key]) => key !== 'bombSteps'),
    );
    const processedSubmissions = {
      ...readRecord(safeGameState.processedSubmissions),
      [submissionKey]: {
        playerId: uid,
        stepIndex,
        actionHash,
        result: resultPayload,
        createdAt: now,
      },
    };
    return {
      ...session,
      status: outcome === 'playing' ? session.status : 'completed',
      completedAt: outcome === 'playing' ? session.completedAt ?? null : now,
      gameState: {
        ...safeGameState,
        currentStepIndex: nextStepIndex,
        currentStep: nextStep,
        outcome: outcome === 'playing' ? null : outcome,
        processedSubmissions,
      },
      updatedAt: now,
    };
  });
  const completedPayload = resultPayload as {
    correct: boolean;
    nextStepIndex: number;
    outcome: 'playing' | 'defused' | 'exploded';
    nextStep: BombStepRecord | null;
  } | null;
  if (!transactionResult.committed || !completedPayload) {
    if (expiredDuringSubmission) {
      await expireRealtimeGameSession('bombDefusal', sessionId, Date.now());
    }
    throw safeError(
      reason === 'game_already_started' ? 'failed-precondition' : 'permission-denied',
      reason ?? 'not_authorized',
    );
  }
  if (completedPayload.outcome !== 'playing') {
    await markGameJoinCodeEndedFromServer('bombDefusal', sessionId);
  }
  return completedPayload;
});

type StoredLobbyMembership = {
  lobbyId: string;
  sessionId: string;
  squadId: string;
  gameType: GameJoinCodeType;
  state: 'joining' | 'active' | 'queued';
  expiresAtMs: number;
};

type LobbyAllocation = LobbyCreateResult & {
  requestId: string;
  hostDisplayName: string;
  squadId: string;
};

async function explicitlyCreateGameLobby(input: {
  uid: string;
  gameType: GameJoinCodeType;
  squadId: string;
  idempotencyKey: string;
  hostDisplayName: string;
}): Promise<LobbyCreateResult> {
  const allocation = await allocateGameLobby(input);
  try {
    await provisionCanonicalLobbyRound({
      gameType: allocation.gameType,
      sessionId: allocation.sessionId,
      lobbyId: allocation.lobbyId,
      lobbyNumber: allocation.lobbyNumber,
      squadId: allocation.squadId,
      hostUserId: input.uid,
      participants: [{ uid: input.uid, displayName: input.hostDisplayName, joinOrder: 1 }],
      expiresAtMs: allocation.expiresAt,
    });
    await completeGameLobbyProvisioning(allocation, input.uid);
    return {
      gameType: allocation.gameType,
      sessionId: allocation.sessionId,
      lobbyId: allocation.lobbyId,
      lobbyNumber: allocation.lobbyNumber,
      participantState: 'joined',
      joinCode: allocation.joinCode,
      expiresAt: allocation.expiresAt,
    };
  } catch (error) {
    await rollbackGameLobbyAllocation(allocation, input.uid).catch(() => undefined);
    if (error instanceof functions.https.HttpsError) throw error;
    throw safeError('internal', 'session_creation_failed');
  }
}

async function allocateGameLobby(input: {
  uid: string;
  gameType: GameJoinCodeType;
  squadId: string;
  idempotencyKey: string;
  hostDisplayName: string;
}): Promise<LobbyAllocation> {
  const requestId = hashIdentifier(`${input.uid}:${input.idempotencyKey}`);
  const requestedLobbyId = `lobby_${randomBytes(18).toString('base64url')}`;
  const requestedSessionId = `${input.gameType === 'triviaBlitz' ? 'trivia' : 'game'}_${randomBytes(18).toString('base64url')}`;
  const nowMs = Date.now();
  const expiresAtMs = nowMs + JOIN_CODE_TTL_MS;
  try {
    return await retryGameJoinCodeReservation(async (candidate) => {
      const requestRef = gameLobbyCreateRequests().doc(requestId);
      const directoryRef = gameLobbyDirectoryRef(input.squadId, input.gameType);
      const membershipRef = activeGameLobbyMemberships().doc(input.uid);
      const candidateRef = registry().doc(candidate);
      const requestedLinkRef = sessionLinks().doc(hashIdentifier(`${input.gameType}:${requestedSessionId}`));
      return admin.firestore().runTransaction(async (transaction): Promise<LobbyAllocation | null> => {
        const [request, directorySnapshot, membership, candidateSnapshot] = await Promise.all([
          transaction.get(requestRef),
          transaction.get(directoryRef),
          transaction.get(membershipRef),
          transaction.get(candidateRef),
        ]);
        const existing = readLobbyAllocation(request.data(), requestId, input.hostDisplayName);
        if (
          request.exists &&
          existing &&
          request.data()?.hostUserId === input.uid &&
          existing.gameType === input.gameType &&
          existing.squadId === input.squadId &&
          existing.expiresAt > Date.now()
        ) return existing;

        const directory = normalizeGameLobbyDirectory(
          directorySnapshot.data(),
          input.squadId,
          input.gameType,
          Date.now(),
        );
        if (Object.keys(directory.lobbies).length >= MAX_DISCOVERABLE_GAME_LOBBIES) {
          throw safeError('resource-exhausted', 'lobby_limit_reached');
        }
        const storedMembership = readStoredLobbyMembership(membership.data());
        if (membership.exists && storedMembership && storedMembership.expiresAtMs > Date.now()) {
          throw safeError('failed-precondition', 'already_participating_elsewhere');
        }
        if (candidateSnapshot.exists && readTimestampMillis(candidateSnapshot.data()?.expiresAt) > Date.now()) {
          return null;
        }

        const timestamp = Timestamp.fromMillis(nowMs);
        const expiresAt = Timestamp.fromMillis(expiresAtMs);
        const lobbyNumber = nextGameLobbyNumber(directory);
        const capacity = capacityForGameType(input.gameType);
        const entry: GameLobbyDirectoryEntry = {
          lobbyId: requestedLobbyId,
          sessionId: requestedSessionId,
          gameType: input.gameType,
          squadId: input.squadId,
          lobbyNumber,
          hostUserId: input.uid,
          hostDisplayName: input.hostDisplayName,
          status: 'provisioning',
          activePlayerCount: 1,
          queuedPlayerCount: 0,
          capacity,
          createdAtMs: nowMs,
          updatedAtMs: nowMs,
          expiresAtMs,
        };
        const nextDirectory = addGameLobbyToDirectory(directory, entry);
        const sharedPayload = {
          code: candidate,
          gameType: input.gameType,
          sessionId: requestedSessionId,
          lobbyId: requestedLobbyId,
          lobbyNumber,
          squadId: input.squadId,
          hostUserId: input.uid,
          status: 'lobby' as const,
          createdAt: timestamp,
          updatedAt: timestamp,
          expiresAt,
        };
        transaction.set(candidateRef, sharedPayload);
        transaction.set(requestedLinkRef, sharedPayload);
        transaction.set(requestRef, {
          ...sharedPayload,
          requestId,
          provisioningState: 'provisioning',
        });
        transaction.set(membershipRef, {
          lobbyId: requestedLobbyId,
          sessionId: requestedSessionId,
          squadId: input.squadId,
          gameType: input.gameType,
          state: 'active',
          createdAt: timestamp,
          updatedAt: timestamp,
          expiresAt,
        });
        transaction.set(directoryRef, {
          ...nextDirectory,
          createdAt: directorySnapshot.data()?.createdAt ?? timestamp,
          updatedAt: timestamp,
        });
        return {
          gameType: input.gameType,
          sessionId: requestedSessionId,
          lobbyId: requestedLobbyId,
          lobbyNumber,
          participantState: 'joined',
          joinCode: candidate,
          expiresAt: expiresAtMs,
          requestId,
          hostDisplayName: input.hostDisplayName,
          squadId: input.squadId,
        };
      });
    });
  } catch (error) {
    if (error instanceof GameJoinCodeReservationError) {
      throw safeError('resource-exhausted', 'code_reservation_failed');
    }
    throw error;
  }
}

async function provisionCanonicalLobbyRound(input: {
  gameType: GameJoinCodeType;
  sessionId: string;
  lobbyId: string;
  lobbyNumber: number;
  squadId: string;
  hostUserId: string;
  participants: TriviaLobbyParticipant[];
  expiresAtMs: number;
}) {
  if (input.gameType === 'triviaBlitz') {
    return provisionTriviaLobbySession(input);
  }
  return createRealtimeSession({
    gameType: input.gameType,
    sessionId: input.sessionId,
    lobbyId: input.lobbyId,
    lobbyNumber: input.lobbyNumber,
    hostUserId: input.hostUserId,
    sourceSquadId: input.squadId,
    participants: input.participants,
    expiresAtMs: input.expiresAtMs,
  });
}

async function completeGameLobbyProvisioning(
  allocation: LobbyAllocation,
  uid: string,
) {
  const directoryRef = gameLobbyDirectoryRef(allocation.squadId, allocation.gameType);
  const requestRef = gameLobbyCreateRequests().doc(allocation.requestId);
  await admin.firestore().runTransaction(async (transaction) => {
    const [directorySnapshot, request] = await Promise.all([
      transaction.get(directoryRef),
      transaction.get(requestRef),
    ]);
    const nowMs = Date.now();
    const directory = normalizeGameLobbyDirectory(
      directorySnapshot.data(),
      allocation.squadId,
      allocation.gameType,
      nowMs,
    );
    const entry = directory.lobbies[allocation.lobbyId];
    if (
      !entry ||
      entry.sessionId !== allocation.sessionId ||
      request.data()?.hostUserId !== uid ||
      request.data()?.lobbyId !== allocation.lobbyId
    ) throw safeError('failed-precondition', 'session_creation_failed');
    const next = updateGameLobbyInDirectory(directory, {
      ...entry,
      status: 'waiting',
      updatedAtMs: nowMs,
    });
    const timestamp = Timestamp.fromMillis(nowMs);
    transaction.set(directoryRef, { ...next, updatedAt: timestamp });
    transaction.update(requestRef, { provisioningState: 'ready', updatedAt: timestamp });
  });
}

async function rollbackGameLobbyAllocation(allocation: LobbyAllocation, uid: string) {
  const directoryRef = gameLobbyDirectoryRef(allocation.squadId, allocation.gameType);
  const requestRef = gameLobbyCreateRequests().doc(allocation.requestId);
  const membershipRef = activeGameLobbyMemberships().doc(uid);
  const mappingRef = registry().doc(allocation.joinCode);
  const linkRef = sessionLinks().doc(hashIdentifier(`${allocation.gameType}:${allocation.sessionId}`));
  await admin.firestore().runTransaction(async (transaction) => {
    const [directorySnapshot, request, membership, mapping, link] = await Promise.all([
      transaction.get(directoryRef),
      transaction.get(requestRef),
      transaction.get(membershipRef),
      transaction.get(mappingRef),
      transaction.get(linkRef),
    ]);
    if (request.data()?.hostUserId !== uid || request.data()?.lobbyId !== allocation.lobbyId) return;
    const directory = normalizeGameLobbyDirectory(
      directorySnapshot.data(),
      allocation.squadId,
      allocation.gameType,
      Date.now(),
    );
    const entry = directory.lobbies[allocation.lobbyId];
    if (entry?.sessionId === allocation.sessionId && entry.status === 'provisioning') {
      transaction.set(directoryRef, {
        ...removeGameLobbyFromDirectory(directory, allocation.lobbyId),
        updatedAt: Timestamp.now(),
      });
    }
    if (membership.data()?.lobbyId === allocation.lobbyId) transaction.delete(membershipRef);
    if (mapping.data()?.lobbyId === allocation.lobbyId) transaction.delete(mappingRef);
    if (link.data()?.lobbyId === allocation.lobbyId) transaction.delete(linkRef);
    transaction.delete(requestRef);
  });
  if (allocation.gameType === 'triviaBlitz') {
    await admin.firestore().collection('triviaGameSecrets').doc(allocation.sessionId).delete().catch(() => undefined);
    await admin.firestore().recursiveDelete(admin.firestore().collection('sessions').doc(allocation.sessionId)).catch(() => undefined);
  } else {
    await admin.database().ref().update({
      [`gameSessions/${allocation.sessionId}`]: null,
      [`gameSessionSecrets/${allocation.sessionId}`]: null,
      [`gameSessionTeamState/${allocation.sessionId}`]: null,
    });
  }
}

async function listAuthorizedLobbyDirectory(
  uid: string,
  squadId: string,
  gameType: GameJoinCodeType,
) {
  const reference = gameLobbyDirectoryRef(squadId, gameType);
  const snapshot = await reference.get();
  const nowMs = Date.now();
  const directory = normalizeGameLobbyDirectory(snapshot.data(), squadId, gameType, nowMs);
  const orderedEntries = sortGameLobbies(Object.values(directory.lobbies));
  const hydrated = await Promise.all(
    orderedEntries.map((entry) => hydrateLobbyEntry(entry, uid)),
  );
  const liveEntries = orderedEntries.flatMap((entry, index) => {
    const result = hydrated[index];
    if (result) return [result.entry];
    return entry.status === 'provisioning' && nowMs - entry.createdAtMs < PROVISIONING_TIMEOUT_MS
      ? [entry]
      : [];
  });
  const publicLobbies = hydrated.flatMap((result) => result ? [result.summary] : []);
  const reconciled = liveEntries.reduce(
    (next, entry) => addGameLobbyToDirectory(next, entry),
    createEmptyGameLobbyDirectory(squadId, gameType),
  );
  const preservedNextLobbyNumber = Math.max(directory.nextLobbyNumber, reconciled.nextLobbyNumber);
  const originalMainStillLive = directory.mainLobbyId && reconciled.lobbies[directory.mainLobbyId]
    ? directory.mainLobbyId
    : null;
  const nextDirectory = {
    ...reconciled,
    mainLobbyId: originalMainStillLive ?? reconciled.mainLobbyId,
    nextLobbyNumber: preservedNextLobbyNumber,
  };
  if (snapshot.exists && JSON.stringify(directory) !== JSON.stringify(nextDirectory)) {
    await withFirestoreContentionRetry('listAuthorizedLobbyDirectory', () =>
      admin.firestore().runTransaction(async (transaction) => {
        const latestSnapshot = await transaction.get(reference);
        let merged = normalizeGameLobbyDirectory(
          latestSnapshot.data(),
          squadId,
          gameType,
          Date.now(),
        );
        Object.values(directory.lobbies).forEach((observedEntry) => {
          const latestEntry = merged.lobbies[observedEntry.lobbyId];
          if (!latestEntry || latestEntry.sessionId !== observedEntry.sessionId) return;
          const liveEntry = nextDirectory.lobbies[observedEntry.lobbyId];
          merged = liveEntry
            ? updateGameLobbyInDirectory(merged, liveEntry)
            : removeGameLobbyFromDirectory(merged, observedEntry.lobbyId);
        });
        merged = {
          ...merged,
          nextLobbyNumber: Math.max(merged.nextLobbyNumber, nextDirectory.nextLobbyNumber),
        };
        transaction.set(reference, { ...merged, updatedAt: Timestamp.now() });
      }),
    );
  }
  return {
    lobbies: publicLobbies.map((lobby) => ({
      ...lobby,
      isMain: lobby.lobbyId === nextDirectory.mainLobbyId,
    })),
  };
}

async function hydrateLobbyEntry(
  entry: GameLobbyDirectoryEntry,
  uid: string,
): Promise<{ entry: GameLobbyDirectoryEntry; summary: PublicLobbySummary } | null> {
  const nowMs = Date.now();
  const link = await sessionLinks().doc(hashIdentifier(`${entry.gameType}:${entry.sessionId}`)).get();
  const linkData = link.data();
  const code = normalizeGameJoinCode(linkData?.code);
  if (
    !link.exists ||
    !code ||
    linkData?.lobbyId !== entry.lobbyId ||
    linkData?.sessionId !== entry.sessionId ||
    linkData?.squadId !== entry.squadId ||
    linkData?.gameType !== entry.gameType
  ) {
    return entry.status === 'provisioning' && nowMs - entry.createdAtMs < PROVISIONING_TIMEOUT_MS
      ? null
      : null;
  }
  const mapping = await registry().doc(code).get();
  if (
    !mapping.exists ||
    mapping.data()?.lobbyId !== entry.lobbyId ||
    mapping.data()?.sessionId !== entry.sessionId ||
    mapping.data()?.squadId !== entry.squadId ||
    mapping.data()?.gameType !== entry.gameType
  ) return null;
  const canonical = entry.gameType === 'triviaBlitz'
    ? await readTriviaLobbySnapshot(entry, uid)
    : await readRealtimeLobbySnapshot(entry, uid);
  if (!canonical) return null;
  const expiresAtMs = Math.min(
    canonical.expiresAtMs,
    readTimestampMillis(linkData?.expiresAt),
    readTimestampMillis(mapping.data()?.expiresAt),
  );
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs || canonical.status === 'closed') {
    return null;
  }
  const hostDisplayName = canonical.hostUserId === entry.hostUserId
    ? entry.hostDisplayName
    : await resolvePlayerDisplayName(canonical.hostUserId);
  const nextEntry: GameLobbyDirectoryEntry = {
    ...entry,
    hostUserId: canonical.hostUserId,
    hostDisplayName,
    status: canonical.status,
    activePlayerCount: canonical.activePlayerCount,
    queuedPlayerCount: canonical.queuedPlayerCount,
    capacity: canonical.capacity,
    expiresAtMs,
    updatedAtMs: nowMs,
  };
  const joinAction = resolveGameLobbyJoinAction({
    callerState: canonical.callerState,
    status: canonical.status,
    activePlayerCount: canonical.activePlayerCount,
    queuedPlayerCount: canonical.queuedPlayerCount,
    capacity: canonical.capacity,
  });
  return {
    entry: nextEntry,
    summary: {
      lobbyId: entry.lobbyId,
      sessionId: entry.sessionId,
      gameType: entry.gameType,
      lobbyNumber: entry.lobbyNumber,
      isMain: false,
      hostDisplayName,
      status: canonical.status,
      activePlayerCount: canonical.activePlayerCount,
      queuedPlayerCount: canonical.queuedPlayerCount,
      capacity: canonical.capacity,
      callerState: canonical.callerState,
      callerIsHost: canonical.hostUserId === uid,
      joinAction,
    },
  };
}

type CanonicalLobbySnapshot = {
  status: Exclude<GameLobbyStatus, 'provisioning' | 'closed' | 'expired'> | 'closed';
  hostUserId: string;
  activePlayerCount: number;
  queuedPlayerCount: number;
  capacity: number;
  expiresAtMs: number;
  callerState: GameLobbyCallerState;
};

async function readRealtimeLobbySnapshot(
  entry: GameLobbyDirectoryEntry,
  uid: string,
): Promise<CanonicalLobbySnapshot | null> {
  const snapshot = await admin.database().ref(`/gameSessions/${entry.sessionId}`).once('value');
  const session = readRecord(snapshot.val());
  if (
    !snapshot.exists() ||
    session.gameType !== legacyRealtimeGameType(entry.gameType) ||
    session.squadId !== entry.squadId ||
    session.lobbyId !== entry.lobbyId ||
    Number(session.lobbyNumber) !== entry.lobbyNumber ||
    Array.isArray(readRecord(session.gameState).bombSteps)
  ) return null;
  const players = readRecord(session.players);
  const queuedPlayers = readRecord(session.queuedPlayers);
  const status = canonicalDirectoryStatus(session.status, false);
  return {
    status,
    hostUserId: readStoredSessionId(session.hostUserId) ?? entry.hostUserId,
    activePlayerCount: Object.keys(players).length,
    queuedPlayerCount: Object.keys(queuedPlayers).length,
    capacity: readPositiveNumber(session.maxPlayers) ?? entry.capacity,
    expiresAtMs: readPositiveNumber(session.expiresAt) ?? 0,
    callerState: players[uid] ? 'active' : queuedPlayers[uid] ? 'queued' : 'none',
  };
}

async function readTriviaLobbySnapshot(
  entry: GameLobbyDirectoryEntry,
  uid: string,
): Promise<CanonicalLobbySnapshot | null> {
  const [parent, game] = await Promise.all([
    admin.firestore().collection('sessions').doc(entry.sessionId).get(),
    admin.firestore().collection('sessions').doc(entry.sessionId).collection('games').doc('triviaBlitz').get(),
  ]);
  const parentData = parent.data();
  if (
    !parent.exists ||
    !game.exists ||
    parentData?.gameType !== 'triviaBlitz' ||
    parentData?.squadId !== entry.squadId ||
    parentData?.lobbyId !== entry.lobbyId ||
    Number(parentData?.lobbyNumber) !== entry.lobbyNumber
  ) return null;
  const playerIds = readStringArray(parentData?.playerIds);
  const queuedPlayerIds = readStringArray(parentData?.queuedPlayerIds);
  return {
    status: canonicalDirectoryStatus(parentData?.status, true),
    hostUserId: readStoredSessionId(parentData?.hostPlayerId) ?? entry.hostUserId,
    activePlayerCount: playerIds.length,
    queuedPlayerCount: queuedPlayerIds.length,
    capacity: 20,
    expiresAtMs: readTimestampMillis(parentData?.expiresAt),
    callerState: playerIds.includes(uid) ? 'active' : queuedPlayerIds.includes(uid) ? 'queued' : 'none',
  };
}

function canonicalDirectoryStatus(
  value: unknown,
  trivia: boolean,
): CanonicalLobbySnapshot['status'] {
  const status = typeof value === 'string' ? value : '';
  if (status === 'lobby' || status === 'waiting') return 'waiting';
  if (status === 'countdown' || status === 'starting') return 'starting';
  if (status === 'active' || status === 'playing' || status === 'started') return 'inProgress';
  if (status === 'results' || status === 'completed' || status === 'ended') {
    return trivia ? 'waitingForRematch' : 'results';
  }
  return 'closed';
}

async function joinExistingGameLobby(input: {
  uid: string;
  gameType: GameJoinCodeType;
  squadId: string;
  lobbyId: string;
  displayName: string;
  mode: 'currentRound' | 'nextRound' | 'auto';
}): Promise<LobbyJoinResult> {
  const existingMembership = await reconcileActiveLobbyMembership(input.uid);
  if (existingMembership && existingMembership.lobbyId !== input.lobbyId) {
    throw safeError('failed-precondition', 'already_participating_elsewhere');
  }
  const directoryRef = gameLobbyDirectoryRef(input.squadId, input.gameType);
  const directorySnapshot = await directoryRef.get();
  const directory = normalizeGameLobbyDirectory(
    directorySnapshot.data(),
    input.squadId,
    input.gameType,
    Date.now(),
  );
  const entry = directory.lobbies[input.lobbyId];
  if (!entry) throw safeError('not-found', 'lobby_closed_or_expired');
  const hydrated = await hydrateLobbyEntry(entry, input.uid);
  if (!hydrated) throw safeError('not-found', 'lobby_closed_or_expired');
  const action = hydrated.summary.joinAction;
  const shouldQueue = input.mode === 'nextRound' ||
    (input.mode === 'auto' && action === 'joinNextRound');
  if (action === 'full') throw safeError('resource-exhausted', 'game_full');
  if (action === 'unavailable') throw safeError('failed-precondition', 'lobby_closed_or_expired');
  if (input.mode === 'currentRound' && action === 'joinNextRound') {
    throw safeError('failed-precondition', 'round_in_progress');
  }
  if (input.mode === 'nextRound' && action !== 'joinNextRound' && action !== 'queued') {
    throw safeError('failed-precondition', action === 'reconnect' ? 'already_joined' : 'round_not_in_progress');
  }

  const membershipState = shouldQueue ? 'queued' as const : 'joining' as const;
  const reserved = await reserveLobbyMembership({
    ...input,
    entry: hydrated.entry,
    state: membershipState,
  });
  try {
    let participantState: 'joined' | 'reconnected' = 'joined';
    if (shouldQueue) {
      if (input.gameType === 'triviaBlitz') {
        await queueTriviaLobbyParticipant({
          uid: input.uid,
          entry: hydrated.entry,
          displayName: input.displayName,
        });
      } else {
        await queueRealtimeLobbyParticipant({
          uid: input.uid,
          entry: hydrated.entry,
          displayName: input.displayName,
        });
      }
    } else {
      const link = await sessionLinks()
        .doc(hashIdentifier(`${input.gameType}:${hydrated.entry.sessionId}`))
        .get();
      if (
        !link.exists ||
        link.data()?.lobbyId !== input.lobbyId ||
        link.data()?.squadId !== input.squadId
      ) throw safeError('not-found', 'lobby_closed_or_expired');
      participantState = input.gameType === 'triviaBlitz'
        ? await joinTriviaSession({
          uid: input.uid,
          sessionId: hydrated.entry.sessionId,
          displayName: input.displayName,
          mappingStatus: link.data()?.status,
          expectedLobbyId: input.lobbyId,
          expectedSquadId: input.squadId,
        })
        : await joinRealtimeSession({
          uid: input.uid,
          sessionId: hydrated.entry.sessionId,
          displayName: input.displayName,
          gameType: input.gameType,
          mappingStatus: link.data()?.status,
          expectedLobbyId: input.lobbyId,
          expectedSquadId: input.squadId,
        });
    }
    await finalizeLobbyMembership({
      uid: input.uid,
      entry: hydrated.entry,
      state: shouldQueue ? 'queued' : 'active',
    });
    await refreshGameLobbyDirectoryEntry(hydrated.entry, input.uid);
    return {
      gameType: input.gameType,
      lobbyId: input.lobbyId,
      lobbyNumber: hydrated.entry.lobbyNumber,
      sessionId: hydrated.entry.sessionId,
      participantState: shouldQueue ? 'joined' : participantState,
    };
  } catch (error) {
    if (reserved.created) {
      await clearLobbyMembershipIfMatches(input.uid, input.lobbyId).catch(() => undefined);
    }
    throw error;
  }
}

async function reserveLobbyMembership(input: {
  uid: string;
  gameType: GameJoinCodeType;
  squadId: string;
  lobbyId: string;
  entry: GameLobbyDirectoryEntry;
  state: 'joining' | 'queued';
}) {
  const reference = activeGameLobbyMemberships().doc(input.uid);
  const directoryRef = gameLobbyDirectoryRef(input.squadId, input.gameType);
  return withFirestoreContentionRetry('reserveLobbyMembership', () =>
    admin.firestore().runTransaction(async (transaction) => {
    const [membership, directorySnapshot] = await Promise.all([
      transaction.get(reference),
      transaction.get(directoryRef),
    ]);
    const stored = readStoredLobbyMembership(membership.data());
    if (stored && stored.expiresAtMs > Date.now() && stored.lobbyId !== input.lobbyId) {
      throw safeError('failed-precondition', 'already_participating_elsewhere');
    }
    const directory = normalizeGameLobbyDirectory(
      directorySnapshot.data(),
      input.squadId,
      input.gameType,
      Date.now(),
    );
    const current = directory.lobbies[input.lobbyId];
    if (!current || current.sessionId !== input.entry.sessionId) {
      throw safeError('not-found', 'lobby_closed_or_expired');
    }
    const now = Timestamp.now();
    transaction.set(reference, {
      lobbyId: input.lobbyId,
      sessionId: current.sessionId,
      squadId: input.squadId,
      gameType: input.gameType,
      state: input.state,
      createdAt: membership.data()?.createdAt ?? now,
      updatedAt: now,
      expiresAt: Timestamp.fromMillis(current.expiresAtMs),
    });
      return { created: !membership.exists };
    }),
  );
}

async function finalizeLobbyMembership(input: {
  uid: string;
  entry: GameLobbyDirectoryEntry;
  state: 'active' | 'queued';
}) {
  const reference = activeGameLobbyMemberships().doc(input.uid);
  await admin.firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.data()?.lobbyId !== input.entry.lobbyId) {
      throw safeError('failed-precondition', 'already_participating_elsewhere');
    }
    transaction.update(reference, {
      state: input.state,
      sessionId: input.entry.sessionId,
      expiresAt: Timestamp.fromMillis(input.entry.expiresAtMs),
      updatedAt: Timestamp.now(),
    });
  });
}

async function reconcileActiveLobbyMembership(uid: string): Promise<StoredLobbyMembership | null> {
  const reference = activeGameLobbyMemberships().doc(uid);
  const snapshot = await reference.get();
  const membership = readStoredLobbyMembership(snapshot.data());
  if (!snapshot.exists || !membership || membership.expiresAtMs <= Date.now()) {
    if (snapshot.exists) await reference.delete();
    return null;
  }
  const directorySnapshot = await gameLobbyDirectoryRef(membership.squadId, membership.gameType).get();
  const directory = normalizeGameLobbyDirectory(
    directorySnapshot.data(),
    membership.squadId,
    membership.gameType,
    Date.now(),
  );
  const entry = directory.lobbies[membership.lobbyId];
  if (!entry) {
    await reference.delete();
    return null;
  }
  const hydrated = await hydrateLobbyEntry(entry, uid);
  if (!hydrated || hydrated.summary.callerState === 'none') {
    await reference.delete();
    return null;
  }
  const next: StoredLobbyMembership = {
    ...membership,
    sessionId: hydrated.entry.sessionId,
    state: hydrated.summary.callerState,
    expiresAtMs: hydrated.entry.expiresAtMs,
  };
  if (
    next.sessionId !== membership.sessionId ||
    next.state !== membership.state ||
    next.expiresAtMs !== membership.expiresAtMs
  ) {
    await reference.update({
      sessionId: next.sessionId,
      state: next.state,
      expiresAt: Timestamp.fromMillis(next.expiresAtMs),
      updatedAt: Timestamp.now(),
    });
  }
  return next;
}

async function queueRealtimeLobbyParticipant(input: {
  uid: string;
  entry: GameLobbyDirectoryEntry;
  displayName: string;
}) {
  let reason = 'round_in_progress';
  const reference = admin.database().ref(`/gameSessions/${input.entry.sessionId}`);
  const result = await reference.transaction((session) => {
    if (
      !session ||
      session.lobbyId !== input.entry.lobbyId ||
      session.squadId !== input.entry.squadId ||
      session.gameType !== legacyRealtimeGameType(input.entry.gameType)
    ) {
      reason = 'lobby_closed_or_expired';
      return;
    }
    const players = readRecord(session.players);
    const queuedPlayers = readRecord(session.queuedPlayers);
    if (players[input.uid]) return session;
    if (queuedPlayers[input.uid]) return session;
    if (session.status !== 'active' && session.status !== 'countdown' && session.status !== 'completed') {
      reason = 'round_not_in_progress';
      return;
    }
    const capacity = readPositiveNumber(session.maxPlayers) ?? input.entry.capacity;
    if (Object.keys(players).length + Object.keys(queuedPlayers).length >= capacity) {
      reason = 'game_full';
      return;
    }
    queuedPlayers[input.uid] = {
      displayName: input.displayName,
      queuedAt: Date.now(),
      isConnected: true,
    };
    return { ...session, queuedPlayers, updatedAt: Date.now() };
  });
  if (!result.committed) {
    throw safeError(reason === 'game_full' ? 'resource-exhausted' : 'failed-precondition', reason);
  }
}

async function queueTriviaLobbyParticipant(input: {
  uid: string;
  entry: GameLobbyDirectoryEntry;
  displayName: string;
}) {
  const parentRef = admin.firestore().collection('sessions').doc(input.entry.sessionId);
  const gameRef = parentRef.collection('games').doc('triviaBlitz');
  const queueRef = gameRef.collection('queuedPlayers').doc(input.uid);
  await admin.firestore().runTransaction(async (transaction) => {
    const [parent, game, queued] = await Promise.all([
      transaction.get(parentRef),
      transaction.get(gameRef),
      transaction.get(queueRef),
    ]);
    if (
      !parent.exists ||
      !game.exists ||
      parent.data()?.lobbyId !== input.entry.lobbyId ||
      parent.data()?.squadId !== input.entry.squadId
    ) throw safeError('not-found', 'lobby_closed_or_expired');
    const playerIds = readStringArray(parent.data()?.playerIds);
    const queuedIds = readStringArray(parent.data()?.queuedPlayerIds);
    if (playerIds.includes(input.uid) || queued.exists) return;
    if (parent.data()?.status !== 'playing' && parent.data()?.status !== 'results') {
      throw safeError('failed-precondition', 'round_not_in_progress');
    }
    if (playerIds.length + queuedIds.length >= 20) throw safeError('resource-exhausted', 'game_full');
    const now = Timestamp.now();
    transaction.set(queueRef, { name: input.displayName, queuedAt: now, updatedAt: now });
    transaction.update(parentRef, {
      queuedPlayerIds: FieldValue.arrayUnion(input.uid),
      updatedAt: now,
    });
    transaction.update(gameRef, {
      queuedPlayerCount: FieldValue.increment(1),
      updatedAt: now,
    });
  });
}

async function refreshGameLobbyDirectoryEntry(entry: GameLobbyDirectoryEntry, uid: string) {
  const hydrated = await hydrateLobbyEntry(entry, uid);
  if (!hydrated) {
    await removeGameLobbyDirectoryEntry({
      gameType: entry.gameType,
      lobbyId: entry.lobbyId,
      squadId: entry.squadId,
    });
    return;
  }
  const reference = gameLobbyDirectoryRef(entry.squadId, entry.gameType);
  await withFirestoreContentionRetry('refreshGameLobbyDirectoryEntry', () =>
    admin.firestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const directory = normalizeGameLobbyDirectory(
        snapshot.data(),
        entry.squadId,
        entry.gameType,
        Date.now(),
      );
      const current = directory.lobbies[entry.lobbyId];
      if (!current || current.sessionId !== entry.sessionId) return;
      transaction.set(reference, {
        ...updateGameLobbyInDirectory(directory, hydrated.entry),
        updatedAt: Timestamp.now(),
      });
    }),
  );
}

async function clearLobbyMembershipIfMatches(uid: string, lobbyId: string) {
  const reference = activeGameLobbyMemberships().doc(uid);
  await admin.firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.data()?.lobbyId === lobbyId) transaction.delete(reference);
  });
}

async function leaveCanonicalGameLobby(uid: string, lobbyId: string) {
  const membership = await reconcileActiveLobbyMembership(uid);
  if (!membership || membership.lobbyId !== lobbyId) {
    throw safeError('permission-denied', 'not_authorized');
  }
  const directorySnapshot = await gameLobbyDirectoryRef(membership.squadId, membership.gameType).get();
  const directory = normalizeGameLobbyDirectory(
    directorySnapshot.data(),
    membership.squadId,
    membership.gameType,
    Date.now(),
  );
  const entry = directory.lobbies[lobbyId];
  if (!entry) {
    await clearLobbyMembershipIfMatches(uid, lobbyId);
    return { status: 'left' as const, hostChanged: false };
  }

  if (membership.state === 'queued') {
    if (membership.gameType === 'triviaBlitz') {
      await removeTriviaQueuedParticipant(uid, entry);
    } else {
      await removeRealtimeQueuedParticipant(uid, entry);
    }
    await clearLobbyMembershipIfMatches(uid, lobbyId);
    await refreshGameLobbyDirectoryEntry(entry, uid);
    return { status: 'left' as const, hostChanged: false };
  }

  const departure = membership.gameType === 'triviaBlitz'
    ? await leaveTriviaLobbyParticipant(uid, entry)
    : await leaveRealtimeLobbyParticipant(uid, entry);
  await clearLobbyMembershipIfMatches(uid, lobbyId);
  if (departure.closed) {
    await closeLobbyDirectoryRecords(entry, uid, 'canceled');
    return { status: 'closed' as const, hostChanged: false };
  }
  if (departure.promotedUserId) {
    await finalizeLobbyMembership({
      uid: departure.promotedUserId,
      entry,
      state: 'active',
    });
  }
  if (departure.hostUserId && departure.hostUserId !== entry.hostUserId) {
    await transferLobbyHostRecords(entry, departure.hostUserId);
  }
  await refreshGameLobbyDirectoryEntry(entry, departure.hostUserId ?? uid);
  return {
    status: 'left' as const,
    hostChanged: Boolean(departure.hostUserId && departure.hostUserId !== entry.hostUserId),
  };
}

async function leaveRealtimeLobbyParticipant(uid: string, entry: GameLobbyDirectoryEntry) {
  let reason = 'not_authorized';
  let nextHostUserId: string | null = null;
  let promotedUserId: string | null = null;
  let closed = false;
  const reference = admin.database().ref(`/gameSessions/${entry.sessionId}`);
  const result = await reference.transaction((session) => {
    if (
      !session ||
      session.lobbyId !== entry.lobbyId ||
      session.squadId !== entry.squadId ||
      !session.players?.[uid]
    ) return;
    if (session.status === 'active' || session.status === 'countdown') {
      reason = 'finish_active_round_first';
      return;
    }
    const players = readRecord(session.players);
    const queuedPlayers = readRecord(session.queuedPlayers);
    delete players[uid];
    if (Object.keys(players).length === 0 && Object.keys(queuedPlayers).length > 0) {
      const [queuedUid, queuedValue] = Object.entries(queuedPlayers)
        .sort(([, left], [, right]) => {
          const leftAt = readPositiveNumber(readRecord(left).queuedAt) ?? Number.MAX_SAFE_INTEGER;
          const rightAt = readPositiveNumber(readRecord(right).queuedAt) ?? Number.MAX_SAFE_INTEGER;
          return leftAt - rightAt;
        })[0];
      const queued = readRecord(queuedValue);
      promotedUserId = queuedUid;
      players[queuedUid] = {
        displayName: typeof queued.displayName === 'string' ? queued.displayName : 'Player',
        avatarUrl: null,
        isReady: false,
        joinOrder: 1,
        teamId: entry.gameType === 'spotTheDifferences' ? 'A' : null,
        teamAssignmentVersion: entry.gameType === 'spotTheDifferences' ? 1 : null,
        score: 0,
        isConnected: true,
      };
      delete queuedPlayers[queuedUid];
    }
    const ordered = Object.entries(players).sort(([leftId, left], [rightId, right]) => {
      const leftOrder = readPositiveNumber(readRecord(left).joinOrder) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = readPositiveNumber(readRecord(right).joinOrder) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || leftId.localeCompare(rightId);
    });
    if (ordered.length === 0) {
      closed = true;
      return {
        ...session,
        players: {},
        queuedPlayers: {},
        status: 'failed',
        completedAt: Date.now(),
        updatedAt: Date.now(),
      };
    }
    nextHostUserId = session.hostUserId === uid ? ordered[0][0] : session.hostUserId;
    const normalizedPlayers = entry.gameType === 'spotTheDifferences'
      ? rebalanceSpotLobbyPlayers(players, Date.now()).players
      : players;
    return {
      ...session,
      hostUserId: nextHostUserId,
      players: normalizedPlayers,
      queuedPlayers,
      updatedAt: Date.now(),
    };
  });
  if (!result.committed) {
    throw safeError('failed-precondition', reason);
  }
  return { closed, hostUserId: nextHostUserId, promotedUserId };
}

async function leaveTriviaLobbyParticipant(uid: string, entry: GameLobbyDirectoryEntry) {
  const parentRef = admin.firestore().collection('sessions').doc(entry.sessionId);
  const gameRef = parentRef.collection('games').doc('triviaBlitz');
  const secretRef = admin.firestore().collection('triviaGameSecrets').doc(entry.sessionId);
  const result = await admin.firestore().runTransaction(async (transaction) => {
    const [parent, game, players, queuedPlayers] = await Promise.all([
      transaction.get(parentRef),
      transaction.get(gameRef),
      transaction.get(gameRef.collection('players')),
      transaction.get(gameRef.collection('queuedPlayers')),
    ]);
    if (
      !parent.exists ||
      !game.exists ||
      parent.data()?.lobbyId !== entry.lobbyId ||
      !readStringArray(parent.data()?.playerIds).includes(uid)
    ) throw safeError('permission-denied', 'not_authorized');
    if (parent.data()?.status === 'playing') {
      throw safeError('failed-precondition', 'finish_active_round_first');
    }
    const remaining = players.docs
      .filter((player) => player.id !== uid)
      .sort((left, right) => Number(left.data().playerIndex ?? 0) - Number(right.data().playerIndex ?? 0));
    let promotedUserId: string | null = null;
    let promotedName = '';
    if (remaining.length === 0 && !queuedPlayers.empty) {
      const promoted = [...queuedPlayers.docs].sort((left, right) =>
        readTimestampMillis(left.data()?.queuedAt) - readTimestampMillis(right.data()?.queuedAt),
      )[0];
      promotedUserId = promoted.id;
      promotedName = typeof promoted.data()?.name === 'string' ? promoted.data().name : 'Player';
      transaction.create(gameRef.collection('players').doc(promoted.id), {
        name: promotedName,
        playerIndex: 0,
        joinOrder: 1,
        score: 0,
        ready: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      transaction.delete(promoted.ref);
    }
    transaction.delete(gameRef.collection('players').doc(uid));
    const remainingIds = remaining.map((player) => player.id);
    if (promotedUserId) remainingIds.push(promotedUserId);
    const queuedIds = queuedPlayers.docs
      .map((player) => player.id)
      .filter((playerId) => playerId !== promotedUserId);
    const closed = remainingIds.length === 0;
    const hostUserId = closed
      ? null
      : parent.data()?.hostPlayerId === uid
        ? remainingIds[0]
        : parent.data()?.hostPlayerId;
    const now = Timestamp.now();
    transaction.update(parentRef, {
      playerIds: remainingIds,
      queuedPlayerIds: queuedIds,
      hostPlayerId: hostUserId,
      status: closed ? 'results' : parent.data()?.status,
      completedAt: closed ? now : parent.data()?.completedAt ?? null,
      updatedAt: now,
    });
    transaction.update(gameRef, {
      totalPlayers: remainingIds.length,
      queuedPlayerCount: queuedIds.length,
      hostPlayerId: hostUserId,
      status: closed ? 'results' : game.data()?.status,
      updatedAt: now,
    });
    if (hostUserId) transaction.update(secretRef, { hostPlayerId: hostUserId, updatedAt: now });
    return { closed, hostUserId, promotedUserId };
  });
  return result;
}

async function removeRealtimeQueuedParticipant(uid: string, entry: GameLobbyDirectoryEntry) {
  await admin.database().ref(`/gameSessions/${entry.sessionId}`).transaction((session) => {
    if (!session || session.lobbyId !== entry.lobbyId || !session.queuedPlayers?.[uid]) return session;
    const queuedPlayers = readRecord(session.queuedPlayers);
    delete queuedPlayers[uid];
    return { ...session, queuedPlayers, updatedAt: Date.now() };
  });
}

async function removeTriviaQueuedParticipant(uid: string, entry: GameLobbyDirectoryEntry) {
  const parentRef = admin.firestore().collection('sessions').doc(entry.sessionId);
  const gameRef = parentRef.collection('games').doc('triviaBlitz');
  const queueRef = gameRef.collection('queuedPlayers').doc(uid);
  await admin.firestore().runTransaction(async (transaction) => {
    const [parent, queued] = await Promise.all([
      transaction.get(parentRef),
      transaction.get(queueRef),
    ]);
    if (!parent.exists || parent.data()?.lobbyId !== entry.lobbyId || !queued.exists) return;
    const queuedIds = readStringArray(parent.data()?.queuedPlayerIds).filter((id) => id !== uid);
    transaction.delete(queueRef);
    transaction.update(parentRef, { queuedPlayerIds: queuedIds, updatedAt: Timestamp.now() });
    transaction.update(gameRef, { queuedPlayerCount: queuedIds.length, updatedAt: Timestamp.now() });
  });
}

async function transferLobbyHostRecords(entry: GameLobbyDirectoryEntry, hostUserId: string) {
  const displayName = await resolvePlayerDisplayName(hostUserId);
  const directoryRef = gameLobbyDirectoryRef(entry.squadId, entry.gameType);
  const linkRef = sessionLinks().doc(hashIdentifier(`${entry.gameType}:${entry.sessionId}`));
  await admin.firestore().runTransaction(async (transaction) => {
    const [directorySnapshot, link] = await Promise.all([
      transaction.get(directoryRef),
      transaction.get(linkRef),
    ]);
    const code = normalizeGameJoinCode(link.data()?.code);
    if (!code || link.data()?.lobbyId !== entry.lobbyId) {
      throw safeError('not-found', 'lobby_closed_or_expired');
    }
    const mappingRef = registry().doc(code);
    const mapping = await transaction.get(mappingRef);
    if (mapping.data()?.lobbyId !== entry.lobbyId) {
      throw safeError('not-found', 'lobby_closed_or_expired');
    }
    const directory = normalizeGameLobbyDirectory(
      directorySnapshot.data(),
      entry.squadId,
      entry.gameType,
      Date.now(),
    );
    const current = directory.lobbies[entry.lobbyId];
    if (!current || current.sessionId !== entry.sessionId) return;
    const next = updateGameLobbyInDirectory(directory, {
      ...current,
      hostUserId,
      hostDisplayName: displayName,
      updatedAtMs: Date.now(),
    });
    const now = Timestamp.now();
    transaction.set(directoryRef, { ...next, updatedAt: now });
    transaction.update(linkRef, { hostUserId, updatedAt: now });
    transaction.update(mappingRef, { hostUserId, updatedAt: now });
  });
}

async function closeCanonicalGameLobby(uid: string, lobbyId: string) {
  const membership = await reconcileActiveLobbyMembership(uid);
  if (!membership || membership.lobbyId !== lobbyId || membership.state !== 'active') {
    throw safeError('permission-denied', 'not_authorized');
  }
  const directorySnapshot = await gameLobbyDirectoryRef(membership.squadId, membership.gameType).get();
  const directory = normalizeGameLobbyDirectory(
    directorySnapshot.data(),
    membership.squadId,
    membership.gameType,
    Date.now(),
  );
  const entry = directory.lobbies[lobbyId];
  if (!entry || entry.hostUserId !== uid) throw safeError('permission-denied', 'not_authorized');
  const hydrated = await hydrateLobbyEntry(entry, uid);
  if (!hydrated) throw safeError('not-found', 'lobby_closed_or_expired');
  if (hydrated.entry.activePlayerCount > 1 || hydrated.entry.queuedPlayerCount > 0) {
    throw safeError('failed-precondition', 'host_must_transfer');
  }
  if (entry.gameType === 'triviaBlitz') {
    const now = Timestamp.now();
    await admin.firestore().collection('sessions').doc(entry.sessionId).set({
      status: 'results',
      completedAt: now,
      updatedAt: now,
    }, { merge: true });
    await admin.firestore().collection('sessions').doc(entry.sessionId).collection('games').doc('triviaBlitz').set({
      status: 'results',
      updatedAt: now,
    }, { merge: true });
  } else {
    await admin.database().ref(`/gameSessions/${entry.sessionId}`).update({
      status: 'failed',
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  await closeLobbyDirectoryRecords(entry, uid, 'canceled');
  return { status: 'closed' as const };
}

async function closeLobbyDirectoryRecords(
  entry: GameLobbyDirectoryEntry,
  actorUid: string,
  status: 'canceled' | 'expired',
) {
  const linkRef = sessionLinks().doc(hashIdentifier(`${entry.gameType}:${entry.sessionId}`));
  const directoryRef = gameLobbyDirectoryRef(entry.squadId, entry.gameType);
  await admin.firestore().runTransaction(async (transaction) => {
    const [link, directorySnapshot] = await Promise.all([
      transaction.get(linkRef),
      transaction.get(directoryRef),
    ]);
    const code = normalizeGameJoinCode(link.data()?.code);
    const directory = normalizeGameLobbyDirectory(
      directorySnapshot.data(),
      entry.squadId,
      entry.gameType,
      Date.now(),
    );
    const mappingRef = code ? registry().doc(code) : null;
    const mapping = mappingRef ? await transaction.get(mappingRef) : null;
    if (directory.lobbies[entry.lobbyId]) {
      transaction.set(directoryRef, {
        ...removeGameLobbyFromDirectory(directory, entry.lobbyId),
        updatedAt: Timestamp.now(),
      });
    }
    if (mappingRef && mapping?.data()?.lobbyId === entry.lobbyId) {
      transaction.update(mappingRef, { status, updatedAt: Timestamp.now() });
    }
    if (link.data()?.lobbyId === entry.lobbyId) {
      transaction.update(linkRef, { status, updatedAt: Timestamp.now() });
    }
  });
  const memberships = await activeGameLobbyMemberships().where('lobbyId', '==', entry.lobbyId).get();
  if (!memberships.empty) {
    const batch = admin.firestore().batch();
    memberships.docs.forEach((membership) => batch.delete(membership.ref));
    await batch.commit();
  }
  functions.logger.info('game_lobby_closed', {
    gameType: entry.gameType,
    reason: status,
    actorIsHost: actorUid === entry.hostUserId,
  });
}

async function createNextLobbyRound(
  uid: string,
  lobbyId: string,
): Promise<LobbyCreateResult> {
  const membership = await reconcileActiveLobbyMembership(uid);
  if (!membership || membership.lobbyId !== lobbyId || membership.state !== 'active') {
    throw safeError('permission-denied', 'not_authorized');
  }
  const directoryRef = gameLobbyDirectoryRef(membership.squadId, membership.gameType);
  const directorySnapshot = await directoryRef.get();
  const directory = normalizeGameLobbyDirectory(
    directorySnapshot.data(),
    membership.squadId,
    membership.gameType,
    Date.now(),
  );
  const currentEntry = directory.lobbies[lobbyId];
  if (!currentEntry || currentEntry.hostUserId !== uid) {
    throw safeError('permission-denied', 'not_authorized');
  }
  const hydrated = await hydrateLobbyEntry(currentEntry, uid);
  if (
    !hydrated ||
    (hydrated.entry.status !== 'results' && hydrated.entry.status !== 'waitingForRematch')
  ) throw safeError('failed-precondition', 'round_not_finished');

  const currentParticipants = await readLobbyRoundParticipants(hydrated.entry);
  const participants: TriviaLobbyParticipant[] = [];
  for (const participant of currentParticipants) {
    const [eligibleStanding, eligibleSquad] = await Promise.all([
      accountCanCommunicate(participant.uid),
      readAuthorizedSquadId(participant.uid, hydrated.entry.squadId),
    ]);
    if (eligibleStanding && eligibleSquad === hydrated.entry.squadId) participants.push(participant);
  }
  const host = participants.find((participant) => participant.uid === uid);
  if (!host) throw safeError('permission-denied', 'not_authorized');
  const orderedParticipants = [host, ...participants.filter((participant) => participant.uid !== uid)]
    .slice(0, hydrated.entry.capacity)
    .map((participant, index) => ({ ...participant, joinOrder: index + 1 }));
  const newSessionId = `${hydrated.entry.gameType === 'triviaBlitz' ? 'trivia' : 'game'}_${randomBytes(18).toString('base64url')}`;
  const expiresAtMs = Date.now() + JOIN_CODE_TTL_MS;
  const rematch = await reserveLobbyRematch({
    entry: hydrated.entry,
    newSessionId,
    expiresAtMs,
    participantCount: orderedParticipants.length,
    uid,
  });
  try {
    await provisionCanonicalLobbyRound({
      gameType: hydrated.entry.gameType,
      sessionId: newSessionId,
      lobbyId,
      lobbyNumber: hydrated.entry.lobbyNumber,
      squadId: hydrated.entry.squadId,
      hostUserId: uid,
      participants: orderedParticipants,
      expiresAtMs,
    });
    await completeLobbyRematch({
      entry: hydrated.entry,
      newSessionId,
      expiresAtMs,
      participants: orderedParticipants,
    });
    return {
      gameType: hydrated.entry.gameType,
      lobbyId,
      lobbyNumber: hydrated.entry.lobbyNumber,
      sessionId: newSessionId,
      participantState: 'joined',
      joinCode: rematch.joinCode,
      expiresAt: expiresAtMs,
    };
  } catch (error) {
    await rollbackLobbyRematch({
      entry: hydrated.entry,
      newSessionId,
      joinCode: rematch.joinCode,
    }).catch(() => undefined);
    if (error instanceof functions.https.HttpsError) throw error;
    throw safeError('internal', 'session_creation_failed');
  }
}

async function readLobbyRoundParticipants(entry: GameLobbyDirectoryEntry): Promise<TriviaLobbyParticipant[]> {
  if (entry.gameType === 'triviaBlitz') {
    const gameRef = admin.firestore().collection('sessions').doc(entry.sessionId).collection('games').doc('triviaBlitz');
    const [players, queuedPlayers] = await Promise.all([
      gameRef.collection('players').get(),
      gameRef.collection('queuedPlayers').get(),
    ]);
    return [...players.docs, ...queuedPlayers.docs]
      .map((player, index) => ({
        uid: player.id,
        displayName: typeof player.data()?.name === 'string' ? player.data().name : 'Player',
        joinOrder: readPositiveNumber(player.data()?.joinOrder) ??
          readPositiveNumber(player.data()?.playerIndex) ?? index + 1,
      }))
      .sort((left, right) => left.joinOrder - right.joinOrder || left.uid.localeCompare(right.uid));
  }
  const snapshot = await admin.database().ref(`/gameSessions/${entry.sessionId}`).once('value');
  const session = readRecord(snapshot.val());
  const players = readRecord(session.players);
  const queuedPlayers = readRecord(session.queuedPlayers);
  return [...Object.entries(players), ...Object.entries(queuedPlayers)]
    .map(([participantId, value], index) => {
      const participant = readRecord(value);
      return {
        uid: participantId,
        displayName: typeof participant.displayName === 'string' ? participant.displayName : 'Player',
        joinOrder: readPositiveNumber(participant.joinOrder) ??
          readPositiveNumber(participant.queuedAt) ?? index + 1,
      };
    })
    .sort((left, right) => left.joinOrder - right.joinOrder || left.uid.localeCompare(right.uid));
}

async function reserveLobbyRematch(input: {
  entry: GameLobbyDirectoryEntry;
  newSessionId: string;
  expiresAtMs: number;
  participantCount: number;
  uid: string;
}) {
  const directoryRef = gameLobbyDirectoryRef(input.entry.squadId, input.entry.gameType);
  const oldLinkRef = sessionLinks().doc(hashIdentifier(`${input.entry.gameType}:${input.entry.sessionId}`));
  const newLinkRef = sessionLinks().doc(hashIdentifier(`${input.entry.gameType}:${input.newSessionId}`));
  return admin.firestore().runTransaction(async (transaction) => {
    const [directorySnapshot, oldLink, newLink] = await Promise.all([
      transaction.get(directoryRef),
      transaction.get(oldLinkRef),
      transaction.get(newLinkRef),
    ]);
    const code = normalizeGameJoinCode(oldLink.data()?.code);
    if (
      !code ||
      newLink.exists ||
      oldLink.data()?.lobbyId !== input.entry.lobbyId ||
      oldLink.data()?.hostUserId !== input.uid
    ) throw safeError('failed-precondition', 'lobby_closed_or_expired');
    const mappingRef = registry().doc(code);
    const mapping = await transaction.get(mappingRef);
    if (
      mapping.data()?.lobbyId !== input.entry.lobbyId ||
      mapping.data()?.sessionId !== input.entry.sessionId
    ) throw safeError('failed-precondition', 'lobby_closed_or_expired');
    const directory = normalizeGameLobbyDirectory(
      directorySnapshot.data(),
      input.entry.squadId,
      input.entry.gameType,
      Date.now(),
    );
    const current = directory.lobbies[input.entry.lobbyId];
    if (
      !current ||
      current.sessionId !== input.entry.sessionId ||
      current.hostUserId !== input.uid ||
      (current.status !== 'results' && current.status !== 'waitingForRematch')
    ) throw safeError('failed-precondition', 'round_not_finished');
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(input.expiresAtMs);
    const nextEntry = {
      ...current,
      sessionId: input.newSessionId,
      status: 'provisioning' as const,
      activePlayerCount: input.participantCount,
      queuedPlayerCount: 0,
      expiresAtMs: input.expiresAtMs,
      updatedAtMs: Date.now(),
    };
    transaction.set(directoryRef, {
      ...updateGameLobbyInDirectory(directory, nextEntry),
      updatedAt: now,
    });
    transaction.update(oldLinkRef, { status: 'ended', updatedAt: now });
    const nextLink = {
      ...oldLink.data(),
      sessionId: input.newSessionId,
      status: 'lobby',
      createdAt: now,
      updatedAt: now,
      expiresAt,
    };
    transaction.create(newLinkRef, nextLink);
    transaction.update(mappingRef, {
      sessionId: input.newSessionId,
      status: 'lobby',
      updatedAt: now,
      expiresAt,
    });
    return { joinCode: code };
  });
}

async function completeLobbyRematch(input: {
  entry: GameLobbyDirectoryEntry;
  newSessionId: string;
  expiresAtMs: number;
  participants: TriviaLobbyParticipant[];
}) {
  const directoryRef = gameLobbyDirectoryRef(input.entry.squadId, input.entry.gameType);
  await admin.firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(directoryRef);
    const directory = normalizeGameLobbyDirectory(
      snapshot.data(),
      input.entry.squadId,
      input.entry.gameType,
      Date.now(),
    );
    const current = directory.lobbies[input.entry.lobbyId];
    if (!current || current.sessionId !== input.newSessionId) {
      throw safeError('failed-precondition', 'session_creation_failed');
    }
    transaction.set(directoryRef, {
      ...updateGameLobbyInDirectory(directory, {
        ...current,
        status: 'waiting',
        updatedAtMs: Date.now(),
      }),
      updatedAt: Timestamp.now(),
    });
  });
  const participantIds = new Set(input.participants.map((participant) => participant.uid));
  const memberships = await activeGameLobbyMemberships().where('lobbyId', '==', input.entry.lobbyId).get();
  const writer = admin.firestore().bulkWriter();
  memberships.docs.forEach((membership) => {
    if (!participantIds.has(membership.id)) writer.delete(membership.ref);
  });
  input.participants.forEach((participant) => {
    writer.set(activeGameLobbyMemberships().doc(participant.uid), {
      lobbyId: input.entry.lobbyId,
      sessionId: input.newSessionId,
      squadId: input.entry.squadId,
      gameType: input.entry.gameType,
      state: 'active',
      updatedAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(input.expiresAtMs),
    }, { merge: true });
  });
  await writer.close();
}

async function rollbackLobbyRematch(input: {
  entry: GameLobbyDirectoryEntry;
  newSessionId: string;
  joinCode: string;
}) {
  const directoryRef = gameLobbyDirectoryRef(input.entry.squadId, input.entry.gameType);
  const oldLinkRef = sessionLinks().doc(hashIdentifier(`${input.entry.gameType}:${input.entry.sessionId}`));
  const newLinkRef = sessionLinks().doc(hashIdentifier(`${input.entry.gameType}:${input.newSessionId}`));
  const mappingRef = registry().doc(input.joinCode);
  await admin.firestore().runTransaction(async (transaction) => {
    const [directorySnapshot, mapping, newLink] = await Promise.all([
      transaction.get(directoryRef),
      transaction.get(mappingRef),
      transaction.get(newLinkRef),
    ]);
    const directory = normalizeGameLobbyDirectory(
      directorySnapshot.data(),
      input.entry.squadId,
      input.entry.gameType,
      Date.now(),
    );
    const current = directory.lobbies[input.entry.lobbyId];
    if (current?.sessionId === input.newSessionId && current.status === 'provisioning') {
      transaction.set(directoryRef, {
        ...updateGameLobbyInDirectory(directory, input.entry),
        updatedAt: Timestamp.now(),
      });
    }
    if (mapping.data()?.lobbyId === input.entry.lobbyId && mapping.data()?.sessionId === input.newSessionId) {
      transaction.update(mappingRef, {
        sessionId: input.entry.sessionId,
        status: 'ended',
        expiresAt: Timestamp.fromMillis(input.entry.expiresAtMs),
        updatedAt: Timestamp.now(),
      });
    }
    transaction.update(oldLinkRef, { status: 'ended', updatedAt: Timestamp.now() });
    if (newLink.data()?.lobbyId === input.entry.lobbyId) transaction.delete(newLinkRef);
  });
  if (input.entry.gameType === 'triviaBlitz') {
    await admin.firestore().collection('triviaGameSecrets').doc(input.newSessionId).delete().catch(() => undefined);
    await admin.firestore().recursiveDelete(admin.firestore().collection('sessions').doc(input.newSessionId)).catch(() => undefined);
  } else {
    await admin.database().ref().update({
      [`gameSessions/${input.newSessionId}`]: null,
      [`gameSessionSecrets/${input.newSessionId}`]: null,
      [`gameSessionTeamState/${input.newSessionId}`]: null,
    });
  }
}

export const cleanupExpiredGameJoinCodes = functions.pubsub.schedule('every 30 minutes').onRun(async () => {
  const now = Timestamp.now();
  const snapshot = await registry().where('expiresAt', '<=', now).limit(CLEANUP_BATCH_SIZE).get();
  if (!snapshot.empty) {
    const batch = admin.firestore().batch();
    for (const document of snapshot.docs) {
      const gameType = readGameJoinCodeType(document.data()?.gameType);
      const sessionId = readStoredSessionId(document.data()?.sessionId);
      batch.delete(document.ref);
      if (gameType && sessionId) {
        const linkRef = sessionLinks().doc(hashIdentifier(`${gameType}:${sessionId}`));
        const link = await linkRef.get();
        if (
          link.data()?.code === document.id &&
          readTimestampMillis(link.data()?.expiresAt) <= now.toMillis()
        ) {
          batch.delete(linkRef);
        }
      }
    }
    await batch.commit();
  }

  const expiredRequests = await requests()
    .where('expiresAt', '<=', now)
    .limit(CLEANUP_BATCH_SIZE)
    .get();
  if (!expiredRequests.empty) {
    const requestBatch = admin.firestore().batch();
    expiredRequests.docs.forEach((document) => requestBatch.delete(document.ref));
    await requestBatch.commit();
  }

  const staleMemberships = await activeGameLobbyMemberships()
    .where('expiresAt', '<=', now)
    .limit(CLEANUP_BATCH_SIZE)
    .get();
  if (!staleMemberships.empty) {
    const membershipBatch = admin.firestore().batch();
    staleMemberships.docs.forEach((document) => membershipBatch.delete(document.ref));
    await membershipBatch.commit();
  }

  const directorySnapshots = await gameLobbyDirectories().limit(CLEANUP_BATCH_SIZE).get();
  for (const document of directorySnapshots.docs) {
    const data = document.data();
    const squadId = readStoredSessionId(data?.squadId);
    const gameType = readGameJoinCodeType(data?.gameType);
    if (!squadId || !gameType) continue;
    await withFirestoreContentionRetry('cleanupExpiredGameLobbyDirectory', () =>
      admin.firestore().runTransaction(async (transaction) => {
        const latestSnapshot = await transaction.get(document.ref);
        if (!latestSnapshot.exists) return;
        const normalized = normalizeGameLobbyDirectory(
          latestSnapshot.data(),
          squadId,
          gameType,
          now.toMillis(),
        );
        transaction.set(document.ref, { ...normalized, updatedAt: now });
      }),
    );
  }

  console.info('[cleanupExpiredGameJoinCodes] completed', {
    expiredCodes: snapshot.size,
    expiredRequests: expiredRequests.size,
    expiredMemberships: staleMemberships.size,
    reconciledDirectories: directorySnapshots.size,
  });
  return null;
});

async function createRealtimeSession(input: {
  gameType: Exclude<GameJoinCodeType, 'triviaBlitz'>;
  sessionId?: string;
  lobbyId?: string;
  lobbyNumber?: number;
  hostUserId: string;
  sourceSquadId: string | null;
  participants?: TriviaLobbyParticipant[];
  expiresAtMs?: number;
}) {
  const sessionId = input.sessionId ?? `game_${randomBytes(18).toString('base64url')}`;
  const existing = await admin.database().ref(`/gameSessions/${sessionId}`).once('value');
  if (existing.exists()) {
    const session = readRecord(existing.val());
    if (
      session.hostUserId === input.hostUserId &&
      session.gameType === legacyRealtimeGameType(input.gameType) &&
      (!input.lobbyId || session.lobbyId === input.lobbyId) &&
      (!input.sourceSquadId || session.squadId === input.sourceSquadId)
    ) return sessionId;
    throw safeError('already-exists', 'session_unavailable');
  }
  const participants = input.participants?.length
    ? [...input.participants]
      .sort((left, right) => left.joinOrder - right.joinOrder || left.uid.localeCompare(right.uid))
    : [{
      uid: input.hostUserId,
      displayName: await resolvePlayerDisplayName(input.hostUserId),
      joinOrder: 1,
    }];
  if (!participants.some((participant) => participant.uid === input.hostUserId)) {
    throw safeError('failed-precondition', 'session_creation_failed');
  }
  const now = Date.now();
  const bombSteps = input.gameType === 'bombDefusal' ? createBombPattern() : null;
  const sceneId = `scene_${String(randomInt(1, 22)).padStart(3, '0')}`;
  const gameState = bombSteps
    ? {
      currentStep: bombSteps[0],
      currentStepIndex: 0,
      outcome: null,
      processedSubmissions: {},
    }
    : {
      sceneId,
      expectedDifferences: EXPECTED_SPOT_DIFFERENCES,
      teamAssignmentsFrozen: false,
      result: null,
      version: 2,
    };
  const maxPlayers = input.gameType === 'bombDefusal' ? 6 : 12;
  const playerEntries = Object.fromEntries(participants.slice(0, maxPlayers).map((participant, index) => {
    const joinOrder = index + 1;
    return [participant.uid, {
      displayName: participant.displayName,
      avatarUrl: null,
      isReady: false,
      joinOrder,
      teamId: input.gameType === 'spotTheDifferences' ? teamForSpotJoinOrder(joinOrder) : null,
      teamAssignmentVersion: input.gameType === 'spotTheDifferences' ? 1 : null,
      score: 0,
      isConnected: true,
    }];
  }));
  const session = {
    sessionId,
    lobbyId: input.lobbyId ?? sessionId,
    lobbyNumber: input.lobbyNumber ?? 1,
    gameType: legacyRealtimeGameType(input.gameType),
    squadId: input.sourceSquadId ?? '',
    hostUserId: input.hostUserId,
    players: playerEntries,
    queuedPlayers: {},
    nextJoinOrder: participants.length + 1,
    status: 'lobby',
    startedAt: null,
    completedAt: null,
    createdAt: now,
    expiresAt: input.expiresAtMs ?? now + JOIN_CODE_TTL_MS,
    gameState,
    minPlayers: input.gameType === 'bombDefusal' ? 2 : 4,
    maxPlayers,
    settings: input.gameType === 'bombDefusal'
      ? { timerSeconds: 60 }
      : { roundDuration: 90 },
  };
  const updates: Record<string, unknown> = {
    [`gameSessions/${sessionId}`]: session,
  };
  if (bombSteps) {
    updates[`gameSessionSecrets/${sessionId}`] = {
      bombSteps,
      expiresAt: session.expiresAt,
    };
  } else {
    updates[`gameSessionTeamState/${sessionId}/A`] = createEmptySpotTeamState('A', session.expiresAt);
    updates[`gameSessionTeamState/${sessionId}/B`] = createEmptySpotTeamState('B', session.expiresAt);
  }
  await admin.database().ref().update(updates);
  return sessionId;
}

function resolveRealtimeJoinState(
  session: Record<string, unknown>,
  joinCodeStatus: unknown,
  uid: string,
  nowMs: number,
) {
  const gameType = session.gameType;
  const players = readRecord(session.players);
  const status = typeof session.status === 'string' ? session.status : '';
  return resolveJoinableGameSession({
    status,
    startedAtMs: readPositiveNumber(session.startedAt),
    endsAtMs: earliestPositiveNumber(
      readPositiveNumber(session.endsAt),
      readPositiveNumber(session.expiresAt),
    ),
    durationSeconds: gameType === 'bomb_defusal' || gameType === 'spot_difference'
      ? readRealtimeDurationSeconds(gameType, session.settings)
      : null,
    joinCodeStatus: typeof joinCodeStatus === 'string' ? joinCodeStatus : null,
    participantCount: Object.keys(players).length,
    capacity: readPositiveNumber(session.maxPlayers),
    callerIsParticipant: Boolean(players[uid]),
    nowMs,
  });
}

async function expireRealtimeGameSession(
  gameType: Exclude<GameJoinCodeType, 'triviaBlitz'>,
  sessionId: string,
  serverNowMs: number,
) {
  await admin.database().ref(`/gameSessions/${sessionId}`).transaction((session) => {
    if (!session || typeof session !== 'object') return session;
    if (['completed', 'failed', 'ended', 'expired', 'canceled', 'cancelled', 'abandoned'].includes(session.status)) {
      return session;
    }
    return {
      ...session,
      status: session.status === 'active' || session.status === 'playing' ? 'completed' : 'failed',
      completedAt: serverNowMs,
      updatedAt: serverNowMs,
    };
  });

  const linkRef = sessionLinks().doc(hashIdentifier(`${gameType}:${sessionId}`));
  await admin.firestore().runTransaction(async (transaction) => {
    const link = await transaction.get(linkRef);
    const linkData = link.data();
    const code = normalizeGameJoinCode(linkData?.code);
    if (!link.exists || linkData?.sessionId !== sessionId || linkData?.gameType !== gameType || !code) return;
    const mappingRef = registry().doc(code);
    const mapping = await transaction.get(mappingRef);
    const timestamp = Timestamp.fromMillis(serverNowMs);
    transaction.update(linkRef, { status: 'expired', updatedAt: timestamp });
    if (mapping.exists && mapping.data()?.sessionId === sessionId && mapping.data()?.gameType === gameType) {
      transaction.update(mappingRef, { status: 'expired', updatedAt: timestamp });
    }
  });
  const expiredLink = await linkRef.get();
  const lobbyId = readStoredSessionId(expiredLink.data()?.lobbyId);
  const squadId = readStoredSessionId(expiredLink.data()?.squadId);
  if (lobbyId && squadId) {
    await removeGameLobbyDirectoryEntry({ gameType, lobbyId, squadId }).catch(() => undefined);
    const memberships = await activeGameLobbyMemberships().where('lobbyId', '==', lobbyId).get();
    if (!memberships.empty) {
      const batch = admin.firestore().batch();
      memberships.docs.forEach((membership) => batch.delete(membership.ref));
      await batch.commit();
    }
  }
}

async function assertHostOwnsCanonicalSession(
  uid: string,
  gameType: GameJoinCodeType,
  sessionId: string,
  allowFinished = false,
) {
  if (gameType === 'triviaBlitz') {
    const [parent, game] = await Promise.all([
      admin.firestore().collection('sessions').doc(sessionId).get(),
      admin.firestore().collection('sessions').doc(sessionId).collection('games').doc('triviaBlitz').get(),
    ]);
    if (!parent.exists || !game.exists || parent.data()?.hostPlayerId !== uid) {
      throw safeError('permission-denied', 'not_authorized');
    }
    if (readTimestampMillis(parent.data()?.expiresAt) <= Date.now()) {
      throw safeError('failed-precondition', 'invalid_or_expired_code');
    }
    if (!allowFinished && parent.data()?.status !== 'lobby') {
      throw safeError('failed-precondition', 'game_already_started');
    }
    return;
  }
  const snapshot = await admin.database().ref(`/gameSessions/${sessionId}`).once('value');
  const session = snapshot.val() as Record<string, unknown> | null;
  if (!session || session.hostUserId !== uid || session.gameType !== legacyRealtimeGameType(gameType)) {
    throw safeError('permission-denied', 'not_authorized');
  }
  if (Array.isArray(readRecord(session.gameState).bombSteps)) {
    throw safeError('failed-precondition', 'invalid_or_expired_code');
  }
  if (readPositiveNumber(session.expiresAt) == null || Number(session.expiresAt) <= Date.now()) {
    throw safeError('failed-precondition', 'invalid_or_expired_code');
  }
  if (!allowFinished && session.status !== 'lobby') {
    throw safeError('failed-precondition', 'game_already_started');
  }
}

async function assertParticipant(uid: string, gameType: GameJoinCodeType, sessionId: string) {
  if (gameType === 'triviaBlitz') {
    const parent = await admin.firestore().collection('sessions').doc(sessionId).get();
    const participantIds = readStringArray(parent.data()?.playerIds);
    if (!parent.exists || (parent.data()?.hostPlayerId !== uid && !participantIds.includes(uid))) {
      throw safeError('permission-denied', 'not_authorized');
    }
    if (readTimestampMillis(parent.data()?.expiresAt) <= Date.now()) {
      throw safeError('failed-precondition', 'invalid_or_expired_code');
    }
    return;
  }
  const snapshot = await admin.database().ref(`/gameSessions/${sessionId}`).once('value');
  if (!snapshot.exists() || !snapshot.child(`players/${uid}`).exists()) {
    throw safeError('permission-denied', 'not_authorized');
  }
  const expiresAt = snapshot.child('expiresAt').val();
  if (typeof expiresAt !== 'number' || expiresAt <= Date.now()) {
    throw safeError('failed-precondition', 'invalid_or_expired_code');
  }
}

async function joinRealtimeSession(input: {
  uid: string;
  sessionId: string;
  displayName: string;
  gameType: Exclude<GameJoinCodeType, 'triviaBlitz'>;
  mappingStatus: unknown;
  expectedLobbyId?: string;
  expectedSquadId?: string;
}): Promise<'joined' | 'reconnected'> {
  let reason: string | null = null;
  let participantState: 'joined' | 'reconnected' = 'joined';
  const reference = admin.database().ref(`/gameSessions/${input.sessionId}`);
  const initialSnapshot = await reference.once('value');
  if (!initialSnapshot.exists()) throw safeError('not-found', 'invalid_or_expired_code');
  const initialSession = initialSnapshot.val();
  if (Array.isArray(initialSession?.gameState?.bombSteps)) {
    throw safeError('not-found', 'invalid_or_expired_code');
  }
  const initialState = resolveRealtimeJoinState(
    initialSession,
    input.mappingStatus,
    input.uid,
    Date.now(),
  );
  if (initialState.isExpired) {
    await expireRealtimeGameSession(input.gameType, input.sessionId, Date.now());
    throw safeError('not-found', 'invalid_or_expired_code');
  }
  let mayUseInitialCacheFallback = true;
  let expiredDuringJoin = false;
  const result = await reference.transaction((cachedSession) => {
    const session = cachedSession ?? (mayUseInitialCacheFallback ? initialSession : null);
    mayUseInitialCacheFallback = false;
    if (
      !session ||
      session.gameType !== legacyRealtimeGameType(input.gameType) ||
      (input.expectedLobbyId && session.lobbyId !== input.expectedLobbyId) ||
      (input.expectedSquadId && session.squadId !== input.expectedSquadId)
    ) {
      reason = 'invalid_or_expired_code';
      return;
    }
    const players = session.players && typeof session.players === 'object' ? session.players : {};
    const existing = Boolean(players[input.uid]);
    const state = resolveRealtimeJoinState(session, input.mappingStatus, input.uid, Date.now());
    if (!state.isJoinable) {
      expiredDuringJoin = state.isExpired;
      reason = state.reason === 'full'
        ? 'game_full'
        : state.reason === 'playing'
          ? 'game_already_started'
          : 'invalid_or_expired_code';
      return;
    }
    if (existing) {
      participantState = 'reconnected';
      players[input.uid] = { ...players[input.uid], isConnected: true };
      return { ...session, players, updatedAt: Date.now() };
    }
    const maxPlayers = Number.isInteger(session.maxPlayers) ? session.maxPlayers : 12;
    if (Object.keys(players).length >= maxPlayers) {
      reason = 'game_full';
      return;
    }
    const serverNowMs = Date.now();
    const joinOrder = readNextSpotJoinOrder(session.nextJoinOrder, players);
    players[input.uid] = {
      displayName: input.displayName,
      avatarUrl: null,
      isReady: false,
      joinOrder,
      teamId: input.gameType === 'spotTheDifferences'
        ? teamForSpotJoinOrder(joinOrder)
        : null,
      teamAssignmentVersion: input.gameType === 'spotTheDifferences'
        ? readPositiveNumber(session.gameState?.teamAssignmentVersion) ?? 1
        : null,
      score: 0,
      isConnected: true,
    };
    if (input.gameType !== 'spotTheDifferences') {
      return { ...session, players, nextJoinOrder: joinOrder + 1, updatedAt: serverNowMs };
    }
    const rebalanced = rebalanceSpotLobbyPlayers(players, serverNowMs);
    return {
      ...session,
      players: rebalanced.players,
      nextJoinOrder: joinOrder + 1,
      gameState: {
        ...session.gameState,
        teamAssignmentVersion: rebalanced.assignmentVersion,
      },
      updatedAt: serverNowMs,
    };
  });
  if (!result.committed) {
    if (expiredDuringJoin) {
      await expireRealtimeGameSession(input.gameType, input.sessionId, Date.now());
    }
    functions.logger.warn('game_join_realtime_transaction_aborted', {
      reason: reason ?? 'transaction_not_committed',
      mappingStatus: input.mappingStatus,
      gameType: input.gameType,
    });
    throw safeError('failed-precondition', reason ?? 'invalid_or_expired_code');
  }
  return participantState;
}

async function joinTriviaSession(input: {
  uid: string;
  sessionId: string;
  displayName: string;
  mappingStatus: unknown;
  expectedLobbyId?: string;
  expectedSquadId?: string;
}): Promise<'joined' | 'reconnected'> {
  const firestore = admin.firestore();
  const parentRef = firestore.collection('sessions').doc(input.sessionId);
  const gameRef = parentRef.collection('games').doc('triviaBlitz');
  const playerRef = gameRef.collection('players').doc(input.uid);
  return withFirestoreContentionRetry('joinTriviaSession', () =>
    firestore.runTransaction(async (transaction) => {
    const [parent, game, player] = await Promise.all([
      transaction.get(parentRef),
      transaction.get(gameRef),
      transaction.get(playerRef),
    ]);
    if (!parent.exists || !game.exists) throw safeError('not-found', 'invalid_or_expired_code');
    if (
      (input.expectedLobbyId && parent.data()?.lobbyId !== input.expectedLobbyId) ||
      (input.expectedSquadId && parent.data()?.squadId !== input.expectedSquadId)
    ) throw safeError('permission-denied', 'not_authorized');
    if (readTimestampMillis(parent.data()?.expiresAt) <= Date.now()) {
      throw safeError('not-found', 'invalid_or_expired_code');
    }
    const participantIds = readStringArray(parent.data()?.playerIds);
    const existing = player.exists || parent.data()?.hostPlayerId === input.uid || participantIds.includes(input.uid);
    const parentStatus = parent.data()?.status;
    const gameStatus = game.data()?.status;
    if (existing) {
      const canReconnect =
        (input.mappingStatus === 'lobby' && parentStatus === 'lobby' && gameStatus === 'lobby') ||
        (input.mappingStatus === 'started' && parentStatus === 'playing' && gameStatus === 'playing');
      if (!canReconnect) throw safeError('failed-precondition', 'game_already_started');
      return 'reconnected' as const;
    }
    if (input.mappingStatus !== 'lobby' || parent.data()?.status !== 'lobby' || game.data()?.status !== 'lobby') {
      throw safeError('failed-precondition', 'game_already_started');
    }
    if (participantIds.length >= 20) throw safeError('resource-exhausted', 'game_full');
    transaction.update(parentRef, {
      playerIds: FieldValue.arrayUnion(input.uid),
      updatedAt: Timestamp.now(),
    });
    transaction.create(playerRef, {
      name: input.displayName,
      playerIndex: participantIds.length,
      joinOrder: participantIds.length + 1,
      score: 0,
      ready: false,
      createdAt: Timestamp.now(),
    });
    transaction.update(gameRef, {
      totalPlayers: FieldValue.increment(1),
      allReady: false,
      updatedAt: Timestamp.now(),
    });
      return 'joined' as const;
    }),
  );
}

async function setJoinCodeStatus(
  gameType: GameJoinCodeType,
  sessionId: string,
  uid: string,
  status: Exclude<GameJoinCodeStatus, 'lobby' | 'expired'>,
) {
  const linkRef = sessionLinks().doc(hashIdentifier(`${gameType}:${sessionId}`));
  await admin.firestore().runTransaction(async (transaction) => {
    const link = await transaction.get(linkRef);
    const code = normalizeGameJoinCode(link.data()?.code);
    if (!link.exists || link.data()?.hostUserId !== uid || !code) {
      throw safeError('permission-denied', 'not_authorized');
    }
    const codeRef = registry().doc(code);
    const mapping = await transaction.get(codeRef);
    if (!mapping.exists || mapping.data()?.sessionId !== sessionId || mapping.data()?.gameType !== gameType) {
      throw safeError('not-found', 'invalid_or_expired_code');
    }
    const linkStatus = readStoredLifecycleStatus(link.data()?.status);
    const mappingStatus = readStoredLifecycleStatus(mapping.data()?.status);
    if (
      !linkStatus ||
      !mappingStatus ||
      linkStatus !== mappingStatus ||
      readTimestampMillis(link.data()?.expiresAt) <= Date.now() ||
      readTimestampMillis(mapping.data()?.expiresAt) <= Date.now() ||
      !canTransitionGameJoinCodeStatus(mappingStatus, status)
    ) {
      throw safeError('failed-precondition', 'invalid_lifecycle_transition');
    }
    if (mappingStatus === status) return;
    transaction.update(codeRef, { status, updatedAt: Timestamp.now() });
    transaction.update(linkRef, { status, updatedAt: Timestamp.now() });
  });
}

async function assertCanonicalSessionCanStart(
  gameType: GameJoinCodeType,
  sessionId: string,
) {
  if (gameType === 'triviaBlitz') {
    const [parent, game] = await Promise.all([
      admin.firestore().collection('sessions').doc(sessionId).get(),
      admin.firestore().collection('sessions').doc(sessionId).collection('games').doc('triviaBlitz').get(),
    ]);
    const parentStatus = parent.data()?.status;
    const gameStatus = game.data()?.status;
    if (
      !parent.exists ||
      !game.exists ||
      readTimestampMillis(parent.data()?.expiresAt) <= Date.now() ||
      parentStatus !== gameStatus ||
      parentStatus !== 'playing'
    ) {
      throw safeError('failed-precondition', 'game_already_started');
    }
    return;
  }

  const snapshot = await admin.database().ref(`/gameSessions/${sessionId}`).once('value');
  const session = readRecord(snapshot.val());
  const gameState = readRecord(session.gameState);
  if (
    !snapshot.exists() ||
    readPositiveNumber(session.expiresAt) == null ||
    Number(session.expiresAt) <= Date.now() ||
    Array.isArray(gameState.bombSteps) ||
    (session.status !== 'lobby' && session.status !== 'active')
  ) {
    throw safeError('failed-precondition', 'game_already_started');
  }
}

async function startRealtimeGameSession(sessionId: string) {
  let reason:
    | 'game_not_found'
    | 'game_already_started'
    | 'invalid_or_expired_code'
    | 'minimum_players_required'
    | 'participants_not_ready'
    | null = null;
  let startedNow = false;
  let startedAtMs = 0;
  const reference = admin.database().ref(`/gameSessions/${sessionId}`);
  const initialSnapshot = await reference.once('value');
  if (!initialSnapshot.exists()) {
    throw safeError('not-found', 'game_not_found');
  }
  const initialSession = initialSnapshot.val();
  let mayUseInitialCacheFallback = true;
  const result = await reference.transaction((cachedSession) => {
    const session =
      cachedSession ?? (mayUseInitialCacheFallback ? initialSession : null);
    mayUseInitialCacheFallback = false;
    if (!session || typeof session !== 'object') {
      reason = 'game_not_found';
      return;
    }
    if (typeof session.expiresAt !== 'number' || session.expiresAt <= Date.now()) {
      reason = 'invalid_or_expired_code';
      return;
    }
    const players = readRecord(session.players);
    const playerEntries = Object.values(players);
    const configuredMinimum = Number.isInteger(session.minPlayers)
      ? Number(session.minPlayers)
      : session.gameType === 'bomb_defusal' ? 2 : 4;
    if (playerEntries.length < configuredMinimum) {
      reason = 'minimum_players_required';
      return;
    }
    if (playerEntries.some((player) => readRecord(player).isReady !== true)) {
      reason = 'participants_not_ready';
      return;
    }
    if (session.status === 'active') {
      startedAtMs = typeof session.startedAt === 'number' ? session.startedAt : 0;
      return session;
    }
    if (session.status !== 'lobby') {
      reason = 'game_already_started';
      return;
    }
    const serverNowMs = Date.now();
    startedNow = true;
    startedAtMs = serverNowMs;
    const isSpotGame = session.gameType === legacyRealtimeGameType('spotTheDifferences');
    const rebalanced = isSpotGame
      ? rebalanceSpotLobbyPlayers(players, serverNowMs)
      : null;
    const frozenPlayers = rebalanced?.players ?? players;
    const teamAssignments = isSpotGame
      ? createFrozenSpotAssignments(frozenPlayers)
      : undefined;
    return {
      ...session,
      players: frozenPlayers,
      status: 'active',
      startedAt: typeof session.startedAt === 'number' ? session.startedAt : serverNowMs,
      endsAt: typeof session.endsAt === 'number'
        ? session.endsAt
        : serverNowMs + Math.max(1, readRealtimeDurationSeconds(session.gameType, session.settings) ?? 90) * 1000,
      gameState: isSpotGame
        ? {
          ...session.gameState,
          expectedDifferences: EXPECTED_SPOT_DIFFERENCES,
          teamAssignmentsFrozen: true,
          teamAssignmentVersion: rebalanced?.assignmentVersion,
          teamAssignments,
          result: readRecord(session.gameState).result ?? null,
          version: 2,
        }
        : session.gameState,
      updatedAt: serverNowMs,
    };
  });
  if (!result.committed) {
    throw safeError(
      reason === 'game_not_found' ? 'not-found' : 'failed-precondition',
      reason ?? 'game_already_started',
    );
  }
  return { startedNow, startedAtMs };
}

async function isGameJoinCodeStatusStarted(
  gameType: Exclude<GameJoinCodeType, 'triviaBlitz'>,
  sessionId: string,
) {
  const link = await sessionLinks().doc(hashIdentifier(`${gameType}:${sessionId}`)).get();
  const code = normalizeGameJoinCode(link.data()?.code);
  if (
    !link.exists ||
    !code ||
    link.data()?.gameType !== gameType ||
    link.data()?.sessionId !== sessionId ||
    link.data()?.status !== 'started'
  ) {
    return false;
  }
  const mapping = await registry().doc(code).get();
  return (
    mapping.exists &&
    mapping.data()?.gameType === gameType &&
    mapping.data()?.sessionId === sessionId &&
    mapping.data()?.status === 'started'
  );
}

async function rollbackRealtimeGameSessionStart(
  sessionId: string,
  startedAtMs: number,
) {
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) return;
  await admin.database().ref(`/gameSessions/${sessionId}`).transaction((session) => {
    if (
      !session ||
      session.status !== 'active' ||
      session.startedAt !== startedAtMs ||
      session.updatedAt !== startedAtMs
    ) {
      return session;
    }
    return {
      ...session,
      status: 'lobby',
      startedAt: null,
      updatedAt: Date.now(),
    };
  });
}

async function markGameJoinCodeEndedFromServer(
  gameType: GameJoinCodeType,
  sessionId: string,
) {
  const linkRef = sessionLinks().doc(hashIdentifier(`${gameType}:${sessionId}`));
  try {
    await admin.firestore().runTransaction(async (transaction) => {
      const link = await transaction.get(linkRef);
      const code = normalizeGameJoinCode(link.data()?.code);
      if (!link.exists || link.data()?.sessionId !== sessionId || link.data()?.gameType !== gameType || !code) {
        return;
      }
      const mappingRef = registry().doc(code);
      const mapping = await transaction.get(mappingRef);
      if (!mapping.exists || mapping.data()?.sessionId !== sessionId || mapping.data()?.gameType !== gameType) {
        return;
      }
      const linkStatus = readStoredLifecycleStatus(link.data()?.status);
      const mappingStatus = readStoredLifecycleStatus(mapping.data()?.status);
      if (linkStatus === 'ended' && mappingStatus === 'ended') return;
      if (
        (linkStatus !== 'lobby' && linkStatus !== 'started') ||
        (mappingStatus !== 'lobby' && mappingStatus !== 'started')
      ) {
        return;
      }
      const updatedAt = Timestamp.now();
      transaction.update(linkRef, { status: 'ended', updatedAt });
      transaction.update(mappingRef, { status: 'ended', updatedAt });
    });
  } catch (error) {
    firebaseFunctions.logger.warn('game_join_terminal_mapping_update_failed', {
      gameType,
      errorCode: readErrorCode(error),
    });
  }
  await setGameLobbyLifecycleForSession(gameType, sessionId, 'waitingForRematch').catch(() => undefined);
}

async function assertPlayersReadyForStart(
  gameType: GameJoinCodeType,
  sessionId: string,
) {
  if (gameType === 'triviaBlitz') {
    const players = await admin.firestore()
      .collection('sessions')
      .doc(sessionId)
      .collection('games')
      .doc('triviaBlitz')
      .collection('players')
      .get();
    if (players.size < TRIVIA_MIN_PLAYERS) {
      throw safeError('failed-precondition', 'minimum_players_required');
    }
    if (players.docs.some((player) => player.data().ready !== true)) {
      throw safeError('failed-precondition', 'participants_not_ready');
    }
    return;
  }

  const snapshot = await admin.database().ref(`/gameSessions/${sessionId}`).once('value');
  const session = readRecord(snapshot.val());
  const players = readRecord(session.players);
  const entries = Object.values(players);
  const configuredMinimum = Number.isInteger(session.minPlayers)
    ? Number(session.minPlayers)
    : gameType === 'bombDefusal' ? 2 : 4;
  if (entries.length < configuredMinimum) {
    throw safeError('failed-precondition', 'minimum_players_required');
  }
  if (entries.some((player) => readRecord(player).isReady !== true)) {
    throw safeError('failed-precondition', 'participants_not_ready');
  }
}

function canTransitionGameJoinCodeStatus(
  current: GameJoinCodeStatus,
  next: Exclude<GameJoinCodeStatus, 'lobby' | 'expired'>,
) {
  if (current === next) return true;
  if (current === 'lobby') return next === 'started' || next === 'canceled';
  if (current === 'started') return next === 'ended' || next === 'canceled';
  return false;
}

function readStoredLifecycleStatus(value: unknown): GameJoinCodeStatus | null {
  return ['lobby', 'started', 'ended', 'canceled', 'expired'].includes(String(value))
    ? value as GameJoinCodeStatus
    : null;
}

async function consumeJoinAttempt(uid: string) {
  const reference = rateLimits().doc(hashIdentifier(uid));
  const now = Date.now();
  await admin.firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data();
    const blockedUntil = readTimestampMillis(data?.blockedUntil);
    if (blockedUntil > now) throw safeError('resource-exhausted', 'rate_limited');
    const windowStartedAt = readTimestampMillis(data?.windowStartedAt);
    const withinWindow = windowStartedAt > 0 && now - windowStartedAt < JOIN_ATTEMPT_WINDOW_MS;
    const attemptCount = withinWindow ? Number(data?.attemptCount ?? 0) + 1 : 1;
    if (attemptCount > JOIN_ATTEMPT_LIMIT) {
      transaction.set(reference, {
        attemptCount,
        windowStartedAt: withinWindow ? data?.windowStartedAt : Timestamp.fromMillis(now),
        blockedUntil: Timestamp.fromMillis(now + JOIN_RATE_LIMIT_MS),
        updatedAt: Timestamp.fromMillis(now),
      });
      return;
    }
    transaction.set(reference, {
      attemptCount,
      windowStartedAt: withinWindow ? data?.windowStartedAt : Timestamp.fromMillis(now),
      blockedUntil: null,
      updatedAt: Timestamp.fromMillis(now),
    });
  });
  const after = await reference.get();
  if (readTimestampMillis(after.data()?.blockedUntil) > now) {
    throw safeError('resource-exhausted', 'rate_limited');
  }
}

async function consumeLobbyCreateAttempt(uid: string) {
  const reference = gameLobbyCreationRateLimits().doc(hashIdentifier(uid));
  const now = Date.now();
  await admin.firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data();
    const blockedUntil = readTimestampMillis(data?.blockedUntil);
    if (blockedUntil > now) throw safeError('resource-exhausted', 'rate_limited');
    const windowStartedAt = readTimestampMillis(data?.windowStartedAt);
    const withinWindow = windowStartedAt > 0 && now - windowStartedAt < LOBBY_CREATE_WINDOW_MS;
    const attemptCount = withinWindow ? Number(data?.attemptCount ?? 0) + 1 : 1;
    const nextBlockedUntil = attemptCount > LOBBY_CREATE_LIMIT
      ? Timestamp.fromMillis(now + LOBBY_CREATE_BLOCK_MS)
      : null;
    transaction.set(reference, {
      attemptCount,
      windowStartedAt: withinWindow ? data?.windowStartedAt : Timestamp.fromMillis(now),
      blockedUntil: nextBlockedUntil,
      updatedAt: Timestamp.fromMillis(now),
    });
  });
  const after = await reference.get();
  if (readTimestampMillis(after.data()?.blockedUntil) > now) {
    throw safeError('resource-exhausted', 'rate_limited');
  }
}

async function requireAuthorizedSquadId(uid: string, value: unknown) {
  const squadId = await readAuthorizedSquadId(uid, value);
  if (!squadId) throw safeError('permission-denied', 'not_authorized');
  return squadId;
}

async function readAuthorizedSquadId(uid: string, value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,360}$/.test(value.trim())) return null;
  const squadId = value.trim();
  const membership = await admin.firestore().collection('squadMemberships').doc(`${squadId}__${uid}`).get();
  return membership.exists && membership.data()?.membershipStatus === 'active' ? squadId : null;
}

function readStoredLobbyMembership(value: unknown): StoredLobbyMembership | null {
  const record = readRecord(value);
  const lobbyId = readStoredSessionId(record.lobbyId);
  const sessionId = readStoredSessionId(record.sessionId);
  const squadId = readStoredSessionId(record.squadId);
  const gameType = readGameJoinCodeType(record.gameType);
  const state = record.state === 'joining' || record.state === 'active' || record.state === 'queued'
    ? record.state
    : null;
  const expiresAtMs = readTimestampMillis(record.expiresAt);
  if (!lobbyId || !sessionId || !squadId || !gameType || !state || !expiresAtMs) return null;
  return { lobbyId, sessionId, squadId, gameType, state, expiresAtMs };
}

function readLobbyAllocation(
  value: unknown,
  requestId: string,
  hostDisplayName: string,
): LobbyAllocation | null {
  const record = readRecord(value);
  const gameType = readGameJoinCodeType(record.gameType);
  const sessionId = readStoredSessionId(record.sessionId);
  const lobbyId = readStoredSessionId(record.lobbyId);
  const squadId = readStoredSessionId(record.squadId);
  const joinCode = normalizeGameJoinCode(record.code);
  const lobbyNumber = readPositiveNumber(record.lobbyNumber);
  const expiresAt = readTimestampMillis(record.expiresAt);
  if (!gameType || !sessionId || !lobbyId || !squadId || !joinCode || !lobbyNumber || !expiresAt) {
    return null;
  }
  return {
    gameType,
    sessionId,
    lobbyId,
    squadId,
    lobbyNumber,
    participantState: 'joined',
    joinCode,
    expiresAt,
    requestId,
    hostDisplayName,
  };
}

function capacityForGameType(gameType: GameJoinCodeType) {
  if (gameType === 'bombDefusal') return 6;
  if (gameType === 'spotTheDifferences') return 12;
  return 20;
}

async function resolvePlayerDisplayName(uid: string, token?: Record<string, unknown>) {
  const profile = await admin.firestore().collection('users').doc(uid).get();
  return (resolveCanonicalPublicName(profile.data())
    ?? resolveCanonicalPublicName({ displayName: token?.name }))?.displayName
    || 'Sideline Social member';
}

export async function finalizeSpotDifferenceRoundForRewards(
  sessionId: string,
  uid: string,
): Promise<FinalizedSpotDifferenceRound> {
  const sessionReference = admin.database().ref(`/gameSessions/${sessionId}`);
  const [sessionSnapshot, teamASnapshot, teamBSnapshot] = await Promise.all([
    sessionReference.once('value'),
    admin.database().ref(`/gameSessionTeamState/${sessionId}/A`).once('value'),
    admin.database().ref(`/gameSessionTeamState/${sessionId}/B`).once('value'),
  ]);
  if (!sessionSnapshot.exists()) throw safeError('not-found', 'game_not_found');
  const session = readRecord(sessionSnapshot.val());
  const players = readRecord(session.players);
  if (session.gameType !== legacyRealtimeGameType('spotTheDifferences') || !players[uid]) {
    throw safeError('permission-denied', 'not_authorized');
  }
  const existingResult = readFinalizedSpotResult(readRecord(session.gameState).result);
  if (existingResult) return existingResult;

  const gameState = readRecord(session.gameState);
  const sceneId = typeof gameState.sceneId === 'string' ? gameState.sceneId : '';
  const scene = getCanonicalSpotScene(sceneId);
  if (
    !scene ||
    scene.differences.length !== EXPECTED_SPOT_DIFFERENCES ||
    gameState.teamAssignmentsFrozen !== true
  ) {
    throw safeError('failed-precondition', 'game_already_started');
  }

  const teamAState = readRecord(teamASnapshot.val());
  const teamBState = readRecord(teamBSnapshot.val());
  const teamTotals = {
    A: readSpotFoundIds(teamAState).length,
    B: readSpotFoundIds(teamBState).length,
  };
  const completionTimes = {
    A: readPositiveNumber(teamAState.completionAt),
    B: readPositiveNumber(teamBState.completionAt),
  };
  const settings = readRecord(session.settings);
  const durationSeconds = readPositiveNumber(settings.roundDuration) ?? 90;
  const startedAt = readPositiveNumber(session.startedAt);
  const serverNowMs = Date.now();
  const timeExpired = Boolean(startedAt && serverNowMs >= startedAt + durationSeconds * 1000);
  const hasPerfectTeam = SPOT_TEAM_IDS.some((teamId) => teamTotals[teamId] >= EXPECTED_SPOT_DIFFERENCES);
  if (!hasPerfectTeam && !timeExpired && session.status !== 'completed') {
    throw safeError('failed-precondition', 'game_already_started');
  }

  const teamByPlayerId = readFrozenSpotTeamAssignments(gameState.teamAssignments);
  if (!teamByPlayerId[uid]) throw safeError('permission-denied', 'not_authorized');
  const resolved = resolveSpotRoundResult({
    teamTotals,
    completionTimes,
    totalDifferences: EXPECTED_SPOT_DIFFERENCES,
  });
  const finalized: FinalizedSpotDifferenceRound = {
    ...resolved,
    resolvedAt: serverNowMs,
    teamByPlayerId,
  };

  let transactionResult: FinalizedSpotDifferenceRound | null = finalized;
  const result = await sessionReference.transaction((cachedSession) => {
    const current = readRecord(cachedSession ?? session);
    const currentGameState = readRecord(current.gameState);
    const currentExisting = readFinalizedSpotResult(currentGameState.result);
    if (currentExisting) {
      transactionResult = currentExisting;
      return cachedSession;
    }
    if (
      current.gameType !== legacyRealtimeGameType('spotTheDifferences') ||
      currentGameState.teamAssignmentsFrozen !== true ||
      !readRecord(current.players)[uid]
    ) {
      transactionResult = null;
      return;
    }
    return {
      ...current,
      status: 'completed',
      completedAt: readPositiveNumber(current.completedAt) ?? serverNowMs,
      gameState: {
        ...currentGameState,
        result: finalized,
      },
      updatedAt: serverNowMs,
    };
  });
  if (!result.committed || !transactionResult) {
    throw safeError('failed-precondition', 'game_already_started');
  }
  await markGameJoinCodeEndedFromServer('spotTheDifferences', sessionId);
  return transactionResult;
}

function createEmptySpotTeamState(teamId: SpotTeamId, expiresAt: number) {
  return {
    teamId,
    foundDifferenceIds: [],
    foundCount: 0,
    latestDiscovery: null,
    discoveredBy: {},
    completionAt: null,
    expiresAt,
    updatedAt: Date.now(),
  };
}

function readSpotTapPoint(data: unknown) {
  const record = readRecord(data);
  const x = typeof record.x === 'number' ? record.x : Number.NaN;
  const y = typeof record.y === 'number' ? record.y : Number.NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    throw safeError('invalid-argument', 'not_authorized');
  }
  return { x, y };
}

function readSpotFoundIds(value: unknown) {
  const record = readRecord(value);
  return readStringArray(record.foundDifferenceIds)
    .filter((differenceId) => /^difference_(?:0[1-9]|10)$/.test(differenceId))
    .slice(0, EXPECTED_SPOT_DIFFERENCES);
}

function readNextSpotJoinOrder(value: unknown, players: Record<string, unknown>) {
  const stored = readPositiveNumber(value);
  const nextFromPlayers = Object.values(players).reduce<number>((maximum, playerValue) => {
    const joinOrder = readPositiveNumber(readRecord(playerValue).joinOrder);
    return joinOrder == null ? maximum : Math.max(maximum, joinOrder + 1);
  }, 1);
  return Math.max(stored ?? 1, nextFromPlayers);
}

function rebalanceSpotLobbyPlayers(playersValue: Record<string, unknown>, nowMs: number) {
  const players = Object.fromEntries(
    Object.entries(playersValue).map(([uid, value]) => [uid, { ...readRecord(value) }]),
  );
  const entries = Object.entries(players)
    .filter(([, player]) => readPositiveNumber(player.leftAt) == null)
    .sort(([leftId, left], [rightId, right]) => {
      const leftOrder = readPositiveNumber(left.joinOrder) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = readPositiveNumber(right.joinOrder) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return leftId.localeCompare(rightId);
    });

  const currentVersion = entries.reduce((maximum, [, player]) => {
    const version = readPositiveNumber(player.teamAssignmentVersion);
    return version == null ? maximum : Math.max(maximum, version);
  }, 1);
  let changed = false;
  const assignments = entries.map(([uid, player], index) => {
    const nextTeamId = teamForSpotJoinIndex(index);
    const previousTeamId = normalizeSpotTeamId(player.teamId);
    if (previousTeamId !== nextTeamId) changed = true;
    return { uid, nextTeamId, previousTeamId };
  });
  const assignmentVersion = changed ? currentVersion + 1 : currentVersion;
  assignments.forEach(({ uid, nextTeamId, previousTeamId }) => {
    const player = players[uid];
    players[uid] = {
      ...player,
      teamId: nextTeamId,
      teamAssignmentVersion: assignmentVersion,
      ...(previousTeamId && previousTeamId !== nextTeamId
        ? {
          previousTeamId,
          teamReassignedAt: nowMs,
          teamAssignmentNoticeId: `${assignmentVersion}:${nextTeamId}`,
        }
        : {}),
    };
  });
  return { players, assignmentVersion };
}

function createFrozenSpotAssignments(playersValue: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(playersValue).flatMap(([uid, playerValue]) => {
      const player = readRecord(playerValue);
      const teamId = normalizeSpotTeamId(player.teamId);
      const joinOrder = readPositiveNumber(player.joinOrder);
      return teamId && joinOrder != null
        ? [[uid, { teamId, joinOrder }]]
        : [];
    }),
  );
}

function readFrozenSpotTeamAssignments(value: unknown) {
  const assignments = readRecord(value);
  return Object.fromEntries(
    Object.entries(assignments).flatMap(([uid, assignmentValue]) => {
      const teamId = normalizeSpotTeamId(assignmentValue) ??
        normalizeSpotTeamId(readRecord(assignmentValue).teamId);
      return teamId ? [[uid, teamId]] : [];
    }),
  ) as Record<string, SpotTeamId>;
}

function readFinalizedSpotResult(value: unknown): FinalizedSpotDifferenceRound | null {
  const result = readRecord(value);
  const outcome = result.outcome === 'teamWin' || result.outcome === 'tie'
    ? result.outcome
    : null;
  const winnerTeamId = result.winnerTeamId == null ? null : normalizeSpotTeamId(result.winnerTeamId);
  const completedByTeamId = result.completedByTeamId == null ? null : normalizeSpotTeamId(result.completedByTeamId);
  const teamTotalsRecord = readRecord(result.teamTotals);
  const teamByPlayerId = readFrozenSpotTeamAssignments(result.teamByPlayerId);
  const perfectTeamIds = readStringArray(result.perfectTeamIds).filter(isSpotTeamId);
  const resolvedAt = readPositiveNumber(result.resolvedAt);
  if (
    !outcome ||
    (outcome === 'teamWin' && !winnerTeamId) ||
    (outcome === 'tie' && winnerTeamId !== null) ||
    resolvedAt == null ||
    Object.keys(teamByPlayerId).length === 0
  ) return null;
  return {
    outcome,
    winnerTeamId,
    completedByTeamId,
    teamTotals: {
      A: Math.min(EXPECTED_SPOT_DIFFERENCES, Math.max(0, Number(teamTotalsRecord.A ?? 0))),
      B: Math.min(EXPECTED_SPOT_DIFFERENCES, Math.max(0, Number(teamTotalsRecord.B ?? 0))),
    },
    perfectTeamIds,
    totalDifferences: EXPECTED_SPOT_DIFFERENCES,
    resolvedAt,
    teamByPlayerId,
  };
}

function createBombPattern() {
  const steps: Array<Record<string, string | number>> = [
    { type: 'cut_wire', color: ['red', 'blue', 'yellow', 'green'][randomInt(4)] },
    { type: 'press_button', label: ['A', 'B', 'C', 'D'][randomInt(4)] },
    { type: 'rotate_dial', target: randomInt(1, 11) },
    { type: 'enter_code', code: randomInt(100, 1000) },
    { type: 'cut_wire', color: ['red', 'blue', 'yellow', 'green'][randomInt(4)] },
  ];
  for (let index = steps.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [steps[index], steps[swapIndex]] = [steps[swapIndex], steps[index]];
  }
  return steps;
}

function readBombAction(value: unknown): Record<string, string | number> {
  const action = readRecord(value);
  const keys = Object.keys(action);
  if (keys.length !== 1) throw safeError('invalid-argument', 'not_authorized');
  if (
    keys[0] === 'color' &&
    typeof action.color === 'string' &&
    ['red', 'blue', 'yellow', 'green'].includes(action.color)
  ) {
    return { color: action.color };
  }
  if (
    keys[0] === 'label' &&
    typeof action.label === 'string' &&
    ['A', 'B', 'C', 'D'].includes(action.label)
  ) {
    return { label: action.label };
  }
  if (
    keys[0] === 'target' &&
    Number.isInteger(action.target) &&
    Number(action.target) >= 1 &&
    Number(action.target) <= 10
  ) {
    return { target: Number(action.target) };
  }
  if (
    keys[0] === 'code' &&
    Number.isInteger(action.code) &&
    Number(action.code) >= 100 &&
    Number(action.code) <= 999
  ) {
    return { code: Number(action.code) };
  }
  throw safeError('invalid-argument', 'not_authorized');
}

function bombActionMatches(
  stepValue: unknown,
  action: Record<string, string | number>,
) {
  const step = readRecord(stepValue);
  if (step.type === 'cut_wire') return action.color === step.color;
  if (step.type === 'press_button') return action.label === step.label;
  if (step.type === 'rotate_dial') return action.target === step.target;
  if (step.type === 'enter_code') return action.code === step.code;
  return false;
}

function isSafeBombStep(value: unknown): value is BombStepRecord {
  const step = readRecord(value);
  if (step.type === 'cut_wire') {
    return typeof step.color === 'string' && ['red', 'blue', 'yellow', 'green'].includes(step.color);
  }
  if (step.type === 'press_button') {
    return typeof step.label === 'string' && ['A', 'B', 'C', 'D'].includes(step.label);
  }
  if (step.type === 'rotate_dial') {
    return Number.isInteger(step.target) && Number(step.target) >= 1 && Number(step.target) <= 10;
  }
  if (step.type === 'enter_code') {
    return Number.isInteger(step.code) && Number(step.code) >= 100 && Number(step.code) <= 999;
  }
  return false;
}

function readBombSubmissionResult(
  sessionValue: unknown,
  submissionKey: string,
  uid: string,
  stepIndex: number,
  actionHash: string,
): {
  correct: boolean;
  nextStepIndex: number;
  outcome: 'playing' | 'defused' | 'exploded';
  nextStep: BombStepRecord | null;
} | null {
  const session = readRecord(sessionValue);
  const gameState = readRecord(session.gameState);
  const processed = readRecord(gameState.processedSubmissions);
  const stored = readRecord(processed[submissionKey]);
  if (Object.keys(stored).length === 0) return null;
  if (
    stored.playerId !== uid ||
    stored.stepIndex !== stepIndex ||
    stored.actionHash !== actionHash
  ) {
    throw safeError('already-exists', 'not_authorized');
  }
  const result = readRecord(stored.result);
  const outcome = result.outcome;
  const nextStep = result.nextStep;
  if (
    typeof result.correct !== 'boolean' ||
    !Number.isInteger(result.nextStepIndex) ||
    (outcome !== 'playing' && outcome !== 'defused' && outcome !== 'exploded') ||
    nextStep === undefined ||
    (nextStep !== null && !isSafeBombStep(nextStep))
  ) {
    throw safeError('internal', 'not_authorized');
  }
  return {
    correct: result.correct,
    nextStepIndex: result.nextStepIndex as number,
    outcome,
    nextStep: nextStep as BombStepRecord | null,
  };
}

function requireUid(context: firebaseFunctions.https.CallableContext) {
  const uid = context.auth?.uid;
  if (!uid) throw safeError('unauthenticated', 'not_authorized');
  return uid;
}

function requireGameType(value: unknown) {
  const gameType = readGameJoinCodeType(value);
  if (!gameType) throw safeError('invalid-argument', 'not_authorized');
  return gameType;
}

function readIdempotencyKey(value: unknown) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(key)) throw safeError('invalid-argument', 'session_creation_failed');
  return key;
}

function readSessionId(value: unknown) {
  const sessionId = readStoredSessionId(value);
  if (!sessionId) throw safeError('invalid-argument', 'game_not_found');
  return sessionId;
}

function readLobbyId(value: unknown) {
  const lobbyId = typeof value === 'string' ? value.trim() : '';
  if (!/^lobby_[A-Za-z0-9_-]{8,200}$/.test(lobbyId)) {
    throw safeError('invalid-argument', 'lobby_closed_or_expired');
  }
  return lobbyId;
}

function readStoredSessionId(value: unknown) {
  const sessionId = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{4,200}$/.test(sessionId) ? sessionId : null;
}

function readLifecycleStatus(value: unknown): 'started' | 'ended' | 'canceled' {
  if (value === 'started' || value === 'ended' || value === 'canceled') return value;
  throw safeError('invalid-argument', 'not_authorized');
}

function isUsableRegistry(data: FirebaseFirestore.DocumentData | undefined, now: number) {
  return Boolean(
    data &&
    (data.status === 'lobby' || data.status === 'started') &&
    readTimestampMillis(data.expiresAt) > now,
  );
}

function isResolvableRegistry(data: FirebaseFirestore.DocumentData | undefined, now: number) {
  return isUsableRegistry(data, now);
}

function isRegistryForSession(
  data: FirebaseFirestore.DocumentData | undefined,
  expected: { gameType: GameJoinCodeType; sessionId: string; hostUserId?: string },
  now: number,
) {
  return Boolean(
    isUsableRegistry(data, now) &&
    data?.gameType === expected.gameType &&
    data?.sessionId === expected.sessionId &&
    (expected.hostUserId == null || data?.hostUserId === expected.hostUserId),
  );
}

function readTimestampMillis(value: unknown) {
  return value instanceof Timestamp ? value.toMillis() : 0;
}

function readRealtimeDurationSeconds(
  gameType: 'bomb_defusal' | 'spot_difference',
  settingsValue: unknown,
) {
  const settings = readRecord(settingsValue);
  return readPositiveNumber(
    gameType === 'bomb_defusal' ? settings.timerSeconds : settings.roundDuration,
  );
}

function readPositiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function earliestPositiveNumber(...values: Array<number | null>) {
  const valid = values.filter((value): value is number => value != null);
  return valid.length ? Math.min(...valid) : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function hashIdentifier(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function readErrorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : 'unknown';
}

function safeError(code: firebaseFunctions.https.FunctionsErrorCode, reason: string) {
  const message = reason === 'game_already_started'
    ? 'This game has already started.'
    : reason === 'game_full'
      ? 'This game is full.'
      : reason === 'minimum_players_required'
        ? 'More players must join before this game can start.'
      : reason === 'rate_limited'
        ? 'Please wait before trying another game code.'
        : reason === 'code_reservation_failed'
          ? 'We could not create a game code. Please try again.'
          : reason === 'invalid_code_format'
            ? 'Enter a four-character game code.'
            : 'That game code is invalid or no longer available.';
  return new functions.https.HttpsError(code, message, { reason });
}
