"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync, readdirSync } = require("node:fs");
const { resolve } = require("node:path");

const APPROVED_PROJECT = "sideline-social-staging-2026";
const EXPIRATION_DATE = "2026-09-23";
const ADVISORY_ID = "GHSA-w5hq-g745-h8pq";
const ADVISORY_SOURCE = 1119441;
const ADVISORY_URL = `https://github.com/advisories/${ADVISORY_ID}`;

const EXPECTED_VULNERABILITIES = Object.freeze({
  "@google-cloud/storage": {
    nodes: ["node_modules/@google-cloud/storage"],
    via: ["retry-request", "teeny-request"],
  },
  "firebase-admin": {
    nodes: ["node_modules/firebase-admin"],
    via: ["@google-cloud/storage"],
  },
  "firebase-functions": {
    nodes: ["node_modules/firebase-functions"],
    via: ["firebase-admin"],
  },
  gaxios: {
    nodes: ["node_modules/gaxios"],
    via: ["uuid"],
  },
  "retry-request": {
    nodes: ["node_modules/retry-request"],
    via: ["teeny-request"],
  },
  "teeny-request": {
    nodes: ["node_modules/teeny-request"],
    via: ["uuid"],
  },
  uuid: {
    nodes: [
      "node_modules/gaxios/node_modules/uuid",
      "node_modules/teeny-request/node_modules/uuid",
    ],
    via: [],
  },
});

const EXPECTED_LOCK_PACKAGES = Object.freeze({
  "node_modules/@google-cloud/storage": "7.22.0",
  "node_modules/firebase-admin": "14.3.0",
  "node_modules/firebase-functions": "7.3.2",
  "node_modules/gaxios": "6.7.1",
  "node_modules/gaxios/node_modules/uuid": "9.0.1",
  "node_modules/retry-request": "7.0.2",
  "node_modules/teeny-request": "9.0.0",
  "node_modules/teeny-request/node_modules/uuid": "9.0.1",
});

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertExactArray(actual, expected, label) {
  assert.deepEqual(sorted(actual || []), sorted(expected), label);
}

function advisoryLeaves(name, vulnerabilities, visited = new Set()) {
  assert.equal(visited.has(name), false, `audit dependency cycle at ${name}`);
  const finding = vulnerabilities[name];
  assert.ok(finding, `audit references unexpected or missing finding ${name}`);
  const nextVisited = new Set(visited).add(name);
  const leaves = new Set();
  for (const via of finding.via || []) {
    if (typeof via === "string") {
      for (const leaf of advisoryLeaves(via, vulnerabilities, nextVisited)) leaves.add(leaf);
      continue;
    }
    assert.equal(via.source, ADVISORY_SOURCE, `${name} has an unapproved advisory source`);
    assert.equal(via.name, "uuid", `${name} has an unapproved advisory package`);
    assert.equal(via.url, ADVISORY_URL, `${name} has an unapproved advisory URL`);
    assert.equal(via.severity, "moderate", `${name} advisory severity changed`);
    assert.equal(via.range, "<11.1.1", `${name} advisory range changed`);
    leaves.add(ADVISORY_ID);
  }
  assert.ok(leaves.size > 0, `${name} does not resolve to an advisory`);
  return leaves;
}

function validateAudit(report, { project, nowDate }) {
  assert.equal(project, APPROVED_PROJECT, "security exception is staging-only");
  assert.match(nowDate, /^\d{4}-\d{2}-\d{2}$/u, "invalid policy date");
  assert.ok(nowDate <= EXPIRATION_DATE, `security exception expired after ${EXPIRATION_DATE}`);

  const metadata = report?.metadata?.vulnerabilities;
  assert.ok(metadata, "npm audit vulnerability metadata is missing");
  assert.equal(metadata.high, 0, "high-severity advisory is not permitted");
  assert.equal(metadata.critical, 0, "critical-severity advisory is not permitted");
  assert.equal(metadata.info, 0, "unexpected informational advisory");
  assert.equal(metadata.low, 0, "unexpected low-severity advisory");
  assert.equal(metadata.moderate, 7, "unexpected moderate-advisory count");
  assert.equal(metadata.total, 7, "unexpected total advisory count");

  const vulnerabilities = report.vulnerabilities || {};
  assertExactArray(
    Object.keys(vulnerabilities),
    Object.keys(EXPECTED_VULNERABILITIES),
    "audit contains an unexpected finding or is missing an expected finding",
  );

  for (const [name, expected] of Object.entries(EXPECTED_VULNERABILITIES)) {
    const finding = vulnerabilities[name];
    assert.equal(finding.name, name, `${name} finding name changed`);
    assert.equal(finding.severity, "moderate", `${name} severity changed`);
    assertExactArray(finding.nodes, expected.nodes, `${name} audit nodes changed`);
    const stringVia = (finding.via || []).filter((value) => typeof value === "string");
    assertExactArray(stringVia, expected.via, `${name} dependency path changed`);
    const leaves = advisoryLeaves(name, vulnerabilities);
    assert.deepEqual([...leaves], [ADVISORY_ID], `${name} derives from an unapproved advisory`);
  }
}

