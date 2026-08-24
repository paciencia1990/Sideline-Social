"use strict";

const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, realpathSync, writeFileSync } = require("node:fs");
const { dirname, relative, resolve, sep } = require("node:path");

const codebaseRoot = resolve(__dirname, "..");
const mobileRoot = resolve(codebaseRoot, "..");
const broadSourceRoot = resolve(mobileRoot, "functions", "src");
const generatedRoot = resolve(codebaseRoot, "src", "generated");
const approvedCopies = ["permanentAuth.ts", "teamMembershipCore.ts", "teamVoiceMessagingCore.ts"];

function assertContained(child, parent, label) {
  const path = realpathSync(child);
  const root = `${realpathSync(parent)}${sep}`;
  if (!path.startsWith(root)) throw new Error(`${label} resolved outside its approved root.`);
  return path;
}

function replaceSingle(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0 || source.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Expected one ${label} marker in the tested reporting source.`);
  }
  return source.replace(search, replacement);
}

function removeRange(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || source.indexOf(startMarker, start + startMarker.length) >= 0) {
    throw new Error(`Unable to isolate the ${label} source range safely.`);
  }
  return `${source.slice(0, start)}${source.slice(end)}`;
}

function readApprovedSource(name) {
  const path = resolve(broadSourceRoot, name);
  assertContained(path, broadSourceRoot, name);
  return readFileSync(path, "utf8");
}

mkdirSync(generatedRoot, { recursive: true });

let reportSource = readApprovedSource("moderationReports.ts");
reportSource = replaceSingle(
  reportSource,
  "  coachAiModerationIngestionEnabled,\n",
  "",
  "Coach AI ingestion import",
);
reportSource = removeRange(
  reportSource,
  "export const listMyModerationReports",
  "async function resolveReportTarget",
  "unapproved report-history and Coach AI ingestion exports",
);
reportSource = removeRange(
  reportSource,
  "function readReporterVisibleStatus",
  "function objectValue",
  "report-history response helper",
);
reportSource = replaceSingle(
  reportSource,
  "  memory: \"256MB\",\n  timeoutSeconds: 60,",
  "  memory: \"256MB\",\n  serviceAccount: \"moderation-runtime-stg@sideline-social-staging-2026.iam.gserviceaccount.com\",\n  timeoutSeconds: 60,",
  "staging runtime identity insertion",
);

let coreSource = readApprovedSource("moderationReportsCore.ts");
coreSource = removeRange(
  coreSource,
  "export function coachAiModerationIngestionEnabled",
  "export function mobileModerationReportingEnabled",
  "Coach AI ingestion gate",
);

const forbiddenGeneratedSource = [
  "accountDeletion",
  "createCoachAiUnsafeModerationReport",
  "defineSecret",
  "listMyModerationReports",
  "submitCoachAiFeedback",
];
for (const token of forbiddenGeneratedSource) {
  if (reportSource.includes(token) || coreSource.includes(token)) {
    throw new Error(`Generated reporting source unexpectedly contains ${token}.`);
  }
}

const generated = new Map([
  ["moderationReports.ts", reportSource],
  ["moderationReportsCore.ts", coreSource],
]);
for (const name of approvedCopies) generated.set(name, readApprovedSource(name));

const manifest = {};
for (const [name, content] of generated) {
  const destination = resolve(generatedRoot, name);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content, "utf8");
  manifest[name] = createHash("sha256").update(content).digest("hex");
}
writeFileSync(
  resolve(generatedRoot, "source-manifest.json"),
  `${JSON.stringify({ generatedFrom: relative(mobileRoot, broadSourceRoot), sha256: manifest }, null, 2)}\n`,
  "utf8",
);

console.log("Prepared the isolated moderation-reporting source from the tested shared implementation.");
