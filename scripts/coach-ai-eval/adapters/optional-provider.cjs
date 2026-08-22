function createOptionalProviderAdapter({ id, endpointEnvironment, keyEnvironment, modelEnvironment }) {
  return {
    id,
    async run() {
      if (!process.env[endpointEnvironment] || !process.env[keyEnvironment] || !process.env[modelEnvironment]) {
        throw new Error(`${id} adapter is not configured; supply its separate endpoint, key, and model environment values.`);
      }
      throw new Error(`${id} transport must be approved and implemented against the selected provider's current API before paid execution.`);
    },
  };
}

module.exports = { createOptionalProviderAdapter };
