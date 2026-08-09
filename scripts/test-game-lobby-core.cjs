const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_DISCOVERABLE_GAME_LOBBIES,
  GameLobbyLimitError,
  addGameLobbyToDirectory,
  createEmptyGameLobbyDirectory,
  normalizeGameLobbyDirectory,
  removeGameLobbyFromDirectory,
  resolveGameLobbyJoinAction,
} = require('../functions/lib/gameLobbyCore.js');

const NOW = 1_800_000_000_000;

function lobby(number, overrides = {}) {
  return {
    lobbyId: `lobby-${number}`,
    sessionId: `session-${number}`,
    gameType: 'triviaBlitz',
    squadId: 'squad-a',
    lobbyNumber: number,
    hostUserId: `host-${number}`,
    hostDisplayName: `Host ${number}`,
    status: 'waiting',
    activePlayerCount: 1,
    queuedPlayerCount: 0,
    capacity: 20,
    createdAtMs: NOW + number,
    updatedAtMs: NOW + number,
    expiresAtMs: NOW + 60_000,
    ...overrides,
  };
}

function run() {
  let directory = createEmptyGameLobbyDirectory('squad-a', 'triviaBlitz');
  assert.equal(directory.mainLobbyId, null, 'an empty Squad/game directory has no implicit lobby');

  directory = addGameLobbyToDirectory(directory, lobby(1));
  assert.equal(directory.mainLobbyId, 'lobby-1', 'the first explicit lobby becomes Main Lobby');
  directory = addGameLobbyToDirectory(directory, lobby(2));
  directory = addGameLobbyToDirectory(directory, lobby(3));
  assert.equal(Object.keys(directory.lobbies).length, MAX_DISCOVERABLE_GAME_LOBBIES);
  assert.equal(directory.nextLobbyNumber, 4, 'lobby numbers are monotonic and server-controlled');
  assert.throws(() => addGameLobbyToDirectory(directory, lobby(4)), GameLobbyLimitError);

  directory = removeGameLobbyFromDirectory(directory, 'lobby-1');
  assert.equal(directory.mainLobbyId, 'lobby-2', 'closing Main Lobby promotes the earliest eligible lobby');
  assert.equal(directory.nextLobbyNumber, 4, 'promotion never recycles an old lobby number');

  const normalized = normalizeGameLobbyDirectory({
    ...directory,
    lobbies: {
      ...directory.lobbies,
      expired: lobby(9, { lobbyId: 'expired', expiresAtMs: NOW - 1 }),
    },
  }, 'squad-a', 'triviaBlitz', NOW);
  assert.equal(normalized.lobbies.expired, undefined, 'expired lobbies are not discoverable');

  assert.equal(resolveGameLobbyJoinAction({
    callerState: 'none', status: 'waiting', activePlayerCount: 2, queuedPlayerCount: 0, capacity: 20,
  }), 'join');
  assert.equal(resolveGameLobbyJoinAction({
    callerState: 'active', status: 'inProgress', activePlayerCount: 2, queuedPlayerCount: 0, capacity: 20,
  }), 'reconnect');
  assert.equal(resolveGameLobbyJoinAction({
    callerState: 'none', status: 'inProgress', activePlayerCount: 2, queuedPlayerCount: 0, capacity: 20,
  }), 'joinNextRound');
  assert.equal(resolveGameLobbyJoinAction({
    callerState: 'queued', status: 'inProgress', activePlayerCount: 2, queuedPlayerCount: 1, capacity: 20,
  }), 'queued');
  assert.equal(resolveGameLobbyJoinAction({
    callerState: 'none', status: 'waiting', activePlayerCount: 20, queuedPlayerCount: 0, capacity: 20,
  }), 'full');

  const root = path.resolve(__dirname, '..');
  const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
  const games = source('app/(tabs)/games.tsx');
  const directoryScreen = source('app/(games)/lobbies.tsx');
  const lobbyHook = source('hooks/useGameLobby.ts');
  const joinCodeService = source('services/gameJoinCodeService.ts');
  const functionsSource = source('functions/src/gameJoinCodes.ts');
  const bomb = source('src/game/BombDefusalScreen.tsx');
  const spot = source('src/game/spotDifference/SpotDifferenceScreen.tsx');
  const trivia = source('src/game/triviaBlitz/TriviaBlitzScreen.tsx');

  assert.match(directoryScreen, /createGameLobby\(/, 'creation exists only behind an explicit directory action');
  assert.match(directoryScreen, /joinGameLobbyById\(/, 'lobby cards join by stable lobby ID');
  assert.match(directoryScreen, /startAnotherTitle/, 'Start Another Lobby requires confirmation');
  assert.match(games, /resolveAndJoinGameByCode\(joinCode\)/, 'manual codes retain a secondary entry path');
  assert.doesNotMatch(lobbyHook, /createGameLobby|createGameJoinCode/, 'mounting a lobby never creates one');
  assert.doesNotMatch(`${games}\n${lobbyHook}\n${bomb}\n${spot}\n${trivia}`, /host:\s*["']1["']/);
  assert.match(joinCodeService, /joinGameLobbyById/);
  assert.match(joinCodeService, /startGameLobbyRematch/);
  assert.match(functionsSource, /MAX_DISCOVERABLE_GAME_LOBBIES/);
  assert.match(functionsSource, /activeGameLobbyMemberships/);
  assert.match(functionsSource, /gameLobbyCreateRequests/);
  assert.match(functionsSource, /createNextLobbyRound/);
  assert.match(`${bomb}\n${spot}\n${trivia}`, /startGameLobbyRematch/);

  console.log('Shared game lobby directory, join-action, routing, rematch, and client mount regression tests passed.');
}

run();
