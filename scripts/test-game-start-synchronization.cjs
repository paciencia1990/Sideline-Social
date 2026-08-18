"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText, filename);
};

const root = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const client = require(path.join(root, "utils", "gameStartSynchronization.ts"));
const backend = require(path.join(root, "functions", "src", "gameStartSynchronizationCore.ts"));

const timeline = backend.nextSharedGameTimeline(100_000);
assert.equal(timeline.countdownStartsAtMs, 102_500);
assert.equal(timeline.gameplayStartsAtMs, 106_300);
assert.equal(timeline.countdownStartsAtMs - 100_000, backend.GAME_START_SAFETY_LEAD_MS);

const state = {
  schemaVersion: client.GAME_START_SCHEMA_VERSION,
  gameType: "bombDefusal",
  sessionId: "session-a",
  lobbyId: "lobby-a",
  hostUserId: "host",
  startAttemptId: "attempt-current",
  phase: "scheduled",
  participantCount: 3,
  acknowledgedCount: 3,
  readinessDeadlineAtMs: 120_000,
  ...timeline,
  failureReason: null,
};

assert.equal(client.deriveGameStartVisiblePhase(state, 102_499), "preparing");
assert.equal(client.deriveGameStartVisiblePhase(state, 102_500), "3");
assert.equal(client.deriveGameStartVisiblePhase(state, 103_500), "2");
assert.equal(client.deriveGameStartVisiblePhase(state, 104_500), "1");
assert.equal(client.deriveGameStartVisiblePhase(state, 105_500), "go");
assert.equal(client.deriveGameStartVisiblePhase(state, 106_300), "active");
assert.equal(client.deriveGameStartVisiblePhase(state, 108_000), "active", "Late clients skip elapsed phases.");

for (const [localNow, offset] of [[101_500, 1_000], [103_000, -500], [92_500, 10_000]]) {
  const adjusted = client.serverAdjustedNow(localNow, offset);
  assert.equal(adjusted, 102_500, "Clock skew must normalize to the shared server instant.");
  assert.equal(client.deriveGameStartVisiblePhase(state, adjusted), "3");
}

const first = backend.appendReadinessAcknowledgement([], "host", ["host", "a", "b"]);
const duplicate = backend.appendReadinessAcknowledgement(first.acknowledgedUserIds, "host", ["host", "a", "b"]);
assert.deepEqual(duplicate, first, "Duplicate acknowledgements must be idempotent.");
assert.equal(backend.appendReadinessAcknowledgement([], "outsider", ["host", "a", "b"]), null);
const allReady = backend.appendReadinessAcknowledgement(["host", "a"], "b", ["host", "a", "b"]);
assert.equal(allReady.allReady, true);

const frozen = [
  { uid: "host", joinOrder: 1, teamId: "A", role: "defuser" },
  { uid: "a", joinOrder: 2, teamId: "B", role: "expert" },
];
assert.equal(backend.participantSnapshotMatches(frozen, [...frozen].reverse()), true);
assert.equal(backend.participantSnapshotMatches(frozen, frozen.slice(0, 1)), false, "A departure invalidates the frozen snapshot.");
assert.equal(backend.participantSnapshotMatches(frozen, [{ ...frozen[0], role: "expert" }, frozen[1]]), false);

const preparing = { ...state, phase: "preparing", readinessDeadlineAtMs: 110_000, countdownStartsAtMs: null, gameplayStartsAtMs: null };
assert.equal(client.deriveGameStartVisiblePhase(preparing, 109_999), "preparing");
assert.equal(client.deriveGameStartVisiblePhase(preparing, 110_000), "timedOut");
assert.equal(client.deriveGameStartVisiblePhase(null, 110_000), "updateRequired");

const hook = read("hooks", "useGameLobby.ts");
const gate = read("components", "SynchronizedGameStartGate.tsx");
const overlay = read("components", "CountdownOverlay.tsx");
const joinFunctions = read("functions", "src", "gameJoinCodes.ts");
const triviaFunctions = read("functions", "src", "triviaGame.ts");
const rules = read("database.rules.json");
const firestoreRules = read("firestore.rules");
const routes = [
  read("app", "games", "bomb-defusal", "play.tsx"),
  read("app", "games", "spot-the-difference", "play.tsx"),
  read("app", "games", "trivia-blitz", "play.tsx"),
].join("\n");

assert.match(hook, /prepareSynchronizedGameStart/u);
assert.doesNotMatch(hook, /updateGameJoinCodeStatus\(\{ gameType, sessionId, status: 'started'/u);
assert.match(gate, /\.info\/serverTimeOffset|useFirebaseServerClock/u);
assert.match(gate, /AppState\.addEventListener/u, "Foregrounding must recompute the shared phase.");
assert.match(gate, /preloadSynchronizedGameRound/u);
assert.match(gate, /acknowledgeSynchronizedGameStart/u);
assert.match(overlay, /phase\?: "3" \| "2" \| "1" \| "go"/u);
assert.equal((routes.match(/import SynchronizedGameStartGate/gu) ?? []).length, 3, "All three routes must import the gate.");
assert.equal((routes.match(/<SynchronizedGameStartGate gameType=/gu) ?? []).length, 3, "All three routes must mount the gate.");
assert.match(joinFunctions, /randomBytes\(18\)\.toString\('base64url'\)/u, "Each retry/rematch receives a fresh attempt ID.");
assert.match(joinFunctions, /gameplayStartsAt > Date\.now\(\)/u, "Spot reads/actions must be server-gated.");
assert.match(joinFunctions, /initialSession\.gameplayStartsAt > Date\.now\(\)/u, "Bomb submissions must be server-gated.");
assert.match(triviaFunctions, /now\.toMillis\(\) < gameplayStartsAt\.toMillis\(\)/u, "Trivia answers must be server-gated.");
assert.match(joinFunctions, /throw safeError\('failed-precondition', 'client_update_required'\)/u, "Legacy direct starts must fail safely.");
assert.match(rules, /gameplayStartsAt/u, "Realtime reads must not reveal game state before gameplay starts.");
assert.match(firestoreRules, /match \/gameStartStates\/\{stateId\}/u);
assert.match(firestoreRules, /allow list, create, update, delete: if false/u);

console.log("Server-authoritative game-start timing, readiness, privacy, and route checks passed.");
