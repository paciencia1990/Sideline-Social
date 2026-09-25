"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  chooseShortBuildDrive,
  createShortBuildRoot,
  makeEnvironment,
  resolveAndroidSdk,
  resolveAndroidSerial,
  resolveGeneratedNativeCache,
  resolveJavaHome,
} = require("./staging-development.cjs");
const { resolveStagingNativeFirebaseTarget } = require("../config/firebaseNativeConfig");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sideline-dev-config-test-"));
const project = "sideline-social-staging-2026";
const pkg = "com.sidelinesquad.app.dev";
const sha = "81eab57c24356385d1565575c904ec403b7023ce";
const native = {
  project_info: { project_id: project, project_number: "3090643405",
    storage_bucket: project + ".firebasestorage.app",
    firebase_url: "https://" + project + "-default-rtdb.firebaseio.com" },
  client: [{
    client_info: { android_client_info: { package_name: pkg },
      mobilesdk_app_id: "1:3090643405:android:abc123" },
    api_key: [{ current_key: "AIza" + "a".repeat(30) }],
    oauth_client: [
      { client_type: 1, client_id: "3090643405-android.apps.googleusercontent.com",
        android_info: { package_name: pkg, certificate_hash: sha } },
      { client_type: 3, client_id: "3090643405-web.apps.googleusercontent.com" },
    ],
  }],
};
const config = { firebaseFile: path.join(temp, "google-services.json"),
  mapsKey: "AIza" + "b".repeat(30), mapsRestrictionsVerified: true,
  mapsProject: project, mapsPackage: pkg, mapsSha1: sha };
