"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const eas = JSON.parse(fs.readFileSync(path.join(root, "eas.json"), "utf8"));
const profile = eas.build["external-testing"];
const appId = profile.env.EXPO_PUBLIC_FIREBASE_APP_ID_ANDROID;
const sha1 = "62:74:7F:E5:1F:3B:85:C4:F1:29:FE:A0:D8:76:9F:28:33:45:A1:B0";
const androidOauthClientId = "903830626771-cgoqfbjs7qect7o09e516bbdh2kgcsa3.apps.googleusercontent.com";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sideline-external-testing-"));
const androidFile = path.join(temp, "google-services.json");
const iosFile = path.join(temp, "GoogleService-Info.plist");
const generatedAndroidTarget = path.join(root, "android", "app", "src", "production", "google-services.json");
const generatedAndroidTargetExisted = fs.existsSync(generatedAndroidTarget);

assert.equal(profile.distribution, "store");
assert.equal(profile.environment, "preview");
assert.equal(profile.autoIncrement, true);
assert.equal(profile.env.APP_VARIANT, "production");
assert.equal(profile.env.EXPO_PUBLIC_EXTERNAL_TESTING_BUILD, "true");
assert.equal(profile.env.EXPO_PUBLIC_FIREBASE_ENVIRONMENT, "staging");
assert.equal(profile.env.EXPO_PUBLIC_AI_COACH_BETA_BUILD, "true");
assert.equal(profile.env.EXPO_PUBLIC_AI_COACH_TESTING_ENABLED, "true");
assert.equal(profile.env.EXPO_PUBLIC_GOOGLE_AUTH_ENABLED, "true");
assert.equal(profile.env.EXPO_PUBLIC_APPLE_AUTH_ENABLED, "true");
assert.equal(profile.env.EXPO_PUBLIC_ANDROID_OAUTH_CLIENT_ID, androidOauthClientId);
assert.equal(profile.env.EXPO_PUBLIC_ANDROID_OAUTH_SHA1, sha1);
assert.equal(profile.android.buildType, "app-bundle");
assert.equal(profile.android.gradleCommand, ":app:bundleProductionRelease");
assert.deepEqual(eas.submit["external-testing"], {});

fs.writeFileSync(androidFile, JSON.stringify({
  project_info: {
    project_number: "3090643405",
    project_id: "sideline-social-staging-2026",
    storage_bucket: "sideline-social-staging-2026.firebasestorage.app",
  },
  client: [{
    client_info: {
      mobilesdk_app_id: appId,
      android_client_info: { package_name: "com.sidelinesquad.app" },
    },
    oauth_client: [{ client_id: "web.apps.googleusercontent.com", client_type: 3 }],
    api_key: [{ current_key: "synthetic-test-key" }],
    services: {
      appinvite_service: {
        other_platform_oauth_client: [{ client_id: "web.apps.googleusercontent.com", client_type: 3 }],
      },
    },
  }],
  configuration_version: "1",
}));
fs.writeFileSync(iosFile, [
  "<plist><dict>",
  "<key>PROJECT_ID</key><string>sideline-social-staging-2026</string>",
  "<key>BUNDLE_ID</key><string>com.sidelinesocial.app</string>",
  "<key>GOOGLE_APP_ID</key><string>1:3090643405:ios:external</string>",
  "</dict></plist>",
].join(""));

const baseEnvironment = {
  ...profile.env,
  EAS_BUILD: "true",
  EAS_DEFER_STAGING_NATIVE_FIREBASE_VALIDATION: "false",
  EXPO_PUBLIC_ANDROID_OAUTH_SHA1: sha1,
  EXPO_PUBLIC_ANDROID_OAUTH_CLIENT_ID: androidOauthClientId,
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: "sideline-social-staging-2026.firebaseapp.com",
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: "sideline-social-staging-2026",
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "web.apps.googleusercontent.com",
  GOOGLE_SERVICES_INFO_PLIST_STAGING: iosFile,
  GOOGLE_SERVICES_JSON_ANDROID_STAGING: androidFile,
  GOOGLE_MAPS_API_KEY_ANDROID_STAGING: "synthetic-android-maps-key",
  GOOGLE_MAPS_API_KEY_IOS_STAGING: "synthetic-ios-maps-key",
};

