"use strict";

const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, realpathSync, writeFileSync } = require("node:fs");
const { dirname, resolve, sep } = require("node:path");

const EXPECTED_SHA256 = "7b4b422f4254691ae51765f115acadbe5b8000ac71dbea4158a5197d8286f67e";
const codebaseRoot = resolve(__dirname, "..");
const consoleRoot = resolve(codebaseRoot, "..", "..", "Sideline_Social_Safety_Console_Phase2");
const canonicalRules = resolve(consoleRoot, "firebase", "staging-firestore.rules");
const destination = resolve(codebaseRoot, "emulator", "staging-firestore.rules");

const resolvedRules = realpathSync(canonicalRules);
const resolvedConsoleRoot = `${realpathSync(consoleRoot)}${sep}`;
if (!resolvedRules.startsWith(resolvedConsoleRoot)) {
  throw new Error("Canonical staging Rules resolved outside the authorized Safety Console worktree.");
}

const content = readFileSync(resolvedRules, "utf8");
const actualHash = createHash("sha256").update(content).digest("hex");
if (actualHash !== EXPECTED_SHA256) {
  throw new Error(`Canonical staging Rules hash changed: ${actualHash}. Review is required before testing.`);
}

mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, content, "utf8");
console.log("Prepared the byte-verified canonical staging Rules copy for the isolated emulator.");
