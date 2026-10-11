const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function loadDepartureModule() {
  const output = ts.transpileModule(read("utils/gameRoomDeparture.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", output)(loaded, loaded.exports);
  return loaded.exports;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function run() {
  const {
    createGameRoomDepartureCoordinator,
    createGameRoomDepartureNavigationController,
  } = loadDepartureModule();

  let releaseLeave;
  let leaveCalls = 0;
  const firstLeave = new Promise((resolve) => { releaseLeave = resolve; });
  const coordinator = createGameRoomDepartureCoordinator(async () => {
    leaveCalls += 1;
    await firstLeave;
  });
  const concurrentA = coordinator.depart();
  const concurrentB = coordinator.depart();
  await Promise.resolve();
  assert.equal(leaveCalls, 1, "simultaneous exit signals share one authoritative leave");
  releaseLeave();
  await Promise.all([concurrentA, concurrentB]);
  await coordinator.depart();
  assert.equal(leaveCalls, 1, "a completed departure is idempotent");

  const backLeave = deferred();
  let backLeaveCalls = 0;
  let resumedBackActions = 0;
  const backController = createGameRoomDepartureNavigationController({
    leaveRoom: async () => {
      backLeaveCalls += 1;
      await backLeave.promise;
    },
    classifyError: () => "network_unavailable",
  });
  const blockedBack = backController.handlePreventedRemoval(
    { type: "GO_BACK" },
    () => { resumedBackActions += 1; },
  );
  await Promise.resolve();
  assert.equal(backLeaveCalls, 1, "platform back starts the authoritative cleanup");
  assert.equal(resumedBackActions, 0, "platform back remains blocked while cleanup is pending");
  backLeave.resolve();
  assert.equal(await blockedBack, true);
  assert.equal(resumedBackActions, 1, "the original back action resumes after cleanup");

  let retryLeaveCalls = 0;
  let retryNavigations = 0;
  const retryStates = [];
  const retryController = createGameRoomDepartureNavigationController({
    leaveRoom: async () => {
      retryLeaveCalls += 1;
      if (retryLeaveCalls === 1) throw new Error("offline");
    },
    classifyError: () => "network_unavailable",
    onStateChange: (state) => retryStates.push({ ...state }),
  });
  assert.equal(
    await retryController.handlePreventedRemoval(
      { type: "GO_BACK" },
      () => { retryNavigations += 1; },
    ),
    false,
    "a failed platform-back cleanup does not leave the room",
  );
  assert.equal(retryNavigations, 0, "the failed destination is not dispatched");
  assert.deepEqual(
    retryController.getState(),
    {
      departed: false,
      departing: false,
      error: "network_unavailable",
      hasPendingNavigation: true,
    },
    "the waiting lobby receives a visible, retryable failure state",
  );
  assert.equal(retryStates.at(-1).error, "network_unavailable");
  assert.equal(await retryController.retryDeparture(), true, "Retry reuses the pending destination");
  assert.equal(retryLeaveCalls, 2, "Retry makes one fresh idempotent leave request");
  assert.equal(retryNavigations, 1, "Retry resumes the original destination exactly once");
  assert.equal(retryController.getState().hasPendingNavigation, false);

  const competingLeave = deferred();
  let competingLeaveCalls = 0;
  let firstDestination = 0;
  let finalDestination = 0;
  const competingController = createGameRoomDepartureNavigationController({
    leaveRoom: async () => {
      competingLeaveCalls += 1;
      await competingLeave.promise;
    },
    classifyError: () => "network_unavailable",
  });
  const firstExit = competingController.departAndNavigate(() => { firstDestination += 1; });
  const finalExit = competingController.departAndNavigate(() => { finalDestination += 1; });
  await Promise.resolve();
  assert.equal(competingLeaveCalls, 1, "competing exits share one leave request");
  competingLeave.resolve();
  await Promise.all([firstExit, finalExit]);
  assert.equal(firstDestination, 0, "a superseded destination is not dispatched");
  assert.equal(finalDestination, 1, "only the final competing destination is dispatched");

  let retainedLeaveCalls = 0;
  let retainedTransitions = 0;
  const retainedController = createGameRoomDepartureNavigationController({
    leaveRoom: async () => { retainedLeaveCalls += 1; },
    classifyError: () => "network_unavailable",
  });
  let playAgainTransition;
  retainedController.continueWithinRoom((params) => {
    queueMicrotask(() => {
      playAgainTransition = retainedController.handlePreventedRemoval(
        { type: "REPLACE", payload: { name: "Lobby", params } },
        () => { retainedTransitions += 1; },
      );
    });
  });
  await Promise.resolve();
  assert.equal(await playAgainTransition, true);
  let gameStartTransition;
  retainedController.continueWithinRoom((params) => {
    queueMicrotask(() => {
      gameStartTransition = retainedController.handlePreventedRemoval(
        { type: "REPLACE", payload: { name: "play", params } },
        () => { retainedTransitions += 1; },
      );
    });
  });
  await Promise.resolve();
  assert.equal(await gameStartTransition, true);
  assert.equal(retainedLeaveCalls, 0, "Play Again and lobby-to-game transitions retain membership");
  assert.equal(retainedTransitions, 2, "both retained transitions continue through the guard");

  let externalExitNavigations = 0;
  assert.equal(
    await retainedController.handlePreventedRemoval(
      { type: "REPLACE", payload: { name: "(tabs)" } },
      () => { externalExitNavigations += 1; },
    ),
    true,
  );
  assert.equal(retainedLeaveCalls, 1, "an external exit after a retained transition still performs cleanup");
  assert.equal(externalExitNavigations, 1, "the external destination resumes after cleanup");

  let cancelledLeaveCalls = 0;
  const cancelledController = createGameRoomDepartureNavigationController({
    leaveRoom: async () => { cancelledLeaveCalls += 1; },
    classifyError: () => "network_unavailable",
  });
  cancelledController.continueWithinRoom(() => undefined);
  await Promise.resolve();
  await cancelledController.handlePreventedRemoval({ type: "GO_BACK" }, () => undefined);
  assert.equal(cancelledLeaveCalls, 1, "a cancelled retained transition cannot bypass a later back departure");

  let supersededLeaveCalls = 0;
  let supersededParams;
  const supersededController = createGameRoomDepartureNavigationController({
    leaveRoom: async () => { supersededLeaveCalls += 1; },
    classifyError: () => "network_unavailable",
  });
  supersededController.continueWithinRoom((params) => { supersededParams = params; });
  supersededController.continueWithinRoom(() => undefined);
  await Promise.resolve();
  await supersededController.handlePreventedRemoval(
    { type: "REPLACE", payload: { name: "Lobby", params: supersededParams } },
    () => undefined,
  );
  assert.equal(supersededLeaveCalls, 1, "a superseded retained transition cannot bypass later departure");

  const hook = read("hooks/useGameRoomDeparture.ts");
  const lobbyHook = read("hooks/useGameLobby.ts");
  const endActions = read("components/GameEndActions.tsx");
  const startGate = read("components/SynchronizedGameStartGate.tsx");
  const bomb = read("src/game/BombDefusalScreen.tsx");
  const spot = read("src/game/spotDifference/SpotDifferenceScreen.tsx");
  const trivia = read("src/game/triviaBlitz/TriviaBlitzScreen.tsx");
  const games = `${bomb}\n${spot}\n${trivia}`;
  const functionsSource = read("functions/src/gameJoinCodes.ts");

  assert.match(hook, /usePreventRemove/, "the supported native-stack removal guard is installed");
  assert.doesNotMatch(hook, /navigation\.addListener\(["']beforeRemove/, "no raw beforeRemove blocker remains");
  assert.match(hook, /handlePreventedRemoval/, "guard callbacks use the tested departure controller");
  assert.match(hook, /leaveGameLobby\(\{ lobbyId \}\)/, "all exits use the canonical leave operation");
  assert.doesNotMatch(hook, /AppState/, "temporary backgrounding does not cause a departure");
  assert.match(lobbyHook, /lifecycleError \?\? roomDeparture\.departureError/, "waiting-lobby back failures are visible");
  assert.match(lobbyHook, /roomDeparture\.hasPendingNavigation\(\)/, "waiting-lobby Retry resumes guarded navigation");
  assert.match(lobbyHook, /roomDeparture\.continueWithinRoom/, "lobby-to-round navigation retains membership");
  assert.match(startGate, /roomDeparture\.departAndNavigate/, "start failures cannot navigate away before leaving");
  assert.doesNotMatch(startGate, /leaveGameLobby\([^)]*\)\.catch\(\(\) => undefined\)/, "leave failures are never discarded");

  assert.equal((games.match(/useGameRoomDeparture/g) ?? []).length >= 6, true, "all three lobby games own departure handling");
  assert.equal((games.match(/roomDeparture\.continueWithinRoom/g) ?? []).length >= 6, true, "Play Again retains the room for hosts and participants");
  assert.equal((games.match(/roomDeparture\.departAndNavigate/g) ?? []).length >= 9, true, "lobby list, Games, and Home all depart first");
  assert.doesNotMatch(games, /catch\s*\{\s*openLobbyDirectory\(\)/, "a rematch failure cannot silently remove the player");
  assert.match(endActions, /game\.backToLobbies/, "results offer a clear Back to Lobbies choice");
  assert.match(endActions, /departureFailed/, "results retain a visible retry path after cleanup failure");

  assert.match(functionsSource, /activeGameLobbyMemberships/, "server departure owns the active-room association");
  assert.match(functionsSource, /beginLobbyDeparture/, "server departure fences concurrent cleanup");
  assert.match(functionsSource, /transferLobbyHostRecords/, "remaining players retain a host after host departure");
  assert.match(functionsSource, /queuedPlayers/, "queued seats are included in canonical cleanup");

  console.log("Game lobby departure guard, navigation recovery, retained transitions, and idempotency regressions passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
