"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function load(source, bindings = {}) {
  const loaded = { exports: {} };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function(...Object.keys(bindings), "module", "exports", compiled)(...Object.values(bindings), loaded, loaded.exports);
  return loaded.exports;
}
function callback(file, name, bindings) {
  const sourceFile = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === name && ts.isCallExpression(node.initializer)) result = node.initializer.arguments[0].getText(sourceFile);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(result, `${name} must be a real screen callback`);
  return load(`module.exports = ${result};`, bindings);
}
const interaction = load(read("utils/gameInteraction.ts"));
const answer = load(read("src/game/triviaBlitz/answerFeedback.ts"));

(async () => {
  const readyRequest = deferred();
  const readyWrites = [];
  const readyStates = [];
  const ready = interaction.createReadyToggleController({ writeReady: async (value) => { readyWrites.push(value); await readyRequest.promise; }, onChange: (state) => readyStates.push(state), classifyError: () => "network_unavailable" });
  ready.updateConfirmed(false);
  const first = ready.toggle();
  assert.deepEqual(ready.getState(), { ready: true, pending: true, error: null }, "The first tap must immediately acknowledge the target state");
  assert.equal(ready.toggle(), first, "A repeat tap shares the in-flight request");
  await flush();
  assert.deepEqual(readyWrites, [true]);
  ready.updateConfirmed(false);
  assert.equal(ready.getState().ready, true, "An older subscription value must not undo pending feedback");
  readyRequest.resolve();
  await first;
  assert.deepEqual(ready.getState(), { ready: true, pending: false, error: null });
  ready.updateConfirmed(true);
  await ready.toggle();
  assert.deepEqual(readyWrites, [true, false], "A separate deliberate tap after confirmation can unready");
  const failedReady = interaction.createReadyToggleController({ writeReady: async () => { throw new Error("offline"); }, onChange: () => undefined, classifyError: () => "network_unavailable" });
  failedReady.updateConfirmed(false);
  await failedReady.toggle();
  assert.deepEqual(failedReady.getState(), { ready: false, pending: false, error: "network_unavailable" });
  const ambiguous = deferred();
  const reconciled = interaction.createReadyToggleController({ writeReady: () => ambiguous.promise, onChange: () => undefined, classifyError: () => "network_unavailable" });
  const committed = reconciled.toggle();
  reconciled.updateConfirmed(true);
  ambiguous.reject(new Error("response lost"));
  await committed;
  assert.deepEqual(reconciled.getState(), { ready: true, pending: false, error: null });
  const abandoned = deferred();
  const abandonedStates = [];
  const disposed = interaction.createReadyToggleController({ writeReady: () => abandoned.promise, onChange: (state) => abandonedStates.push(state), classifyError: () => "network_unavailable" });
  const oldReady = disposed.toggle();
  disposed.dispose();
  abandoned.resolve();
  await oldReady;
  assert.equal(abandonedStates.length, 1, "Departed lobbies must ignore late readiness responses");

  assert.equal(interaction.getTriviaAdvanceDelay({ nowMs: 1000, questionEndsAtMs: 15000, revealedAtMs: 1000, screenReaderEnabled: false }), 600);
  assert.equal(interaction.getTriviaAdvanceDelay({ nowMs: 1300, questionEndsAtMs: 15000, revealedAtMs: 1000, screenReaderEnabled: false }), 300, "Repeated snapshots must use the original reveal deadline");
  assert.equal(interaction.getTriviaAdvanceDelay({ nowMs: 1700, questionEndsAtMs: 15000, revealedAtMs: 1000, screenReaderEnabled: false }), 0);
  assert.equal(interaction.getTriviaAdvanceDelay({ nowMs: 1000, questionEndsAtMs: 15000, revealedAtMs: 1000, screenReaderEnabled: true }), 1600);
  assert.equal(interaction.getTriviaAdvanceDelay({ nowMs: 14000, questionEndsAtMs: 15000, revealedAtMs: null, screenReaderEnabled: false }), 1100, "Unanswered questions retain the server-controlled deadline");

  const firstAnswer = deferred(), nextAnswer = deferred();
  const submissions = [], selections = [], results = [], alerts = [];
  const answerSubmissionKeyRef = { current: "" }, currentQuestionScopeRef = { current: "session:0:one" };
  let pendingKey = null;
  function triviaHandler(key, index, response) {
    return callback("src/game/triviaBlitz/TriviaBlitzScreen.tsx", "handleSelectAnswer", {
      sessionId: "session", self: { id: "self" }, currentQuestion: { id: key }, session: { status: "playing", questionIndex: index, currentSelection: null }, synchronizedResult: null, isActiveTurn: true,
      currentQuestionKey: key, answerSubmissionKeyRef, currentQuestionScopeRef,
      claimTriviaAnswerSubmission: answer.claimTriviaAnswerSubmission, createTriviaSessionId: () => `synthetic-${index}`,
      setOptimisticSelection: (selection) => selections.push(selection), setAnswerPendingKey: (value) => { pendingKey = typeof value === "function" ? value(pendingKey) : value; },
      submitTriviaAnswer: (input) => { submissions.push(input); return response.promise; }, setLastResult: (result) => results.push(result),
      t: (value) => value, getTriviaErrorTranslationKey: () => "error", Alert: { alert: (...args) => alerts.push(args) },
    });
  }
  const selectFirst = triviaHandler("0:one", 0, firstAnswer);
  selectFirst(2); selectFirst(1);
  assert.equal(submissions.length, 1);
  assert.deepEqual(selections[0], { answerIndex: 2, questionKey: "0:one" });
  currentQuestionScopeRef.current = "session:1:two";
  triviaHandler("1:two", 1, nextAnswer)(1);
  assert.equal(submissions.length, 2, "The next question accepts its tap while an older response is pending");
  assert.equal(pendingKey, "1:two");
  firstAnswer.reject(new Error("late failure"));
  await flush();
  assert.equal(pendingKey, "1:two");
  assert.equal(alerts.length, 0);
  nextAnswer.resolve({ correct: true, correctAnswerIndex: 1 });
  await flush();
  assert.equal(pendingKey, null);
  assert.equal(results.length, 1);
  assert.equal(results[0].questionKey, "1:two");

  const bombResponse = deferred();
  const bombRequests = [], appliedViews = [];
  const actionInFlightRef = { current: false }, actionRequestRef = { current: 0 }, publicViewRefreshPendingRef = { current: false }, requestSequenceRef = { current: 0 }, submissionIdsRef = { current: new Map() };
  let refreshCalls = 0, selectedOption = null;
  const bombBindings = {
    playerView: { role: "defuser", commandId: "command-1" }, outcome: "playing", actionInFlightRef, actionRequestRef, publicViewRefreshPendingRef, requestSequenceRef, submissionIdsRef,
    createGameJoinIdempotencyKey: () => "synthetic-bomb-request", sessionId: "bomb-session", locale: "en",
    setActionSubmitting: () => undefined, setSelectedOptionId: (value) => { selectedOption = value; }, setActionError: () => undefined, setViewLoading: () => undefined,
    submitBombDefusalStep: (input) => { bombRequests.push(input); return bombResponse.promise; }, applyPlayerView: (view) => appliedViews.push(view),
    refreshPlayerView: async () => { refreshCalls += 1; }, readGameJoinCodeFailureReason: () => "network_unavailable",
  };
  const submitBomb = callback("src/game/BombDefusalScreen.tsx", "submitAction", bombBindings);
  const bombFirst = submitBomb({ optionId: "option-2" });
  await submitBomb({ optionId: "option-3" });
  assert.equal(bombRequests.length, 1, "Rapid Bomb taps must submit one move");
  assert.equal(selectedOption, "option-2", "The selected choice remains visible while awaiting the server");
  assert.equal(bombRequests[0].includePlayerView, true);
  bombResponse.resolve({ playerView: { sessionId: "bomb-session", commandId: "command-2", role: "expert" } });
  await bombFirst;
  assert.equal(appliedViews.length, 1);
  assert.equal(refreshCalls, 0, "A committed reply with the private view must not wait on a second callable");
  const legacySubmit = callback("src/game/BombDefusalScreen.tsx", "submitAction", { ...bombBindings, submitBombDefusalStep: async () => ({ correct: true }) });
  await legacySubmit({ optionId: "option-2" });
  assert.equal(refreshCalls, 1, "The new client remains compatible with the previous server");
  const priorRoundResponse = deferred();
  const priorRoundSubmit = callback("src/game/BombDefusalScreen.tsx", "submitAction", { ...bombBindings, submitBombDefusalStep: () => priorRoundResponse.promise });
  const oldRoundRequest = priorRoundSubmit({ optionId: "option-2" });
  actionRequestRef.current += 1;
  actionInFlightRef.current = false;
  priorRoundResponse.resolve({ playerView: { sessionId: "bomb-session", commandId: "command-6", outcome: "exploded" } });
  await oldRoundRequest;
  assert.equal(appliedViews.length, 1, "A superseded Bomb response cannot replace a rematch view");
  const publicState = { endsAt: 1000, gameState: { currentCommandId: "command-2", roleAssignment: { defuserUserId: "b", expertUserId: "a" }, strikeCount: 0, outcome: null, lastResult: { resolvedAt: 50 } } };
  const view = { commandId: "command-2", defuserUserId: "b", expertUserId: "a", strikeCount: 0, outcome: "playing", endsAtMs: 1000, lastResult: { resolvedAt: 50 } };
  assert.equal(interaction.bombViewMatchesPublicState(view, publicState), true);
  assert.equal(interaction.bombViewMatchesPublicState(view, { ...publicState, gameState: { ...publicState.gameState, roleAssignment: { defuserUserId: "c", expertUserId: "a" } } }), false);

  const spotResponse = deferred(), spotRequests = [], spotFeedback = [];
  let foundIds = [];
  const roundScopeRef = { current: "spot-session:scene:0" }, submittingDifferenceIdsRef = { current: new Set() }, latestTapSequenceRef = { current: 0 };
  const tapSpot = callback("src/game/spotDifference/SpotDifferenceScreen.tsx", "handleImageTap", {
    roundHasServerResult: false, isComplete: false, currentScene: { differences: [{ id: "one" }] }, sceneLayouts: { A: {}, B: {} }, imageRects: { A: {}, B: {} },
    screenPointToSourcePoint: (x, y) => ({ x, y }), requestedSessionId: "spot-session", roundScopeRef,
    findDifferenceAtPoint: () => ({ id: "one" }), submittingDifferenceIdsRef, latestTapSequenceRef,
    setFeedback: (feedback) => spotFeedback.push(feedback), setFoundIds: (value) => { foundIds = typeof value === "function" ? value(foundIds) : value; },
    recordSpotDifferenceFound: (input) => { spotRequests.push(input); return spotResponse.promise; }, foundSet: new Set(),
  });
  tapSpot("A", { x: 0.4, y: 0.4 }, {}); tapSpot("B", { x: 0.41, y: 0.4 }, {});
  assert.equal(spotRequests.length, 1, "Two taps in one pending difference region share a request");
  assert.equal(spotFeedback[0].kind, "checking");
  assert.deepEqual(foundIds, [], "Tap acknowledgment must never award an unconfirmed difference");
  roundScopeRef.current = "spot-session:new-scene:1";
  spotResponse.resolve({ found: true, differenceId: "one" });
  await flush();
  assert.deepEqual(foundIds, [], "A late result from the prior round must not mark the next image");
  console.log("Ready feedback/duplicate/rollback guards, Trivia timing and late-response isolation, Bomb one-call transition/compatibility, and Spot pending/round-scope behavior passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
