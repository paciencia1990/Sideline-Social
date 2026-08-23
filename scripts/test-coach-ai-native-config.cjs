const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  assertStagingNativeFirebaseConfig,
  shouldDeferStagingNativeFirebaseValidation,
} = require("../config/firebaseNativeConfig");

const appConfigPath = require.resolve("../app.config.js");
const appConfigEnvironmentNames = [
  "APP_VARIANT",
  "EAS_BUILD",
  "EAS_DEFER_STAGING_NATIVE_FIREBASE_VALIDATION",
  "EXPO_PUBLIC_AI_COACH_TESTING_ENABLED",
  "EXPO_PUBLIC_AI_COACH_BETA_BUILD",
  "EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD",
  "EXPO_PUBLIC_FIREBASE_ENVIRONMENT",
  "REQUIRE_PRODUCTION_LEGAL_CONFIG",
];

assert.doesNotThrow(() => evaluateAppConfig({
  APP_VARIANT: "production",
  EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "production",
}));
assert.doesNotThrow(() => evaluateAppConfig({
  APP_VARIANT: "production",
  EXPO_PUBLIC_AI_COACH_TESTING_ENABLED: "true",
  EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD: "true",
  EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "production",
}));
assert.doesNotThrow(() => evaluateAppConfig({
  APP_VARIANT: "production",
  EAS_DEFER_STAGING_NATIVE_FIREBASE_VALIDATION: "true",
  EXPO_PUBLIC_AI_COACH_TESTING_ENABLED: "true",
  EXPO_PUBLIC_AI_COACH_BETA_BUILD: "true",
  EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "staging",
}));
assert.throws(() => evaluateAppConfig({
  APP_VARIANT: "production",
  EXPO_PUBLIC_AI_COACH_TESTING_ENABLED: "true",
  EXPO_PUBLIC_AI_COACH_BETA_BUILD: "true",
  EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD: "true",
  EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "production",
}), /cannot both be enabled/);
assert.throws(() => evaluateAppConfig({
  APP_VARIANT: "production",
  EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD: "true",
  EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "production",
}), /requires release JavaScript, the exact testing flag, and production Firebase/);
assert.throws(() => evaluateAppConfig({
  APP_VARIANT: "development",
  EXPO_PUBLIC_AI_COACH_TESTING_ENABLED: "true",
  EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD: "true",
  EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "production",
}), /requires release JavaScript/);
assert.throws(() => evaluateAppConfig({
  APP_VARIANT: "production",
  EXPO_PUBLIC_AI_COACH_TESTING_ENABLED: "true",
  EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD: "true",
  EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "staging",
}), /requires release JavaScript, the exact testing flag, and production Firebase/);
assert.throws(() => evaluateAppConfig({
  APP_VARIANT: "production",
  EXPO_PUBLIC_AI_COACH_TESTING_ENABLED: "true",
  EXPO_PUBLIC_AI_COACH_BETA_BUILD: "true",
  EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "production",
}), /requires the exact testing flag and staging Firebase/);

const localBetaResolution = {
  requested: true,
  isEasBuild: false,
  coachAiBetaBuild: true,
  coachAiTestingBuild: true,
  firebaseEnvironment: "staging",
};
assert.equal(shouldDeferStagingNativeFirebaseValidation(localBetaResolution), true);
assert.equal(shouldDeferStagingNativeFirebaseValidation({ ...localBetaResolution, isEasBuild: true }), false);
assert.equal(shouldDeferStagingNativeFirebaseValidation({ ...localBetaResolution, coachAiBetaBuild: false }), false);
assert.equal(shouldDeferStagingNativeFirebaseValidation({ ...localBetaResolution, coachAiTestingBuild: false }), false);
assert.equal(shouldDeferStagingNativeFirebaseValidation({ ...localBetaResolution, firebaseEnvironment: "production" }), false);
assert.equal(shouldDeferStagingNativeFirebaseValidation({ ...localBetaResolution, requested: false }), false);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "coach-ai-native-config-"));
try {
  const androidFile = path.join(temporaryDirectory, "google-services.json");
  const iosFile = path.join(temporaryDirectory, "GoogleService-Info.plist");
  fs.writeFileSync(androidFile, JSON.stringify({
    project_info: { project_id: "sideline-social-staging" },
    client: [{ client_info: { android_client_info: { package_name: "com.sidelinesquad.app" } } }],
  }));
  fs.writeFileSync(iosFile, `<?xml version="1.0"?><plist><dict>
    <key>PROJECT_ID</key><string>sideline-social-staging</string>
    <key>BUNDLE_ID</key><string>com.sidelinesocial.app</string>
    <key>GOOGLE_APP_ID</key><string>1:123:ios:abc</string>
  </dict></plist>`);
  const valid = {
    androidFile, iosFile, projectId: "sideline-social-staging",
    androidPackage: "com.sidelinesquad.app", iosBundleIdentifier: "com.sidelinesocial.app",
  };
  assert.doesNotThrow(() => assertStagingNativeFirebaseConfig(valid));
  assert.throws(() => assertStagingNativeFirebaseConfig({ ...valid, projectId: "different-staging" }), /project ID does not match/);
  assert.throws(() => assertStagingNativeFirebaseConfig({ ...valid, androidPackage: "com.wrong.app" }), /exactly one/);
  assert.throws(() => assertStagingNativeFirebaseConfig({ ...valid, iosBundleIdentifier: "com.wrong.app" }), /must target/);
  assert.throws(() => assertStagingNativeFirebaseConfig({ ...valid, iosFile: path.join(temporaryDirectory, "missing.plist") }), /missing or invalid/);
} finally {
  const resolvedTemporaryDirectory = path.resolve(temporaryDirectory);
  const resolvedSystemTemp = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!resolvedTemporaryDirectory.startsWith(resolvedSystemTemp)) throw new Error("Refusing to clean a path outside the system temp directory.");
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("Coach AI native Firebase consistency and mutually exclusive build-gate tests passed.");

function evaluateAppConfig(environment) {
  const previous = new Map(appConfigEnvironmentNames.map((name) => [name, process.env[name]]));
  try {
    for (const name of appConfigEnvironmentNames) delete process.env[name];
    Object.assign(process.env, environment);
    delete require.cache[appConfigPath];
    return require(appConfigPath);
  } finally {
    delete require.cache[appConfigPath];
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
