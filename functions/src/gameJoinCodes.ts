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
import { resolveJoinableGameSession } from './gameJoinSessionState';
import { permanentAccountFunctions } from './permanentAuth';
import { resolveCanonicalPublicName } from './publicUserProfileCore';

const functions = permanentAccountFunctions(firebaseFunctions);
const JOIN_CODE_TTL_MS = 2 * 60 * 60 * 1000;
const JOIN_ATTEMPT_WINDOW_MS = 60 * 1000;
const JOIN_ATTEMPT_LIMIT = 12;
const JOIN_RATE_LIMIT_MS = 5 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 200;
const RESULTS_GRACE_MS = 5 * 60 * 1000;
const TRIVIA_MIN_PLAYERS = 2;

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
  callerIsParticipant: boolean;
  endsAtMs: number;
};

type BombStepRecord = Record<string, string | number>;

export const createGameJoinCode = functions.https.onCall(async (data, context): Promise<ReservationResult> => {
  const uid = requireUid(context);
  await consumeJoinAttempt(uid);
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

export const recordSpotDifferenceFound = functions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const sessionId = readSessionId(data?.sessionId);
  const differenceId = typeof data?.differenceId === 'string' ? data.differenceId.trim() : '';
  if (!/^difference_(?:0[1-9]|10)$/.test(differenceId)) {
    throw safeError('invalid-argument', 'not_authorized');
  }
  let reason: string | null = null;
  let foundCount = 0;
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
  let mayUseInitialCacheFallback = true;
  let expiredDuringRecord = false;
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
    const state = resolveRealtimeJoinState(session, joinCodeStatus, uid, Date.now());
    if (!state.isJoinable || session.status !== 'active') {
      expiredDuringRecord = state.isExpired;
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
  if (!result.committed) {
    if (expiredDuringRecord) {
      await expireRealtimeGameSession('spotTheDifferences', sessionId, Date.now());
    }
    throw safeError('permission-denied', reason ?? 'not_authorized');
  }
  return { foundCount };
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

  console.info('[cleanupExpiredGameJoinCodes] completed', {
    expiredCodes: snapshot.size,
    expiredRequests: expiredRequests.size,
  });
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
  const bombSteps = input.gameType === 'bombDefusal' ? createBombPattern() : null;
  const gameState = bombSteps
    ? {
      currentStep: bombSteps[0],
      currentStepIndex: 0,
      outcome: null,
      processedSubmissions: {},
    }
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
  const updates: Record<string, unknown> = {
    [`gameSessions/${sessionId}`]: session,
  };
  if (bombSteps) {
    updates[`gameSessionSecrets/${sessionId}`] = {
      bombSteps,
      expiresAt: session.expiresAt,
    };
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
    if (!session || session.gameType !== legacyRealtimeGameType(input.gameType)) {
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
      return { ...session, players };
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
    return {
      ...session,
      status: 'active',
      startedAt: typeof session.startedAt === 'number' ? session.startedAt : serverNowMs,
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

async function readAuthorizedSquadId(uid: string, value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,360}$/.test(value.trim())) return null;
  const squadId = value.trim();
  const membership = await admin.firestore().collection('squadMemberships').doc(`${squadId}__${uid}`).get();
  return membership.exists && membership.data()?.membershipStatus === 'active' ? squadId : null;
}

async function resolvePlayerDisplayName(uid: string, token?: Record<string, unknown>) {
  const profile = await admin.firestore().collection('users').doc(uid).get();
  return (resolveCanonicalPublicName(profile.data())
    ?? resolveCanonicalPublicName({ displayName: token?.name }))?.displayName
    || 'Sideline Social member';
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
