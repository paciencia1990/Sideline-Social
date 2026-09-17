"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const eas = JSON.parse(fs.readFileSync(path.join(root, "eas.json"), "utf8"));
const profile = eas.build["staging-acceptance"];
assert.equal(profile.distribution, "internal");
assert.equal(profile.android.buildType, "apk");
assert.equal(profile.android.gradleCommand, ":app:assembleStagingRelease");
assert.equal(profile.env.APP_VARIANT, "development");
assert.equal(profile.env.EXPO_PUBLIC_FIREBASE_ENVIRONMENT, "staging");
assert.equal(profile.env.EXPO_PUBLIC_GOOGLE_AUTH_ENABLED, "true");
assert.equal(profile.env.EXPO_PUBLIC_STAGING_ACCEPTANCE_BUILD, "true");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sideline-staging-config-"));
const androidFile = path.join(temp, "google-services.json");
const iosFile = path.join(temp, "GoogleService-Info.plist");
fs.writeFileSync(androidFile, JSON.stringify({
  project_info: { project_id: "sideline-social-staging-2026" },
  client: [{
    client_info: {
      mobilesdk_app_id: "1:123456789:android:staging",
      android_client_info: { package_name: "com.sidelinesquad.app.dev" },
    },
    oauth_client: [
      {
        client_id: "android.apps.googleusercontent.com",
        client_type: 1,
        android_info: {
          package_name: "com.sidelinesquad.app.dev",
          certificate_hash: "81:Ea:B5:7c:24:35:63:85:D1:56:55:75:C9:04:EC:40:3B:70:23:CE",
        },
      },
      { client_id: "web.apps.googleusercontent.com", client_type: 3 },
    ],
  }],
}));
fs.writeFileSync(iosFile, [
  "<plist><dict>",
  "<key>PROJECT_ID</key><string>sideline-social-staging-2026</string>",
  "<key>BUNDLE_ID</key><string>com.sidelinesocial.app</string>",
  "<key>GOOGLE_APP_ID</key><string>1:123456789:ios:abc</string>",
  "</dict></plist>",
].join(""));

function load(overrides = {}) {
  const env = {
    APP_VARIANT: "development",
    EAS_BUILD: "true",
    EAS_BUILD_PLATFORM: "android",
    EAS_BUILD_PROFILE: "staging-acceptance",
    EAS_DEFER_STAGING_NATIVE_FIREBASE_VALIDATION: "false",
    EXPO_PUBLIC_FIREBASE_APP_ID_ANDROID: "1:123456789:android:staging",
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: "sideline-social-staging-2026.firebaseapp.com",
    EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "staging",
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: "sideline-social-staging-2026",
    EXPO_PUBLIC_GOOGLE_AUTH_ENABLED: "true",
    EXPO_PUBLIC_STAGING_ACCEPTANCE_BUILD: "true",
    GOOGLE_SERVICES_INFO_PLIST_STAGING: iosFile,
    GOOGLE_SERVICES_JSON_ANDROID_STAGING: androidFile,
    ...overrides,
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const target = path.join(root, "app.config.js");
    delete require.cache[require.resolve(target)];
    return require(target)({ config: {} });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const resolved = load();
assert.equal(resolved.name, "Sideline Social Staging");
assert.equal(resolved.android.package, "com.sidelinesquad.app.dev");
assert.equal(resolved.ios.bundleIdentifier, "com.sidelinesocial.app");
assert.equal(resolved.android.googleServicesFile, androidFile);
assert.equal(resolved.ios.googleServicesFile, undefined);
const androidGooglePlugin = resolved.plugins.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === "react-native-nitro-google-signin",
);
assert.deepEqual(androidGooglePlugin, [
  "react-native-nitro-google-signin",
  { androidGoogleServicesFile: androidFile },
]);
assert.equal(resolved.extra.authProviders.googleWebClientId, "autoDetect");
assert.doesNotThrow(() => load({ EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "web.apps.googleusercontent.com" }));
assert.doesNotThrow(() => load({ GOOGLE_SERVICES_INFO_PLIST_STAGING: undefined }));
assert.throws(
  () => load({ GOOGLE_SERVICES_JSON_ANDROID_STAGING: undefined }),
  /Android staging Firebase configuration is required/u,
);
assert.throws(
  () => load({ EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: "wrong.firebaseapp.com" }),
  /authentication domain/u,
);
assert.throws(
  () => load({ EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "wrong.apps.googleusercontent.com" }),
  /explicit web OAuth client/u,
);
assert.throws(() => load({ EAS_BUILD_PLATFORM: "ios" }), /authorized only for Android/u);
assert.throws(() => load({ EAS_BUILD_PLATFORM: "windows" }), /authorized only for Android/u);
assert.throws(() => load({ EAS_BUILD_PROFILE: "production" }), /profile context is conflicting/u);
assert.throws(() => load({ EAS_BUILD_PROFILE: undefined }), /platform context is incomplete/u);
assert.throws(
  () => load({
    EAS_BUILD: undefined,
    EAS_BUILD_PLATFORM: undefined,
    EAS_BUILD_PROFILE: undefined,
    GOOGLE_SERVICES_INFO_PLIST_STAGING: undefined,
  }),
  /iOS staging Firebase configuration is required/u,
);
assert.throws(() => load({ EXPO_PUBLIC_GOOGLE_AUTH_ENABLED: "false" }), /requires.*Google authentication/u);
assert.throws(() => load({ EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "production" }), /requires.*staging Firebase/u);
assert.throws(() => load({ EAS_DEFER_STAGING_NATIVE_FIREBASE_VALIDATION: "true" }), /cannot defer/u);

const productionUrlScheme = load({
  APP_VARIANT: "production",
  EAS_BUILD: undefined,
  EAS_BUILD_PLATFORM: undefined,
  EAS_BUILD_PROFILE: undefined,
  EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "production",
  EXPO_PUBLIC_GOOGLE_AUTH_ENABLED: "true",
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: "production-ios.apps.googleusercontent.com",
  EXPO_PUBLIC_STAGING_ACCEPTANCE_BUILD: "false",
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "production-web.apps.googleusercontent.com",
  EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME: "com.googleusercontent.apps.production",
  GOOGLE_SERVICES_INFO_PLIST_STAGING: undefined,
  GOOGLE_SERVICES_JSON_ANDROID_STAGING: undefined,
});
assert.deepEqual(
  productionUrlScheme.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "react-native-nitro-google-signin",
  ),
  ["react-native-nitro-google-signin", { iosUrlScheme: "com.googleusercontent.apps.production" }],
);

console.log("Staging acceptance identity, Firebase isolation, native config, and Google Sign-In fail-closed checks passed.");
