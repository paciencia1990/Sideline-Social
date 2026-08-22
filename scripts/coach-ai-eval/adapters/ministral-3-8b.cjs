const { createOptionalProviderAdapter } = require("./optional-provider.cjs");

module.exports = createOptionalProviderAdapter({
  id: "ministral-3-8b",
  endpointEnvironment: "MINISTRAL_EVAL_ENDPOINT",
  keyEnvironment: "MINISTRAL_EVAL_API_KEY",
  modelEnvironment: "MINISTRAL_EVAL_MODEL",
});
