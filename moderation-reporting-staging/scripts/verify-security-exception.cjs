"use strict";

const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const APPROVED_PROJECT = "sideline-social-staging-2026";

function validateAudit(report, { project }) {
  assert.equal(project, APPROVED_PROJECT, "dependency validation is staging-only");
  const metadata = report?.metadata?.vulnerabilities;
  assert.ok(metadata, "npm audit vulnerability metadata is missing");
  for (const severity of ["info", "low", "moderate", "high", "critical", "total"]) {
    assert.equal(metadata[severity], 0, `unexpected ${severity} advisory count`);
  }
  assert.deepEqual(Object.keys(report.vulnerabilities || {}), [], "npm audit contains a finding");
}

function validateLock(lock, packageJson) {
  assert.equal(packageJson.engines.node, "22", "Node 22 pin changed");
  assert.deepEqual(packageJson.dependencies, {
    "@google-cloud/firestore": "9.2.0",
    "firebase-admin": "14.5.0",
    "firebase-functions": "7.3.2",
  });
  assert.deepEqual(packageJson.devDependencies, {
    "@google-cloud/storage": "8.2.0",
    "@types/node": "22.20.1",
    "typescript": "5.9.3",
  });
  assert.equal(lock.lockfileVersion, 3, "unexpected npm lockfile version");
  assert.deepEqual(lock.packages?.[""]?.dependencies, packageJson.dependencies, "lockfile root dependencies changed");
  assert.equal(lock.packages?.["node_modules/@google-cloud/firestore"]?.version, "9.2.0");
  assert.equal(lock.packages?.["node_modules/firebase-admin"]?.version, "14.5.0");
  assert.equal(lock.packages?.["node_modules/firebase-functions"]?.version, "7.3.2");
  assert.equal(lock.packages?.["node_modules/qs"]?.version, "6.16.0");
}

function validateInstallPolicy(root) {
  assert.equal(readFileSync(resolve(root, ".npmrc"), "utf8").trim(), "omit=optional");
  assert.equal(existsSync(resolve(root, "node_modules", "@google-cloud", "firestore")), true, "required Firestore client is missing");
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.equal(packageJson.dependencies["@google-cloud/storage"], undefined, "Storage became a production dependency");
  assert.equal(packageJson.devDependencies["@google-cloud/storage"], "8.2.0", "emulator Storage dependency changed");
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(?:c?js|ts)$/u.test(entry.name) ? [file] : [];
  });
}

function validateSource(root) {
  const sourceRoot = resolve(root, "src");
  const combined = sourceFiles(sourceRoot).map((file) => readFileSync(file, "utf8")).join("\n");
  for (const [label, pattern] of [
    ["UUID package import", /(?:from\s+|require\s*\(\s*)["']uuid(?:\/[^"']*)?["']/u],
    ["UUID v3/v5/v6 call", /\b(?:v3|v5|v6)\s*\(/u],
    ["Firebase Admin Storage import", /firebase-admin\/storage/u],
    ["Firebase Admin getStorage call", /\bgetStorage\s*\(/u],
    ["Firebase Admin namespaced Storage call", /\badmin\.storage\s*\(/u],
  ]) {
    assert.equal(pattern.test(combined), false, `${label} is prohibited in the isolated reporting package`);
  }

  const reportSource = readFileSync(resolve(sourceRoot, "generated", "moderationReports.ts"), "utf8");
  assert.match(reportSource, /import \{ randomUUID \} from "node:crypto";/u);
  assert.match(reportSource, /from "firebase-admin\/firestore"/u);
  assert.match(reportSource, /from "firebase-functions\/v1"/u);
  assert.match(reportSource, /randomUUID\(\)/u);
  assert.equal(/randomUUID\(\s*[^)]/u.test(reportSource), false, "randomUUID received an argument");

  const environmentTemplate = readFileSync(resolve(root, ".env.example"), "utf8");
  assert.match(environmentTemplate, /^MODERATION_SYSTEM_ENABLED=false$/mu);
  assert.match(environmentTemplate, /^MODERATION_REPORTING_V2_ENABLED=false$/mu);
  assert.match(environmentTemplate, /^MODERATION_APP_CHECK_MODE=monitor$/mu);
}

function configuredProjects(project) {
  const projects = [project, process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim());
  if (process.env.FIREBASE_CONFIG) {
    const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
    if (firebaseConfig.projectId) projects.push(firebaseConfig.projectId);
  }
  return projects;
}

function runFreshAudit(root) {
  const auditArguments = ["audit", "--omit=dev", "--omit=optional", "--json"];
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const argumentsForCommand = npmCli ? [npmCli, ...auditArguments] : auditArguments;
  const result = spawnSync(command, argumentsForCommand, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `npm audit did not pass: ${result.stderr}`);
  assert.ok(result.stdout.trim(), "npm audit returned no JSON");
  process.stdout.write(`${result.stdout.trim()}\n`);
  return JSON.parse(result.stdout);
}

function parseProject(argumentsList) {
  const argument = argumentsList.find((value) => value.startsWith("--project="));
  assert.ok(argument, "an explicit --project is required");
  return argument.slice("--project=".length);
}

function main() {
  const root = resolve(__dirname, "..");
  const project = parseProject(process.argv.slice(2));
  for (const configuredProject of configuredProjects(project)) {
    assert.equal(configuredProject, APPROVED_PROJECT, "dependency validation cannot run for another project");
  }
  validateAudit(runFreshAudit(root), { project });
  validateLock(
    JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8")),
    JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")),
  );
  validateInstallPolicy(root);
  validateSource(root);
  console.log("Production dependency audit is clean for the installed isolated reporting runtime; no security exception is active.");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Dependency security validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { APPROVED_PROJECT, validateAudit, validateInstallPolicy, validateLock, validateSource };
