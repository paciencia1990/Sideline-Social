import { createHash, randomBytes, randomInt } from 'node:crypto';

import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions';

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

const JOIN_CODE_TTL_MS = 2 * 60 * 60 * 1000;
const JOIN_ATTEMPT_WINDOW_MS = 60 * 1000;
const JOIN_ATTEMPT_LIMIT = 12;
const JOIN_RATE_LIMIT_MS = 5 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 200;

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

type ActiveSquadGameSession = {
  sessionId: string;
  gameType: 'bomb_defusal' | 'spot_difference';
  status: 'lobby' | 'countdown' | 'active';
};

export const createGameJoinCode = functions.https.onCall(async (data, context): Promise<ReservationResult> => {
  const uid = requireUid(context);
  const gameType = requireGameType(data?.gameType);
  const idempotencyKey = readIdempotencyKey(data?.idempotencyKey);
  const requestedSessionId = data?.sessionId == null ? null : readSessionId(data.sessionId);
  const sourceSquadId = await readAuthorizedSquadId(uid, data?.squadId);
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
      await admin.database().ref(`/gameSessions/${sessionId}`).remove().catch(() => undefined);
    }
    if (error instanceof GameJoinCodeReservationError) {
      throw safeError('resource-exhausted', 'code_reservation_failed');
    }
    throw error;
  }
});

export const resolveAndJoinGameByCode = functions.https.onCall(async (data, context): Promise<JoinResult> => {
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
  if (!gameType || !sessionId) throw safeError('not-found', 'invalid_or_expired_code');
  const displayName = await resolvePlayerDisplayName(uid, context.auth?.token);

  try {
    const participantState = gameType === 'triviaBlitz'
      ? await joinTriviaSession({ uid, sessionId, displayName, mappingStatus: mapping?.status })
      : await joinRealtimeSession({ uid, sessionId, displayName, gameType, mappingStatus: mapping?.status });
    return { gameType, sessionId, participantState };
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
  return {
    joinCode: code,
    status: mappingSnapshot.data()?.status as GameJoinCodeStatus,
    expiresAt: readTimestampMillis(mappingSnapshot.data()?.expiresAt),
  };
});

export const getActiveSquadGameSession = functions.https.onCall(async (data, context): Promise<{
  session: ActiveSquadGameSession | null;
}> => {
  const uid = requireUid(context);
  const requestedSquadId = typeof data?.squadId === 'string' ? data.squadId.trim() : '';
  const squadId = await readAuthorizedSquadId(uid, requestedSquadId);
  if (!squadId) throw safeError('permission-denied', 'not_authorized');

  const snapshot = await admin.database()
    .ref('/gameSessions')
    .orderByChild('squadId')
    .equalTo(squadId)
    .once('value');
  const rawSessions = snapshot.val();
  if (!rawSessions || typeof rawSessions !== 'object' || Array.isArray(rawSessions)) return { session: null };

  const candidates = Object.entries(rawSessions as Record<string, unknown>)
    .flatMap(([documentId, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const session = value as Record<string, unknown>;
      const gameType = session.gameType;
      const status = session.status;
      if (gameType !== 'bomb_defusal' && gameType !== 'spot_difference') return [];
      if (status !== 'lobby' && status !== 'countdown' && status !== 'active') return [];
      const sessionId = typeof session.sessionId === 'string' && session.sessionId.trim()
        ? session.sessionId.trim()
        : documentId;
      const createdAt = typeof session.createdAt === 'number' && Number.isFinite(session.createdAt)
        ? session.createdAt
        : 0;
      const candidate: ActiveSquadGameSession & { createdAt: number } = {
        sessionId,
        gameType,
        status,
        createdAt,
      };
      return [candidate];
    })
    .sort((left, right) => right.createdAt - left.createdAt);
  const active = candidates[0];
  return {
    session: active
      ? { sessionId: active.sessionId, gameType: active.gameType, status: active.status }
      : null,
  };
});

export const updateGameJoinCodeStatus = functions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const gameType = requireGameType(data?.gameType);
  const sessionId = readSessionId(data?.sessionId);
  const status = readLifecycleStatus(data?.status);
  await assertHostOwnsCanonicalSession(uid, gameType, sessionId, true);
  await setJoinCodeStatus(gameType, sessionId, uid, status);
  if (gameType !== 'triviaBlitz' && status !== 'started') {
    await admin.database().ref(`/gameSessions/${sessionId}`).update({
      status: status === 'ended' ? 'completed' : 'failed',
      completedAt: Date.now(),
    });
  }
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
    await Promise.all([
      parentRef.set({ status: 'results', updatedAt: Timestamp.now() }, { merge: true }),
      parentRef.collection('games').doc('triviaBlitz').set(
        { status: 'results', updatedAt: Timestamp.now() },
        { merge: true },
      ),
    ]);
  } else {
    await admin.database().ref(`/gameSessions/${sessionId}`).update({ status: 'failed', completedAt: Date.now() });
  }
  return { status: 'canceled' as const };
});

