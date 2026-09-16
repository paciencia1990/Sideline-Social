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
assert.equal(profile.env.APP_VARIANT, "development");
assert.equal(profile.env.EXPO_PUBLIC_FIREBASE_ENVIRONMENT, "staging");
assert.equal(profile.env.EXPO_PUBLIC_GOOGLE_AUTH_ENABLED, "true");
assert.equal(profile.env.EXPO_PUBLIC_STAGING_ACCEPTANCE_BUILD, "true");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sideline-staging-config-"));
const androidFile = path.join(temp, "google-services.json");
const iosFile = path.join(temp, "GoogleService-Info.plist");
fs.writeFileSync(androidFile, JSON.stringify({
  project_info: { project_id: "sideline-social-staging-2026" },
  client: [{ client_info: { android_client_info: { package_name: "com.sidelinesquad.app.dev" } } }],
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
    EAS_DEFER_STAGING_NATIVE_FIREBASE_VALIDATION: "false",
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
assert.ok(resolved.plugins.some((plugin) => Array.isArray(plugin) && plugin[0] === "react-native-nitro-google-signin"));
assert.throws(() => load({ EXPO_PUBLIC_GOOGLE_AUTH_ENABLED: "false" }), /requires.*Google authentication/u);
assert.throws(() => load({ EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "production" }), /requires.*staging Firebase/u);
assert.throws(() => load({ EAS_DEFER_STAGING_NATIVE_FIREBASE_VALIDATION: "true" }), /cannot defer/u);

console.log("Staging acceptance identity, Firebase isolation, native config, and Google Sign-In fail-closed checks passed.");
