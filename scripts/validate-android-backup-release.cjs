"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const androidRoot = path.join(root, "android");
const gradleCommand = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const gradle = spawnSync(
  gradleCommand,
  [":app:processReleaseMainManifest", "--console=plain"],
  {
    cwd: androidRoot,
    env: { ...process.env, NODE_ENV: "production" },
    shell: process.platform === "win32",
    stdio: "inherit",
  },
);

if (gradle.error) throw gradle.error;
if (gradle.status !== 0) process.exit(gradle.status ?? 1);

const test = spawnSync(
  process.execPath,
  [path.join(root, "scripts", "test-android-backup-config.cjs"), "--merged"],
  { cwd: root, stdio: "inherit" },
);
if (test.error) throw test.error;
process.exit(test.status ?? 1);
