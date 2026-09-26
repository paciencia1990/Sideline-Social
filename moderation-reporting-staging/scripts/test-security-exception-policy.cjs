"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const {
  APPROVED_PROJECT,
  validateAudit,
  validateInstallPolicy,
  validateLock,
  validateSource,
} = require("./verify-security-exception.cjs");

const root = resolve(__dirname, "..");
const cleanAudit = {
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
};

validateAudit(cleanAudit, { project: APPROVED_PROJECT });
validateLock(
  JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8")),
  JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")),
);
validateInstallPolicy(root);
validateSource(root);

const finding = structuredClone(cleanAudit);
finding.vulnerabilities.uuid = { name: "uuid", severity: "moderate" };
finding.metadata.vulnerabilities.moderate = 1;
finding.metadata.vulnerabilities.total = 1;
assert.throws(() => validateAudit(finding, { project: APPROVED_PROJECT }), /moderate advisory count|finding/u);
assert.throws(() => validateAudit(cleanAudit, { project: "sideline-squad" }), /staging-only/u);

const changedPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
changedPackage.dependencies["firebase-admin"] = "14.3.0";
assert.throws(
  () => validateLock(JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8")), changedPackage),
  /Expected values to be strictly deep-equal/u,
);

console.log("Dependency policy requires a zero-finding production audit, exact supported pins, explicit Firestore, and omission of unused optional Storage.");