function load(platform, overrides = {}) {
  const environment = {
    ...baseEnvironment,
    EAS_BUILD_PLATFORM: platform,
    EAS_BUILD_PROFILE: "external-testing",
    ...overrides,
  };
  const keys = new Set([...Object.keys(environment), "EXPO_PUBLIC_STAGING_ACCEPTANCE_BUILD"]);
  const previous = Object.fromEntries([...keys].map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    for (const [key, value] of Object.entries(environment)) {
      if (value !== undefined) process.env[key] = value;
    }
    const target = path.join(root, "app.config.js");
    delete require.cache[require.resolve(target)];
    return require(target)({ config: {} });
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

const android = load("android", { GOOGLE_SERVICES_INFO_PLIST_STAGING: undefined });
assert.equal(android.name, "Sideline Social");
assert.equal(android.android.package, "com.sidelinesquad.app");
assert.equal(android.android.googleServicesFile, androidFile);
assert.equal(android.android.config.googleMaps.apiKey, "synthetic-android-maps-key");
assert.equal(android.ios.googleServicesFile, undefined);
assert.deepEqual(
  android.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "react-native-nitro-google-signin"),
  ["react-native-nitro-google-signin", { androidGoogleServicesFile: androidFile }],
);

const ios = load("ios", { GOOGLE_SERVICES_JSON_ANDROID_STAGING: undefined });
assert.equal(ios.ios.bundleIdentifier, "com.sidelinesocial.app");
assert.equal(ios.ios.googleServicesFile, iosFile);
assert.equal(ios.ios.config.googleMapsApiKey, "synthetic-ios-maps-key");
assert.deepEqual(
  ios.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "react-native-nitro-google-signin"),
  ["react-native-nitro-google-signin", { iosGoogleServicesFile: iosFile }],
);

assert.throws(() => load("android", { GOOGLE_SERVICES_JSON_ANDROID_STAGING: undefined }), /Android staging Firebase configuration is required/u);
assert.throws(() => load("ios", { GOOGLE_SERVICES_INFO_PLIST_STAGING: undefined }), /iOS staging Firebase configuration is required/u);
assert.throws(() => load("android", { EXPO_PUBLIC_ANDROID_OAUTH_SHA1: undefined }), /approved Play signing client/u);
assert.throws(() => load("android", { EXPO_PUBLIC_ANDROID_OAUTH_CLIENT_ID: undefined }), /approved Play signing client/u);
assert.throws(() => load("android", { EXPO_PUBLIC_ANDROID_OAUTH_CLIENT_ID: "wrong.apps.googleusercontent.com" }), /approved Play signing client/u);
assert.throws(() => load("android", { GOOGLE_MAPS_API_KEY_ANDROID_STAGING: undefined }), /Android build requires.*Maps API key/u);
assert.throws(() => load("ios", { GOOGLE_MAPS_API_KEY_IOS_STAGING: undefined }), /iOS build requires.*Maps API key/u);
assert.throws(() => load("android", { EAS_BUILD_PROFILE: "production" }), /profile context is conflicting/u);
assert.throws(() => load("web"), /supports only Android and iOS/u);
assert.throws(() => load("android", { APP_VARIANT: "development" }), /requires release app identity/u);
assert.throws(() => load("android", { EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "production" }), /requires.*staging Firebase/u);
assert.throws(() => load("android", { EXPO_PUBLIC_AI_COACH_BETA_BUILD: undefined }), /requires the entitled Coach AI/u);
assert.throws(() => load("android", { EXPO_PUBLIC_STAGING_ACCEPTANCE_BUILD: "true" }), /cannot both be enabled|cannot overlap/u);

function runGradle(overrides = {}) {
  const environment = {
    ...process.env,
    ...baseEnvironment,
    EAS_BUILD_PLATFORM: "android",
    EAS_BUILD_PROFILE: "external-testing",
    ...overrides,
  };
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete environment[key];
  }
  return spawnSync(process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe", [
    "/d", "/c", "gradlew.bat", ":app:processProductionReleaseGoogleServices",
    "--offline", "--no-daemon", "--console=plain",
  ], {
    cwd: path.join(root, "android"),
    env: environment,
    encoding: "utf8",
    windowsHide: true,
    timeout: 240000,
  });
}

function output(result) {
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function removeGeneratedTarget() {
  if (generatedAndroidTargetExisted || !fs.existsSync(generatedAndroidTarget)) return;
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.unlinkSync(generatedAndroidTarget);
      return;
    } catch (error) {
      lastError = error;
      if (!["EBUSY", "EPERM"].includes(error?.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
  throw lastError;
}

try {
  const gradle = runGradle();
  assert.equal(gradle.error, undefined, gradle.error?.message);
  assert.equal(gradle.status, 0, output(gradle));
  assert.match(output(gradle), /processProductionReleaseGoogleServices/u);
  assert.deepEqual(fs.readFileSync(generatedAndroidTarget), fs.readFileSync(androidFile));

  removeGeneratedTarget();
  const missingSha = runGradle({ EXPO_PUBLIC_ANDROID_OAUTH_SHA1: undefined });
  assert.notEqual(missingSha.status, 0);
  assert.match(output(missingSha), /OAuth signing SHA-1 is required/u);

  removeGeneratedTarget();
  const wrongClient = runGradle({ EXPO_PUBLIC_ANDROID_OAUTH_CLIENT_ID: "wrong.apps.googleusercontent.com" });
  assert.notEqual(wrongClient.status, 0);
  assert.match(output(wrongClient), /OAuth package and signing association is invalid/u);
} finally {
  removeGeneratedTarget();
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log("External Play/TestFlight staging identity, native Firebase, OAuth, Coach entitlement, and Gradle selection checks passed.");
