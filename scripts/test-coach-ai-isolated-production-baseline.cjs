const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const baselineCommit = "fddb310";
const appConfigPath = path.join(projectRoot, "app.config.js");
const easPath = path.join(projectRoot, "eas.json");
const managedEnvironmentNames = [
  "APP_VARIANT",
  "REQUIRE_PRODUCTION_LEGAL_CONFIG",
  "EAS_BUILD",
  "EAS_DEFER_STAGING_NATIVE_FIREBASE_VALIDATION",
  "EXPO_PUBLIC_AI_COACH_TESTING_ENABLED",
  "EXPO_PUBLIC_AI_COACH_BETA_BUILD",
  "EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD",
  "EXPO_PUBLIC_FIREBASE_ENVIRONMENT",
];

const previousEnvironment = new Map(
  managedEnvironmentNames.map((name) => [name, process.env[name]]),
);

try {
  for (const name of managedEnvironmentNames) delete process.env[name];

  const baselineAppConfigFactory = loadSourceModule(
    readBaselineFile("app.config.js"),
    appConfigPath,
  );
  delete require.cache[require.resolve(appConfigPath)];
  const isolatedAppConfigFactory = require(appConfigPath);
  const configInput = { config: {} };
  const baselineAppConfig = baselineAppConfigFactory(configInput);
  const isolatedAppConfig = isolatedAppConfigFactory(configInput);
  assert.deepEqual(
    isolatedAppConfig,
    baselineAppConfig,
    "The normal production Expo configuration must remain identical to fddb310.",
  );

  const baselineEas = JSON.parse(readBaselineFile("eas.json"));
  const isolatedEas = JSON.parse(fs.readFileSync(easPath, "utf8"));
  assert.deepEqual(
    isolatedEas.build.production,
    baselineEas.build.production,
    "The normal production EAS build profile must remain identical to fddb310.",
  );
  assert.deepEqual(
    isolatedEas.submit.production,
    baselineEas.submit.production,
    "The normal production EAS submit profile must remain identical to fddb310.",
  );
} finally {
  for (const [name, value] of previousEnvironment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

console.log("Coach AI isolated-source normal-production baseline parity tests passed.");

function readBaselineFile(filename) {
  return childProcess.execFileSync(
    "git",
    ["show", `${baselineCommit}:${filename}`],
    { cwd: projectRoot, encoding: "utf8" },
  );
}

function loadSourceModule(source, filename) {
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(source, filename);
  return loaded.exports;
}
