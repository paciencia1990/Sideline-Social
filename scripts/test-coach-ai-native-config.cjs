const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  assertStagingNativeFirebaseConfig,
  resolveStagingNativeFirebaseTarget,
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
assert.equal(resolveStagingNativeFirebaseTarget({ stagingAcceptanceBuild: false }), "all");
assert.equal(resolveStagingNativeFirebaseTarget({ stagingAcceptanceBuild: true }), "all");
assert.equal(resolveStagingNativeFirebaseTarget({
  stagingAcceptanceBuild: true,
  easBuildPlatform: "android",
  easBuildProfile: "staging-acceptance",
}), "android");
assert.throws(() => resolveStagingNativeFirebaseTarget({
  stagingAcceptanceBuild: true,
  easBuildPlatform: "ios",
  easBuildProfile: "staging-acceptance",
}), /authorized only for Android/);
assert.throws(() => resolveStagingNativeFirebaseTarget({
  stagingAcceptanceBuild: true,
  easBuildPlatform: "android",
}), /context is incomplete/);
assert.throws(() => resolveStagingNativeFirebaseTarget({
  stagingAcceptanceBuild: true,
  easBuildPlatform: "android",
  easBuildProfile: "production",
}), /context is conflicting/);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "coach-ai-native-config-"));
try {
  const androidFile = path.join(temporaryDirectory, "google-services.json");
  const iosFile = path.join(temporaryDirectory, "GoogleService-Info.plist");
  fs.writeFileSync(androidFile, JSON.stringify({
    project_info: { project_id: "sideline-social-staging" },
    client: [{
      client_info: {
        mobilesdk_app_id: "1:123:android:abc",
        android_client_info: { package_name: "com.sidelinesquad.app" },
      },
      oauth_client: [
        {
          client_id: "android.apps.googleusercontent.com",
          client_type: 1,
          android_info: {
            package_name: "com.sidelinesquad.app",
            certificate_hash: "AA:BB:CC:DD",
          },
        },
        { client_id: "web.apps.googleusercontent.com", client_type: 3 },
      ],
    }],
  }));
  fs.writeFileSync(iosFile, `<?xml version="1.0"?><plist><dict>
    <key>PROJECT_ID</key><string>sideline-social-staging</string>
    <key>BUNDLE_ID</key><string>com.sidelinesocial.app</string>
    <key>GOOGLE_APP_ID</key><string>1:123:ios:abc</string>
  </dict></plist>`);
  const valid = {
    androidFile, iosFile, projectId: "sideline-social-staging",
    authDomain: "sideline-social-staging.firebaseapp.com",
    androidPackage: "com.sidelinesquad.app",
    androidAppId: "1:123:android:abc",
    androidSha1: "aabbccdd",
    webClientId: "web.apps.googleusercontent.com",
    iosBundleIdentifier: "com.sidelinesocial.app",
  };
  assert.doesNotThrow(() => assertStagingNativeFirebaseConfig(valid));
  assert.doesNotThrow(() => assertStagingNativeFirebaseConfig({ ...valid, webClientId: undefined }));
  assert.doesNotThrow(() => assertStagingNativeFirebaseConfig({ ...valid, iosFile: undefined, targetPlatform: "android" }));
  assert.doesNotThrow(() => assertStagingNativeFirebaseConfig({ ...valid, androidFile: undefined, targetPlatform: "ios" }));
  assert.throws(() => assertStagingNativeFirebaseConfig({ ...valid, targetPlatform: "invalid" }), /target platform/);
  assert.throws(() => assertStagingNativeFirebaseConfig({ ...valid, androidFile: undefined, targetPlatform: "android" }), /Android staging Firebase configuration is required/);
  assert.throws(() => assertStagingNativeFirebaseConfig({ ...valid, iosFile: undefined, targetPlatform: "ios" }), /iOS staging Firebase configuration is required/);
  assert.throws(() => assertStagingNativeFirebaseConfig({ ...valid, authDomain: "wrong.firebaseapp.com" }), /authentication domain/);
  assert.throws(() => assertStagingNativeFirebaseConfig({
    ...valid,
    projectId: "different-staging",
    authDomain: "different-staging.firebaseapp.com",
  }), /project ID does not match/);
  assert.throws(() => assertStagingNativeFirebaseConfig({ ...valid, androidPackage: "com.wrong.app" }), /exactly one/);
  assert.throws(() => assertStagingNativeFirebaseConfig({ ...valid, androidAppId: "1:123:android:wrong" }), /app identity/);
  assert.throws(() => assertStagingNativeFirebaseConfig({ ...valid, androidSha1: "00112233" }), /SHA-1 OAuth client/);
  assert.throws(() => assertStagingNativeFirebaseConfig({ ...valid, webClientId: "wrong.apps.googleusercontent.com" }), /explicit web OAuth client/);
  assert.throws(() => assertStagingNativeFirebaseConfig({ ...valid, iosBundleIdentifier: "com.wrong.app" }), /must target/);
  assert.throws(() => assertStagingNativeFirebaseConfig({ ...valid, iosFile: path.join(temporaryDirectory, "missing.plist") }), /missing or invalid/);

  const noWebClientFile = path.join(temporaryDirectory, "google-services-no-web.json");
  const noWebClient = JSON.parse(fs.readFileSync(androidFile, "utf8"));
  noWebClient.client[0].oauth_client = noWebClient.client[0].oauth_client.filter((client) => client.client_type !== 3);
  fs.writeFileSync(noWebClientFile, JSON.stringify(noWebClient));
  assert.throws(() => assertStagingNativeFirebaseConfig({ ...valid, androidFile: noWebClientFile }), /exactly one web OAuth client/);

  const malformedAndroidFile = path.join(temporaryDirectory, "google-services-malformed.json");
  fs.writeFileSync(malformedAndroidFile, "{");
  assert.throws(() => assertStagingNativeFirebaseConfig({ ...valid, androidFile: malformedAndroidFile }), /missing or invalid/);
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
