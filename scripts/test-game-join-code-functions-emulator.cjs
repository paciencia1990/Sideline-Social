const assert = require('node:assert/strict');
const admin = require('../functions/node_modules/firebase-admin');
const { initializeApp } = require('firebase/app');
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } = require('firebase/auth');
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require('firebase/functions');

const projectId = process.env.GCLOUD_PROJECT || 'sideline-game-join-code-functions-test';
if (!admin.apps.length) {
  admin.initializeApp({ projectId, databaseURL: `https://${projectId}.firebaseio.com` });
}
const firestore = admin.firestore();
const database = admin.database();

async function createClient(label, authenticated = true) {
  const app = initializeApp({ apiKey: 'demo-key', projectId }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  let uid = null;
  if (authenticated) {
    const credential = await createUserWithEmailAndPassword(auth, `${label}@example.test`, 'ValidPass123!');
    uid = credential.user.uid;
  }
  const callableFunctions = getFunctions(app, 'us-central1');
  connectFunctionsEmulator(callableFunctions, '127.0.0.1', 5001);
  return {
    uid,
    call: (name, data = {}) => httpsCallable(callableFunctions, name)(data).then((result) => result.data),
  };
}

function hasReason(reason) {
  return (error) => error?.details?.reason === reason || String(error?.message).includes(reason);
}

async function run() {
  const squadId = 'active-game-squad';
  const [hostA, hostB, player, outsider, brute, anonymous] = await Promise.all([
    createClient('join-host-a'),
    createClient('join-host-b'),
    createClient('join-player'),
    createClient('join-outsider'),
    createClient('join-brute'),
    createClient('join-anonymous', false),
  ]);
  await Promise.all([
    firestore.collection('users').doc(hostA.uid).set({ firstName: 'Host', lastName: 'Alpha' }),
    firestore.collection('users').doc(hostB.uid).set({ firstName: 'Host', lastName: 'Beta' }),
    firestore.collection('users').doc(player.uid).set({ firstName: 'Player', lastName: 'One' }),
    firestore.collection('users').doc(outsider.uid).set({ firstName: 'Player', lastName: 'Two' }),
    firestore.collection('users').doc(brute.uid).set({ firstName: 'Rate', lastName: 'Limit' }),
    firestore.collection('squads').doc(squadId).set({ venueName: 'Fixture Field', isActive: true }),
    firestore.collection('squadMemberships').doc(`${squadId}__${hostA.uid}`).set({ squadId, userId: hostA.uid, membershipStatus: 'active' }),
    firestore.collection('squadMemberships').doc(`${squadId}__${player.uid}`).set({ squadId, userId: player.uid, membershipStatus: 'active' }),
  ]);

  await assert.rejects(
    () => anonymous.call('createGameJoinCode', { gameType: 'bombDefusal', idempotencyKey: 'anonymous-request-1' }),
    (error) => String(error?.code).includes('unauthenticated'),
  );
  await assert.rejects(
    () => anonymous.call('resolveAndJoinGameByCode', { code: '7KPM' }),
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
  assert.equal(Array.isArray(bombSession.gameState.bombSteps), true);
  assert.equal(bombSession.gameState.bombSteps.length, 5);

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
    (error) => String(error?.code).includes('unauthenticated'),
  );

  const mapping = (await firestore.collection('gameJoinCodes').doc(createdBomb.joinCode).get()).data();
  assert.deepEqual(
    Object.keys(mapping).sort(),
    ['code', 'createdAt', 'expiresAt', 'gameType', 'hostUserId', 'sessionId', 'status', 'updatedAt'].sort(),
  );
  assert.equal(['displayName', 'email', 'childId', 'location', 'token'].some((field) => field in mapping), false);

  const pastedCode = `${createdBomb.joinCode.slice(0, 2).toLowerCase()}-${createdBomb.joinCode.slice(2).toLowerCase()}`;
  const joinedBomb = await player.call('resolveAndJoinGameByCode', { code: pastedCode });
  assert.equal(joinedBomb.gameType, 'bombDefusal');
  assert.equal(joinedBomb.sessionId, createdBomb.sessionId);
  assert.equal(joinedBomb.participantState, 'joined');
  assert.equal((await database.ref(`gameSessions/${createdBomb.sessionId}/players/${player.uid}`).get()).exists(), true);
  const participantCode = await player.call('getGameJoinCodeForSession', {
    gameType: 'bombDefusal', sessionId: createdBomb.sessionId,
  });
  assert.equal(participantCode.joinCode, createdBomb.joinCode);

  await hostA.call('updateGameJoinCodeStatus', {
    gameType: 'bombDefusal', sessionId: createdBomb.sessionId, status: 'started',
  });
  await assert.rejects(
    () => outsider.call('resolveAndJoinGameByCode', { code: createdBomb.joinCode }),
    hasReason('game_already_started'),
  );
  const reconnected = await player.call('resolveAndJoinGameByCode', { code: createdBomb.joinCode });
  assert.equal(reconnected.participantState, 'reconnected');
  await hostA.call('updateGameJoinCodeStatus', {
    gameType: 'bombDefusal', sessionId: createdBomb.sessionId, status: 'ended',
  });

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
  await player.call('resolveAndJoinGameByCode', { code: spotA.joinCode });
  await database.ref(`gameSessions/${spotA.sessionId}/status`).set('active');
  await hostA.call('updateGameJoinCodeStatus', { gameType: 'spotTheDifferences', sessionId: spotA.sessionId, status: 'started' });
  const found = await player.call('recordSpotDifferenceFound', { sessionId: spotA.sessionId, differenceId: 'difference_1' });
  assert.equal(found.foundCount, 1);
  assert.deepEqual((await database.ref(`gameSessions/${spotA.sessionId}/gameState/foundDifferenceIds`).get()).val(), ['difference_1']);
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
  await player.call('resolveAndJoinGameByCode', { code: staleSpot.joinCode });
  await hostA.call('updateGameJoinCodeStatus', {
    gameType: 'spotTheDifferences',
    sessionId: staleSpot.sessionId,
    status: 'started',
  });
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
    () => player.call('recordSpotDifferenceFound', { sessionId: staleSpot.sessionId, differenceId: 'difference_2' }),
    hasReason('game_already_started'),
  );

  const triviaSessionId = 'triviaCanonicalSessionA';
  const questionOrder = [{ id: 'question-1', options_en: ['A', 'B', 'C', 'D'], answer: 0 }];
  await firestore.collection('sessions').doc(triviaSessionId).set({
    sessionId: triviaSessionId, gameId: 'triviaBlitz', gameType: 'triviaBlitz', hostPlayerId: hostA.uid,
    playerIds: [hostA.uid], status: 'lobby', createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now(),
  });
  await firestore.collection('sessions').doc(triviaSessionId).collection('games').doc('triviaBlitz').set({
    status: 'lobby', hostPlayerId: hostA.uid, selectedQuestions: questionOrder, totalPlayers: 1, allReady: false,
  });
  await firestore.collection('sessions').doc(triviaSessionId).collection('games').doc('triviaBlitz').collection('players').doc(hostA.uid).set({
    name: 'Host Alpha', playerIndex: 0, score: 0, ready: false,
  });
  const triviaCode = await hostA.call('createGameJoinCode', {
    gameType: 'triviaBlitz', sessionId: triviaSessionId, idempotencyKey: 'trivia-host-request-1',
  });
  const joinedTrivia = await outsider.call('resolveAndJoinGameByCode', { code: triviaCode.joinCode.toLowerCase() });
  assert.equal(joinedTrivia.gameType, 'triviaBlitz');
  assert.equal(joinedTrivia.sessionId, triviaSessionId);
  const triviaAfter = (await firestore.collection('sessions').doc(triviaSessionId).collection('games').doc('triviaBlitz').get()).data();
  assert.deepEqual(triviaAfter.selectedQuestions, questionOrder, 'joining never selects a second Trivia question order');
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

  console.log('Game Join Code Functions emulator creation, idempotency, joining, routing, reconnect, lifecycle, rate-limit, and canonical-session tests passed.');
  await admin.app().delete();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
