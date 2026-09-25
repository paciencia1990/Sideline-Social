"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

function loadTypeScript(...segments) {
  const filename = path.join(process.cwd(), ...segments);
  const { outputText } = ts.transpileModule(read(...segments), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  });
  const module = { exports: {} };
  new Function("module", "exports", "require", outputText)(module, module.exports, require);
  return module.exports;
}

(async () => {
  const deletion = loadTypeScript("utils", "teamMessageDeletionExecution.ts");
  let cleanupCalls = 0;
  await assert.rejects(() => deletion.executeTeamMessageDeletion({
    deleteFromBackend: async () => { throw new Error("backend_failed"); },
    cleanupLocalArtifacts: async () => { cleanupCalls += 1; },
  }), /backend_failed/u);
  assert.equal(cleanupCalls, 0, "local cleanup cannot run before backend deletion commits");
  assert.deepEqual(await deletion.executeTeamMessageDeletion({
    deleteFromBackend: async () => ({ status: "deleted" }),
    cleanupLocalArtifacts: async () => { cleanupCalls += 1; throw new Error("cache_failed"); },
  }), { backend: "confirmed", localCleanup: "failed" });
  assert.equal(cleanupCalls, 1, "cache failure is reported separately after canonical deletion");

  const reliability = require("../functions/lib/teamMessagingReliabilityCore.js");
  let auxiliaryFailures = 0;
  assert.equal(await reliability.attemptAuxiliaryAfterCommit(async () => "ok", () => { auxiliaryFailures += 1; }), "accepted");
  assert.equal(await reliability.attemptAuxiliaryAfterCommit(async () => { throw new Error("notification_failed"); }, () => { auxiliaryFailures += 1; }), "deferred");
  assert.equal(auxiliaryFailures, 1, "a post-commit notification failure is retained without rejecting the canonical send");

  const functionsSource = read("functions", "src", "index.ts");
  for (const marker of [
    "teamAnnouncementId(teamId, uid, clientMessageId)",
    "teamAnnouncementReplyId(teamId, announcementId, uid, clientReplyId)",
    "teamVoiceReservationId(kind, teamId, uid, clientMessageId)",
    "clientRequestHash",
    "notifyPrivateTeamMessageAfterCommit",
    "messageCommitted: true",
  ]) assert.match(functionsSource, new RegExp(marker.replace(/[()]/gu, "\\$&"), "u"));
  assert.match(functionsSource, /return \{ messageId: result\.messageId, notification, status: result\.created \? 'sent' : 'alreadySent' \}/u);
  assert.match(functionsSource, /return \{ messageId: result\.messageId, notification, status: result\.created \? 'sent' : 'alreadyFinalized' \}/u);

  const voiceService = read("services", "teamPrivateMessageService.ts");
  assert.match(voiceService, /readNativeUploadBlob\(draft\.uri, draft\.sizeBytes/u);
  assert.doesNotMatch(voiceService, /fetch\(draft\.uri\)\)\.blob/u);
  assert.match(voiceService, /closeNativeUploadBlob\(blob\)/u);

  const composer = read("app", "coach", "messages.tsx");
  assert.match(composer, /clientMessageId: clientMessageId\.current/u);
  assert.match(composer, /createTeamAnnouncement\([\s\S]*clientMessageId\.current/u);
  assert.match(composer, /memberships\.length > 1 && !hasDraft/u);
  assert.match(composer, /recipientCountsError/u);

  const privateThread = read("components", "PrivateTeamMessageThread.tsx");
  assert.match(privateThread, /executeTeamMessageDeletion/u);
  assert.match(privateThread, /teamMessages\.deleteLocalCleanupFailed/u);
  assert.match(privateThread, /voiceMemo\.localCleanupWarning/u);

  console.log("Team message retry identity, native voice Blob, committed-send, deletion ordering, and auxiliary cleanup contracts passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
