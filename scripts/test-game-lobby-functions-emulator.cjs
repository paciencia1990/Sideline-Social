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

const projectId = process.env.GCLOUD_PROJECT || 'sideline-game-join-code-functions-test';
if (!admin.apps.length) {
  admin.initializeApp({ projectId, databaseURL: `https://${projectId}.firebaseio.com` });
}
const firestore = admin.firestore();
const database = admin.database();

async function createClient(label, authentication = 'password') {
  const app = initializeApp({ apiKey: 'demo-key', projectId }, `lobby-${label}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  let uid = null;
  if (authentication === 'password') {
    uid = (await createUserWithEmailAndPassword(auth, `${label}@example.test`, 'ValidPass123!')).user.uid;
  } else if (authentication === 'anonymous') {
    uid = (await signInAnonymously(auth)).user.uid;
  }
  const callableFunctions = getFunctions(app, 'us-central1');
  connectFunctionsEmulator(callableFunctions, '127.0.0.1', 5001);
  return {
    label,
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

async function acknowledgeSynchronizedStart(gameType, sessionId, hostClient, participantClients) {
  const prepared = await hostClient.call('prepareSynchronizedGameStart', { gameType, sessionId });
  for (const client of participantClients) {
    await client.call('acknowledgeSynchronizedGameStart', {
      gameType,
      sessionId,
      startAttemptId: prepared.startAttemptId,
    });
  }
  return prepared;
}

async function openRealtimeGameplayWindow(sessionId) {
  const now = Date.now();
  await database.ref(`gameSessions/${sessionId}`).update({
    countdownStartsAt: now - 3_900,
    gameplayStartsAt: now - 100,
    startedAt: now - 100,
  });
}

async function seedMember(client, squadId) {
  await Promise.all([
    firestore.collection('users').doc(client.uid).set({ firstName: client.label, lastName: 'Tester' }),
    firestore.collection('squadMemberships').doc(`${squadId}__${client.uid}`).set({
      squadId,
      userId: client.uid,
      membershipStatus: 'active',
    }),
  ]);
}

async function run() {
  const squadA = 'shared-lobby-squad-a';
  const squadB = 'shared-lobby-squad-b';
  const clients = await Promise.all(
    Array.from({ length: 30 }, (_, index) => createClient(`player-${String(index + 1).padStart(2, '0')}`)),
  );
  const anonymous = await createClient('anonymous', 'anonymous');
  const signedOut = await createClient('signed-out', 'none');
  await Promise.all([
    firestore.collection('squads').doc(squadA).set({ venueName: 'Shared Lobby Field', isActive: true }),
    firestore.collection('squads').doc(squadB).set({ venueName: 'Other Field', isActive: true }),
    ...clients.map((client) => seedMember(client, squadA)),
    seedMember(clients[19], squadB),
  ]);

  const triviaHost = clients[0];
  const simultaneousJoiners = clients.slice(1, 11);
  const codeJoiner = clients[11];
  const queuedPlayer = clients[12];

  await assert.rejects(
    () => anonymous.call('createGameLobby', {
      gameType: 'triviaBlitz', squadId: squadA, idempotencyKey: 'anonymous-create-1',
    }),
    (error) => String(error?.code).includes('permission-denied'),
  );
  await assert.rejects(
    () => signedOut.call('listGameLobbies', { squadId: squadA }),
    (error) => String(error?.code).includes('unauthenticated'),
  );
  await assert.rejects(
    () => triviaHost.call('createGameJoinCode', {
      gameType: 'triviaBlitz', idempotencyKey: 'legacy-create-without-session', squadId: squadA,
    }),
    hasReason('client_update_required'),
    'older clients cannot create personal sessions or codes',
  );

  const trivia = await triviaHost.call('createGameLobby', {
    gameType: 'triviaBlitz', squadId: squadA, idempotencyKey: 'trivia-main-lobby-create',
  });
  const triviaRetry = await triviaHost.call('createGameLobby', {
    gameType: 'triviaBlitz', squadId: squadA, idempotencyKey: 'trivia-main-lobby-create',
  });
  assert.equal(triviaRetry.lobbyId, trivia.lobbyId, 'a retried create returns the original stable lobby');
  assert.equal(triviaRetry.sessionId, trivia.sessionId);
  assert.equal(triviaRetry.joinCode, trivia.joinCode);

  const initialDirectory = await simultaneousJoiners[0].call('listGameLobbies', {
    gameType: 'triviaBlitz', squadId: squadA,
  });
  assert.equal(initialDirectory.lobbies.length, 1);
  assert.equal(initialDirectory.lobbies[0].isMain, true);
  assert.equal(initialDirectory.lobbies[0].lobbyNumber, 1);
  assert.equal('joinCode' in initialDirectory.lobbies[0], false, 'directory summaries never expose join codes');

  const sessionsBeforeJoin = (await firestore.collection('sessions').get()).docs
    .filter((document) => document.data().gameType === 'triviaBlitz').length;
  const codesBeforeJoin = (await firestore.collection('gameJoinCodes').get()).size;
  const directResults = await Promise.all(simultaneousJoiners.map((client) => client.call('joinGameLobbyById', {
    gameType: 'triviaBlitz', squadId: squadA, lobbyId: trivia.lobbyId,
  })));
  directResults.forEach((result) => {
    assert.equal(result.lobbyId, trivia.lobbyId);
    assert.equal(result.sessionId, trivia.sessionId);
  });
  assert.equal(
    (await firestore.collection('sessions').get()).docs
      .filter((document) => document.data().gameType === 'triviaBlitz').length,
    sessionsBeforeJoin,
    'ten simultaneous joins never create another session',
  );
  assert.equal((await firestore.collection('gameJoinCodes').get()).size, codesBeforeJoin, 'joining creates no code');
  assert.equal(
    (await firestore.collection('sessions').doc(trivia.sessionId).get()).data().playerIds.length,
    11,
  );

  const joinedByCode = await codeJoiner.call('resolveAndJoinGameByCode', {
    code: `${trivia.joinCode.slice(0, 2).toLowerCase()}-${trivia.joinCode.slice(2).toLowerCase()}`,
  });
  assert.equal(joinedByCode.lobbyId, trivia.lobbyId, 'manual code and lobby-card joining converge');
  assert.equal(joinedByCode.sessionId, trivia.sessionId);
  const reconnect = await simultaneousJoiners[0].call('joinGameLobbyById', {
    gameType: 'triviaBlitz', squadId: squadA, lobbyId: trivia.lobbyId,
  });
  assert.equal(reconnect.participantState, 'reconnected', 'a retried join is idempotent');
  await assert.rejects(
    () => simultaneousJoiners[0].call('createGameLobby', {
      gameType: 'bombDefusal', squadId: squadA, idempotencyKey: 'blocked-second-active-lobby',
    }),
    hasReason('already_participating_elsewhere'),
  );

  const triviaParent = firestore.collection('sessions').doc(trivia.sessionId);
  const triviaGame = triviaParent.collection('games').doc('triviaBlitz');
  await Promise.all([
    triviaParent.update({ status: 'playing', updatedAt: admin.firestore.Timestamp.now() }),
    triviaGame.update({ status: 'playing', updatedAt: admin.firestore.Timestamp.now() }),
  ]);
  const inProgressDirectory = await queuedPlayer.call('listGameLobbies', {
    gameType: 'triviaBlitz', squadId: squadA,
  });
  assert.equal(inProgressDirectory.lobbies[0].joinAction, 'joinNextRound');
  await queuedPlayer.call('joinGameLobbyNextRound', {
    gameType: 'triviaBlitz', squadId: squadA, lobbyId: trivia.lobbyId,
  });
  const queuedDirectory = await queuedPlayer.call('listGameLobbies', {
    gameType: 'triviaBlitz', squadId: squadA,
  });
  assert.equal(queuedDirectory.lobbies[0].callerState, 'queued');
  assert.equal(queuedDirectory.lobbies[0].queuedPlayerCount, 1);

  await Promise.all([
    triviaParent.update({ status: 'results', completedAt: admin.firestore.Timestamp.now() }),
    triviaGame.update({ status: 'results', updatedAt: admin.firestore.Timestamp.now() }),
  ]);
  const expectedNextHostId = (await triviaGame.collection('players').get()).docs
    .filter((player) => player.id !== triviaHost.uid)
    .sort((left, right) =>
      Number(left.data().joinOrder ?? left.data().playerIndex ?? Number.MAX_SAFE_INTEGER) -
        Number(right.data().joinOrder ?? right.data().playerIndex ?? Number.MAX_SAFE_INTEGER) ||
      left.id.localeCompare(right.id),
    )[0].id;
  const expectedNextHost = clients.find((client) => client.uid === expectedNextHostId);
  assert.ok(expectedNextHost, 'the promoted host is one of the canonical lobby participants');
  await triviaHost.call('listGameLobbies', { gameType: 'triviaBlitz', squadId: squadA });
  const departure = await triviaHost.call('leaveGameLobby', { lobbyId: trivia.lobbyId });
  assert.equal(departure.hostChanged, true, 'host departure transfers the same lobby');
  const codeAfterTransfer = (await firestore.collection('gameJoinCodes').doc(trivia.joinCode).get()).data();
  assert.equal(codeAfterTransfer.lobbyId, trivia.lobbyId);
  assert.equal(codeAfterTransfer.hostUserId, expectedNextHostId);

  const rematch = await expectedNextHost.call('startGameLobbyRematch', { lobbyId: trivia.lobbyId });
  assert.equal(rematch.lobbyId, trivia.lobbyId, 'rematches preserve the stable lobby ID');
  assert.equal(rematch.joinCode, trivia.joinCode, 'rematches preserve the stable code');
  assert.notEqual(rematch.sessionId, trivia.sessionId, 'each reward-bearing round has a fresh session ID');
  const rematchParent = (await firestore.collection('sessions').doc(rematch.sessionId).get()).data();
  assert.equal(rematchParent.playerIds.includes(queuedPlayer.uid), true, 'eligible queued players enter the rematch');
  assert.equal(rematchParent.playerIds.includes(triviaHost.uid), false, 'departed players stay removed');

  const spotCreators = clients.slice(13, 17);
  const spotMain = await spotCreators[0].call('createGameLobby', {
    gameType: 'spotTheDifferences', squadId: squadA, idempotencyKey: 'spot-explicit-lobby-1',
  });
  const spotTwo = await spotCreators[1].call('createGameLobby', {
    gameType: 'spotTheDifferences', squadId: squadA, idempotencyKey: 'spot-explicit-lobby-2',
  });
  const spotThree = await spotCreators[2].call('createGameLobby', {
    gameType: 'spotTheDifferences', squadId: squadA, idempotencyKey: 'spot-explicit-lobby-3',
  });
  const spotDirectory = await spotCreators[3].call('listGameLobbies', {
    gameType: 'spotTheDifferences', squadId: squadA,
  });
  assert.deepEqual(spotDirectory.lobbies.map((lobby) => lobby.lobbyNumber), [1, 2, 3]);
  assert.equal(spotDirectory.lobbies[0].isMain, true);
  assert.equal(spotDirectory.canCreateLobby, false);
  assert.equal(spotDirectory.creationBlockReason, 'lobby_limit');
  await assert.rejects(
    () => spotCreators[3].call('createGameLobby', {
      gameType: 'spotTheDifferences', squadId: squadA, idempotencyKey: 'spot-fourth-lobby-blocked',
    }),
    hasReason('lobby_limit_reached'),
  );

  await spotCreators[0].call('closeGameLobby', { lobbyId: spotMain.lobbyId });
  const promotedDirectory = await spotCreators[3].call('listGameLobbies', {
    gameType: 'spotTheDifferences', squadId: squadA,
  });
  assert.equal(promotedDirectory.lobbies.find((lobby) => lobby.isMain).lobbyId, spotTwo.lobbyId);
  const spotFour = await spotCreators[3].call('createGameLobby', {
    gameType: 'spotTheDifferences', squadId: squadA, idempotencyKey: 'spot-lobby-number-four',
  });
  assert.equal(spotFour.lobbyNumber, 4, 'lobby numbers are never recycled after Main Lobby promotion');

  const spotJoinerA = clients[17];
  const spotJoinerB = clients[18];
  const joinedSpotTwo = await spotJoinerA.call('joinGameLobbyById', {
    gameType: 'spotTheDifferences', squadId: squadA, lobbyId: spotTwo.lobbyId,
  });
  const joinedSpotThree = await spotJoinerB.call('resolveAndJoinGameByCode', { code: spotThree.joinCode });
  assert.equal(joinedSpotTwo.sessionId, spotTwo.sessionId);
  assert.equal(joinedSpotThree.sessionId, spotThree.sessionId);
  assert.equal((await database.ref(`gameSessions/${spotTwo.sessionId}/players/${spotJoinerA.uid}/teamId`).get()).val(), 'B');
  assert.equal((await database.ref(`gameSessions/${spotThree.sessionId}/players/${spotJoinerB.uid}/teamId`).get()).val(), 'B');
  await database.ref(`gameSessions/${spotTwo.sessionId}/maxPlayers`).set(2);
  await assert.rejects(
    () => clients[19].call('joinGameLobbyById', {
      gameType: 'spotTheDifferences', squadId: squadA, lobbyId: spotTwo.lobbyId,
    }),
    hasReason('game_full'),
  );
  await assert.rejects(
    () => clients[19].call('joinGameLobbyById', {
      gameType: 'bombDefusal', squadId: squadA, lobbyId: spotThree.lobbyId,
    }),
    hasReason('lobby_closed_or_expired'),
  );
  await assert.rejects(
    () => clients[19].call('joinGameLobbyById', {
      gameType: 'spotTheDifferences', squadId: squadB, lobbyId: spotThree.lobbyId,
    }),
    hasReason('lobby_closed_or_expired'),
  );

  await spotCreators[3].call('closeGameLobby', { lobbyId: spotFour.lobbyId });
  assert.equal((await firestore.collection('gameJoinCodes').doc(spotFour.joinCode).get()).data().status, 'canceled');
  await assert.rejects(
    () => clients[19].call('resolveAndJoinGameByCode', { code: spotFour.joinCode }),
    hasReason('invalid_or_expired_code'),
  );

  const soleHost = clients[20];
  const soleLobby = await soleHost.call('createGameLobby', {
    gameType: 'bombDefusal', squadId: squadA, idempotencyKey: 'sole-host-leave-lobby',
  });
  const soleBeforeLeave = await soleHost.call('listGameLobbies', { gameType: 'bombDefusal', squadId: squadA });
  assert.equal(soleBeforeLeave.activeLobby.lobbyId, soleLobby.lobbyId);
  assert.equal(soleBeforeLeave.activeLobby.activePlayerCount, 1);
  assert.equal(soleBeforeLeave.activeLobby.callerIsHost, true);
  const crossGameRecovery = await soleHost.call('listGameLobbies', {
    gameType: 'spotTheDifferences', squadId: squadA,
  });
  assert.equal(crossGameRecovery.activeLobby.lobbyId, soleLobby.lobbyId);
  assert.equal(crossGameRecovery.activeLobby.gameType, 'bombDefusal');
  assert.equal(crossGameRecovery.activeLobby.activePlayerCount, 1);
  assert.equal(crossGameRecovery.activeLobby.callerIsHost, true);
  assert.equal(crossGameRecovery.canCreateLobby, false);
  assert.equal(crossGameRecovery.creationBlockReason, 'active_lobby');
  let soleLeaveResult;
  try {
    soleLeaveResult = await soleHost.call('leaveGameLobby', { lobbyId: soleLobby.lobbyId });
  } catch (error) {
    throw new Error(`Sole-host leave failed: ${JSON.stringify({
      code: error?.code,
      details: error?.details,
      message: error?.message,
    })}`, { cause: error });
  }
  assert.equal(soleLeaveResult.status, 'closed');
  assert.deepEqual(
    await soleHost.call('leaveGameLobby', { lobbyId: soleLobby.lobbyId }),
    { status: 'left', hostChanged: false },
    'retrying a completed leave is idempotent',
  );
  assert.equal((await firestore.collection('activeGameLobbyMemberships').doc(soleHost.uid).get()).exists, false);
  assert.equal((await firestore.collection('gameJoinCodes').doc(soleLobby.joinCode).get()).data().status, 'canceled');
  assert.equal((await database.ref(`gameSessions/${soleLobby.sessionId}/gameState/rewardEligible`).get()).val(), false);
  const soleAfterLeave = await soleHost.call('listGameLobbies', { gameType: 'bombDefusal', squadId: squadA });
  assert.equal(soleAfterLeave.activeLobby, null);
  assert.equal(soleAfterLeave.canCreateLobby, true);
  assert.equal(soleAfterLeave.creationBlockReason, null);
  assert.equal(soleAfterLeave.lobbies.some((lobby) => lobby.lobbyId === soleLobby.lobbyId), false);
  const immediateCrossGame = await soleHost.call('createGameLobby', {
    gameType: 'spotTheDifferences', squadId: squadA, idempotencyKey: 'cross-game-after-leave',
  });
  assert.equal(immediateCrossGame.gameType, 'spotTheDifferences');
  await soleHost.call('closeGameLobby', { lobbyId: immediateCrossGame.lobbyId });
  await firestore.collection('activeGameLobbyMemberships').doc(soleHost.uid).set({
    lobbyId: 'missing-lobby',
    sessionId: 'missing-session',
    squadId: squadA,
    gameType: 'bombDefusal',
    state: 'active',
    updatedAt: admin.firestore.Timestamp.now(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60_000),
  });
  const repairedDirectory = await soleHost.call('listGameLobbies', {
    gameType: 'bombDefusal', squadId: squadA,
  });
  assert.equal(repairedDirectory.activeLobby, null, 'a missing lobby repairs its stale active pointer');
  assert.equal((await firestore.collection('activeGameLobbyMemberships').doc(soleHost.uid).get()).exists, false);

  const transferHost = clients[21];
  const abandonedBomb = await transferHost.call('createGameLobby', {
    gameType: 'bombDefusal', squadId: squadA, idempotencyKey: 'partial-bomb-departure',
  });
  await soleHost.call('joinGameLobbyById', {
    gameType: 'bombDefusal', squadId: squadA, lobbyId: abandonedBomb.lobbyId,
  });
  await firestore.collection('activeGameLobbyMemberships').doc(soleHost.uid).set({
    state: 'leaving',
    departureState: 'active',
    updatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 60_000),
  }, { merge: true });
  await database.ref(`gameSessions/${abandonedBomb.sessionId}/players/${soleHost.uid}`).remove();
  const repairedDeparture = await soleHost.call('listGameLobbies', {
    gameType: 'spotTheDifferences', squadId: squadA,
  });
  assert.equal(repairedDeparture.activeLobby, null, 'a partially completed Bomb departure is reconciled from canonical state');
  assert.equal(repairedDeparture.canCreateLobby, true);
  assert.equal(repairedDeparture.creationBlockReason, null);
  assert.equal((await firestore.collection('activeGameLobbyMemberships').doc(soleHost.uid).get()).exists, false);
  const spotAfterStaleBomb = await soleHost.call('createGameLobby', {
    gameType: 'spotTheDifferences', squadId: squadA, idempotencyKey: 'spot-after-stale-bomb-repair',
  });
  assert.equal(spotAfterStaleBomb.gameType, 'spotTheDifferences');
  await soleHost.call('closeGameLobby', { lobbyId: spotAfterStaleBomb.lobbyId });
  await transferHost.call('closeGameLobby', { lobbyId: abandonedBomb.lobbyId });

  const transferFirst = clients[22];
  const transferSecond = clients[23];
  const transferThird = clients[24];
  const transferLobby = await transferHost.call('createGameLobby', {
    gameType: 'bombDefusal', squadId: squadA, idempotencyKey: 'host-transfer-lobby',
  });
  const transferParticipants = [transferFirst, transferSecond, transferThird];
  await Promise.all(transferParticipants.map((client) =>
    client.call('joinGameLobbyById', {
      gameType: 'bombDefusal', squadId: squadA, lobbyId: transferLobby.lobbyId,
    })));
  const transferPlayers = (await database.ref(`gameSessions/${transferLobby.sessionId}/players`).get()).val();
  const orderedRemainingIds = Object.entries(transferPlayers)
    .filter(([uid]) => uid !== transferHost.uid)
    .sort(([leftId, left], [rightId, right]) =>
      Number(left.joinOrder) - Number(right.joinOrder) || leftId.localeCompare(rightId))
    .map(([uid]) => uid);
  const promotedHost = transferParticipants.find((client) => client.uid === orderedRemainingIds[0]);
  const nonHostLeaver = transferParticipants.find((client) => client.uid === orderedRemainingIds.at(-1));
  assert.ok(promotedHost && nonHostLeaver && promotedHost.uid !== nonHostLeaver.uid);
  const transferResult = await transferHost.call('leaveGameLobby', { lobbyId: transferLobby.lobbyId });
  assert.equal(transferResult.hostChanged, true);
  assert.equal(
    (await database.ref(`gameSessions/${transferLobby.sessionId}/hostUserId`).get()).val(),
    promotedHost.uid,
    'host transfers to the earliest remaining server join order',
  );
  assert.equal((await database.ref(`gameSessions/${transferLobby.sessionId}/players/${transferHost.uid}`).get()).exists(), false);
  await nonHostLeaver.call('leaveGameLobby', { lobbyId: transferLobby.lobbyId });
  assert.equal((await database.ref(`gameSessions/${transferLobby.sessionId}/players/${nonHostLeaver.uid}`).get()).exists(), false);
  const closeEveryone = await promotedHost.call('closeGameLobby', { lobbyId: transferLobby.lobbyId });
  assert.equal(closeEveryone.status, 'closed');
  assert.equal(closeEveryone.clearedParticipantCount, 2);
  for (const participant of [transferFirst, transferSecond, transferThird, transferHost]) {
    assert.equal(
      (await firestore.collection('activeGameLobbyMemberships').doc(participant.uid).get()).exists,
      false,
      'host closure clears every current or already-departed participant pointer',
    );
  }
  assert.equal((await database.ref(`gameSessions/${transferLobby.sessionId}/status`).get()).val(), 'canceled');
  assert.equal((await database.ref(`gameSessions/${transferLobby.sessionId}/gameState/rewardEligible`).get()).val(), false);
  assert.equal((await firestore.collection('gameJoinCodes').doc(transferLobby.joinCode).get()).data().status, 'canceled');

  const activeHost = clients[25];
  const activeLeaver = clients[26];
  const activeLobby = await activeHost.call('createGameLobby', {
    gameType: 'bombDefusal', squadId: squadA, idempotencyKey: 'active-leave-abandons-round',
  });
  await activeLeaver.call('joinGameLobbyById', {
    gameType: 'bombDefusal', squadId: squadA, lobbyId: activeLobby.lobbyId,
  });
  await Promise.all([activeHost, activeLeaver].map((client) =>
    client.call('setRealtimeGamePlayerReady', { sessionId: activeLobby.sessionId, ready: true })));
  await acknowledgeSynchronizedStart('bombDefusal', activeLobby.sessionId, activeHost, [activeHost, activeLeaver]);
  await openRealtimeGameplayWindow(activeLobby.sessionId);
  await activeLeaver.call('leaveGameLobby', { lobbyId: activeLobby.lobbyId });
  const abandonedSession = (await database.ref(`gameSessions/${activeLobby.sessionId}`).get()).val();
  assert.equal(abandonedSession.status, 'completed');
  assert.equal(abandonedSession.gameState.outcome, 'abandoned');
  assert.equal(abandonedSession.gameState.rewardEligible, false, 'an incomplete round cannot award rewards');
  assert.equal(abandonedSession.players[activeLeaver.uid], undefined);
  await activeHost.call('closeGameLobby', { lobbyId: activeLobby.lobbyId });

  const bombHost = clients[27];
  const bombSecond = clients[28];
  const bombThird = clients[29];
  const bombFourth = activeHost;
  const roleLobby = await bombHost.call('createGameLobby', {
    gameType: 'bombDefusal', squadId: squadA, idempotencyKey: 'role-based-bomb-round',
  });
  await bombSecond.call('joinGameLobbyById', {
    gameType: 'bombDefusal', squadId: squadA, lobbyId: roleLobby.lobbyId,
  });
  await bombThird.call('joinGameLobbyById', {
    gameType: 'bombDefusal', squadId: squadA, lobbyId: roleLobby.lobbyId,
  });
  await bombFourth.call('joinGameLobbyById', {
    gameType: 'bombDefusal', squadId: squadA, lobbyId: roleLobby.lobbyId,
  });
  const bombSecondJoinOrder = (await database
    .ref(`gameSessions/${roleLobby.sessionId}/players/${bombSecond.uid}/joinOrder`).get()).val();
  const provisionedBombSecret = (await database.ref(`gameSessionSecrets/${roleLobby.sessionId}`).get()).val();
  assert.equal(provisionedBombSecret.generatorVersion, 1);
  assert.match(provisionedBombSecret.generationSeed, /^[a-f0-9]{64}$/);
  assert.equal(provisionedBombSecret.bombSteps.length, 6);
  assert.equal(provisionedBombSecret.challengeFingerprints.length, 6);
  assert.ok(provisionedBombSecret.recentChallengeFingerprints.length <= 30);
  const bombReconnect = await bombSecond.call('joinGameLobbyById', {
    gameType: 'bombDefusal', squadId: squadA, lobbyId: roleLobby.lobbyId,
  });
  assert.equal(bombReconnect.participantState, 'reconnected');
  assert.equal(
    (await database.ref(`gameSessions/${roleLobby.sessionId}/players/${bombSecond.uid}/joinOrder`).get()).val(),
    bombSecondJoinOrder,
    'a Bomb reconnect preserves the frozen server join order',
  );
  const reconnectedBombSecret = (await database.ref(`gameSessionSecrets/${roleLobby.sessionId}`).get()).val();
  assert.equal(reconnectedBombSecret.generationSeed, provisionedBombSecret.generationSeed, 'reconnects reuse the stored seed');
  assert.deepEqual(reconnectedBombSecret.bombSteps, provisionedBombSecret.bombSteps, 'reconnects never regenerate the command sequence');
  await Promise.all([bombHost, bombSecond, bombThird, bombFourth].map((client) =>
    client.call('setRealtimeGamePlayerReady', { sessionId: roleLobby.sessionId, ready: true })));
  await acknowledgeSynchronizedStart(
    'bombDefusal',
    roleLobby.sessionId,
    bombHost,
    [bombHost, bombSecond, bombThird, bombFourth],
  );
  await assert.rejects(
    () => bombHost.call('getBombDefusalPlayerView', { sessionId: roleLobby.sessionId }),
    hasReason('game_not_started'),
  );
  await openRealtimeGameplayWindow(roleLobby.sessionId);
  const [hostView, secondView, thirdView, fourthView] = await Promise.all([
    bombHost.call('getBombDefusalPlayerView', { sessionId: roleLobby.sessionId }),
    bombSecond.call('getBombDefusalPlayerView', { sessionId: roleLobby.sessionId }),
    bombThird.call('getBombDefusalPlayerView', { sessionId: roleLobby.sessionId }),
    bombFourth.call('getBombDefusalPlayerView', { sessionId: roleLobby.sessionId }),
  ]);
  assert.equal(hostView.role, 'defuser');
  assert.equal(secondView.role, 'expert');
  assert.equal(thirdView.role, 'support');
  assert.equal(fourthView.role, 'support');
  assert.equal(hostView.instruction, null, 'Defuser cannot read the private command');
  assert.equal(thirdView.instruction, null, 'Support Crew cannot read the private command');
  assert.equal(fourthView.instruction, null, 'all Support Crew views hide the private command');
  assert.ok(secondView.instruction, 'only the Command Expert receives the instruction');
  assert.equal('challengeId' in secondView.instruction, false, 'server-only challenge IDs stay out of the Expert view');
  assert.equal('correctOptionId' in secondView.instruction, false, 'the Expert view does not reveal the answer');
  assert.deepEqual(hostView.publicCommand, secondView.publicCommand);
  assert.deepEqual(hostView.publicCommand, thirdView.publicCommand);
  assert.deepEqual(hostView.publicCommand, fourthView.publicCommand);
  assert.equal('correctAnswer' in hostView.publicCommand, false);
  assert.equal('solution' in hostView && hostView.solution === null, true, 'live views do not reveal a solution');
  const publicBombSession = (await database.ref(`gameSessions/${roleLobby.sessionId}`).get()).val();
  for (const publicValue of [publicBombSession, hostView, secondView, thirdView, fourthView]) {
    const serialized = JSON.stringify(publicValue);
    assert.equal(serialized.includes('generationSeed'), false, 'the generation seed remains server-only');
    assert.equal(serialized.includes('challengeFingerprints'), false, 'semantic fingerprints remain server-only');
    assert.equal(serialized.includes('recentChallengeFingerprints'), false, 'replay history remains server-only');
  }
  const initialBombSecret = (await database.ref(`gameSessionSecrets/${roleLobby.sessionId}`).get()).val();
  assert.equal(initialBombSecret.bombSteps.length, 6);
  assert.deepEqual(initialBombSecret.bombSteps.map((command) => command.stage), [
    'direct', 'interpretation', 'reasoning', 'reasoning', 'reasoning', 'combined',
  ]);
  assert.equal(new Set(initialBombSecret.bombSteps.slice(2, 5).map((command) => command.category)).size, 3);
  const secondSpanishView = await bombSecond.call('getBombDefusalPlayerView', {
    sessionId: roleLobby.sessionId,
    locale: 'es',
  });
  assert.notEqual(secondSpanishView.instruction.prompt, secondView.instruction.prompt, 'the Expert clue is localized per caller');
  const firstAction = await bombActionForSession(database, roleLobby.sessionId, true);
  await assert.rejects(
    () => bombSecond.call('submitBombDefusalStep', {
      sessionId: roleLobby.sessionId,
      commandId: secondView.commandId,
      action: firstAction,
      submissionId: 'expert-cannot-submit-command-1',
    }),
    hasReason('bomb_not_defuser'),
  );
  await assert.rejects(
    () => soleHost.call('getBombDefusalPlayerView', { sessionId: roleLobby.sessionId }),
    hasReason('not_authorized'),
  );
  const firstSubmission = await bombHost.call('submitBombDefusalStep', {
    sessionId: roleLobby.sessionId,
    commandId: hostView.commandId,
    action: firstAction,
    submissionId: 'defuser-command-idempotent-1',
  });
  assert.equal(firstSubmission.correct, true);
  assert.deepEqual(
    await bombHost.call('submitBombDefusalStep', {
      sessionId: roleLobby.sessionId,
      commandId: hostView.commandId,
      action: firstAction,
      submissionId: 'defuser-command-idempotent-1',
    }),
    firstSubmission,
  );
  await assert.rejects(
    () => bombHost.call('submitBombDefusalStep', {
      sessionId: roleLobby.sessionId,
      commandId: hostView.commandId,
      action: firstAction,
      submissionId: 'stale-command-replay-0001',
    }),
    hasReason('bomb_command_stale'),
  );
  const [rotatedHost, rotatedDefuser, rotatedExpert] = await Promise.all([
    bombHost.call('getBombDefusalPlayerView', { sessionId: roleLobby.sessionId }),
    bombSecond.call('getBombDefusalPlayerView', { sessionId: roleLobby.sessionId }),
    bombThird.call('getBombDefusalPlayerView', { sessionId: roleLobby.sessionId }),
  ]);
  assert.equal(rotatedHost.role, 'support');
  assert.equal(rotatedDefuser.role, 'defuser');
  assert.equal(rotatedExpert.role, 'expert');
  const simultaneousAction = await bombActionForSession(database, roleLobby.sessionId, true);
  const simultaneousResults = await Promise.allSettled([
    bombSecond.call('submitBombDefusalStep', {
      sessionId: roleLobby.sessionId,
      commandId: rotatedDefuser.commandId,
      action: simultaneousAction,
      submissionId: 'simultaneous-command-choice-a',
    }),
    bombSecond.call('submitBombDefusalStep', {
      sessionId: roleLobby.sessionId,
      commandId: rotatedDefuser.commandId,
      action: simultaneousAction,
      submissionId: 'simultaneous-command-choice-b',
    }),
  ]);
  assert.equal(simultaneousResults.filter((result) => result.status === 'fulfilled').length, 1, 'only one simultaneous choice is accepted');
  assert.equal(simultaneousResults.filter((result) => result.status === 'rejected').length, 1);

  const activeThirdView = await bombThird.call('getBombDefusalPlayerView', { sessionId: roleLobby.sessionId });
  assert.equal(activeThirdView.role, 'defuser');
  await bombThird.call('leaveGameLobby', { lobbyId: roleLobby.lobbyId });
  const [afterDefuserLeaveHost, afterDefuserLeaveFourth] = await Promise.all([
    bombHost.call('getBombDefusalPlayerView', { sessionId: roleLobby.sessionId }),
    bombFourth.call('getBombDefusalPlayerView', { sessionId: roleLobby.sessionId }),
  ]);
  assert.equal(afterDefuserLeaveHost.role, 'expert', 'an active Defuser departure safely reassigns both active roles');
  assert.equal(afterDefuserLeaveFourth.role, 'defuser');

  await bombSecond.call('leaveGameLobby', { lobbyId: roleLobby.lobbyId });
  const [twoPlayerDefuser, twoPlayerExpert] = await Promise.all([
    bombHost.call('getBombDefusalPlayerView', { sessionId: roleLobby.sessionId }),
    bombFourth.call('getBombDefusalPlayerView', { sessionId: roleLobby.sessionId }),
  ]);
  assert.equal(twoPlayerDefuser.role, 'defuser', 'two-player rotation follows frozen surviving join order');
  assert.equal(twoPlayerExpert.role, 'expert');
  const beforeWrongState = (await database.ref(`gameSessions/${roleLobby.sessionId}/gameState`).get()).val();
  const terminalBombResult = await bombHost.call('submitBombDefusalStep', {
    sessionId: roleLobby.sessionId,
    commandId: twoPlayerDefuser.commandId,
    action: await bombActionForSession(database, roleLobby.sessionId, false),
    submissionId: 'one-wrong-move-detonates',
  });
  assert.equal(terminalBombResult.correct, false);
  assert.equal(terminalBombResult.strikeCount, 1);
  assert.equal(terminalBombResult.outcome, 'exploded');
  const afterWrongState = (await database.ref(`gameSessions/${roleLobby.sessionId}/gameState`).get()).val();
  assert.equal(afterWrongState.currentCommandIndex, beforeWrongState.currentCommandIndex, 'a wrong move does not advance');
  assert.equal(afterWrongState.roleRevision, beforeWrongState.roleRevision, 'a wrong move does not rotate roles');
  const explodedView = await bombHost.call('getBombDefusalPlayerView', { sessionId: roleLobby.sessionId });
  assert.equal(explodedView.outcome, 'exploded');
  assert.ok(explodedView.solution?.correctOptionId, 'terminal participants receive the correct answer');
  assert.ok(explodedView.solution?.explanation, 'terminal participants receive a concise explanation');
  const postDetonationAction = await bombActionForSession(database, roleLobby.sessionId, true);
  await assert.rejects(
    () => bombHost.call('submitBombDefusalStep', {
      sessionId: roleLobby.sessionId,
      commandId: twoPlayerDefuser.commandId,
      action: postDetonationAction,
      submissionId: 'post-detonation-command',
    }),
    hasReason('game_already_started'),
  );
  const bombRematch = await bombHost.call('startGameLobbyRematch', { lobbyId: roleLobby.lobbyId });
  assert.equal(bombRematch.lobbyId, roleLobby.lobbyId);
  assert.equal(bombRematch.joinCode, roleLobby.joinCode);
  assert.notEqual(bombRematch.sessionId, roleLobby.sessionId, 'a rematch provisions fresh trusted round state');
  const bombRematchState = (await database.ref(`gameSessions/${bombRematch.sessionId}/gameState`).get()).val();
  assert.equal(bombRematchState.roleSchemaVersion, 3);
  assert.equal(bombRematchState.strikeCount, 0);
  assert.equal(bombRematchState.currentCommandId ?? null, null);
  const rematchSecret = (await database.ref(`gameSessionSecrets/${bombRematch.sessionId}`).get()).val();
  assert.notDeepEqual(rematchSecret.challengeIds, initialBombSecret.challengeIds, 'the complete challenge sequence changes on rematch');
  assert.notEqual(rematchSecret.generationSeed, initialBombSecret.generationSeed, 'a rematch receives a fresh cryptographic seed');
  assert.equal(rematchSecret.generatorVersion, 1);
  assert.equal(rematchSecret.bombSteps.length, 6);
  assert.equal(rematchSecret.challengeFingerprints.length, 6);
  assert.ok(rematchSecret.recentChallengeFingerprints.length <= 30, 'server-only replay history remains bounded to five rounds');
  assert.ok(
    initialBombSecret.challengeFingerprints.every((fingerprint) => rematchSecret.recentChallengeFingerprints.includes(fingerprint)),
    'the rematch carries forward the previous semantic fingerprints',
  );
  assert.ok(
    rematchSecret.challengeFingerprints.filter((fingerprint) => initialBombSecret.challengeFingerprints.includes(fingerprint)).length <= 2,
    'the rematch differs materially from the immediately previous round',
  );
  await Promise.all([bombHost, bombFourth].map((client) =>
    client.call('setRealtimeGamePlayerReady', { sessionId: bombRematch.sessionId, ready: true })));
  await acknowledgeSynchronizedStart('bombDefusal', bombRematch.sessionId, bombHost, [bombHost, bombFourth]);
  await openRealtimeGameplayWindow(bombRematch.sessionId);
  for (let commandIndex = 0; commandIndex < 6; commandIndex += 1) {
    const [hostCommandView, fourthCommandView] = await Promise.all([
      bombHost.call('getBombDefusalPlayerView', { sessionId: bombRematch.sessionId }),
      bombFourth.call('getBombDefusalPlayerView', { sessionId: bombRematch.sessionId }),
    ]);
    const defuserClient = hostCommandView.role === 'defuser' ? bombHost : bombFourth;
    const defuserView = hostCommandView.role === 'defuser' ? hostCommandView : fourthCommandView;
    const result = await defuserClient.call('submitBombDefusalStep', {
      sessionId: bombRematch.sessionId,
      commandId: defuserView.commandId,
      action: await bombActionForSession(database, bombRematch.sessionId, true),
      submissionId: `successful-rematch-command-${commandIndex + 1}`,
    });
    assert.equal(result.correct, true);
    assert.equal(result.outcome, commandIndex === 5 ? 'defused' : 'playing');
  }
  const completedRematchView = await bombHost.call('getBombDefusalPlayerView', { sessionId: bombRematch.sessionId });
  assert.equal(completedRematchView.outcome, 'defused');
  assert.equal(completedRematchView.correctCommandCount, 6);
  await bombHost.call('closeGameLobby', { lobbyId: roleLobby.lobbyId });
  for (const participant of [bombHost, bombSecond, bombThird, bombFourth]) {
    assert.equal((await firestore.collection('activeGameLobbyMemberships').doc(participant.uid).get()).exists, false);
  }

  const timeoutLobby = await bombHost.call('createGameLobby', {
    gameType: 'bombDefusal', squadId: squadA, idempotencyKey: 'server-authoritative-bomb-timeout',
  });
  await bombThird.call('joinGameLobbyById', {
    gameType: 'bombDefusal', squadId: squadA, lobbyId: timeoutLobby.lobbyId,
  });
  await Promise.all([bombHost, bombThird].map((client) =>
    client.call('setRealtimeGamePlayerReady', { sessionId: timeoutLobby.sessionId, ready: true })));
  await acknowledgeSynchronizedStart('bombDefusal', timeoutLobby.sessionId, bombHost, [bombHost, bombThird]);
  await openRealtimeGameplayWindow(timeoutLobby.sessionId);
  await bombSecond.call('joinGameLobbyNextRound', {
    gameType: 'bombDefusal', squadId: squadA, lobbyId: timeoutLobby.lobbyId,
  });
  assert.equal((await database.ref(`gameSessions/${timeoutLobby.sessionId}/queuedPlayers/${bombSecond.uid}`).get()).exists(), true);
  await bombSecond.call('leaveGameLobby', { lobbyId: timeoutLobby.lobbyId });
  assert.equal((await database.ref(`gameSessions/${timeoutLobby.sessionId}/queuedPlayers/${bombSecond.uid}`).get()).exists(), false);
  await database.ref(`gameSessions/${timeoutLobby.sessionId}/endsAt`).set(Date.now() - 1);
  const timedOutBombView = await bombHost.call('getBombDefusalPlayerView', { sessionId: timeoutLobby.sessionId });
  assert.equal(timedOutBombView.outcome, 'exploded');
  const timedOutBombState = (await database.ref(`gameSessions/${timeoutLobby.sessionId}/gameState`).get()).val();
  assert.equal(timedOutBombState.completionReason, 'timeout');
  assert.equal(timedOutBombState.rewardEligible, true, 'only a completed server timeout remains reward eligible');
  await bombHost.call('closeGameLobby', { lobbyId: timeoutLobby.lobbyId });

  const rateUser = clients[19];
  let rateError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rateUser.call('createGameLobby', {
        gameType: 'bombDefusal', squadId: squadA, idempotencyKey: `rate-lobby-${attempt}`,
      });
    } catch (error) {
      rateError = error;
    }
  }
  assert.equal(hasReason('rate_limited')(rateError), true, 'explicit creation has a conservative per-user rate limit');

  console.log('Shared lobby Functions emulator tests passed: creation, idempotent leave, cross-game recovery, host transfer, close-for-everyone, abandonment, secure Bomb roles, simultaneous submissions, authorization, and cleanup.');
  await admin.app().delete();
}

run().catch(async (error) => {
  console.error(error?.stack ?? error);
  if (admin.apps.length) await admin.app().delete().catch(() => undefined);
  process.exit(1);
});

async function bombActionForSession(database, sessionId, correct) {
  const [sessionSnapshot, secretSnapshot] = await Promise.all([
    database.ref(`gameSessions/${sessionId}/gameState`).get(),
    database.ref(`gameSessionSecrets/${sessionId}/bombSteps`).get(),
  ]);
  const state = sessionSnapshot.val();
  const commands = secretSnapshot.val();
  const command = commands?.[state?.currentCommandIndex];
  assert.ok(command?.correctOptionId, 'the emulator needs a server-side canonical answer');
  if (correct) return { optionId: command.correctOptionId };
  const wrongOption = command.options.find((option) => option.id !== command.correctOptionId);
  assert.ok(wrongOption?.id, 'every challenge needs a safe incorrect test option');
  return { optionId: wrongOption.id };
}
