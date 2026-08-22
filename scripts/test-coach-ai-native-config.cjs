const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  assertStagingNativeFirebaseConfig,
  shouldDeferStagingNativeFirebaseValidation,
} = require("../config/firebaseNativeConfig");

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

console.log("Coach AI staging native Firebase file consistency tests passed.");
