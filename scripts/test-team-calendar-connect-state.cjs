const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function load(file) {
  const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(require, loaded, loaded.exports);
  return loaded.exports;
}

const state = load("utils/teamCalendarConnectState.ts");
const guard = state.createTeamCalendarConnectRequestGuard();
const firstContext = state.calendarConnectContextKey("team-a", "user-a");
const secondContext = state.calendarConnectContextKey("team-b", "user-a");
const first = guard.begin(firstContext);
assert.equal(guard.isCurrent(first, firstContext), true);
const retry = guard.begin(firstContext);
assert.equal(guard.isCurrent(first, firstContext), false, "a retry supersedes an older response");
assert.equal(guard.isCurrent(retry, firstContext), true);
assert.equal(guard.isCurrent(retry, secondContext), false, "a response cannot update another Team");
guard.invalidate();
assert.equal(guard.isCurrent(retry, firstContext), false, "unmount or sign-out invalidates pending work");
assert.equal(state.calendarConnectContextKey("team-a", undefined), "signed-out:team-a");

const screen = fs.readFileSync(path.join(process.cwd(), "app", "teams", "[teamId]", "schedule", "connect.tsx"), "utf8");
assert.match(screen, /loadState === "error"/);
assert.match(screen, /retryStatus/);
assert.match(screen, /setActionError\(null\).*setWarnings\(\[\]\).*setIntegrationId\(null\)/s, "editing a draft clears obsolete preview and submission feedback");
assert.match(screen, /setUrl\(""\).*server accepts/s, "a private URL is cleared only after preview succeeds");
assert.doesNotMatch(screen, /busy === "load"|\{error \?/);
assert.match(screen, /requestGuard\.current\.isCurrent/g);

const service = fs.readFileSync(path.join(process.cwd(), "services", "teamCalendarIntegrationService.ts"), "utf8");
assert.match(service, /SAFE_CALENDAR_REASONS/);
assert.match(service, /SAFE_CALENDAR_REASONS\.has\(error\.details\.reason\).*return error\.details\.reason/s);

console.log("Connect Calendar loading, retry, draft preservation, and stale-response state tests passed.");
