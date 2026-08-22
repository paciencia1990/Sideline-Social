const {
  executeCoachAiClaudeGateway,
  validateCoachHelpRequest,
} = (() => {
  const gateway = require("../../../functions/lib/coachAiClaudeGatewayCore");
  const core = require("../../../functions/lib/coachResourceHelpCore");
  return { ...gateway, ...core };
})();

module.exports = {
  id: "claude",
  async run(fixture) {
    const startedAt = Date.now();
    let request;
    try {
      request = validateCoachHelpRequest(fixture.request);
    } catch {
      return base(fixture, { modelId: "local-validation", latencyMs: Date.now() - startedAt, schemaValid: false, outcome: "validation_failure" });
    }
    const outcome = await executeCoachAiClaudeGateway({
      request,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
      correlationId: `eval-${fixture.id}`,
    });
    const inputTokens = outcome.telemetry.inputTokens || 0;
    const outputTokens = outcome.telemetry.outputTokens || 0;
    return base(fixture, {
      modelId: outcome.telemetry.modelIdentifier,
      latencyMs: outcome.telemetry.durationMs,
      schemaValid: true,
      outcome: outcome.telemetry.outcome,
      output: outcome.result,
      inputTokens,
      outputTokens,
      estimatedCostUsd: (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15,
    });
  },
};

function base(fixture, values) {
  return {
    fixtureId: fixture.id,
    providerId: "claude",
    expectedDisposition: fixture.expectedDisposition,
    output: null,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    ...values,
  };
}
