const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

function loadTypeScript(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(require, loaded, loaded.exports);
  return loaded.exports;
}

const { resolveJoinableGameSession } = loadTypeScript("functions/src/gameJoinSessionState.ts");
const nowMs = 1_000_000;
const base = {
  status: "lobby",
  startedAtMs: null,
  endsAtMs: nowMs + 60_000,
  durationSeconds: null,
  joinCodeStatus: "lobby",
  participantCount: 2,
  capacity: 12,
  nowMs,
};

assert.deepEqual(resolveJoinableGameSession(base), {
  isActive: true,
  isJoinable: true,
  isExpired: false,
  reason: "lobby",
  endsAtMs: nowMs + 60_000,
});
assert.equal(resolveJoinableGameSession({ ...base, participantCount: 12 }).reason, "full");
assert.equal(resolveJoinableGameSession({ ...base, participantCount: 12 }).isJoinable, false);

const playing = resolveJoinableGameSession({
  ...base,
  status: "active",
  startedAtMs: nowMs - 30_000,
  durationSeconds: 90,
  joinCodeStatus: "started",
  callerIsParticipant: true,
});
assert.equal(playing.isActive, true);
assert.equal(playing.isJoinable, true);
assert.equal(playing.reason, "playing");
assert.equal(playing.endsAtMs, nowMs + 60_000);
assert.equal(resolveJoinableGameSession({ ...base, status: "active", joinCodeStatus: "started" }).isJoinable, false);
assert.equal(resolveJoinableGameSession({
  ...base,
  status: "active",
  startedAtMs: null,
  endsAtMs: null,
  durationSeconds: 90,
  joinCodeStatus: "started",
  callerIsParticipant: true,
}).reason, "unknown", "active state without a trusted start/end is rejected");

for (const [status, reason] of [
  ["completed", "completed"],
  ["ended", "completed"],
  ["failed", "completed"],
  ["canceled", "canceled"],
  ["cancelled", "canceled"],
  ["abandoned", "completed"],
  ["expired", "expired"],
]) {
  const result = resolveJoinableGameSession({ ...base, status });
  assert.equal(result.isActive, false, status);
  assert.equal(result.isJoinable, false, status);
  assert.equal(result.reason, reason, status);
}

const zeroSeconds = resolveJoinableGameSession({
  ...base,
  status: "active",
  startedAtMs: nowMs - 90_000,
  endsAtMs: null,
  durationSeconds: 90,
  joinCodeStatus: "started",
  callerIsParticipant: true,
});
assert.equal(zeroSeconds.isExpired, true);
assert.equal(zeroSeconds.isActive, false, "Spot the Differences at 0 seconds is never active");

const functionSource = read("functions", "src", "gameJoinCodes.ts");
assert.match(functionSource, /serverNowMs = Date\.now\(\)/);
assert.match(functionSource, /expireRealtimeGameSession/);
assert.match(functionSource, /status: 'expired'/);
assert.match(
  functionSource,
  /startRealtimeGameSession[\s\S]*reference\.transaction[\s\S]*startedAt: typeof session\.startedAt === 'number' \? session\.startedAt : serverNowMs/,
  "game start time is normalized inside the trusted RTDB transaction",
);
assert.match(
  functionSource,
  /playerEntries\.length < configuredMinimum[\s\S]*participants_not_ready/,
  "minimum-player and readiness checks execute in the same trusted start path",
);
assert.match(functionSource, /resolveRealtimeJoinState\(initialSession, joinCodeStatus, uid, Date\.now\(\)\)/);

const serviceSource = read("services", "gameService.ts");
const hookSource = read("hooks", "useActiveSquadGameSession.ts");
assert.match(serviceSource, /expiresAtLocalMs: Date\.now\(\) \+ Math\.max\(0, endsAtMs - serverNowMs\)/);
assert.match(hookSource, /useFocusEffect/);
assert.match(hookSource, /AppState\.addEventListener/);
assert.match(hookSource, /setTimeout\(\(\) => clearAndRefresh\(session\), delay\)/);
assert.match(hookSource, /subscribeToSession\(session\.sessionId/);
assert.doesNotMatch(hookSource, /setInterval/, "Active Now uses one expiration timer, not polling");

console.log("Canonical active/joinable status, zero-second expiry, server clock, idempotent finalization path, subscription, focus, and foreground contracts passed.");