function validateLock(lock, packageJson) {
  assert.equal(packageJson.engines.node, "22", "Node 22 pin changed");
  assert.deepEqual(packageJson.dependencies, {
    "firebase-admin": "14.3.0",
    "firebase-functions": "7.3.2",
  });
  assert.equal(lock.lockfileVersion, 3, "unexpected npm lockfile version");

  for (const [path, version] of Object.entries(EXPECTED_LOCK_PACKAGES)) {
    assert.equal(lock.packages?.[path]?.version, version, `${path} version changed`);
    assert.notEqual(lock.packages[path].dev, true, `${path} became development-only`);
  }
  assert.equal(
    lock.packages["node_modules/firebase-admin"].optionalDependencies?.["@google-cloud/storage"],
    "^7.22.0",
    "Firebase Admin Storage dependency range changed",
  );
  assert.equal(lock.packages["node_modules/@google-cloud/storage"].dependencies?.gaxios, "^6.0.2");
  assert.equal(lock.packages["node_modules/@google-cloud/storage"].dependencies?.["retry-request"], "^7.0.0");
  assert.equal(lock.packages["node_modules/@google-cloud/storage"].dependencies?.["teeny-request"], "^9.0.0");

  const uuidPackages = Object.entries(lock.packages)
    .filter(([path]) => path === "node_modules/uuid" || path.endsWith("/node_modules/uuid"))
    .map(([path, value]) => [path, value.version]);
  assert.deepEqual(uuidPackages, [
    ["node_modules/gaxios/node_modules/uuid", "9.0.1"],
    ["node_modules/teeny-request/node_modules/uuid", "9.0.1"],
  ], "UUID dependency graph changed");
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:c?js|ts)$/u.test(entry.name) ? [path] : [];
  });
}

function validateSource(root) {
  const sourceRoot = resolve(root, "src");
  const combined = sourceFiles(sourceRoot).map((path) => readFileSync(path, "utf8")).join("\n");
  for (const [label, pattern] of [
    ["UUID package import", /(?:from\s+|require\s*\(\s*)["']uuid(?:\/[^"']*)?["']/u],
    ["UUID v3/v5/v6 call", /\b(?:v3|v5|v6)\s*\(/u],
    ["Firebase Admin Storage import", /firebase-admin\/storage/u],
    ["Firebase Admin getStorage call", /\bgetStorage\s*\(/u],
    ["Firebase Admin namespaced Storage call", /\badmin\.storage\s*\(/u],
  ]) {
    assert.equal(pattern.test(combined), false, `${label} is prohibited by the staging exception`);
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
    let firebaseConfig;
    try {
      firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
    } catch {
      throw new Error("FIREBASE_CONFIG is not valid JSON");
    }
    if (firebaseConfig.projectId) projects.push(firebaseConfig.projectId);
  }
  return projects;
}

function runFreshAudit(root) {
  const auditArguments = ["audit", "--omit=dev", "--json"];
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const argumentsForCommand = npmCli ? [npmCli, ...auditArguments] : auditArguments;
  const result = spawnSync(command, argumentsForCommand, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.ok([0, 1].includes(result.status), `npm audit failed to produce a reviewable result: ${result.stderr}`);
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
    assert.equal(configuredProject, APPROVED_PROJECT, "security exception cannot run for another project");
  }
  const report = runFreshAudit(root);
  validateAudit(report, { project, nowDate: new Date().toISOString().slice(0, 10) });
  validateLock(
    JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8")),
    JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")),
  );
  validateSource(root);
  console.log(`Normal npm audit remains non-zero: seven moderate findings derived solely from ${ADVISORY_ID}.`);
  console.log(`Accepted only for ${APPROVED_PROJECT} through ${EXPIRATION_DATE}; production use is prohibited.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Security-exception policy failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ADVISORY_ID,
  ADVISORY_SOURCE,
  ADVISORY_URL,
  APPROVED_PROJECT,
  EXPIRATION_DATE,
  EXPECTED_VULNERABILITIES,
  validateAudit,
  validateLock,
  validateSource,
};