export const recordSpotDifferenceFound = functions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const sessionId = readSessionId(data?.sessionId);
  const differenceId = typeof data?.differenceId === 'string' ? data.differenceId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(differenceId)) {
    throw safeError('invalid-argument', 'not_authorized');
  }
  let reason: string | null = null;
  let foundCount = 0;
  const reference = admin.database().ref(`/gameSessions/${sessionId}`);
  const initialSnapshot = await reference.once('value');
  if (!initialSnapshot.exists()) throw safeError('not-found', 'game_not_found');
  const initialSession = initialSnapshot.val();
  let mayUseInitialCacheFallback = true;
  const result = await reference.transaction((cachedSession) => {
    const session = cachedSession ?? (mayUseInitialCacheFallback ? initialSession : null);
    mayUseInitialCacheFallback = false;
    if (!session || session.gameType !== legacyRealtimeGameType('spotTheDifferences')) {
      reason = 'game_not_found';
      return;
    }
    if (!session.players?.[uid]) {
      reason = 'not_authorized';
      return;
    }
    if (session.status !== 'active') {
      reason = 'game_already_started';
      return;
    }
    const current = Array.isArray(session.gameState?.foundDifferenceIds)
      ? session.gameState.foundDifferenceIds.filter((value: unknown): value is string => typeof value === 'string')
      : [];
    const next = current.includes(differenceId) ? current : [...current, differenceId].slice(0, 10);
    foundCount = next.length;
    return {
      ...session,
      gameState: { ...session.gameState, foundDifferenceIds: next },
      updatedAt: Date.now(),
    };
  });
  if (!result.committed) throw safeError('permission-denied', reason ?? 'not_authorized');
  return { foundCount };
});

export const cleanupExpiredGameJoinCodes = functions.pubsub.schedule('every 30 minutes').onRun(async () => {
  const now = Timestamp.now();
  const snapshot = await registry().where('expiresAt', '<=', now).limit(CLEANUP_BATCH_SIZE).get();
  if (snapshot.empty) {
    console.info('[cleanupExpiredGameJoinCodes] completed', { reviewed: 0, expired: 0 });
    return null;
  }
  const batch = admin.firestore().batch();
  snapshot.docs.forEach((document) => {
    batch.delete(document.ref);
  });
  await batch.commit();
  console.info('[cleanupExpiredGameJoinCodes] completed', { reviewed: snapshot.size, expired: snapshot.size });
  return null;
});

async function createRealtimeSession(input: {
  gameType: Exclude<GameJoinCodeType, 'triviaBlitz'>;
  hostUserId: string;
  sourceSquadId: string | null;
}) {
  const sessionId = `game_${randomBytes(18).toString('base64url')}`;
  const displayName = await resolvePlayerDisplayName(input.hostUserId);
  const now = Date.now();
  const gameState = input.gameType === 'bombDefusal'
    ? { bombSteps: createBombPattern() }
    : { sceneId: `scene_${String(randomInt(1, 22)).padStart(3, '0')}`, foundDifferenceIds: [] };
  const maxPlayers = input.gameType === 'bombDefusal' ? 6 : 12;
  const session = {
    sessionId,
    gameType: legacyRealtimeGameType(input.gameType),
    squadId: input.sourceSquadId ?? '',
    hostUserId: input.hostUserId,
    players: {
      [input.hostUserId]: {
        displayName,
        avatarUrl: null,
        isReady: false,
        score: 0,
        isConnected: true,
      },
    },
    status: 'lobby',
    startedAt: null,
    completedAt: null,
    createdAt: now,
    expiresAt: now + JOIN_CODE_TTL_MS,
    gameState,
    minPlayers: input.gameType === 'bombDefusal' ? 2 : 4,
    maxPlayers,
    settings: input.gameType === 'bombDefusal'
      ? { timerSeconds: 60 }
      : { roundDuration: 90 },
  };
  const result = await admin.database().ref(`/gameSessions/${sessionId}`).transaction((current) => current ?? session);
  if (!result.committed) throw safeError('internal', 'session_creation_failed');
  return sessionId;
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
    return;
  }
  const snapshot = await admin.database().ref(`/gameSessions/${sessionId}`).once('value');
  if (!snapshot.exists() || !snapshot.child(`players/${uid}`).exists()) {
    throw safeError('permission-denied', 'not_authorized');
  }
}

