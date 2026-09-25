"use strict";
// Offline AGP integration fixture: no real app, credentials, compilation or install.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createShortBuildRoot } = require("./staging-development.cjs");
const repo = path.resolve(__dirname, "..");
const rootGradle = fs.readFileSync(path.join(repo, "android", "build.gradle"), "utf8");
assert.ok(rootGradle.indexOf('apply from: "staging-native-paths.gradle"') <
  rootGradle.indexOf('apply plugin: "com.facebook.react.rootproject"'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sideline-native-path-test-"));
const fixture = path.join(temp, "mobile");
const android = path.join(fixture, "android");
const script = path.join(repo, "android", "staging-native-paths.gradle").replace(/\\/g, "/");
const nativeModule = `
apply plugin: "com.android.library"
android {
  namespace "com.example.pathcheck"
  compileSdk 36
  ndkVersion "27.1.12297006"
  defaultConfig { minSdk 24 }
  externalNativeBuild { cmake { path "CMakeLists.txt" } }
}
`;
function write(relative, content) {
  const file = path.join(android, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
let mapping;
try {
  write("settings.gradle", `
rootProject.name = "native-path-check"
include ":app", ":react-native-nitro-google-signin", ":nested:second-native", ":plain-library"
`);
  write("build.gradle", `
buildscript {
  repositories { google(); mavenCentral() }
  dependencies { classpath "com.android.tools.build:gradle:8.12.0" }
}
if (System.getenv("EXPO_PUBLIC_STAGING_DEVELOPMENT_BUILD") == "true") {
  apply from: "${script}"
}
tasks.register("verifyUntouched") {
  doLast {
    subprojects.findAll { it.plugins.hasPlugin("com.android.library") }.each {
      assert !it.android.externalNativeBuild.cmake.buildStagingDirectory.toString().contains(".cxx-staging-libs")
    }
    println("NON_DEVELOPMENT_NATIVE_PATHS_UNCHANGED")
  }
}
tasks.register("verifyPlainLibrary") {
  doLast {
    assert !project(":plain-library").android.externalNativeBuild.cmake.buildStagingDirectory.toString().contains(".cxx-staging-libs")
    assert project(":app").tasks.named("preStagingDebugBuild").get().taskDependencies.getDependencies(project(":app").tasks.named("preStagingDebugBuild").get()).contains(tasks.named("verifyStagingDebugNativePaths").get())
    println("NON_NATIVE_LIBRARY_UNCHANGED_AND_BUILD_GUARD_CONNECTED")
  }
}
`);
  write("app/build.gradle", 'tasks.register("preStagingDebugBuild")\n');
  write("plain-library/build.gradle", 'apply plugin: "com.android.library"\nandroid { namespace "com.example.plain"; compileSdk 36; defaultConfig { minSdk 24 } }\n');
  for (const module of ["react-native-nitro-google-signin", "nested/second-native"]) {
    write(module + "/build.gradle", nativeModule);
    write(module + "/CMakeLists.txt", "cmake_minimum_required(VERSION 3.22.1)\nproject(PathCheck)\n");
  }
  mapping = createShortBuildRoot(fixture);
  const env = { ...process.env,
    JAVA_HOME: "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.11.10-hotspot",
    ANDROID_HOME: path.join(process.env.LOCALAPPDATA, "Android", "Sdk"),
    EAS_BUILD_PROFILE: "staging-development", EAS_BUILD_PLATFORM: "android",
    APP_VARIANT: "development", EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "staging",
    EXPO_PUBLIC_STAGING_DEVELOPMENT_BUILD: "true",
    EXPO_PUBLIC_STAGING_ACCEPTANCE_BUILD: "false", EXPO_PUBLIC_EXTERNAL_TESTING_BUILD: "false",
  };
  function run(tasks, overrides = {}) {
    const result = spawnSync(path.join(repo, "android", "gradlew.bat"),
      [...tasks, "--offline", "--no-daemon", "--console=plain"],
      { cwd: path.join(mapping.root, "android"), env: { ...env, ...overrides },
        shell: true, encoding: "utf8", windowsHide: true, timeout: 180000 });
    const output = (result.stdout || "") + (result.stderr || "");
    assert.equal(result.error, undefined, result.error?.message);
    return { status: result.status, output };
  }
  const active = run(["verifyStagingDebugNativePaths", "verifyPlainLibrary"]);
  assert.equal(active.status, 0, active.output);
  assert.match(active.output, /Staging native path verified: :react-native-nitro-google-signin/);
  assert.match(active.output, /Staging native path verified: :nested:second-native/);
  assert.match(active.output, /NON_NATIVE_LIBRARY_UNCHANGED_AND_BUILD_GUARD_CONNECTED/);
  const verifiedPaths = [...active.output.matchAll(/Staging native path verified: [^\r\n]+ -> ([^\r\n]+)/g)]
    .map(match => match[1].trim());
  assert.equal(verifiedPaths.length, 2);
  assert.equal(new Set(verifiedPaths).size, 2);
  assert.ok(verifiedPaths.every(directory => directory.startsWith(mapping.root + path.sep)));
  console.log("Active native-library short paths and build guard: passed.");
  const other = run(["verifyUntouched"], {
    EAS_BUILD_PROFILE: "external-testing", APP_VARIANT: "production",
    EXPO_PUBLIC_STAGING_DEVELOPMENT_BUILD: "false",
  });
  assert.equal(other.status, 0, other.output);
  assert.match(other.output, /NON_DEVELOPMENT_NATIVE_PATHS_UNCHANGED/);
  console.log("Non-development native paths unchanged: passed.");
  const conflict = run(["verifyStagingDebugNativePaths"], { EAS_BUILD_PROFILE: "production" });
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.output, /exclusive Windows staging-development context/);
  console.log("Conflicting profile rejected: passed. No CMake compile or APK build ran.");
} finally {
  if (mapping) mapping.release();
  // This exact generated fixture is the only removed directory.
  assert.ok(temp.startsWith(path.join(os.tmpdir(), "sideline-native-path-test-")));
  fs.rmSync(temp, { recursive: true, force: true });
}
