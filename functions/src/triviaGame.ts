import { createHash, randomBytes, randomInt } from 'node:crypto';

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import * as firebaseFunctions from 'firebase-functions';

import { setGameLobbyLifecycleForSession } from './gameLobbyStore';
import { permanentAccountFunctions, requirePermanentUid } from './permanentAuth';
import { resolveCanonicalPublicName } from './publicUserProfileCore';
import rawTriviaQuestions from './triviaQuestions.json';

const functions = permanentAccountFunctions(firebaseFunctions, "communication");
const DEFAULT_QUESTION_COUNT = 10;
const MIN_PLAYERS = 2;
const QUESTION_DURATION_MS = 15_000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const RESULTS_GRACE_MS = 5 * 60 * 1000;
const CREATE_WINDOW_MS = 60_000;
const CREATE_LIMIT = 10;
const CREATE_BLOCK_MS = 5 * 60_000;
const ANSWER_WINDOW_MS = 60_000;
const ANSWER_LIMIT = 40;
const ANSWER_BLOCK_MS = 60_000;

type TriviaStatus = 'lobby' | 'playing' | 'results';

type TriviaQuestion = {
  id: string;
  category: string;
  question_en: string;
  question_es: string;
  options_en: string[];
  options_es: string[];
  answer: number;
};

type PublicTriviaQuestion = Omit<TriviaQuestion, 'answer'>;

type ScoreResult = {
  correct: boolean;
  pointsAwarded: number;
  streakBonusAwarded: number;
  correctAnswerIndex: number;
};

type TriviaIdentityResult = {
  sessionId: string;
  playerId: string;
  isHost: boolean;
};

type CallableHandler<Result> = (
  data: Record<string, unknown>,
  context: firebaseFunctions.https.CallableContext,
) => Promise<Result>;

const questionBank = normalizeQuestionBank(rawTriviaQuestions as unknown[]);
if (questionBank.length < DEFAULT_QUESTION_COUNT) {
  throw new Error('Trivia Blitz requires at least ten valid bilingual questions.');
}

const firestore = () => admin.firestore();
const parentRef = (sessionId: string) => firestore().collection('sessions').doc(sessionId);
const gameRef = (sessionId: string) => parentRef(sessionId).collection('games').doc('triviaBlitz');
const playersRef = (sessionId: string) => gameRef(sessionId).collection('players');
const playerRef = (sessionId: string, uid: string) => playersRef(sessionId).doc(uid);
const secretRef = (sessionId: string) => firestore().collection('triviaGameSecrets').doc(sessionId);
const submissions = () => firestore().collection('triviaGameSubmissions');
const rateLimits = () => firestore().collection('triviaGameRateLimits');

export type TriviaLobbyParticipant = {
  uid: string;
  displayName: string;
  joinOrder: number;
};

export type ProvisionTriviaLobbyInput = {
  sessionId: string;
  lobbyId: string;
  lobbyNumber: number;
  squadId: string;
  hostUserId: string;
  participants: TriviaLobbyParticipant[];
  expiresAtMs: number;
};

