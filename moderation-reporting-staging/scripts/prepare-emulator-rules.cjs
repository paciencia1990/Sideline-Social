"use strict";

const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, realpathSync, writeFileSync } = require("node:fs");
const { dirname, resolve, sep } = require("node:path");

const EXPECTED_SHA256 = "08e41d2abf8756ece597bcdae2356b35830d672251712370f13bef5ccd8b259d";
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
