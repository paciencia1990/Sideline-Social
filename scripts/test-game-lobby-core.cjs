const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

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

function loadLobbyDirectoryState() {
  const source = fs.readFileSync(path.join(process.cwd(), 'utils', 'gameLobbyDirectoryState.ts'), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', output)(module, module.exports);
  return module.exports;
}

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
  const {
    createEmptyGameLobbyDirectoryResult,
    normalizeGameLobbyDirectoryResult,
    resolveGameLobbyDirectoryEligibility,
  } = loadLobbyDirectoryState();
  const emptyClientDirectory = {
    ...createEmptyGameLobbyDirectoryResult(),
    canCreateLobby: true,
    creationBlockReason: null,
    serverNowMs: NOW,
  };
  const eligibleInput = {
    authLoading: false,
    authenticated: true,
    accountLoading: false,
    accountError: false,
    accountStatus: 'active',
    membershipLoading: false,
    membershipError: false,
    squadId: 'squad-a',
    selectedSquadId: 'squad-a',
    hasActiveMembership: true,
    directoryLoading: false,
    directoryResolved: true,
    directoryError: null,
    directory: emptyClientDirectory,
    creating: false,
  };
  assert.equal(resolveGameLobbyDirectoryEligibility(eligibleInput).kind, 'eligible', 'an eligible user with no active lobby can start one');
  assert.equal(resolveGameLobbyDirectoryEligibility({ ...eligibleInput, directoryLoading: true }).kind, 'checking');
  assert.equal(resolveGameLobbyDirectoryEligibility({ ...eligibleInput, creating: true }).kind, 'creating', 'only the in-flight create state disables an otherwise eligible action');
  assert.equal(resolveGameLobbyDirectoryEligibility({ ...eligibleInput, creating: false }).kind, 'eligible', 'a failed create can return to an enabled state');
  assert.equal(resolveGameLobbyDirectoryEligibility({ ...eligibleInput, squadId: '', selectedSquadId: null }).kind, 'missingSquad');
  assert.equal(resolveGameLobbyDirectoryEligibility({ ...eligibleInput, hasActiveMembership: false }).kind, 'inactiveMembership');
  assert.equal(resolveGameLobbyDirectoryEligibility({ ...eligibleInput, accountStatus: 'messagingRestricted' }).kind, 'accountRestricted');
  assert.equal(resolveGameLobbyDirectoryEligibility({
    ...eligibleInput,
    directory: { ...emptyClientDirectory, lobbies: [lobby(1), lobby(2), lobby(3)], canCreateLobby: false, creationBlockReason: 'lobby_limit' },
  }).kind, 'lobbyLimit');
  assert.equal(resolveGameLobbyDirectoryEligibility({
    ...eligibleInput,
    directory: {
      ...emptyClientDirectory,
      canCreateLobby: false,
      activeLobbyId: 'bomb-lobby',
      activeLobby: {
        lobbyId: 'bomb-lobby', sessionId: 'bomb-session', squadId: 'squad-a', gameType: 'bombDefusal',
        state: 'active', activePlayerCount: 2, callerIsHost: false,
      },
      creationBlockReason: 'active_lobby',
    },
  }).kind, 'activeLobby', 'a genuine cross-game membership uses recovery UI');

  const legacyBlockedResponse = normalizeGameLobbyDirectoryResult({
    lobbies: [],
    canCreateLobby: false,
    activeLobbyId: 'stale-bomb-lobby',
    maxLobbiesPerGame: 3,
    serverNowMs: NOW,
  });
  assert.equal(legacyBlockedResponse.activeLobby, null, 'an omitted legacy activeLobby never becomes undefined');
  assert.equal(legacyBlockedResponse.creationBlockReason, 'eligibility_unavailable', 'an incomplete legacy conflict becomes a retryable state');
  assert.equal(resolveGameLobbyDirectoryEligibility({
    ...eligibleInput,
    directory: legacyBlockedResponse,
  }).kind, 'directoryUnavailable');

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
  const lobbyBase = source('components/LobbyBase.tsx');
  const lobbyRoutes = [
    source('app/(games)/bomb-defusal/Lobby.tsx'),
    source('app/(games)/spot-the-difference/Lobby.tsx'),
    source('app/(games)/trivia-blitz/Lobby.tsx'),
  ].join('\n');
  const joinCodeService = source('services/gameJoinCodeService.ts');
  const functionsSource = source('functions/src/gameJoinCodes.ts');
  const bomb = source('src/game/BombDefusalScreen.tsx');
  const spot = source('src/game/spotDifference/SpotDifferenceScreen.tsx');
  const trivia = source('src/game/triviaBlitz/TriviaBlitzScreen.tsx');

  assert.match(directoryScreen, /createGameLobby\(/, 'creation exists only behind an explicit directory action');
  assert.match(directoryScreen, /joinGameLobbyById\(/, 'lobby cards join by stable lobby ID');
  assert.match(directoryScreen, /startAnotherTitle/, 'Start Another Lobby requires confirmation');
  assert.match(directoryScreen, /ActiveLobbyRecoveryCard/, 'cross-game membership has a visible recovery card');
  assert.match(directoryScreen, /leaveGameLobby\(\{ lobbyId: activeLobby\.lobbyId \}\)/, 'recovery awaits the canonical leave operation');
  assert.match(directoryScreen, /activeElsewhereTitle/, 'the recovery card explains the active game conflict');
  assert.match(directoryScreen, /activeLobby\.activePlayerCount === 1/, 'recovery uses canonical membership count for sole-player closure confirmation');
  assert.match(directoryScreen, /games\.joinCode\.leaveAndCloseTitle/, 'recovery reuses the localized leave-and-close confirmation');
  assert.doesNotMatch(directoryScreen, /disabled=\{!canOfferCreate \|\| createBlocked\}/, 'Start Lobby is not silently disabled by opaque state');
  assert.match(directoryScreen, /createInFlightRef\.current/, 'rapid Start taps are guarded synchronously');
  assert.match(directoryScreen, /directoryRequestVersionRef\.current/, 'older directory responses cannot restore blocking state');
  assert.match(directoryScreen, /\[GameLobbyDirectory\] eligibility/, 'development diagnostics record the bounded eligibility reason');
  assert.match(directoryScreen, /onPress=\{\(\) => void handleCreate\(\)\}/, 'failed creation exposes the same idempotent create retry');
  assert.doesNotMatch(directoryScreen, /Platform\.(OS|select)[\s\S]{0,120}(eligib|canCreate|Start Lobby)/, 'Android and iOS share one eligibility path');
  assert.match(games, /resolveAndJoinGameByCode\(joinCode\)/, 'manual codes retain a secondary entry path');
  assert.doesNotMatch(lobbyHook, /createGameLobby|createGameJoinCode/, 'mounting a lobby never creates one');
  assert.match(lobbyHook, /await leaveGameLobby\(\{ lobbyId \}\)/, 'navigation waits for server-authoritative leave');
  assert.match(lobbyHook, /await closeGameLobby\(\{ lobbyId \}\)/, 'host closure waits for the backend');
  assert.match(lobbyHook, /if \(!isLocal && !lobbyId\)[\s\S]*setLifecycleError\('game_not_found'\)/, 'a missing canonical lobby ID keeps the user on-screen for retry');
  assert.match(lobbyHook, /suppressLobbyEventsRef/, 'stale listeners cannot resurrect a deliberately departed lobby');
  assert.match(lobbyHook, /departureCompletedRef/, 'completed departure permanently suppresses local reconnect effects');
  assert.match(lobbyBase, /onRetryLifecycle/, 'backend leave failures expose a retry action');
  assert.match(lobbyBase, /closeLobbyForEveryone/, 'hosts receive a separate close-for-everyone action');
  assert.equal((lobbyRoutes.match(/onCloseLobby=\{closeLobby\}/g) ?? []).length, 3, 'all released lobby routes wire host closure');
  assert.equal((lobbyRoutes.match(/lifecycleError=\{lifecycleError\}/g) ?? []).length, 3, 'all released lobby routes surface lifecycle failures');
  assert.doesNotMatch(`${games}\n${lobbyHook}\n${bomb}\n${spot}\n${trivia}`, /host:\s*["']1["']/);
  assert.match(joinCodeService, /joinGameLobbyById/);
  assert.match(joinCodeService, /startGameLobbyRematch/);
  assert.match(functionsSource, /MAX_DISCOVERABLE_GAME_LOBBIES/);
  assert.match(functionsSource, /activeGameLobbyMemberships/);
  assert.match(functionsSource, /gameLobbyCreateRequests/);
  assert.match(functionsSource, /createNextLobbyRound/);
  assert.match(functionsSource, /LOBBY_DEPARTURE_STALE_MS/, 'abandoned departure pointers have bounded recovery');
  assert.match(functionsSource, /hydrated\.summary\.callerState === 'none'/, 'canonical absence clears a stale lobby pointer');
  assert.match(`${bomb}\n${spot}\n${trivia}`, /startGameLobbyRematch/);

  console.log('Shared game lobby directory, join-action, routing, rematch, and client mount regression tests passed.');
}

run();
