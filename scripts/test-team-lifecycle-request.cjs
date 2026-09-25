const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function load(relativePath) {
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", output)(loaded, loaded.exports, require);
  return loaded.exports;
}

async function run() {
  const subject = load("utils/teamLifecycleRequest.ts");
  assert.deepEqual(await subject.executeTeamLifecycleRequest({
    desiredStatus: "archived",
    request: async () => ({ status: "archived", inviteCode: null }),
    readPersistedState: async () => { throw new Error("must not read after confirmed success"); },
  }), { status: "archived", inviteCode: null, reconciliationComplete: true });

  const partial = await subject.executeTeamLifecycleRequest({
    desiredStatus: "archived",
    request: async () => { throw Object.assign(new Error("reconciliation failed"), { code: "functions/aborted" }); },
    readPersistedState: async () => ({ status: "archived", inviteCode: null }),
  });
  assert.deepEqual(partial, { status: "archived", inviteCode: null, reconciliationComplete: false });
  assert.equal("error" in partial, false, "raw provider errors are not retained in a partial result");

  const original = Object.assign(new Error("call failed"), { code: "functions/internal" });
  await assert.rejects(() => subject.executeTeamLifecycleRequest({
    desiredStatus: "archived",
    request: async () => { throw original; },
    readPersistedState: async () => ({ status: "active", inviteCode: "SAFE1234" }),
  }), (error) => error === original, "unchanged persisted state preserves the original failure");
  await assert.rejects(() => subject.executeTeamLifecycleRequest({
    desiredStatus: "active",
    request: async () => { throw original; },
    readPersistedState: async () => { throw new Error("read unavailable"); },
  }), (error) => error === original, "an ambiguous verification read cannot overwrite the original failure");

  const service = fs.readFileSync(path.join(process.cwd(), "services", "teamService.ts"), "utf8");
  const screen = fs.readFileSync(path.join(process.cwd(), "app", "coach", "team.tsx"), "utf8");
  assert.match(service, /executeTeamLifecycleRequest/u);
  assert.match(service, /readPersistedState:[\s\S]*getTeamById/u);
  assert.match(screen, /result\.reconciliationComplete/u);
  assert.match(screen, /archiveReconciliationPending/u);
  assert.match(screen, /restoreReconciliationPending/u);
  console.log("Team lifecycle request reconciliation tests passed.");
}

run().catch((error) => { console.error(error); process.exit(1); });