async function joinRealtimeSession(input: {
  uid: string;
  sessionId: string;
  displayName: string;
  gameType: Exclude<GameJoinCodeType, 'triviaBlitz'>;
  mappingStatus: unknown;
}): Promise<'joined' | 'reconnected'> {
  let reason: string | null = null;
  let participantState: 'joined' | 'reconnected' = 'joined';
  const reference = admin.database().ref(`/gameSessions/${input.sessionId}`);
  const initialSnapshot = await reference.once('value');
  if (!initialSnapshot.exists()) throw safeError('not-found', 'invalid_or_expired_code');
  const initialSession = initialSnapshot.val();
  let mayUseInitialCacheFallback = true;
  const result = await reference.transaction((cachedSession) => {
    const session = cachedSession ?? (mayUseInitialCacheFallback ? initialSession : null);
    mayUseInitialCacheFallback = false;
    if (!session || session.gameType !== legacyRealtimeGameType(input.gameType)) {
      reason = 'invalid_or_expired_code';
      return;
    }
    const players = session.players && typeof session.players === 'object' ? session.players : {};
    const existing = Boolean(players[input.uid]);
    if (existing) {
      participantState = 'reconnected';
      players[input.uid] = { ...players[input.uid], isConnected: true };
      return { ...session, players };
    }
    if (input.mappingStatus !== 'lobby' || session.status !== 'lobby') {
      reason = 'game_already_started';
      return;
    }
    const maxPlayers = Number.isInteger(session.maxPlayers) ? session.maxPlayers : 12;
    if (Object.keys(players).length >= maxPlayers) {
      reason = 'game_full';
      return;
    }
    players[input.uid] = {
      displayName: input.displayName,
      avatarUrl: null,
      isReady: false,
      score: 0,
      isConnected: true,
    };
    return { ...session, players, updatedAt: Date.now() };
  });
  if (!result.committed) {
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
}): Promise<'joined' | 'reconnected'> {
  const firestore = admin.firestore();
  const parentRef = firestore.collection('sessions').doc(input.sessionId);
  const gameRef = parentRef.collection('games').doc('triviaBlitz');
  const playerRef = gameRef.collection('players').doc(input.uid);
  return firestore.runTransaction(async (transaction) => {
    const [parent, game, player] = await Promise.all([
      transaction.get(parentRef),
      transaction.get(gameRef),
      transaction.get(playerRef),
    ]);
    if (!parent.exists || !game.exists) throw safeError('not-found', 'invalid_or_expired_code');
    const participantIds = readStringArray(parent.data()?.playerIds);
    const existing = player.exists || parent.data()?.hostPlayerId === input.uid || participantIds.includes(input.uid);
    if (existing) return 'reconnected' as const;
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
  });
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
    transaction.update(codeRef, { status, updatedAt: Timestamp.now() });
    transaction.update(linkRef, { status, updatedAt: Timestamp.now() });
  });
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

async function readAuthorizedSquadId(uid: string, value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,360}$/.test(value.trim())) return null;
  const squadId = value.trim();
  const membership = await admin.firestore().collection('squadMemberships').doc(`${squadId}__${uid}`).get();
  return membership.exists && membership.data()?.membershipStatus === 'active' ? squadId : null;
}

async function resolvePlayerDisplayName(uid: string, token?: Record<string, unknown>) {
  const profile = await admin.firestore().collection('users').doc(uid).get();
  const data = profile.data();
  const firstName = typeof data?.firstName === 'string' ? data.firstName.trim() : '';
  const lastName = typeof data?.lastName === 'string' ? data.lastName.trim() : '';
  if (firstName) return lastName ? `${firstName} ${[...lastName][0]}.` : firstName;
  const displayName = typeof data?.displayName === 'string' ? data.displayName.trim() : '';
  if (displayName) return displayName.split(/\s+/).slice(0, 2).join(' ');
  const tokenName = typeof token?.name === 'string' ? token.name.trim() : '';
  return tokenName || 'Player';
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

function requireUid(context: functions.https.CallableContext) {
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

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function hashIdentifier(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function safeError(code: functions.https.FunctionsErrorCode, reason: string) {
  const message = reason === 'game_already_started'
    ? 'This game has already started.'
    : reason === 'game_full'
      ? 'This game is full.'
      : reason === 'rate_limited'
        ? 'Please wait before trying another game code.'
        : reason === 'code_reservation_failed'
          ? 'We could not create a game code. Please try again.'
          : reason === 'invalid_code_format'
            ? 'Enter a four-character game code.'
            : 'That game code is invalid or no longer available.';
  return new functions.https.HttpsError(code, message, { reason });
}
