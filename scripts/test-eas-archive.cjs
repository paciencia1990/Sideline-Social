"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ignore = require("ignore");
const root = path.resolve(__dirname, "..");
const rules = ignore().add(fs.readFileSync(path.join(root, ".easignore"), "utf8"));
for (const file of [".git/config", "node_modules/expo/package.json", "android/.gradle/cache.bin", "android/app/.cxx/cache.bin", "android/app/build/outputs/app.apk", "android/local.properties", "functions/lib/index.js", "functions/.env.staging", "android/app/src/production/google-services.json", ".env.local"]) assert(rules.ignores(file), `Build/private output must be excluded: ${file}`);
for (const file of ["app.config.js", "package.json", "package-lock.json", "eas.json", "plugins/withAndroidBackupProtection.js", "config/firebaseNativeConfig.js", "scripts/test-ios-maps-prebuild.cjs", "assets/games/spot-the-difference/scene_001_A.webp", "android/gradlew", "android/gradle/wrapper/gradle-wrapper.jar", "android/app/build.gradle", "android/app/src/main/AndroidManifest.xml"]) assert(!rules.ignores(file), `Required input must remain: ${file}`);
// Do not drop source trees, native Android, or signing/Firebase inputs with broad globs.
for (const dir of ["app", "assets", "components", "config", "plugins", "scripts", "src", "android"]) assert(!rules.ignores(`${dir}/`));
console.log("EAS archive exclusions preserve application, plugin, asset and native inputs.");
