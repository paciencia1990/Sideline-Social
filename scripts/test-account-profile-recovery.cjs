"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText, filename);
};

const root = path.resolve(__dirname, "..");
const {
  buildAccountCompletionFields,
  buildCanonicalAccountProfile,
  normalizeAccountProfileInput,
} = require(path.join(root, "utils", "accountProfileCore.ts"));

const profile = buildCanonicalAccountProfile({
  adultEligibilityConfirmed: true,
  email: " person@example.test ",
  firstName: " Avery ",
  lastName: " Parent ",
  phoneNumber: null,
  policiesAccepted: true,
  preferredLanguage: "en",
  sports: [" Soccer ", "", "Soccer", "Basketball"],
  userId: "user-a",
  zipCode: " 12345 ",
}, { createdAt: "created", updatedAt: "updated" }, "legal-v1");

assert.deepEqual(profile.sports, ["Soccer", "Basketball"]);
assert.equal(profile.displayName, "Avery Parent");
assert.equal(profile.email, "person@example.test");
assert.equal(profile.zipCode, "12345");
assert.equal(profile.accountOnboardingCompleted, true);
assert.equal(profile.modeOnboardingCompleted, false);
assert.deepEqual(profile.squadIds, []);
assert.deepEqual(profile.friendIds, []);
assert.equal(profile.profileVisibility, "squad_only");

const completion = buildAccountCompletionFields({
  adultEligibilityConfirmed: true,
  firstName: "Recovered",
  lastName: "Account",
  policiesAccepted: true,
}, "updated", "legal-v1");
assert.equal(completion.displayName, "Recovered Account");
assert.equal("friendIds" in completion, false, "completion must not overwrite existing relationship data");
assert.equal("squadIds" in completion, false, "completion must not overwrite existing team data");

for (const invalid of [
  { adultEligibilityConfirmed: false, policiesAccepted: true },
  { adultEligibilityConfirmed: true, policiesAccepted: false },
]) {
  assert.throws(() => normalizeAccountProfileInput({
    ...invalid,
    email: null,
    firstName: "Avery",
    lastName: "Parent",
    preferredLanguage: "en",
    userId: "user-a",
  }), /Account onboarding is incomplete/u);
}

const authSource = fs.readFileSync(path.join(root, "context", "AuthContext.tsx"), "utf8");
const profileSource = fs.readFileSync(path.join(root, "services", "authProfileService.ts"), "utf8");
assert.match(authSource, /createPasswordUserProfile\(credential\.user/u);
assert.match(authSource, /return \{ exists: true, profile: undefined \}/u, "transient profile-read failures must not misclassify established accounts as new");
assert.match(authSource, /runExclusiveAuthOperation\(async \(operationId\)/u);
assert.match(profileSource, /if \(!existing\.exists\(\)\)[\s\S]*buildCanonicalAccountProfile/u, "missing-profile recovery must create the complete canonical record");
assert.match(profileSource, /buildAccountCompletionFields[\s\S]*\{ merge: true \}/u, "existing profiles must retain relationship and team fields");

console.log("Canonical password-profile creation, missing-profile recovery, and fail-closed hydration checks passed.");