let assertions = 0;
function check(fn) { fn(); assertions++; }
try {
  fs.writeFileSync(config.firebaseFile, JSON.stringify(native));
  const env = makeEnvironment(config, native, {
    PATH: process.env.PATH, EXPO_PUBLIC_EXTERNAL_TESTING_BUILD: "true",
    EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD: "true",
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: "sideline-squad", GOOGLE_MAPS_API_KEY: "production",
    FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099", __FIREBASE_DEFAULTS__: "old",
  });
  check(() => assert.equal(env.EXPO_PUBLIC_FIREBASE_PROJECT_ID, project));
  check(() => assert.equal(env.EXPO_PUBLIC_FIREBASE_APP_ID_ANDROID, "1:3090643405:android:abc123"));
  for (const key of ["EXPO_PUBLIC_EXTERNAL_TESTING_BUILD", "EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD",
    "GOOGLE_MAPS_API_KEY", "FIREBASE_AUTH_EMULATOR_HOST", "__FIREBASE_DEFAULTS__"]) {
    check(() => assert.equal(env[key], undefined));
  }
  for (const changes of [{ mapsKey: "" }, { mapsRestrictionsVerified: false },
    { mapsPackage: "com.sidelinesquad.app" }, { mapsProject: "sideline-squad" },
    { mapsSha1: "wrong" }]) {
    check(() => assert.throws(() => makeEnvironment({ ...config, ...changes }, native)));
  }
  check(() => assert.throws(() => makeEnvironment(config, {
    ...native, project_info: { ...native.project_info, project_id: "sideline-squad" },
  })));
  const previous = { ...process.env };
  const evaluate = (changes = {}) => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env, changes);
    const file = path.join(root, "app.config.js");
    delete require.cache[require.resolve(file)];
    return require(file)({ config: {} });
  };
  try {
    const app = evaluate();
    check(() => assert.equal(app.android.package, pkg));
    check(() => assert.equal(app.name, "Sideline Social Staging Dev"));
    check(() => assert.equal(app.android.googleServicesFile, config.firebaseFile));
    check(() => assert.equal(app.ios.googleServicesFile, undefined));
    check(() => assert.equal(app.android.config.googleMaps.apiKey, config.mapsKey));
    check(() => assert.equal(app.extra.authProviders.googleWebClientId, native.client[0].oauth_client[1].client_id));
    for (const changes of [
      { EAS_BUILD_PROFILE: "external-testing" }, { EAS_BUILD_PLATFORM: "ios" },
      { EXPO_PUBLIC_STAGING_ACCEPTANCE_BUILD: "true" },
      { EXPO_PUBLIC_EXTERNAL_TESTING_BUILD: "true" },
      { EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "production" },
      { APP_VARIANT: "production" }, { EXPO_PUBLIC_GOOGLE_AUTH_ENABLED: "false" },
      { EXPO_PUBLIC_AI_COACH_TESTING_ENABLED: "false" },
      { EAS_DEFER_STAGING_NATIVE_FIREBASE_VALIDATION: "true" },
      { GOOGLE_MAPS_API_KEY_ANDROID_STAGING_DEVELOPMENT: "" },
      { EXPO_PUBLIC_FIREBASE_PROJECT_ID: "sideline-squad" },
    ]) check(() => assert.throws(() => evaluate(changes)));
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, previous);
  }
  check(() => assert.equal(resolveStagingNativeFirebaseTarget({
    stagingAcceptanceBuild: true, easBuildProfile: "staging-acceptance", easBuildPlatform: "android",
  }), "android"));
  check(() => assert.equal(resolveStagingNativeFirebaseTarget({
    externalTestingBuild: true, easBuildProfile: "external-testing", easBuildPlatform: "ios",
  }), "ios"));
  check(() => assert.equal(chooseShortBuildDrive(drive => drive === "S:\\"), "T:"));
  check(() => assert.throws(() => chooseShortBuildDrive(() => true), /No temporary drive letter/));
  check(() => assert.equal(resolveGeneratedNativeCache(root), path.join(root, "android", "app", ".cxx")));
  check(() => assert.equal(resolveAndroidSdk({}, { ANDROID_SDK_ROOT: "C:\\Android\\Sdk" }), "C:\\Android\\Sdk"));
  check(() => assert.equal(resolveJavaHome({}, { JAVA_HOME: "C:\\Java\\jdk" }), "C:\\Java\\jdk"));
  check(() => assert.equal(resolveJavaHome({}, {}, () => ({
    status: 0, stdout: "C:\\PortableJava\\bin\\keytool.exe\r\n",
  })), "C:\\PortableJava"));
  check(() => assert.equal(resolveAndroidSerial({ deviceSerial: "device-123" }, "adb"), "device-123"));
  check(() => assert.equal(resolveAndroidSerial({}, "adb", () => ({
    status: 0, stdout: "List of devices attached\r\ndevice-456\tdevice\r\n",
  }), {}), "device-456"));
  check(() => assert.throws(() => resolveAndroidSerial({}, "adb", () => ({
    status: 0, stdout: "List of devices attached\r\none\tdevice\r\ntwo\tdevice\r\n",
  }), {}), /exactly one authorized/));
  const mappingCalls = [];
  const mapping = createShortBuildRoot(root, {
    pathExists: drive => drive === "S:\\",
    run(command, args) {
      mappingCalls.push({ command, args });
      return { status: 0 };
    },
  });
  check(() => assert.deepEqual(mappingCalls[0].args, ["T:", path.dirname(root)]));
  check(() => assert.equal(mapping.root, path.join("T:\\", path.basename(root))));
  check(() => assert.notEqual(path.dirname(mapping.root), mapping.root));
  check(() => assert.equal(path.join(mapping.root, "android"), path.join("T:\\", path.basename(root), "android")));
  mapping.release();
  check(() => assert.deepEqual(mappingCalls[1].args, ["T:", "/D"]));
  check(() => assert.equal(mappingCalls.length, 2));
  check(() => assert.throws(() => createShortBuildRoot(path.parse(root).root), /filesystem root/));
  check(() => assert.throws(() => createShortBuildRoot("relative-project"), /must be absolute/));
  check(() => assert.throws(() => createShortBuildRoot(root, {
    pathExists: () => false, run: () => ({ status: 1 }),
  }), /mapping could not be created/));
  console.log(assertions + " staging-development local configuration assertions passed.");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
