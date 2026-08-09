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
    Array.from({ length: 20 }, (_, index) => createClient(`player-${String(index + 1).padStart(2, '0')}`)),
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

  console.log('Shared lobby Functions emulator tests passed: explicit creation, idempotency, simultaneous direct joins, code convergence, queue, rematch, host transfer, limits, authorization, and cleanup.');
  await admin.app().delete();
}

run().catch(async (error) => {
  console.error(error?.stack ?? error);
  if (admin.apps.length) await admin.app().delete().catch(() => undefined);
  process.exit(1);
});
