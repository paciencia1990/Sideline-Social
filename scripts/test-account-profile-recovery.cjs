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
  buildFederatedAccountProfile,
  initializeAccountProfileIfMissing,
  normalizeAccountProfileInput,
} = require(path.join(root, "utils", "accountProfileCore.ts"));

(async () => {
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

const federated = buildFederatedAccountProfile({
  email: " first@example.test ",
  firstName: " First ",
  lastName: " User ",
  phoneNumber: null,
  preferredLanguage: "en",
  userId: "federated-a",
}, { createdAt: "created", updatedAt: "updated" });
assert.equal(federated.displayName, "First User");
assert.equal(federated.email, "first@example.test");
assert.equal(federated.accountOnboardingCompleted, false);
assert.equal(federated.modeOnboardingCompleted, false);

let writes = 0;
assert.deepEqual(await initializeAccountProfileIfMissing({
  createFields: () => federated,
  readExists: async () => false,
  write: () => { writes += 1; },
}), { created: true });
assert.deepEqual(await initializeAccountProfileIfMissing({
  createFields: () => { throw new Error("returning profiles must not be rebuilt"); },
  readExists: async () => true,
  write: () => { writes += 1; },
}), { created: false });
assert.equal(writes, 1);

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
assert.match(profileSource, /runTransaction\(db,[\s\S]*initializeAccountProfileIfMissing/u,
  "repeated federated initialization must be an atomic no-op for returning accounts");
assert.match(profileSource, /readExists: async \(\) => \(await transaction\.get\(userRef\)\)\.exists\(\)/u,
  "the federated initializer must read existence inside the transaction");
assert.match(profileSource, /write: \(fields\) => transaction\.set\(userRef, fields\)/u,
  "the federated initializer must check existence in the same transaction before its only creation write");

console.log("Canonical password-profile creation, missing-profile recovery, and fail-closed hydration checks passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
