const { createOptionalProviderAdapter } = require("./optional-provider.cjs");

module.exports = createOptionalProviderAdapter({
  id: "gpt-5.6-luna",
  endpointEnvironment: "GPT_LUNA_EVAL_ENDPOINT",
  keyEnvironment: "GPT_LUNA_EVAL_API_KEY",
  modelEnvironment: "GPT_LUNA_EVAL_MODEL",
});
