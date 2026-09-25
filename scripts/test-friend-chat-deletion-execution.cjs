const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

function loadTypeScript(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", output)(loaded, loaded.exports, require);
  return loaded.exports;
}

async function run() {
  const subject = loadTypeScript("utils/friendChatDeletionExecution.ts");
  const order = [];
  assert.deepEqual(await subject.executeFriendChatDeletion({
    deleteFromBackend: async () => { order.push("backend"); },
    cleanupLocalArtifacts: async () => { order.push("cleanup"); },
  }), { backend: "confirmed", localCleanup: "complete", localCleanupCode: null });
  assert.deepEqual(order, ["backend", "cleanup"], "local cleanup must never block backend dispatch");

  let cleanupCalled = false;
  await assert.rejects(() => subject.executeFriendChatDeletion({
    deleteFromBackend: async () => { throw Object.assign(new Error("call failed"), { code: "functions/not-found" }); },
    cleanupLocalArtifacts: async () => { cleanupCalled = true; },
  }), /call failed/u);
  assert.equal(cleanupCalled, false, "a backend failure must not remove local media or appear successful");

  const auxiliaryFailure = await subject.executeFriendChatDeletion({
    deleteFromBackend: async () => undefined,
    cleanupLocalArtifacts: async () => { throw Object.assign(new Error("private detail"), { code: "cache/io-error" }); },
  });
  assert.deepEqual(auxiliaryFailure, { backend: "confirmed", localCleanup: "failed", localCleanupCode: "io" });
  assert.equal("error" in auxiliaryFailure, false, "raw errors must not be retained in diagnostic results");

  assert.equal(subject.friendChatDeletionDiagnosticCode({ code: "storage/unauthorized" }), "permission");
  assert.equal(subject.friendChatDeletionDiagnosticCode({ code: "operation/canceled" }), "canceled");
  assert.equal(subject.friendChatDeletionDiagnosticCode(new Error("sensitive provider text")), "unknown");

  const screen = read("app", "(social)", "chat", "[chatId].tsx");
  assert.match(screen, /executeFriendChatDeletion/u);
  assert.match(screen, /deleteFromBackend:[\s\S]*deleteFriendChatMessagesForMe/u);
  assert.match(screen, /cleanupLocalArtifacts:[\s\S]*clearPersistedVoicePlaybackArtifacts/u);
  assert.match(screen, /cleanupLocalArtifacts:[\s\S]*clearFriendChatImageCacheForMessages/u);
  assert.match(screen, /result\.localCleanup === "failed"/u);
  assert.match(screen, /chat\.deleteLocalCleanupFailed/u);

  console.log("Friend-chat deletion backend and local-cleanup phase tests passed.");
}

run().catch((error) => { console.error(error); process.exit(1); });
