#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createCoachAiEvalFixtures } = require("./fixtures.cjs");
const { blindEvaluationRuns, csvReport, estimateClaudeCorpusCeiling } = require("./harness-core.cjs");

async function main() {
  const args = new Set(process.argv.slice(2));
  const fixtures = createCoachAiEvalFixtures();
  const ceiling = estimateClaudeCorpusCeiling(fixtures.length);
  const outputIndex = process.argv.indexOf("--output");
  const providersIndex = process.argv.indexOf("--providers");
  const providerIds = providersIndex >= 0 ? process.argv[providersIndex + 1].split(",").map((value) => value.trim()).filter(Boolean) : ["claude"];
  const supportedProviders = new Set(["claude", "gpt-5.6-luna", "ministral-3-8b"]);
  if (providerIds.some((provider) => !supportedProviders.has(provider))) throw new Error("Unsupported evaluation provider adapter.");
  const outputDirectory = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : path.resolve("artifacts/coach-ai-eval");
  if (!args.has("--execute")) {
    console.log(`Dry run: ${fixtures.length} synthetic fixtures are ready for ${providerIds.join(", ")}. Conservative Claude ceiling: $${ceiling.toFixed(2)} USD.`);
    console.log("No provider request was made. Add --execute --confirm-paid-api and a sufficient --cost-ceiling-usd only after approval.");
    return;
  }
  const ceilingIndex = process.argv.indexOf("--cost-ceiling-usd");
  const approvedCeiling = ceilingIndex >= 0 ? Number(process.argv[ceilingIndex + 1]) : NaN;
  if (!args.has("--confirm-paid-api") || !Number.isFinite(approvedCeiling) || approvedCeiling < ceiling) {
    throw new Error(`Paid execution requires --confirm-paid-api and --cost-ceiling-usd of at least ${ceiling.toFixed(2)}.`);
  }
  if (providerIds.includes("claude") && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY must be supplied directly in the execution environment.");
  }
  const runs = [];
  for (const providerId of providerIds) {
    const adapter = require(`./adapters/${providerId}.cjs`);
    for (const fixture of fixtures) runs.push(await adapter.run(fixture));
  }
  const report = blindEvaluationRuns(runs);
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "reviewer-report.csv"), csvReport(report.reviewerRows));
  fs.writeFileSync(path.join(outputDirectory, "reviewer-report.json"), JSON.stringify(report.reviewerRows, null, 2));
  fs.writeFileSync(path.join(outputDirectory, "answer-key.json"), JSON.stringify(report.answerKey, null, 2));
  console.log(`Wrote blinded reports for ${runs.length} runs. Credentials and prompt text are not included.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Evaluation failed."); process.exit(1); });
