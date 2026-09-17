"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const gradlePath = path.join(root, "android", "app", "build.gradle");
const gradle = fs.readFileSync(gradlePath, "utf8");
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
const releaseTarget = path.join(root, "android", "app", "src", "staging", "google-services.json");
const debugTarget = path.join(root, "android", "app", "src", "debug", "google-services.json");
const releaseTargetExisted = fs.existsSync(releaseTarget);
const debugTargetExisted = fs.existsSync(debugTarget);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sideline-native-gradle-"));
const approvedAppId = "1:123456789:android:staging";

function firebaseConfig({ projectId = "sideline-social-staging-2026", packageName = "com.sidelinesquad.app.dev" } = {}) {
  return {
    project_info: {
      project_number: "123456789",
      project_id: projectId,
      storage_bucket: `${projectId}.firebasestorage.app`,
    },
    client: [{
      client_info: {
        mobilesdk_app_id: approvedAppId,
        android_client_info: { package_name: packageName },
      },
      oauth_client: [
        {
          client_id: "android.apps.googleusercontent.com",
          client_type: 1,
          android_info: {
            package_name: packageName,
            certificate_hash: "81:Ea:B5:7c:24:35:63:85:D1:56:55:75:C9:04:EC:40:3B:70:23:CE",
          },
        },
        { client_id: "web.apps.googleusercontent.com", client_type: 3 },
      ],
      api_key: [{ current_key: "synthetic-test-key" }],
      services: {
        appinvite_service: {
          other_platform_oauth_client: [{ client_id: "web.apps.googleusercontent.com", client_type: 3 }],
        },
      },
    }],
    configuration_version: "1",
  };
}

function writeConfig(name, value) {
  const target = path.join(temp, name);
  fs.writeFileSync(target, JSON.stringify(value));
  return target;
}

function removeGeneratedTarget(target, existedBefore) {
  if (existedBefore || !fs.existsSync(target)) return;
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.unlinkSync(target);
      return;
    } catch (error) {
      lastError = error;
      if (!["EBUSY", "EPERM"].includes(error?.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
  throw lastError;
}

function runGradle(args, overrides = {}) {
  const env = {
    ...process.env,
    EAS_BUILD: "true",
    EAS_BUILD_PLATFORM: "android",
    EAS_BUILD_PROFILE: "staging-acceptance",
    APP_VARIANT: "development",
    EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "staging",
    EXPO_PUBLIC_STAGING_ACCEPTANCE_BUILD: "true",
    EXPO_PUBLIC_FIREBASE_APP_ID_ANDROID: approvedAppId,
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "web.apps.googleusercontent.com",
    ...overrides,
  };
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete env[name];
  }
  return spawnSync(process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe", [
    "/d",
    "/c",
    "gradlew.bat",
    ...args,
    "--offline",
    "--no-daemon",
    "--console=plain",
  ], {
    cwd: path.join(root, "android"),
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 240000,
  });
}

function combinedOutput(result) {
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function assertFailure(result, pattern) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0, "Expected Gradle configuration to fail closed.");
  assert.match(combinedOutput(result), pattern);
}

try {
  assert.ok(gradle.includes('System.getenv("EAS_BUILD_PROFILE")'));
  assert.ok(gradle.includes('easBuildProfile == "staging-acceptance"'));
  assert.ok(gradle.includes('easBuildPlatform == "android"'));
  assert.ok(gradle.includes('System.getenv("GOOGLE_SERVICES_JSON_ANDROID_STAGING")'));
  assert.ok(gradle.includes('file("src/staging/google-services.json")'));
  assert.ok(gradle.includes("applicationId 'com.sidelinesquad.app.dev'"));
  assert.equal(gradle.includes('applicationIdSuffix ".dev"'), false);
  assert.match(gitignore, /^android\/app\/src\/staging\/google-services\.json$/mu);

  const valid = writeConfig("valid.json", firebaseConfig());
  const wrongProject = writeConfig("wrong-project.json", firebaseConfig({ projectId: "wrong-project" }));
  const wrongPackage = writeConfig("wrong-package.json", firebaseConfig({ packageName: "com.sidelinesquad.wrong" }));

  assertFailure(
    runGradle(["help"], { GOOGLE_SERVICES_JSON_ANDROID_STAGING: undefined }),
    /GOOGLE_SERVICES_JSON_ANDROID_STAGING is required/u,
  );
  assertFailure(
    runGradle(["help"], { GOOGLE_SERVICES_JSON_ANDROID_STAGING: wrongProject }),
    /project attribution is invalid/u,
  );
  assertFailure(
    runGradle(["help"], { GOOGLE_SERVICES_JSON_ANDROID_STAGING: wrongPackage }),
    /package attribution is invalid/u,
  );
  assertFailure(
    runGradle(["help"], {
      GOOGLE_SERVICES_JSON_ANDROID_STAGING: valid,
      EAS_BUILD_PLATFORM: undefined,
    }),
    /build context is incomplete or conflicting/u,
  );

  const staging = runGradle([":app:processStagingReleaseGoogleServices"], {
    GOOGLE_SERVICES_JSON_ANDROID_STAGING: valid,
  });
  assert.equal(staging.status, 0, combinedOutput(staging));
  assert.match(combinedOutput(staging), /processStagingReleaseGoogleServices/u);
  assert.ok(fs.existsSync(releaseTarget), "The release variant did not receive the selected staging file.");
  assert.deepEqual(fs.readFileSync(releaseTarget), fs.readFileSync(valid));

  removeGeneratedTarget(releaseTarget, releaseTargetExisted);
  const production = runGradle([":app:processProductionReleaseGoogleServices"], {
    EAS_BUILD: undefined,
    EAS_BUILD_PLATFORM: undefined,
    EAS_BUILD_PROFILE: undefined,
    APP_VARIANT: "production",
    EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "production",
    EXPO_PUBLIC_STAGING_ACCEPTANCE_BUILD: "false",
    EXPO_PUBLIC_FIREBASE_APP_ID_ANDROID: undefined,
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: undefined,
    GOOGLE_SERVICES_JSON_ANDROID_STAGING: undefined,
  });
  assert.equal(production.status, 0, combinedOutput(production));

  const development = runGradle([":app:processDevelopmentDebugGoogleServices"], {
    EAS_BUILD: undefined,
    EAS_BUILD_PLATFORM: undefined,
    EAS_BUILD_PROFILE: "development",
    APP_VARIANT: "development",
    EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "development",
    EXPO_PUBLIC_STAGING_ACCEPTANCE_BUILD: "false",
    EXPO_PUBLIC_FIREBASE_APP_ID_ANDROID: undefined,
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: undefined,
    GOOGLE_SERVICES_JSON_ANDROID_STAGING: undefined,
    GOOGLE_SERVICES_JSON_ANDROID_DEVELOPMENT: path.join(root, "google-services.json"),
  });
  assert.equal(development.status, 0, combinedOutput(development));

  console.log("Actual Gradle staging release selection, Google Services processing, rejection, and production/development preservation checks passed.");
} finally {
  removeGeneratedTarget(releaseTarget, releaseTargetExisted);
  removeGeneratedTarget(debugTarget, debugTargetExisted);
  fs.rmSync(temp, { recursive: true, force: true });
}