export async function provisionTriviaLobbySession(
  input: ProvisionTriviaLobbyInput,
): Promise<TriviaIdentityResult> {
  const participants = [...input.participants]
    .filter((participant) => participant.uid && participant.displayName)
    .sort((left, right) => left.joinOrder - right.joinOrder || left.uid.localeCompare(right.uid));
  if (!participants.some((participant) => participant.uid === input.hostUserId)) {
    throw safeError('failed-precondition', 'session_creation_failed');
  }
  const selectedQuestions = selectQuestions(DEFAULT_QUESTION_COUNT);
  const roundId = randomBytes(18).toString('base64url');

  return firestore().runTransaction(async (transaction) => {
    const parent = parentRef(input.sessionId);
    const game = gameRef(input.sessionId);
    const secret = secretRef(input.sessionId);
    const [parentSnapshot, gameSnapshot, secretSnapshot] = await Promise.all([
      transaction.get(parent),
      transaction.get(game),
      transaction.get(secret),
    ]);

    if (parentSnapshot.exists || gameSnapshot.exists || secretSnapshot.exists) {
      if (
        parentSnapshot.exists &&
        gameSnapshot.exists &&
        secretSnapshot.exists &&
        parentSnapshot.data()?.hostPlayerId === input.hostUserId &&
        parentSnapshot.data()?.lobbyId === input.lobbyId &&
        parentSnapshot.data()?.squadId === input.squadId &&
        parentSnapshot.data()?.status === 'lobby' &&
        gameSnapshot.data()?.status === 'lobby'
      ) {
        assertSessionNotExpired(parentSnapshot.data());
        return { sessionId: input.sessionId, playerId: input.hostUserId, isHost: true };
      }
      throw safeError('already-exists', 'session_unavailable');
    }

    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(input.expiresAtMs);
    const participantIds = participants.map((participant) => participant.uid);
    transaction.create(parent, {
      sessionId: input.sessionId,
      lobbyId: input.lobbyId,
      lobbyNumber: input.lobbyNumber,
      squadId: input.squadId,
      gameId: 'triviaBlitz',
      gameType: 'triviaBlitz',
      hostPlayerId: input.hostUserId,
      playerIds: participantIds,
      queuedPlayerIds: [],
      status: 'lobby',
      completedAt: null,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    transaction.create(game, {
      status: 'lobby',
      turnIndex: 0,
      questionIndex: 0,
      questionCount: selectedQuestions.length,
      teamStreak: 0,
      totalPoints: 0,
      correctAnswers: 0,
      answeredQuestions: 0,
      totalPlayers: participants.length,
      queuedPlayerCount: 0,
      allReady: false,
      currentQuestion: null,
      currentSelection: null,
      answerResult: null,
      hostPlayerId: input.hostUserId,
      questionStartedAt: null,
      questionEndsAt: null,
      createdAt: now,
      updatedAt: now,
    });
    participants.forEach((participant, playerIndex) => {
      transaction.create(playerRef(input.sessionId, participant.uid), {
        name: participant.displayName,
        playerIndex,
        joinOrder: participant.joinOrder,
        score: 0,
        ready: false,
        createdAt: now,
        updatedAt: now,
      });
    });
    transaction.create(secret, {
      sessionId: input.sessionId,
      lobbyId: input.lobbyId,
      hostPlayerId: input.hostUserId,
      roundId,
      selectedQuestions,
      questionCount: selectedQuestions.length,
      createdAt: now,
      updatedAt: now,
    });
    return { sessionId: input.sessionId, playerId: input.hostUserId, isHost: true };
  });
}

export const createTriviaGameSession = onTriviaCall(
  'createTriviaGameSession',
  async (data, context): Promise<TriviaIdentityResult> => {
    const uid = requirePermanentUid(context);
    const requestedSessionId = readOptionalSessionId(data.requestedSessionId);
    if (!requestedSessionId) throw safeError('failed-precondition', 'client_update_required');
    await consumeCreateAttempt(uid);
    const link = await firestore().collection('gameJoinSessionLinks')
      .doc(hashIdentifier(`triviaBlitz:${requestedSessionId}`))
      .get();
    const linkData = link.data();
    const linkExpiresAt = readTimestamp(linkData?.expiresAt);
    if (
      !link.exists ||
      linkData?.sessionId !== requestedSessionId ||
      linkData?.gameType !== 'triviaBlitz' ||
      linkData?.hostUserId !== uid ||
      typeof linkData?.lobbyId !== 'string' ||
      typeof linkData?.squadId !== 'string' ||
      !Number.isInteger(linkData?.lobbyNumber) ||
      !linkExpiresAt || linkExpiresAt.toMillis() <= Date.now()
    ) {
      throw safeError('failed-precondition', 'client_update_required');
    }
    const displayName = await resolvePlayerDisplayName(uid, context.auth?.token);
    return provisionTriviaLobbySession({
      sessionId: requestedSessionId,
      lobbyId: linkData.lobbyId,
      lobbyNumber: linkData.lobbyNumber,
      squadId: linkData.squadId,
      hostUserId: uid,
      participants: [{ uid, displayName, joinOrder: 1 }],
      expiresAtMs: linkExpiresAt.toMillis(),
    });
  },
);

export const resumeTriviaGameSession = onTriviaCall(
  'resumeTriviaGameSession',
  async (data, context): Promise<TriviaIdentityResult> => {
    const uid = requirePermanentUid(context);
    const sessionId = readSessionId(data.sessionId);
    const [parent, game, player] = await Promise.all([
      parentRef(sessionId).get(),
      gameRef(sessionId).get(),
      playerRef(sessionId, uid).get(),
    ]);
    assertSessionMembership(parent, game, player, uid);
    assertSessionNotExpired(parent.data());
    assertSessionReadableLifecycle(parent.data(), game.data());
    return {
      sessionId,
      playerId: uid,
      isHost: parent.data()?.hostPlayerId === uid,
    };
  },
);

export const setTriviaPlayerReady = onTriviaCall(
  'setTriviaPlayerReady',
  async (data, context) => {
    const uid = requirePermanentUid(context);
    const sessionId = readSessionId(data.sessionId);
    const ready = readBoolean(data.ready, 'ready');

    const result = await firestore().runTransaction(async (transaction) => {
      const parent = await transaction.get(parentRef(sessionId));
      const game = await transaction.get(gameRef(sessionId));
      const player = await transaction.get(playerRef(sessionId, uid));
      const playerSnapshots = await transaction.get(playersRef(sessionId));
      assertSessionMembership(parent, game, player, uid);
      assertSessionNotExpired(parent.data());
      if (parent.data()?.status !== 'lobby' || game.data()?.status !== 'lobby') {
        throw safeError('failed-precondition', 'session_closed');
      }

      const allReady =
        !playerSnapshots.empty &&
        playerSnapshots.docs.every((snapshot) =>
          snapshot.id === uid ? ready : snapshot.data().ready === true,
        );
      const now = Timestamp.now();
      transaction.update(player.ref, { ready, updatedAt: now });
      transaction.update(game.ref, {
        totalPlayers: playerSnapshots.size,
        allReady,
        updatedAt: now,
      });
      return { ready };
    });
  },
);

export const startTriviaGameSession = onTriviaCall(
  'startTriviaGameSession',
  async (data, context) => {
    const uid = requirePermanentUid(context);
    const sessionId = readSessionId(data.sessionId);
    const joinLink = firestore()
      .collection('gameJoinSessionLinks')
      .doc(hashIdentifier(`triviaBlitz:${sessionId}`));

    const result = await firestore().runTransaction(async (transaction) => {
      const parent = await transaction.get(parentRef(sessionId));
      const game = await transaction.get(gameRef(sessionId));
      const secret = await transaction.get(secretRef(sessionId));
      const playerSnapshots = await transaction.get(playersRef(sessionId));
      const link = await transaction.get(joinLink);
      const joinCode = readTriviaJoinCode(link.data()?.code);
      if (!joinCode) {
        throw safeError('failed-precondition', 'session_closed');
      }
      const mappingRef = firestore().collection('gameJoinCodes').doc(joinCode);
      const mapping = await transaction.get(mappingRef);
      assertHost(parent, game, uid);
      assertSessionNotExpired(parent.data());
      assertTriviaJoinCodeState({
        link,
        mapping,
        sessionId,
        uid,
        expectedStatus:
          game.data()?.status === 'playing' && parent.data()?.status === 'playing'
            ? 'started'
            : 'lobby',
      });
      if (game.data()?.status === 'playing' && parent.data()?.status === 'playing') {
        return { status: 'playing' as const };
      }
      if (game.data()?.status !== 'lobby' || parent.data()?.status !== 'lobby') {
        throw safeError('failed-precondition', 'session_closed');
      }
      if (playerSnapshots.empty) {
        throw safeError('failed-precondition', 'participant_required');
      }
      if (playerSnapshots.size < MIN_PLAYERS) {
        throw safeError('failed-precondition', 'minimum_players_required');
      }
      if (playerSnapshots.docs.some((player) => player.data().ready !== true)) {
        throw safeError('failed-precondition', 'participants_not_ready');
      }
      const questions = readStoredQuestions(secret.data()?.selectedQuestions);
      const firstQuestion = questions[0];
      if (!secret.exists || !firstQuestion) {
        throw safeError('failed-precondition', 'question_unavailable');
      }

      const now = Timestamp.now();
      const endsAt = Timestamp.fromMillis(now.toMillis() + QUESTION_DURATION_MS);
      transaction.update(parent.ref, {
        status: 'playing',
        completedAt: null,
        updatedAt: now,
      });
      transaction.update(link.ref, { status: 'started', updatedAt: now });
      transaction.update(mappingRef, { status: 'started', updatedAt: now });
      transaction.update(game.ref, {
        status: 'playing',
        turnIndex: 0,
        questionIndex: 0,
        questionCount: questions.length,
        totalPlayers: playerSnapshots.size,
        currentQuestion: toPublicQuestion(firstQuestion),
        currentSelection: null,
        answerResult: null,
        questionStartedAt: now,
        questionEndsAt: endsAt,
        updatedAt: now,
      });
      return { status: 'playing' as const };
    });
    await setGameLobbyLifecycleForSession('triviaBlitz', sessionId, 'inProgress');
    return result;
  },
);

export const submitTriviaAnswer = onTriviaCall(
  'submitTriviaAnswer',
  async (data, context): Promise<ScoreResult> => {
    const uid = requirePermanentUid(context);
    const sessionId = readSessionId(data.sessionId);
    const questionIndex = readBoundedInteger(data.questionIndex, 'questionIndex', 0, 100);
    const answerIndex = readBoundedInteger(data.answerIndex, 'answerIndex', 0, 20);
    const submissionId = readSubmissionId(data.submissionId);
    const submission = submissions().doc(hashIdentifier(`${sessionId}:${uid}:${submissionId}`));
    await consumeAnswerAttempt(uid, sessionId);

    return firestore().runTransaction(async (transaction) => {
      const parent = await transaction.get(parentRef(sessionId));
      const game = await transaction.get(gameRef(sessionId));
      const player = await transaction.get(playerRef(sessionId, uid));
      const secret = await transaction.get(secretRef(sessionId));
      const priorSubmission = await transaction.get(submission);
      const playerSnapshots = await transaction.get(playersRef(sessionId));
      assertSessionMembership(parent, game, player, uid);
      assertSessionNotExpired(parent.data());

      if (priorSubmission.exists) {
        const prior = priorSubmission.data();
        if (
          prior?.sessionId !== sessionId ||
          prior?.playerId !== uid ||
          prior?.questionIndex !== questionIndex ||
          prior?.answerIndex !== answerIndex ||
          prior?.roundId !== secret.data()?.roundId
        ) {
          throw safeError('already-exists', 'submission_id_reused');
        }
        return readStoredScoreResult(prior?.result);
      }

      const gameData = game.data() ?? {};
      if (parent.data()?.status !== 'playing' || gameData.status !== 'playing') {
        throw safeError('failed-precondition', 'session_closed');
      }
      if (gameData.questionIndex !== questionIndex) {
        throw safeError('failed-precondition', 'stale_question');
      }
      if (player.data()?.playerIndex !== gameData.turnIndex) {
        throw safeError('permission-denied', 'not_active_player');
      }
      if (gameData.currentSelection != null || gameData.answerResult != null) {
        throw safeError('already-exists', 'answer_already_submitted');
      }

      const questions = readStoredQuestions(secret.data()?.selectedQuestions);
      const question = questions[questionIndex];
      if (!secret.exists || !question) {
        throw safeError('failed-precondition', 'question_unavailable');
      }
      if (answerIndex >= question.options_en.length) {
        throw safeError('invalid-argument', 'answer_out_of_range');
      }

      const now = Timestamp.now();
      const endsAt = readTimestamp(gameData.questionEndsAt);
      if (!endsAt || now.toMillis() > endsAt.toMillis()) {
        throw safeError('deadline-exceeded', 'answer_window_closed');
      }

      const correct = answerIndex === question.answer;
      const remainingMs = Math.max(0, endsAt.toMillis() - now.toMillis());
      let pointsAwarded = 0;
      let streakBonusAwarded = 0;
      let nextTeamStreak = 0;
      if (correct) {
        pointsAwarded = 10 + (remainingMs >= 7000 ? 5 : 0);
        nextTeamStreak = readNonNegativeInteger(gameData.teamStreak) + 1;
        if (nextTeamStreak >= 3) {
          streakBonusAwarded = 20;
          pointsAwarded += streakBonusAwarded;
          nextTeamStreak = 0;
        }
      }
      const result: ScoreResult = {
        correct,
        pointsAwarded,
        streakBonusAwarded,
        correctAnswerIndex: question.answer,
      };
      const currentTotal = readNonNegativeInteger(gameData.totalPoints);
      const currentCorrect = readNonNegativeInteger(gameData.correctAnswers);
      const currentAnswered = readNonNegativeInteger(gameData.answeredQuestions);

      transaction.update(game.ref, {
        totalPoints: currentTotal + pointsAwarded,
        teamStreak: nextTeamStreak,
        correctAnswers: currentCorrect + (correct ? 1 : 0),
        answeredQuestions: currentAnswered + 1,
        currentSelection: {
          playerId: uid,
          answerIndex,
          selectedAt: now.toMillis(),
        },
        answerResult: {
          ...result,
          questionIndex,
          playerId: uid,
          answerIndex,
          submissionId,
          revealedAt: now,
        },
        updatedAt: now,
      });
      playerSnapshots.docs.forEach((snapshot) => {
        transaction.update(snapshot.ref, {
          score: readNonNegativeInteger(snapshot.data().score) + pointsAwarded,
          updatedAt: now,
        });
      });
      transaction.create(submission, {
        sessionId,
        playerId: uid,
        questionIndex,
        answerIndex,
        submissionId,
        roundId: String(secret.data()?.roundId ?? ''),
        result,
        createdAt: now,
      });
      return result;
    });
  },
);

export const advanceTriviaGameSession = onTriviaCall(
  'advanceTriviaGameSession',
  async (data, context) => {
    const uid = requirePermanentUid(context);
    const sessionId = readSessionId(data.sessionId);
    const requestedQuestionIndex = readBoundedInteger(
      data.questionIndex,
      'questionIndex',
      0,
      100,
    );

    const result = await firestore().runTransaction(async (transaction) => {
      const parent = await transaction.get(parentRef(sessionId));
      const game = await transaction.get(gameRef(sessionId));
      const secret = await transaction.get(secretRef(sessionId));
      assertHost(parent, game, uid);
      assertSessionNotExpired(parent.data());
      assertSessionReadableLifecycle(parent.data(), game.data());
      const gameData = game.data() ?? {};
      if (gameData.status === 'results') {
        return {
          status: 'results' as const,
          questionIndex: readNonNegativeInteger(gameData.questionIndex),
        };
      }
      if (gameData.status !== 'playing' || parent.data()?.status !== 'playing') {
        throw safeError('failed-precondition', 'session_closed');
      }
      const currentQuestionIndex = readNonNegativeInteger(gameData.questionIndex);
      if (currentQuestionIndex !== requestedQuestionIndex) {
        if (requestedQuestionIndex < currentQuestionIndex) {
          return { status: 'playing' as const, questionIndex: currentQuestionIndex };
        }
        throw safeError('failed-precondition', 'stale_question');
      }

      const now = Timestamp.now();
      const endsAt = readTimestamp(gameData.questionEndsAt);
      const hasAnswer = gameData.answerResult != null;
      if (!hasAnswer && (!endsAt || now.toMillis() < endsAt.toMillis())) {
        throw safeError('failed-precondition', 'answer_pending');
      }

      const questions = readStoredQuestions(secret.data()?.selectedQuestions);
      if (!secret.exists || questions.length === 0) {
        throw safeError('failed-precondition', 'question_unavailable');
      }
      const answeredQuestions =
        readNonNegativeInteger(gameData.answeredQuestions) + (hasAnswer ? 0 : 1);
      const nextQuestionIndex = currentQuestionIndex + 1;
      if (nextQuestionIndex >= questions.length) {
        transaction.update(parent.ref, {
          status: 'results',
          completedAt: now,
          expiresAt: terminalExpiry(parent.data(), now),
          updatedAt: now,
        });
        transaction.update(game.ref, {
          status: 'results',
          answeredQuestions,
          teamStreak: hasAnswer ? readNonNegativeInteger(gameData.teamStreak) : 0,
          currentQuestion: null,
          currentSelection: null,
          answerResult: null,
          questionStartedAt: null,
          questionEndsAt: null,
          updatedAt: now,
        });
        return { status: 'results' as const, questionIndex: currentQuestionIndex };
      }

      const totalPlayers = Math.max(readNonNegativeInteger(gameData.totalPlayers), 1);
      const nextTurnIndex = (readNonNegativeInteger(gameData.turnIndex) + 1) % totalPlayers;
      const nextQuestion = questions[nextQuestionIndex];
      const nextEndsAt = Timestamp.fromMillis(now.toMillis() + QUESTION_DURATION_MS);
      transaction.update(game.ref, {
        questionIndex: nextQuestionIndex,
        turnIndex: nextTurnIndex,
        answeredQuestions,
        teamStreak: hasAnswer ? readNonNegativeInteger(gameData.teamStreak) : 0,
        currentQuestion: toPublicQuestion(nextQuestion),
        currentSelection: null,
        answerResult: null,
        questionStartedAt: now,
        questionEndsAt: nextEndsAt,
        updatedAt: now,
      });
      return { status: 'playing' as const, questionIndex: nextQuestionIndex };
    });
    if (result.status === 'results') {
      await setGameLobbyLifecycleForSession('triviaBlitz', sessionId, 'waitingForRematch');
    }
    return result;
  },
);

export const resetTriviaGameSession = onTriviaCall(
  'resetTriviaGameSession',
  async (data, context) => {
    const uid = requirePermanentUid(context);
    const sessionId = readSessionId(data.sessionId);
    const selectedQuestions = selectQuestions(DEFAULT_QUESTION_COUNT);
    const roundId = randomBytes(18).toString('base64url');
    const joinLink = firestore()
      .collection('gameJoinSessionLinks')
      .doc(hashIdentifier(`triviaBlitz:${sessionId}`));

    const result = await firestore().runTransaction(async (transaction) => {
      const parent = await transaction.get(parentRef(sessionId));
      const game = await transaction.get(gameRef(sessionId));
      const playerSnapshots = await transaction.get(playersRef(sessionId));
      const link = await transaction.get(joinLink);
      const joinCode = readTriviaJoinCode(link.data()?.code);
      if (!joinCode) {
        throw safeError('failed-precondition', 'session_closed');
      }
      const mappingRef = firestore().collection('gameJoinCodes').doc(joinCode);
      const mapping = await transaction.get(mappingRef);
      assertHost(parent, game, uid);
      if (typeof parent.data()?.lobbyId === 'string') {
        throw safeError('failed-precondition', 'client_update_required');
      }
      assertSessionNotExpired(parent.data());
      assertSessionReadableLifecycle(parent.data(), game.data());
      assertTriviaJoinCodeResettable({
        link,
        mapping,
        sessionId,
        uid,
      });
      const now = Timestamp.now();
      const expiresAt = Timestamp.fromMillis(now.toMillis() + SESSION_TTL_MS);
      transaction.update(parent.ref, {
        status: 'lobby',
        completedAt: null,
        expiresAt,
        updatedAt: now,
      });
      transaction.update(link.ref, { status: 'lobby', expiresAt, updatedAt: now });
      transaction.update(mappingRef, { status: 'lobby', expiresAt, updatedAt: now });
      transaction.update(game.ref, {
        status: 'lobby',
        turnIndex: 0,
        questionIndex: 0,
        questionCount: selectedQuestions.length,
        teamStreak: 0,
        totalPoints: 0,
        correctAnswers: 0,
        answeredQuestions: 0,
        totalPlayers: playerSnapshots.size,
        allReady: false,
        currentQuestion: null,
        currentSelection: null,
        answerResult: null,
        questionStartedAt: null,
        questionEndsAt: null,
        updatedAt: now,
      });
      transaction.set(secretRef(sessionId), {
        sessionId,
        hostPlayerId: uid,
        roundId,
        selectedQuestions,
        questionCount: selectedQuestions.length,
        createdAt: now,
        updatedAt: now,
      });
      playerSnapshots.docs.forEach((snapshot) => {
        transaction.update(snapshot.ref, {
          score: 0,
          ready: false,
          updatedAt: now,
        });
      });
      return { status: 'lobby' as const };
    });
    await setGameLobbyLifecycleForSession('triviaBlitz', sessionId, 'waiting');
    return result;
  },
);

export const endTriviaGameSession = onTriviaCall(
  'endTriviaGameSession',
  async (data, context) => {
    const uid = requirePermanentUid(context);
    const sessionId = readSessionId(data.sessionId);

    const result = await firestore().runTransaction(async (transaction) => {
      const parent = await transaction.get(parentRef(sessionId));
      const game = await transaction.get(gameRef(sessionId));
      assertHost(parent, game, uid);
      assertSessionNotExpired(parent.data());
      assertSessionReadableLifecycle(parent.data(), game.data());
      if (game.data()?.status === 'results' && parent.data()?.status === 'results') {
        return { status: 'results' as const };
      }
      const now = Timestamp.now();
      transaction.update(parent.ref, {
        status: 'results',
        completedAt: now,
        expiresAt: terminalExpiry(parent.data(), now),
        updatedAt: now,
      });
      transaction.update(game.ref, {
        status: 'results',
        currentQuestion: null,
        currentSelection: null,
        answerResult: null,
        questionStartedAt: null,
        questionEndsAt: null,
        updatedAt: now,
      });
      return { status: 'results' as const };
    });
    await setGameLobbyLifecycleForSession('triviaBlitz', sessionId, 'waitingForRematch');
    return result;
  },
);

function onTriviaCall<Result>(
  operation: string,
  handler: CallableHandler<Result>,
) {
  return functions.https.onCall(async (data, context) => {
    try {
      const input =
        data && typeof data === 'object' && !Array.isArray(data)
          ? data as Record<string, unknown>
          : {};
      return await handler(input, context);
    } catch (error) {
      if (error instanceof firebaseFunctions.https.HttpsError) {
        throw error;
      }
      const normalized = error instanceof Error ? error : new Error(String(error));
      firebaseFunctions.logger.error('trivia_game_unexpected_failure', {
        operation,
        errorName: normalized.name,
        errorCode: readErrorCode(error),
        stack: normalized.stack,
      });
      throw safeError('internal', 'unexpected_failure');
    }
  });
}

function assertSessionMembership(
  parent: FirebaseFirestore.DocumentSnapshot,
  game: FirebaseFirestore.DocumentSnapshot,
  player: FirebaseFirestore.DocumentSnapshot,
  uid: string,
) {
  const playerIds = readStringArray(parent.data()?.playerIds);
  if (
    !parent.exists ||
    !game.exists ||
    !player.exists ||
    game.data()?.hostPlayerId !== parent.data()?.hostPlayerId ||
    (!playerIds.includes(uid) && parent.data()?.hostPlayerId !== uid)
  ) {
    throw safeError('permission-denied', 'not_participant');
  }
}

function assertHost(
  parent: FirebaseFirestore.DocumentSnapshot,
  game: FirebaseFirestore.DocumentSnapshot,
  uid: string,
) {
  if (
    !parent.exists ||
    !game.exists ||
    parent.data()?.hostPlayerId !== uid ||
    game.data()?.hostPlayerId !== uid
  ) {
    throw safeError('permission-denied', 'host_required');
  }
}

function assertTriviaJoinCodeState(input: {
  link: FirebaseFirestore.DocumentSnapshot;
  mapping: FirebaseFirestore.DocumentSnapshot;
  sessionId: string;
  uid: string;
  expectedStatus: 'lobby' | 'started';
}) {
  const linkData = input.link.data();
  const mappingData = input.mapping.data();
  const nowMs = Date.now();
  const linkExpiresAt = readTimestamp(linkData?.expiresAt);
  const mappingExpiresAt = readTimestamp(mappingData?.expiresAt);
  if (
    !input.link.exists ||
    !input.mapping.exists ||
    linkData?.code !== input.mapping.id ||
    linkData?.gameType !== 'triviaBlitz' ||
    mappingData?.gameType !== 'triviaBlitz' ||
    linkData?.sessionId !== input.sessionId ||
    mappingData?.sessionId !== input.sessionId ||
    linkData?.hostUserId !== input.uid ||
    mappingData?.hostUserId !== input.uid ||
    linkData?.status !== input.expectedStatus ||
    mappingData?.status !== input.expectedStatus ||
    !linkExpiresAt ||
    !mappingExpiresAt ||
    linkExpiresAt.toMillis() <= nowMs ||
    mappingExpiresAt.toMillis() <= nowMs
  ) {
    throw safeError('failed-precondition', 'session_closed');
  }
}

function assertTriviaJoinCodeResettable(input: {
  link: FirebaseFirestore.DocumentSnapshot;
  mapping: FirebaseFirestore.DocumentSnapshot;
  sessionId: string;
  uid: string;
}) {
  const linkData = input.link.data();
  const mappingData = input.mapping.data();
  const allowedStatuses = new Set(['lobby', 'started', 'ended']);
  const nowMs = Date.now();
  const linkExpiresAt = readTimestamp(linkData?.expiresAt);
  const mappingExpiresAt = readTimestamp(mappingData?.expiresAt);
  if (
    !input.link.exists ||
    !input.mapping.exists ||
    linkData?.code !== input.mapping.id ||
    linkData?.gameType !== 'triviaBlitz' ||
    mappingData?.gameType !== 'triviaBlitz' ||
    linkData?.sessionId !== input.sessionId ||
    mappingData?.sessionId !== input.sessionId ||
    linkData?.hostUserId !== input.uid ||
    mappingData?.hostUserId !== input.uid ||
    linkData?.status !== mappingData?.status ||
    !allowedStatuses.has(String(linkData?.status)) ||
    !linkExpiresAt ||
    !mappingExpiresAt ||
    linkExpiresAt.toMillis() <= nowMs ||
    mappingExpiresAt.toMillis() <= nowMs
  ) {
    throw safeError('failed-precondition', 'session_closed');
  }
}

function readTriviaJoinCode(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(normalized)
    ? normalized
    : null;
}

function assertSessionNotExpired(data: FirebaseFirestore.DocumentData | undefined) {
  const expiresAt = readTimestamp(data?.expiresAt);
  if (!expiresAt || expiresAt.toMillis() <= Date.now()) {
    throw safeError('failed-precondition', 'session_expired');
  }
}

function assertSessionReadableLifecycle(
  parentData: FirebaseFirestore.DocumentData | undefined,
  gameData: FirebaseFirestore.DocumentData | undefined,
) {
  const status = parentData?.status;
  if (status !== gameData?.status) {
    throw safeError('failed-precondition', 'session_closed');
  }
  if (status === 'lobby' || status === 'playing') return;
  const completedAt = readTimestamp(parentData?.completedAt);
  if (
    status === 'results' &&
    completedAt &&
    completedAt.toMillis() + RESULTS_GRACE_MS > Date.now()
  ) {
    return;
  }
  throw safeError('failed-precondition', 'session_closed');
}

function terminalExpiry(
  data: FirebaseFirestore.DocumentData | undefined,
  now: Timestamp,
) {
  const currentExpiry = readTimestamp(data?.expiresAt)?.toMillis();
  const graceExpiry = now.toMillis() + RESULTS_GRACE_MS;
  return Timestamp.fromMillis(
    currentExpiry == null ? graceExpiry : Math.min(currentExpiry, graceExpiry),
  );
}

async function resolvePlayerDisplayName(
  uid: string,
  token?: Record<string, unknown>,
) {
  const profile = await firestore().collection('users').doc(uid).get();
  return (
    resolveCanonicalPublicName(profile.data()) ??
    resolveCanonicalPublicName({ displayName: token?.name })
  )?.displayName || 'Sideline Social member';
}

async function consumeCreateAttempt(uid: string) {
  const reference = rateLimits().doc(hashIdentifier(`create:${uid}`));
  await firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const now = Timestamp.now();
    const data = snapshot.data();
    const blockedUntil = readTimestamp(data?.blockedUntil);
    if (blockedUntil && blockedUntil.toMillis() > now.toMillis()) {
      throw safeError('resource-exhausted', 'rate_limited');
    }
    const windowStartedAt = readTimestamp(data?.windowStartedAt);
    const inWindow =
      Boolean(windowStartedAt) &&
      now.toMillis() - (windowStartedAt?.toMillis() ?? 0) < CREATE_WINDOW_MS;
    const attemptCount = inWindow ? readNonNegativeInteger(data?.attemptCount) + 1 : 1;
    if (attemptCount > CREATE_LIMIT) {
      transaction.set(reference, {
        attemptCount,
        userId: uid,
        windowStartedAt: inWindow ? windowStartedAt : now,
        blockedUntil: Timestamp.fromMillis(now.toMillis() + CREATE_BLOCK_MS),
        updatedAt: now,
      });
      return;
    }
    transaction.set(reference, {
      attemptCount,
      userId: uid,
      windowStartedAt: inWindow ? windowStartedAt : now,
      blockedUntil: null,
      updatedAt: now,
    });
  });
  const result = await reference.get();
  const blockedUntil = readTimestamp(result.data()?.blockedUntil);
  if (blockedUntil && blockedUntil.toMillis() > Date.now()) {
    throw safeError('resource-exhausted', 'rate_limited');
  }
}

