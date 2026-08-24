"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const {
  ADVISORY_SOURCE,
  ADVISORY_URL,
  APPROVED_PROJECT,
  EXPECTED_VULNERABILITIES,
  validateAudit,
  validateLock,
  validateSource,
} = require("./verify-security-exception.cjs");

const root = resolve(__dirname, "..");

function finding(name, expected) {
  return {
    name,
    severity: "moderate",
    nodes: [...expected.nodes],
    via: name === "uuid" ? [{
      source: ADVISORY_SOURCE,
      name: "uuid",
      url: ADVISORY_URL,
      severity: "moderate",
      range: "<11.1.1",
    }] : [...expected.via],
  };
}

function baselineAudit() {
  return {
    auditReportVersion: 2,
    vulnerabilities: Object.fromEntries(
      Object.entries(EXPECTED_VULNERABILITIES).map(([name, expected]) => [name, finding(name, expected)]),
    ),
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 7, high: 0, critical: 0, total: 7 },
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const accepted = baselineAudit();
validateAudit(accepted, { project: APPROVED_PROJECT, nowDate: "2026-08-24" });
validateLock(
  JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8")),
  JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")),
);
validateSource(root);

const extra = clone(accepted);
extra.vulnerabilities.unapproved = finding("unapproved", { nodes: ["node_modules/unapproved"], via: ["uuid"] });
extra.metadata.vulnerabilities.moderate += 1;
extra.metadata.vulnerabilities.total += 1;
assert.throws(
  () => validateAudit(extra, { project: APPROVED_PROJECT, nowDate: "2026-08-24" }),
  /unexpected (?:moderate-advisory count|finding)/u,
);

const high = clone(accepted);
high.metadata.vulnerabilities.high = 1;
high.metadata.vulnerabilities.total += 1;
assert.throws(
  () => validateAudit(high, { project: APPROVED_PROJECT, nowDate: "2026-08-24" }),
  /high-severity/u,
);

const changedGraph = clone(accepted);
changedGraph.vulnerabilities.uuid.nodes.push("node_modules/unexpected/node_modules/uuid");
assert.throws(
  () => validateAudit(changedGraph, { project: APPROVED_PROJECT, nowDate: "2026-08-24" }),
  /audit nodes changed/u,
);

assert.throws(
  () => validateAudit(accepted, { project: "sideline-squad", nowDate: "2026-08-24" }),
  /staging-only/u,
);
assert.throws(
  () => validateAudit(accepted, { project: APPROVED_PROJECT, nowDate: "2026-09-24" }),
  /expired/u,
);

console.log("Security-exception policy accepts only the reviewed staging UUID advisory graph and fails closed for production, expiry, graph drift, or additional severity.");
