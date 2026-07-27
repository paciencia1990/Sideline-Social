"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const functionsDirectory = path.join(root, "functions");
const rootPackage = readJson(path.join(root, "package.json"));
const functionsPackagePath = path.join(functionsDirectory, "package.json");
const functionsLockPath = path.join(functionsDirectory, "package-lock.json");
const functionsPackage = readJson(functionsPackagePath);
const firebaseConfig = readJson(path.join(root, "firebase.json"));

assert.equal(
  fs.existsSync(functionsLockPath),
  true,
  "Cloud Functions must commit a package-lock.json for reproducible npm ci installs.",
);

const functionsLock = readJson(functionsLockPath);
const dependencyGroups = [
  functionsPackage.dependencies,
  functionsPackage.devDependencies,
  functionsPackage.optionalDependencies,
  functionsPackage.peerDependencies,
].filter(Boolean);

for (const dependencies of dependencyGroups) {
  for (const [name, specifier] of Object.entries(dependencies)) {
    assert.notEqual(
      name,
      rootPackage.name,
      "Cloud Functions must not depend on the root application package in any dependency group.",
    );
    assert.equal(
      isLocalDependencySpecifier(specifier),
      false,
      `Cloud Functions dependency ${name} must not resolve through a local file or developer-machine path.`,
    );
  }
}

assert.equal(
  functionsPackage.dependencies?.[rootPackage.name],
  undefined,
  "Cloud Functions must not depend on the root application package.",
);
assert.equal(
  functionsLock.name,
  functionsPackage.name,
  "The Functions lockfile must describe the Functions package.",
);
assert.ok(
  Number.isInteger(functionsLock.lockfileVersion) && functionsLock.lockfileVersion >= 3,
  "The Functions lockfile must use the modern npm lockfile format.",
);

for (const [packagePath, metadata] of Object.entries(functionsLock.packages ?? {})) {
  assert.equal(
    isOutsideFunctionsPackagePath(packagePath),
    false,
    `Functions lockfile package key ${packagePath} must remain inside the Functions install.`,
  );
  assert.equal(
    packagePath === `node_modules/${rootPackage.name}` ||
      metadata?.name === rootPackage.name,
    false,
    "The Functions lockfile must not bundle the root application package.",
  );
  assert.notEqual(
    metadata?.link,
    true,
    `Functions lockfile package ${packagePath || "<root>"} must not be a local package link.`,
  );
  for (const field of ["resolved", "version"]) {
    assert.equal(
      isLocalDependencySpecifier(metadata?.[field]),
      false,
      `Functions lockfile package ${packagePath || "<root>"} has a local ${field}.`,
    );
  }
  inspectDependencyMap(metadata?.dependencies, packagePath || "<root>");
  inspectDependencyMap(metadata?.devDependencies, packagePath || "<root>");
  inspectDependencyMap(metadata?.optionalDependencies, packagePath || "<root>");
}
inspectLegacyDependencies(functionsLock.dependencies ?? {}, "dependencies");

assert.ok(
  firebaseConfig.functions?.predeploy?.some((command) => command.includes("run build")),
  "Firebase Functions deployment must build TypeScript from a clean checkout before packaging.",
);

console.log("Cloud Functions package and lockfile contain no parent-package dependency or developer-machine path.");

function isLocalDependencySpecifier(value) {
  return typeof value === "string" && (
    /^(?:file|link|workspace):/iu.test(value) ||
    /^\.{1,2}[\\/]/u.test(value) ||
    /^[a-z]:[\\/]/iu.test(value) ||
    /^\\\\/u.test(value) ||
    /^\//u.test(value)
  );
}

function isOutsideFunctionsPackagePath(packagePath) {
  return (
    packagePath === ".." ||
    packagePath.startsWith("../") ||
    path.isAbsolute(packagePath)
  );
}

function inspectDependencyMap(dependencies, location) {
  for (const [name, specifier] of Object.entries(dependencies ?? {})) {
    assert.equal(
      isLocalDependencySpecifier(specifier),
      false,
      `Functions lockfile dependency ${location}.${name} must not resolve through a local path.`,
    );
  }
}

function inspectLegacyDependencies(dependencies, location) {
  for (const [name, metadata] of Object.entries(dependencies)) {
    assert.notEqual(metadata?.link, true, `Functions lockfile dependency ${location}.${name} must not be linked.`);
    for (const field of ["resolved", "version"]) {
      assert.equal(
        isLocalDependencySpecifier(metadata?.[field]),
        false,
        `Functions lockfile dependency ${location}.${name} has a local ${field}.`,
      );
    }
    inspectLegacyDependencies(metadata?.dependencies ?? {}, `${location}.${name}.dependencies`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
