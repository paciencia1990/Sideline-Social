"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp, deleteApp } = require("firebase/app");
const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } = require("firebase/auth");
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require("firebase/functions");
const core = require("../functions/lib/bombDefusalCore.js");
const projectId = process.env.GCLOUD_PROJECT;
assert.ok(projectId?.startsWith("demo-"), "This test requires an isolated demo project");
assert.ok(process.env.FIREBASE_DATABASE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "All test services must be local emulators");
admin.initializeApp({ projectId, databaseURL: `https://${projectId}.firebaseio.com` });
const database = admin.database();
const apps = [];
async function client(label) {
  const app = initializeApp({ apiKey: "demo-key", projectId }, `bomb-response-${label}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const uid = (await createUserWithEmailAndPassword(auth, `${label}@example.test`, "SyntheticPass123!")).user.uid;
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { uid, call: async (name, input) => (await httpsCallable(functions, name)(input)).data };
}
function correctAction(command) {
  if (command.responseMode === "text" || command.responseMode === "numeric") return { value: Object.values(command.validation.answer ?? command.validation.decoded)[0] };
  return { optionId: command.correctOptionId };
}
async function seed(sessionId, clients) {
  const commands = core.createBombGeneratedRound(crypto.createHash("sha256").update(sessionId).digest("hex")).commands;
  const participants = clients.map((item, index) => ({ uid: item.uid, joinOrder: index + 1 }));
  const now = Date.now();
  await database.ref(`/gameSessions/${sessionId}`).set({
    gameType: "bomb_defusal", status: "active", hostUserId: clients[0].uid,
    gameplayStartsAt: now - 1000, startedAt: now - 1000, endsAt: now + 90_000, expiresAt: now + 120_000,
    players: Object.fromEntries(participants.map((player) => [player.uid, { displayName: "Synthetic player", isReady: true, joinOrder: player.joinOrder }])),
    gameState: {
      roleSchemaVersion: core.BOMB_ROLE_SCHEMA_VERSION, currentCommandId: "command-1", currentCommandIndex: 0,
      publicCommand: core.createBombPublicCommand(commands[0], 0), roleAssignment: core.assignBombRoles(participants, 0), roleRevision: 0,
      strikeCount: 0, correctCommandCount: 0, outcome: null, lastResult: null, processedSubmissions: {},
    },
  });
  await database.ref(`/gameSessionSecrets/${sessionId}`).set({ bombSteps: commands });
  return commands;
}
(async () => {
  try {
    const [first, second, third, outsider] = await Promise.all(["first", "second", "third", "outsider"].map(client));
    const pairCommands = await seed("response-pair", [first, second]);
    const input = { sessionId: "response-pair", commandId: "command-1", action: correctAction(pairCommands[0]), submissionId: "response-view-first-request", includePlayerView: true, locale: "es" };
    const initial = await first.call("getBombDefusalPlayerView", { sessionId: "response-pair", locale: "es" });
    assert.equal(initial.role, "defuser");
    assert.equal(initial.instruction, null);
    const reply = await first.call("submitBombDefusalStep", input);
    assert.equal(reply.correct, true);
    assert.equal(reply.playerView.sessionId, "response-pair");
    assert.equal(reply.playerView.commandId, "command-2");
    assert.equal(reply.playerView.role, "expert");
    assert.equal(reply.playerView.instruction.prompt, pairCommands[1].prompt.es);
    assert.equal(reply.playerView.solution, null);
    assert.equal("correctOptionId" in reply.playerView, false);
    assert.equal("validation" in reply.playerView, false);
    assert.equal("bombSteps" in reply.playerView, false);
    const duplicate = await first.call("submitBombDefusalStep", input);
    assert.equal(duplicate.correct, true);
    assert.equal(duplicate.playerView.role, "expert");
    const pairState = (await database.ref("/gameSessions/response-pair/gameState").get()).val();
    assert.equal(pairState.correctCommandCount, 1);
    for (const entry of Object.values(pairState.processedSubmissions)) assert.equal("playerView" in entry.result, false, "Role-private views must never enter the shared submission ledger");
    await assert.rejects(outsider.call("submitBombDefusalStep", { ...input, submissionId: "outsider-view-request" }), (error) => error.code === "functions/permission-denied");
    await assert.rejects(first.call("submitBombDefusalStep", { ...input, commandId: "command-2", action: correctAction(pairCommands[1]), submissionId: "expert-cannot-act-now" }), (error) => error.details?.reason === "bomb_not_defuser");
    const wrongOption = pairCommands[1].options.find((option) => option.id !== pairCommands[1].correctOptionId);
    const terminal = await second.call("submitBombDefusalStep", { sessionId: "response-pair", commandId: "command-2", action: wrongOption ? { optionId: wrongOption.id } : { value: "incorrect-value" }, submissionId: "response-view-terminal-request", includePlayerView: true, locale: "en" });
    assert.equal(terminal.outcome, "exploded");
    assert.equal(terminal.playerView.outcome, "exploded");
    assert.ok(terminal.playerView.solution?.correctOptionId);
    assert.equal(terminal.playerView.commandIndex, 1);
    const tripleCommands = await seed("response-triple", [first, second, third]);
    const supportReply = await first.call("submitBombDefusalStep", { sessionId: "response-triple", commandId: "command-1", action: correctAction(tripleCommands[0]), submissionId: "three-player-response-view", includePlayerView: true });
    assert.equal(supportReply.playerView.role, "support");
    assert.equal(supportReply.playerView.instruction, null);
    assert.equal(supportReply.playerView.solution, null);
    const legacyCommands = await seed("response-legacy", [first, second]);
    const legacyReply = await first.call("submitBombDefusalStep", { sessionId: "response-legacy", commandId: "command-1", action: correctAction(legacyCommands[0]), submissionId: "old-client-compatible-response" });
    assert.equal(legacyReply.correct, true);
    assert.equal("playerView" in legacyReply, false, "Existing clients retain their original reply shape");
    console.log("Bomb response-view emulator checks passed: next command, locale, Expert/Support privacy, no shared private view, duplicate idempotency, unauthorized rejection, terminal result, and old-client compatibility.");
  } finally {
    await Promise.all(apps.map(deleteApp));
    await admin.app().delete();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
