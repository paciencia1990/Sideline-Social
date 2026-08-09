const assert = require('node:assert/strict');
const admin = require('../functions/node_modules/firebase-admin');
const { initializeApp } = require('firebase/app');
const {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInAnonymously,
} = require('firebase/auth');
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require('firebase/functions');
const { getCanonicalSpotScene } = require('../functions/lib/spotDifferenceCore.js');

const projectId = process.env.GCLOUD_PROJECT || 'sideline-game-join-code-functions-test';
if (!admin.apps.length) {
  admin.initializeApp({ projectId, databaseURL: `https://${projectId}.firebaseio.com` });
}
const firestore = admin.firestore();
const database = admin.database();

async function createClient(label, authentication = 'password') {
  const app = initializeApp({ apiKey: 'demo-key', projectId }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  let uid = null;
  if (authentication === 'password') {
    const credential = await createUserWithEmailAndPassword(auth, `${label}@example.test`, 'ValidPass123!');
    uid = credential.user.uid;
  } else if (authentication === 'anonymous') {
    uid = (await signInAnonymously(auth)).user.uid;
  }
  const callableFunctions = getFunctions(app, 'us-central1');
  connectFunctionsEmulator(callableFunctions, '127.0.0.1', 5001);
  return {
    uid,
    call: (name, data = {}) => httpsCallable(callableFunctions, name)(data).then((result) => result.data),
  };
}

function hasReason(reason) {
  return (error) =>
    error?.details?.reason === reason ||
    error?.details?.details?.reason === reason ||
    String(error?.message).includes(reason);
}

async function run() {
  const squadId = 'active-game-squad';
  const [
    hostA,
    hostB,
    player,
    outsider,
    spotPlayerTwo,
    spotPlayerThree,
    brute,
    createBrute,
    anonymous,
    signedOut,
  ] = await Promise.all([
    createClient('join-host-a'),
    createClient('join-host-b'),
    createClient('join-player'),
    createClient('join-outsider'),
    createClient('join-spot-player-two'),
    createClient('join-spot-player-three'),
    createClient('join-brute'),
    createClient('create-brute'),
    createClient('join-anonymous', 'anonymous'),
    createClient('join-signed-out', 'none'),
  ]);
  await Promise.all([
    firestore.collection('users').doc(hostA.uid).set({ firstName: 'Host', lastName: 'Alpha' }),
    firestore.collection('users').doc(hostB.uid).set({ firstName: 'Host', lastName: 'Beta' }),
    firestore.collection('users').doc(player.uid).set({ firstName: 'Player', lastName: 'One' }),
    firestore.collection('users').doc(outsider.uid).set({ firstName: 'Player', lastName: 'Two' }),
    firestore.collection('users').doc(spotPlayerTwo.uid).set({ firstName: 'Spot', lastName: 'Three' }),
    firestore.collection('users').doc(spotPlayerThree.uid).set({ firstName: 'Spot', lastName: 'Four' }),
    firestore.collection('users').doc(brute.uid).set({ firstName: 'Rate', lastName: 'Limit' }),
    firestore.collection('users').doc(createBrute.uid).set({ firstName: 'Create', lastName: 'Limit' }),
    firestore.collection('squads').doc(squadId).set({ venueName: 'Fixture Field', isActive: true }),
    firestore.collection('squadMemberships').doc(`${squadId}__${hostA.uid}`).set({ squadId, userId: hostA.uid, membershipStatus: 'active' }),
    firestore.collection('squadMemberships').doc(`${squadId}__${player.uid}`).set({ squadId, userId: player.uid, membershipStatus: 'active' }),
  ]);

  await assert.rejects(
    () => anonymous.call('createGameJoinCode', { gameType: 'bombDefusal', idempotencyKey: 'anonymous-request-1' }),
    (error) => String(error?.code).includes('permission-denied'),
  );
  await assert.rejects(
    () => anonymous.call('resolveAndJoinGameByCode', { code: '7KPM' }),
    (error) => String(error?.code).includes('permission-denied'),
  );
  await assert.rejects(
    () => signedOut.call('createGameJoinCode', { gameType: 'bombDefusal', idempotencyKey: 'signed-out-request-1' }),
    (error) => String(error?.code).includes('unauthenticated'),
  );

  const createdBomb = await hostA.call('createGameJoinCode', {
    gameType: 'bombDefusal', idempotencyKey: 'bomb-host-request-1', squadId,
  });
  assert.match(createdBomb.joinCode, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
  assert.equal(/[01OI]/.test(createdBomb.joinCode), false);
  const repeatedBomb = await hostA.call('createGameJoinCode', {
    gameType: 'bombDefusal', idempotencyKey: 'bomb-host-request-1',
  });
  assert.equal(repeatedBomb.joinCode, createdBomb.joinCode);
  assert.equal(repeatedBomb.sessionId, createdBomb.sessionId);
  const repeatedBombBySession = await hostA.call('createGameJoinCode', {
    gameType: 'bombDefusal', sessionId: createdBomb.sessionId, idempotencyKey: 'bomb-host-request-2',
  });
  assert.equal(repeatedBombBySession.joinCode, createdBomb.joinCode);

  const bombSession = (await database.ref(`gameSessions/${createdBomb.sessionId}`).get()).val();
  assert.equal(bombSession.hostUserId, hostA.uid);
  assert.equal(bombSession.gameType, 'bomb_defusal');
  assert.equal(bombSession.squadId, squadId);
  assert.equal('joinCode' in bombSession, false, 'short routing credentials are not stored in queryable RTDB sessions');
  assert.equal('bombSteps' in bombSession.gameState, false, 'future Bomb steps are never participant-readable');
  assert.equal(typeof bombSession.gameState.currentStep?.type, 'string');
  const bombSecret = (await database.ref(`gameSessionSecrets/${createdBomb.sessionId}`).get()).val();
  assert.equal(Array.isArray(bombSecret.bombSteps), true);
  assert.equal(bombSecret.bombSteps.length, 5);

  const activeForHost = await hostA.call('getActiveSquadGameSession', { squadId });
  assert.deepEqual(
    Object.keys(activeForHost.session).sort(),
    ['callerIsParticipant', 'endsAtMs', 'gameType', 'sessionId', 'status'].sort(),
  );
  assert.equal(Number.isFinite(activeForHost.serverNowMs), true);
  assert.equal(activeForHost.session.callerIsParticipant, true);
  assert.equal(activeForHost.session.endsAtMs > activeForHost.serverNowMs, true);
  assert.equal(activeForHost.session.sessionId, createdBomb.sessionId);
  const lobbyForSquadMember = await player.call('getActiveSquadGameSession', { squadId });
  assert.equal(lobbyForSquadMember.session.sessionId, createdBomb.sessionId);
  assert.equal(lobbyForSquadMember.session.callerIsParticipant, false);
  await assert.rejects(
    () => outsider.call('getActiveSquadGameSession', { squadId }),
    (error) => String(error?.code).includes('permission-denied'),
  );
  await assert.rejects(
    () => anonymous.call('getActiveSquadGameSession', { squadId }),
    (error) => String(error?.code).includes('permission-denied'),
  );

  const mapping = (await firestore.collection('gameJoinCodes').doc(createdBomb.joinCode).get()).data();
  assert.deepEqual(
    Object.keys(mapping).sort(),
    ['code', 'createdAt', 'expiresAt', 'gameType', 'hostUserId', 'sessionId', 'status', 'updatedAt'].sort(),
  );
  assert.equal(['displayName', 'email', 'childId', 'location', 'token'].some((field) => field in mapping), false);
  await hostA.call('setRealtimeGamePlayerReady', { sessionId: createdBomb.sessionId, ready: true });
  await assert.rejects(
    () => hostA.call('updateGameJoinCodeStatus', {
      gameType: 'bombDefusal', sessionId: createdBomb.sessionId, status: 'started',
    }),
    hasReason('minimum_players_required'),
    'Bomb Defusal cannot start with only its host',
  );

  const pastedCode = `${createdBomb.joinCode.slice(0, 2).toLowerCase()}-${createdBomb.joinCode.slice(2).toLowerCase()}`;
  const joinedBomb = await player.call('resolveAndJoinGameByCode', { code: pastedCode });
  assert.equal(joinedBomb.gameType, 'bombDefusal');
  assert.equal(joinedBomb.sessionId, createdBomb.sessionId);
  assert.equal(joinedBomb.participantState, 'joined');
  assert.equal((await database.ref(`gameSessions/${createdBomb.sessionId}/players/${player.uid}`).get()).exists(), true);
  assert.equal(
    (await database.ref(`gameSessions/${createdBomb.sessionId}/players/${player.uid}/isReady`).get()).val(),
    false,
  );
  await assert.rejects(
    () => outsider.call('setRealtimeGamePlayerReady', { sessionId: createdBomb.sessionId, ready: true }),
    hasReason('not_authorized'),
  );
  const participantCode = await player.call('getGameJoinCodeForSession', {
    gameType: 'bombDefusal', sessionId: createdBomb.sessionId,
  });
  assert.equal(participantCode.joinCode, createdBomb.joinCode);

  await assert.rejects(
    () => hostA.call('updateGameJoinCodeStatus', {
      gameType: 'bombDefusal', sessionId: createdBomb.sessionId, status: 'started',
    }),
    hasReason('participants_not_ready'),
    'a host cannot start while any multiplayer participant is not ready',
  );
  assert.deepEqual(
    await player.call('setRealtimeGamePlayerReady', { sessionId: createdBomb.sessionId, ready: true }),
    { ready: true },
  );
  await hostA.call('updateGameJoinCodeStatus', {
    gameType: 'bombDefusal', sessionId: createdBomb.sessionId, status: 'started',
  });
  const firstBombStep = (await database.ref(`gameSessions/${createdBomb.sessionId}/gameState/currentStep`).get()).val();
  const firstBombAction = actionForBombStep(firstBombStep);
  const bombStepResult = await player.call('submitBombDefusalStep', {
    sessionId: createdBomb.sessionId,
    stepIndex: 0,
    action: firstBombAction,
    submissionId: 'bomb-step-idempotency-0001',
  });
  assert.equal(bombStepResult.correct, true);
  assert.equal(bombStepResult.nextStepIndex, 1);
  assert.deepEqual(
    bombStepResult.nextStep,
    (await database.ref(`gameSessions/${createdBomb.sessionId}/gameState/currentStep`).get()).val(),
    'only the newly revealed current step is returned',
  );
  assert.deepEqual(
    await player.call('submitBombDefusalStep', {
      sessionId: createdBomb.sessionId,
      stepIndex: 0,
      action: firstBombAction,
      submissionId: 'bomb-step-idempotency-0001',
    }),
    bombStepResult,
  );
  await assert.rejects(
    () => outsider.call('submitBombDefusalStep', {
      sessionId: createdBomb.sessionId,
      stepIndex: 1,
      action: { label: 'A' },
      submissionId: 'bomb-outsider-attempt-0001',
    }),
    hasReason('game_already_started'),
  );
  await assert.rejects(
    () => outsider.call('resolveAndJoinGameByCode', { code: createdBomb.joinCode }),
    hasReason('game_already_started'),
  );
  const reconnected = await player.call('resolveAndJoinGameByCode', { code: createdBomb.joinCode });
  assert.equal(reconnected.participantState, 'reconnected');
  let terminalBombResult = bombStepResult;
  for (let stepIndex = 1; stepIndex < 5; stepIndex += 1) {
    const currentStep = (
      await database.ref(`gameSessions/${createdBomb.sessionId}/gameState/currentStep`).get()
    ).val();
    terminalBombResult = await player.call('submitBombDefusalStep', {
      sessionId: createdBomb.sessionId,
      stepIndex,
      action: actionForBombStep(currentStep),
      submissionId: `bomb-terminal-step-${stepIndex}-0001`,
    });
  }
  assert.equal(terminalBombResult.outcome, 'defused');
  assert.equal(
    (await firestore.collection('gameJoinCodes').doc(createdBomb.joinCode).get()).data().status,
    'ended',
    'server completion closes the routing mapping without a client lifecycle write',
  );
  await assert.rejects(
    () => player.call('submitBombDefusalStep', {
      sessionId: createdBomb.sessionId,
      stepIndex: 4,
      action: actionForBombStep(bombSecret.bombSteps[4]),
      submissionId: 'bomb-terminal-step-4-0001',
    }),
    hasReason('game_already_started'),
    'a stored Bomb submission cannot be replayed after terminal state',
  );
  await assert.rejects(
    () => hostA.call('updateGameJoinCodeStatus', {
      gameType: 'bombDefusal', sessionId: createdBomb.sessionId, status: 'started',
    }),
    hasReason('game_already_started'),
    'a terminal session cannot be reopened',
  );

  const [spotA, spotB] = await Promise.all([
    hostA.call('createGameJoinCode', { gameType: 'spotTheDifferences', idempotencyKey: 'spot-host-request-a' }),
    hostB.call('createGameJoinCode', { gameType: 'spotTheDifferences', idempotencyKey: 'spot-host-request-b' }),
  ]);
  assert.notEqual(spotA.joinCode, spotB.joinCode);
  assert.notEqual(spotA.sessionId, spotB.sessionId);
  await database.ref(`gameSessions/${spotB.sessionId}/maxPlayers`).set(1);
  await assert.rejects(
    () => outsider.call('resolveAndJoinGameByCode', { code: spotB.joinCode }),
    hasReason('game_full'),
  );
  assert.equal(
    (await database.ref(`gameSessions/${spotA.sessionId}/players/${hostA.uid}/teamId`).get()).val(),
    'A',
    'the Spot host is first join order and starts on Team A',
  );
  await player.call('resolveAndJoinGameByCode', { code: spotA.joinCode });
  const duplicateSpotJoin = await player.call('resolveAndJoinGameByCode', { code: spotA.joinCode });
  assert.equal(duplicateSpotJoin.participantState, 'reconnected');
  await Promise.all([
    hostA.call('setRealtimeGamePlayerReady', { sessionId: spotA.sessionId, ready: true }),
    player.call('setRealtimeGamePlayerReady', { sessionId: spotA.sessionId, ready: true }),
  ]);
  await assert.rejects(
    () => hostA.call('updateGameJoinCodeStatus', {
      gameType: 'spotTheDifferences', sessionId: spotA.sessionId, status: 'started',
    }),
    hasReason('minimum_players_required'),
    'Spot the Difference cannot start with only two players',
  );
  await Promise.all([
    spotPlayerTwo.call('resolveAndJoinGameByCode', { code: spotA.joinCode }),
    spotPlayerThree.call('resolveAndJoinGameByCode', { code: spotA.joinCode }),
  ]);
  const spotLobbyPlayers = (await database.ref(`gameSessions/${spotA.sessionId}/players`).get()).val();
  const orderedSpotTeams = Object.values(spotLobbyPlayers)
    .sort((left, right) => left.joinOrder - right.joinOrder)
    .map((playerState) => playerState.teamId);
  assert.deepEqual(orderedSpotTeams, ['A', 'B', 'A', 'B']);
  await Promise.all([
    spotPlayerTwo.call('setRealtimeGamePlayerReady', { sessionId: spotA.sessionId, ready: true }),
    spotPlayerThree.call('setRealtimeGamePlayerReady', { sessionId: spotA.sessionId, ready: true }),
  ]);
  await hostA.call('updateGameJoinCodeStatus', { gameType: 'spotTheDifferences', sessionId: spotA.sessionId, status: 'started' });
  const spotStartedSession = (await database.ref(`gameSessions/${spotA.sessionId}`).get()).val();
  const spotScene = getCanonicalSpotScene(spotStartedSession.gameState.sceneId);
  const firstSpotDifference = spotScene.differences[0];
  const found = await player.call('recordSpotDifferenceFound', {
    sessionId: spotA.sessionId,
    x: firstSpotDifference.x,
    y: firstSpotDifference.y,
  });
  assert.equal(found.found, true);
  assert.equal(found.differenceId, firstSpotDifference.id);
  assert.equal(found.foundCount, 1);
  const playerTeamId = (await database.ref(`gameSessions/${spotA.sessionId}/players/${player.uid}/teamId`).get()).val();
  assert.deepEqual(
    (await database.ref(`gameSessionTeamState/${spotA.sessionId}/${playerTeamId}/foundDifferenceIds`).get()).val(),
    [firstSpotDifference.id],
  );
  assert.equal(
    (await database.ref(`gameSessions/${spotA.sessionId}/gameState/foundDifferenceIds`).get()).exists(),
    false,
    'active Spot discoveries are not stored in the participant-readable session node',
  );
  const oppositeTeamUid = Object.entries((await database.ref(`gameSessions/${spotA.sessionId}/players`).get()).val())
    .find(([, playerState]) => playerState.teamId !== playerTeamId)[0];
  const oppositeClient = [
    [hostA.uid, hostA],
    [player.uid, player],
    [spotPlayerTwo.uid, spotPlayerTwo],
    [spotPlayerThree.uid, spotPlayerThree],
  ].find(([uid]) => uid === oppositeTeamUid)[1];
  const oppositeFound = await oppositeClient.call('recordSpotDifferenceFound', {
    sessionId: spotA.sessionId,
    x: firstSpotDifference.x,
    y: firstSpotDifference.y,
  });
  assert.equal(oppositeFound.found, true, 'the same hotspot remains available to the other team');
  await assert.rejects(
    () => player.call('recordSpotDifferenceFound', { sessionId: spotA.sessionId, x: -1, y: 0.5 }),
    (error) => String(error?.code).includes('invalid-argument'),
  );
  await hostA.call('updateGameJoinCodeStatus', {
    gameType: 'spotTheDifferences', sessionId: spotA.sessionId, status: 'ended',
  });
  await assert.rejects(
    () => outsider.call('resolveAndJoinGameByCode', { code: spotA.joinCode }),
    hasReason('invalid_or_expired_code'),
  );

  const staleSpot = await hostA.call('createGameJoinCode', {
    gameType: 'spotTheDifferences',
    idempotencyKey: 'spot-expiration-request-a',
    squadId,
  });
  await Promise.all([
    player.call('resolveAndJoinGameByCode', { code: staleSpot.joinCode }),
    spotPlayerTwo.call('resolveAndJoinGameByCode', { code: staleSpot.joinCode }),
    spotPlayerThree.call('resolveAndJoinGameByCode', { code: staleSpot.joinCode }),
  ]);
  await Promise.all([
    hostA.call('setRealtimeGamePlayerReady', { sessionId: staleSpot.sessionId, ready: true }),
    player.call('setRealtimeGamePlayerReady', { sessionId: staleSpot.sessionId, ready: true }),
    spotPlayerTwo.call('setRealtimeGamePlayerReady', { sessionId: staleSpot.sessionId, ready: true }),
    spotPlayerThree.call('setRealtimeGamePlayerReady', { sessionId: staleSpot.sessionId, ready: true }),
  ]);
  await hostA.call('updateGameJoinCodeStatus', {
    gameType: 'spotTheDifferences',
    sessionId: staleSpot.sessionId,
    status: 'started',
  });
  const staleSpotSession = (await database.ref(`gameSessions/${staleSpot.sessionId}`).get()).val();
  const staleSpotDifference = getCanonicalSpotScene(staleSpotSession.gameState.sceneId).differences[1];
  await database.ref(`gameSessions/${staleSpot.sessionId}/startedAt`).set(Date.now() - 91_000);
  const expiredLookup = await hostA.call('getActiveSquadGameSession', { squadId });
  assert.equal(expiredLookup.session, null, 'a Spot session at zero seconds is never advertised as active');
  const expiredSession = (await database.ref(`gameSessions/${staleSpot.sessionId}`).get()).val();
  assert.equal(expiredSession.status, 'completed');
  assert.equal((await firestore.collection('gameJoinCodes').doc(staleSpot.joinCode).get()).data().status, 'expired');
  const firstCompletedAt = expiredSession.completedAt;
  assert.equal((await hostA.call('getActiveSquadGameSession', { squadId })).session, null);
  assert.equal(
    (await database.ref(`gameSessions/${staleSpot.sessionId}/completedAt`).get()).val(),
    firstCompletedAt,
    'expiration finalization is idempotent',
  );
  await assert.rejects(
    () => player.call('resolveAndJoinGameByCode', { code: staleSpot.joinCode }),
    hasReason('invalid_or_expired_code'),
  );
  await assert.rejects(
    () => player.call('recordSpotDifferenceFound', {
      sessionId: staleSpot.sessionId,
      x: staleSpotDifference.x,
      y: staleSpotDifference.y,
    }),
    hasReason('game_already_started'),
  );

  const expiredBombLobby = await hostB.call('createGameJoinCode', {
    gameType: 'bombDefusal',
    idempotencyKey: 'bomb-expired-lobby-request-1',
  });
  await database.ref(`gameSessions/${expiredBombLobby.sessionId}/expiresAt`).set(Date.now() - 1000);
  await assert.rejects(
    () => hostB.call('setRealtimeGamePlayerReady', {
      sessionId: expiredBombLobby.sessionId,
      ready: true,
    }),
    hasReason('invalid_or_expired_code'),
  );
  await assert.rejects(
    () => hostB.call('updateGameJoinCodeStatus', {
      gameType: 'bombDefusal',
      sessionId: expiredBombLobby.sessionId,
      status: 'started',
    }),
    hasReason('invalid_or_expired_code'),
  );
  const expiredActiveBomb = await hostB.call('createGameJoinCode', {
    gameType: 'bombDefusal',
    idempotencyKey: 'bomb-expired-active-request-1',
  });
  await spotPlayerTwo.call('resolveAndJoinGameByCode', { code: expiredActiveBomb.joinCode });
  await Promise.all([
    hostB.call('setRealtimeGamePlayerReady', {
      sessionId: expiredActiveBomb.sessionId,
      ready: true,
    }),
    spotPlayerTwo.call('setRealtimeGamePlayerReady', {
      sessionId: expiredActiveBomb.sessionId,
      ready: true,
    }),
  ]);
  await hostB.call('updateGameJoinCodeStatus', {
    gameType: 'bombDefusal',
    sessionId: expiredActiveBomb.sessionId,
    status: 'started',
  });
  const expiredBombStep = (
    await database.ref(`gameSessions/${expiredActiveBomb.sessionId}/gameState/currentStep`).get()
  ).val();
  await database.ref(`gameSessions/${expiredActiveBomb.sessionId}/expiresAt`).set(Date.now() - 1000);
  await assert.rejects(
    () => spotPlayerTwo.call('submitBombDefusalStep', {
      sessionId: expiredActiveBomb.sessionId,
      stepIndex: 0,
      action: actionForBombStep(expiredBombStep),
      submissionId: 'bomb-expired-active-step-0001',
    }),
    hasReason('game_already_started'),
  );
  assert.equal(
    (await database.ref(`gameSessions/${expiredActiveBomb.sessionId}/status`).get()).val(),
    'completed',
  );

  const createdTrivia = await hostA.call('createTriviaGameSession');
  const triviaSessionId = createdTrivia.sessionId;
  const triviaCode = await hostA.call('createGameJoinCode', {
    gameType: 'triviaBlitz', sessionId: triviaSessionId, idempotencyKey: 'trivia-host-request-1',
  });
  const joinedTrivia = await outsider.call('resolveAndJoinGameByCode', { code: triviaCode.joinCode.toLowerCase() });
  assert.equal(joinedTrivia.gameType, 'triviaBlitz');
  assert.equal(joinedTrivia.sessionId, triviaSessionId);
  const triviaAfter = (await firestore.collection('sessions').doc(triviaSessionId).collection('games').doc('triviaBlitz').get()).data();
  assert.equal('selectedQuestions' in triviaAfter, false, 'participant-readable Trivia state never contains answer keys');
  assert.equal(triviaAfter.questionCount, 10);
  assert.equal(
    (await firestore.collection('triviaGameSecrets').doc(triviaSessionId).get()).data().selectedQuestions.length,
    10,
    'joining never selects a second private Trivia question order',
  );
  assert.equal((await firestore.collection('sessions').doc(triviaSessionId).collection('games').doc('triviaBlitz').collection('players').doc(outsider.uid).get()).exists, true);

  await firestore.collection('gameJoinCodes').doc(spotB.joinCode).update({ expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000) });
  await assert.rejects(
    () => outsider.call('resolveAndJoinGameByCode', { code: spotB.joinCode }),
    hasReason('invalid_or_expired_code'),
  );

  await hostA.call('releaseGameJoinCode', { gameType: 'triviaBlitz', sessionId: triviaSessionId });
  assert.equal((await firestore.collection('sessions').doc(triviaSessionId).get()).data().status, 'results');
  assert.equal(
    (await firestore.collection('sessions').doc(triviaSessionId).collection('games').doc('triviaBlitz').get()).data().status,
    'results',
  );
  await assert.rejects(
    () => player.call('resolveAndJoinGameByCode', { code: triviaCode.joinCode }),
    hasReason('invalid_or_expired_code'),
  );

  let lastRateError = null;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    try {
      await brute.call('resolveAndJoinGameByCode', { code: 'ZZZZ' });
    } catch (error) {
      lastRateError = error;
    }
  }
  assert.equal(hasReason('rate_limited')(lastRateError), true);

  let lastCreateRateError = null;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    try {
      await createBrute.call('createGameJoinCode', {
        gameType: 'bombDefusal',
        idempotencyKey: `create-rate-request-${String(attempt).padStart(2, '0')}`,
      });
    } catch (error) {
      lastCreateRateError = error;
    }
  }
  assert.equal(
    hasReason('rate_limited')(lastCreateRateError),
    true,
    'creating join codes shares the server-side abuse limit',
  );

  console.log('Game Join Code Functions emulator creation, idempotency, joining, routing, reconnect, lifecycle, rate-limit, and canonical-session tests passed.');
  await admin.app().delete();
}

function actionForBombStep(step) {
  if (step.type === 'cut_wire') return { color: step.color };
  if (step.type === 'press_button') return { label: step.label };
  if (step.type === 'rotate_dial') return { target: step.target };
  if (step.type === 'enter_code') return { code: step.code };
  throw new Error(`Unknown Bomb Defusal step: ${String(step?.type)}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
