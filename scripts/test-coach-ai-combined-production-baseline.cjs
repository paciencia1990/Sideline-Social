const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
// Android 32 / iOS 20 already include the reviewed App Check, Maps and SDK
// configuration. Compare the next candidate with that delivered baseline.
const baselineCommit = "1d0012efef5f60d0ad1f014171135a435a385ae1";
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
  const combinedAppConfigFactory = require(appConfigPath);
  const configInput = { config: {} };
  const baselineAppConfig = baselineAppConfigFactory(configInput);
  const combinedAppConfig = combinedAppConfigFactory(configInput);
  assert.deepEqual(
    combinedAppConfig,
    baselineAppConfig,
    "The normal production Expo configuration must match the delivered Android 32 / iOS 20 baseline.",
  );

  const baselineEas = JSON.parse(readBaselineFile("eas.json"));
  const combinedEas = JSON.parse(fs.readFileSync(easPath, "utf8"));
  assert.deepEqual(
    combinedEas.build.production,
    baselineEas.build.production,
    "The normal production EAS build profile must match the delivered baseline.",
  );
  assert.equal(combinedEas.build.production.android.gradleCommand, ":app:bundleProductionRelease");
  assert.deepEqual(
    combinedEas.submit.production,
    baselineEas.submit.production,
    "The normal production EAS submit profile must match the delivered baseline.",
  );
  assert.equal(combinedEas.build.production.env?.EXPO_PUBLIC_AI_COACH_TESTING_ENABLED, undefined);
  assert.equal(combinedEas.build.production.env?.EXPO_PUBLIC_AI_COACH_BETA_BUILD, undefined);
  assert.equal(combinedEas.build.production.env?.EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD, undefined);
  assert.equal(combinedEas.build["coach-ai-production-beta"].environment, "production");
  assert.equal(combinedEas.build["coach-ai-production-beta"].developmentClient, false);
  assert.equal(combinedEas.build["coach-ai-production-beta"].distribution, "store");
  assert.equal(combinedEas.build["coach-ai-production-beta"].android.buildType, "app-bundle");
  assert.equal(combinedEas.build["coach-ai-production-beta"].android.gradleCommand, ":app:bundleProductionRelease");
  assert.equal(combinedEas.build["coach-ai-production-beta"].env.EXPO_PUBLIC_AI_COACH_TESTING_ENABLED, "true");
  assert.equal(combinedEas.build["coach-ai-production-beta"].env.EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD, "true");
  assert.equal(combinedEas.build["coach-ai-production-beta"].env.EXPO_PUBLIC_AI_COACH_BETA_BUILD, undefined);
} finally {
  for (const [name, value] of previousEnvironment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

console.log("Coach AI combined-source normal-production baseline parity tests passed.");

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
