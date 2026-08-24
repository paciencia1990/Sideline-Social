"use strict";

const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const Module = require("node:module");
const { resolve, relative } = require("node:path");
const { spawnSync } = require("node:child_process");

const root = resolve(__dirname, "..");
const mobileRoot = resolve(root, "..");
const packageJson = require(resolve(root, "package.json"));
const firebaseConfig = require(resolve(mobileRoot, "firebase.moderation-staging.json"));
const generatedManifest = require(resolve(root, "src", "generated", "source-manifest.json"));

assert.equal(packageJson.main, "lib/src/index.js");
assert.deepEqual(Object.keys(packageJson.dependencies).sort(), ["firebase-admin", "firebase-functions"]);
assert.equal(firebaseConfig.functions.length, 1);
assert.equal(firebaseConfig.functions[0].source, "moderation-reporting-staging");
assert.equal(firebaseConfig.functions[0].codebase, "moderation-reporting-staging");
assert.match(firebaseConfig.functions[0].predeploy[0], /assert-staging-project/u);
assert.equal(Object.keys(generatedManifest.sha256).length, 5);

const guard = resolve(root, "scripts", "assert-staging-project.cjs");
const guardEnvironment = {
  ...process.env,
  RESOURCE_DIR: root,
};
assert.equal(spawnSync(process.execPath, [guard], {
  env: { ...guardEnvironment, GCLOUD_PROJECT: "sideline-social-staging-2026" },
}).status, 0);
for (const rejectedProject of ["sideline-squad", "", "another-project"]) {
  const result = spawnSync(process.execPath, [guard], {
    env: { ...guardEnvironment, GCLOUD_PROJECT: rejectedProject, GOOGLE_CLOUD_PROJECT: "" },
  });
  assert.notEqual(result.status, 0, `deployment guard accepted ${rejectedProject || "a missing project"}`);
}

const libRoot = resolve(root, "lib");
const localLoaded = new Set();
const originalLoad = Module._load;
Module._load = function tracedLoad(request, parent, isMain) {
  const resolved = Module._resolveFilename(request, parent, isMain);
  if (typeof resolved === "string" && resolved.startsWith(libRoot)) {
    localLoaded.add(relative(libRoot, resolved).replaceAll("\\", "/"));
  }
  return originalLoad.apply(this, arguments);
};
let exportsFromMain;
try {
  process.env.FUNCTIONS_EMULATOR = "true";
  process.env.GCLOUD_PROJECT = "demo-sideline-moderation-reporting-isolation";
  exportsFromMain = require(resolve(root, packageJson.main));
} finally {
  Module._load = originalLoad;
}

assert.deepEqual(Object.keys(exportsFromMain), ["submitModerationReportV2"]);
assert.deepEqual([...localLoaded].sort(), [
  "src/generated/moderationReports.js",
  "src/generated/moderationReportsCore.js",
  "src/generated/permanentAuth.js",
  "src/generated/teamMembershipCore.js",
  "src/generated/teamVoiceMessagingCore.js",
  "src/index.js",
]);
assert.equal(exportsFromMain.submitModerationReportV2.__endpoint.platform, "gcfv1");
assert.deepEqual(exportsFromMain.submitModerationReportV2.__trigger.regions, ["us-central1"]);
assert.equal(exportsFromMain.submitModerationReportV2.__trigger.availableMemoryMb, 256);
assert.equal(exportsFromMain.submitModerationReportV2.__trigger.timeout, "60s");
assert.equal(
  exportsFromMain.submitModerationReportV2.__endpoint.serviceAccountEmail,
  "moderation-runtime-stg@sideline-social-staging-2026.iam.gserviceaccount.com",
);
assert.deepEqual(Object.keys(exportsFromMain.submitModerationReportV2.__endpoint.callableTrigger), []);

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? javascriptFiles(path) : entry.name.endsWith(".js") ? [path] : [];
  });
}
const ownRuntimeSource = javascriptFiles(libRoot).map((path) => readFileSync(path, "utf8")).join("\n");
for (const forbidden of [
  "accountDeletion",
  "createCoachAiUnsafeModerationReport",
  "defineSecret",
  "listMyModerationReports",
  "secretmanager",
  "submitCoachAiFeedback",
]) {
  assert.equal(ownRuntimeSource.includes(forbidden), false, `runtime source contains ${forbidden}`);
}

console.log(`Isolated discovery exports only submitModerationReportV2; loaded ${localLoaded.size} approved local modules and no secret-bound Function source.`);
