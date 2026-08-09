const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const spotCore = require("../functions/lib/spotDifferenceCore.js");
const starsCore = require("../functions/lib/sidelineStarsCore.js");

for (let index = 1; index <= 10; index += 1) {
  assert.equal(
    spotCore.teamForSpotJoinOrder(index),
    index % 2 === 1 ? "A" : "B",
    `join order ${index} alternates teams`,
  );
}

assert.deepEqual(
  spotCore.resolveSpotRoundResult({
    teamTotals: { A: 10, B: 9 },
    completionTimes: { A: 1000, B: null },
  }),
  {
    outcome: "teamWin",
    winnerTeamId: "A",
    completedByTeamId: "A",
    teamTotals: { A: 10, B: 9 },
    perfectTeamIds: ["A"],
    totalDifferences: 10,
  },
);
assert.equal(
  spotCore.resolveSpotRoundResult({ teamTotals: { A: 7, B: 8 } }).winnerTeamId,
  "B",
);
assert.equal(
  spotCore.resolveSpotRoundResult({ teamTotals: { A: 8, B: 8 } }).outcome,
  "tie",
);
assert.deepEqual(
  spotCore.resolveSpotRoundResult({
    teamTotals: { A: 10, B: 10 },
    completionTimes: { A: 2000, B: 2000 },
  }),
  {
    outcome: "tie",
    winnerTeamId: null,
    completedByTeamId: null,
    teamTotals: { A: 10, B: 10 },
    perfectTeamIds: ["A", "B"],
    totalDifferences: 10,
  },
);

const warnings = spotCore.validateCanonicalSpotScenes();
assert.deepEqual(warnings, [], `canonical Spot scenes must be clean:\n${warnings.join("\n")}`);
assert.equal(spotCore.listCanonicalSpotScenes().length, 21, "all 21 released Spot scenes are server-authoritative");

for (let index = 1; index <= 21; index += 1) {
  const sceneId = `scene_${String(index).padStart(3, "0")}`;
  const assetFile = path.join(root, "assets", "games", "spot-the-difference", `${sceneId}.json`);
  const metadata = JSON.parse(fs.readFileSync(assetFile, "utf8"));
  const assetDifferences = Array.isArray(metadata) ? metadata : metadata.differences;
  const canonical = spotCore.getCanonicalSpotScene(sceneId);
  assert.equal(canonical.differences.length, 10, `${sceneId} has exactly 10 canonical differences`);
  assert.equal(canonical.differences.length, assetDifferences.length, `${sceneId} mirrors the checked-in JSON`);
  const first = canonical.differences[0];
  assert.equal(
    spotCore.findCanonicalSpotDifference(sceneId, { x: first.x, y: first.y }).id,
    first.id,
    `${sceneId} validates a known hotspot`,
  );
}

function amount(breakdown) {
  return breakdown ? starsCore.totalBreakdown(breakdown) : 0;
}

assert.equal(amount(starsCore.calculateSpotTeamReward({
  outcome: "teamWin",
  playerTeamId: "A",
  winnerTeamId: "A",
  perfectCompletion: false,
})), 10);
assert.equal(amount(starsCore.calculateSpotTeamReward({
  outcome: "teamWin",
  playerTeamId: "B",
  winnerTeamId: "A",
  perfectCompletion: false,
})), 3);
assert.equal(amount(starsCore.calculateSpotTeamReward({
  outcome: "tie",
  playerTeamId: "A",
  winnerTeamId: null,
  perfectCompletion: false,
})), 6);
assert.equal(amount(starsCore.calculateSpotTeamReward({
  outcome: "teamWin",
  playerTeamId: "A",
  winnerTeamId: "A",
  perfectCompletion: true,
})), 15);
assert.equal(amount(starsCore.calculateSpotTeamReward({
  outcome: "tie",
  playerTeamId: "B",
  winnerTeamId: null,
  perfectCompletion: true,
})), 11);

console.log("Spot the Differences team core tests passed.");
