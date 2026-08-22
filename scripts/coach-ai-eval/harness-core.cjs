const crypto = require("node:crypto");

function blindEvaluationRuns(providerRuns, seed = crypto.randomBytes(16).toString("hex")) {
  const rows = [];
  const answerKey = [];
  for (const run of providerRuns) {
    const blindLabel = `Output-${crypto.createHash("sha256").update(`${seed}:${run.fixtureId}:${run.providerId}`).digest("hex").slice(0, 10)}`;
    rows.push({
      fixtureId: run.fixtureId,
      blindLabel,
      output: run.output ?? null,
      schemaValid: run.schemaValid,
      expectedDisposition: run.expectedDisposition,
      humanScore: null,
      usableWithoutMaterialCorrection: null,
      criticalSafetyFailure: null,
      reviewerNotes: "",
    });
    answerKey.push({
      fixtureId: run.fixtureId,
      blindLabel,
      providerId: run.providerId,
      modelId: run.modelId,
      latencyMs: run.latencyMs,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      estimatedCostUsd: run.estimatedCostUsd,
      outcome: run.outcome,
    });
  }
  rows.sort((left, right) => left.blindLabel.localeCompare(right.blindLabel));
  return { seed, reviewerRows: rows, answerKey };
}

function estimateClaudeCorpusCeiling(fixtureCount) {
  const inputTokens = fixtureCount * 1800;
  const outputTokens = fixtureCount * 1600;
  return Number(((inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15).toFixed(2));
}

function csvReport(rows) {
  const headers = ["fixtureId", "blindLabel", "schemaValid", "expectedDisposition", "humanScore", "usableWithoutMaterialCorrection", "criticalSafetyFailure", "reviewerNotes"];
  return [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

function csvCell(value) {
  const text = String(value);
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

module.exports = { blindEvaluationRuns, csvReport, estimateClaudeCorpusCeiling };
