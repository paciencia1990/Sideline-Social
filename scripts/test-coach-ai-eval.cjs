const assert = require("node:assert/strict");
const { CATEGORIES, LOCALES, createCoachAiEvalFixtures } = require("./coach-ai-eval/fixtures.cjs");
const { blindEvaluationRuns, csvReport, estimateClaudeCorpusCeiling } = require("./coach-ai-eval/harness-core.cjs");

const fixtures = createCoachAiEvalFixtures();
assert.equal(fixtures.length, 240);
assert.equal(fixtures.filter((fixture) => fixture.group === "ordinary").length, 180);
assert.equal(fixtures.filter((fixture) => fixture.group !== "ordinary").length, 60);
assert.equal(new Set(fixtures.map((fixture) => fixture.id)).size, 240);
for (const category of CATEGORIES) for (const locale of LOCALES) {
  assert.equal(fixtures.filter((fixture) => fixture.group === "ordinary" && fixture.request.category === category && fixture.request.locale === locale).length, 10);
}
assert.equal(fixtures.some((fixture) => JSON.stringify(fixture).match(/@|\b\d{3}[- .]\d{3}/u)), false, "fixtures must not contain emails or phone numbers");
const sampleRuns = ["claude", "gpt-5.6-luna"].map((providerId) => ({
  fixtureId: fixtures[0].id, providerId, modelId: providerId, latencyMs: 20, inputTokens: 10, outputTokens: 20,
  estimatedCostUsd: 0.001, schemaValid: true, expectedDisposition: "provider_guidance", outcome: "completed", output: { title: "Synthetic" },
}));
const blinded = blindEvaluationRuns(sampleRuns, "fixed-test-seed");
assert.equal(blinded.reviewerRows.length, 2);
assert.equal(blinded.reviewerRows.some((row) => JSON.stringify(row).includes("claude")), false);
assert.equal(blinded.answerKey.every((row) => row.providerId), true);
assert.match(csvReport(blinded.reviewerRows), /humanScore/);
assert.ok(estimateClaudeCorpusCeiling(240) > 0);

console.log("Coach AI 240-fixture corpus, provider-neutral blinding, reporting, and cost-ceiling tests passed.");