async function consumeAnswerAttempt(uid: string, sessionId: string) {
  const reference = rateLimits().doc(hashIdentifier(`answer:${uid}:${sessionId}`));
  const blocked = await firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const now = Timestamp.now();
    const data = snapshot.data();
    const blockedUntil = readTimestamp(data?.blockedUntil);
    if (blockedUntil && blockedUntil.toMillis() > now.toMillis()) return true;
    const windowStartedAt = readTimestamp(data?.windowStartedAt);
    const inWindow =
      Boolean(windowStartedAt) &&
      now.toMillis() - (windowStartedAt?.toMillis() ?? 0) < ANSWER_WINDOW_MS;
    const attemptCount = inWindow ? readNonNegativeInteger(data?.attemptCount) + 1 : 1;
    const shouldBlock = attemptCount > ANSWER_LIMIT;
    transaction.set(reference, {
      attemptCount,
      userId: uid,
      windowStartedAt: inWindow ? windowStartedAt : now,
      blockedUntil: shouldBlock
        ? Timestamp.fromMillis(now.toMillis() + ANSWER_BLOCK_MS)
        : null,
      updatedAt: now,
    });
    return shouldBlock;
  });
  if (blocked) throw safeError('resource-exhausted', 'rate_limited');
}

function normalizeQuestionBank(values: unknown[]): TriviaQuestion[] {
  const normalized: TriviaQuestion[] = [];
  const seenIds = new Set<string>();
  values.forEach((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const question = value as Record<string, unknown>;
    const category = readNonEmptyString(question.category);
    const questionEn = readNonEmptyString(question.question_en);
    const questionEs = readNonEmptyString(question.question_es);
    const optionsEn = readStringArray(question.options_en);
    const optionsEs = readStringArray(question.options_es);
    const answer = question.answer;
    if (
      !category ||
      !questionEn ||
      !questionEs ||
      optionsEn.length < 2 ||
      optionsEn.length !== optionsEs.length ||
      !Number.isInteger(answer) ||
      (answer as number) < 0 ||
      (answer as number) >= optionsEn.length
    ) {
      return;
    }
    const providedId = readNonEmptyString(question.id);
    const id = providedId ?? stableQuestionId(category, questionEn);
    if (seenIds.has(id)) return;
    seenIds.add(id);
    normalized.push({
      id,
      category,
      question_en: questionEn,
      question_es: questionEs,
      options_en: optionsEn,
      options_es: optionsEs,
      answer: answer as number,
    });
  });
  return normalized;
}

function selectQuestions(count: number) {
  const shuffled = [...questionBank];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function readStoredQuestions(value: unknown): TriviaQuestion[] {
  return Array.isArray(value) ? normalizeQuestionBank(value) : [];
}

function toPublicQuestion(question: TriviaQuestion): PublicTriviaQuestion {
  return {
    id: question.id,
    category: question.category,
    question_en: question.question_en,
    question_es: question.question_es,
    options_en: question.options_en,
    options_es: question.options_es,
  };
}

function stableQuestionId(category: string, question: string) {
  const identity = `${category.trim().toLocaleLowerCase('en-US')}::${question
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US')}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `trivia_${(hash >>> 0).toString(36)}`;
}

function readOptionalSessionId(value: unknown) {
  return value == null ? null : readSessionId(value);
}

function readSessionId(value: unknown) {
  const sessionId = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{4,200}$/.test(sessionId)) {
    throw safeError('invalid-argument', 'invalid_session');
  }
  return sessionId;
}

function readSubmissionId(value: unknown) {
  const submissionId = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(submissionId)) {
    throw safeError('invalid-argument', 'invalid_submission');
  }
  return submissionId;
}

function readBoolean(value: unknown, field: string) {
  if (typeof value !== 'boolean') {
    throw safeError('invalid-argument', `invalid_${field}`);
  }
  return value;
}

function readBoundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
) {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw safeError('invalid-argument', `invalid_${field}`);
  }
  return value as number;
}

function readNonNegativeInteger(value: unknown) {
  return Number.isInteger(value) && (value as number) >= 0 ? value as number : 0;
}

function readTimestamp(value: unknown): Timestamp | null {
  return value instanceof Timestamp ? value : null;
}

function readNonEmptyString(value: unknown) {
  const result = typeof value === 'string' ? value.trim() : '';
  return result || null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function readStoredScoreResult(value: unknown): ScoreResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw safeError('internal', 'invalid_stored_submission');
  }
  const result = value as Record<string, unknown>;
  if (
    typeof result.correct !== 'boolean' ||
    !Number.isInteger(result.pointsAwarded) ||
    !Number.isInteger(result.streakBonusAwarded) ||
    !Number.isInteger(result.correctAnswerIndex)
  ) {
    throw safeError('internal', 'invalid_stored_submission');
  }
  return {
    correct: result.correct,
    pointsAwarded: result.pointsAwarded as number,
    streakBonusAwarded: result.streakBonusAwarded as number,
    correctAnswerIndex: result.correctAnswerIndex as number,
  };
}

function hashIdentifier(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function readErrorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : 'unknown';
}

function safeError(
  code: firebaseFunctions.https.FunctionsErrorCode,
  reason: string,
) {
  const message =
    code === 'unauthenticated'
      ? 'Sign in is required.'
      : code === 'permission-denied'
        ? 'You do not have access to this game.'
        : code === 'resource-exhausted'
          ? 'Please wait before trying again.'
          : code === 'internal'
            ? 'Trivia Blitz could not be updated.'
            : 'This Trivia Blitz action is no longer available.';
  return new firebaseFunctions.https.HttpsError(code, message, { reason });
}
