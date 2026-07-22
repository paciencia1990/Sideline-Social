const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
function read(...segments) { return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8"); }
function load(relativePath) {
  const output = ts.transpileModule(read(relativePath), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  const loaded = { exports: {} }; new Function("module", "exports", output)(loaded, loaded.exports); return loaded.exports;
}
const core = load("functions/src/publicUserProfileCore.ts");
assert.equal(core.resolveCanonicalPublicName({ firstName: "Maria", lastName: "Garcia" }).displayName, "Maria Garcia");
assert.equal(core.resolveCanonicalPublicName({ FirstName: "Maria", LastName: "Garcia" }).displayName, "Maria Garcia");
assert.equal(core.resolveCanonicalPublicName({ displayName: "Joann Pollard" }).displayName, "Joann Pollard");
assert.equal(core.resolveCanonicalPublicName({ name: "D’Andre Smith" }).displayName, "D’Andre Smith");
assert.equal(core.resolveCanonicalPublicName({ displayName: "private@example.test" }), null);
assert.deepEqual(core.toMinimalPublicUserProfile(core.resolveCanonicalPublicProfile("uid", {
  firstName: "Maria", lastName: "Garcia", photoURL: null,
})), { userId: "uid", firstName: "Maria", lastName: "Garcia", displayName: "Maria Garcia", photoURL: null });
assert.equal(core.isCanonicalPublicProfile({
  userId: "uid", firstName: "Maria", lastName: "G.", displayName: "Maria G.", photoURL: null,
}, "uid"), false);
assert.equal(core.isCanonicalPublicProfile({
  userId: "uid", firstName: "Maria", lastName: "Garcia", displayName: "Maria Garcia", photoURL: null,
}, "uid"), true);
assert.equal(core.resolveCanonicalPublicName({ displayName: "Preferred Name", firstName: "Maria", lastName: "Garcia" }).displayName, "Preferred Name");
assert.equal(core.resolveCanonicalPublicName({ firstName: "Prince" }).displayName, "Prince");
assert.equal(core.resolveCanonicalPublicName({ lastName: "Madonna" }).displayName, "Madonna");
assert.equal(core.resolveCanonicalPublicName({ displayName: "Sideline Social member" }), null);

const source = read("functions", "src", "index.ts");
const callable = source.slice(source.indexOf("export const getPublicUserProfiles"), source.indexOf("export const getSuggestedConnections"));
const sync = source.slice(source.indexOf("export const syncPublicUserProfile"), source.indexOf("export const getPublicUserProfiles"));
const client = read("services", "publicProfileService.ts");
const rules = read("firestore.rules");
const audit = read("scripts", "audit-public-user-profiles.cjs");

assert.ok(callable.includes("context.auth?.uid"));
assert.ok(callable.includes("normalizePublicProfileIds"));
assert.ok(callable.includes("publicUserProfiles"));
assert.ok(callable.includes("admin.auth().getUsers"), "Auth is the final server fallback");
assert.ok(callable.includes("serverFallbackCount"));
assert.ok(callable.includes("returnedProfileCount"));
assert.ok(callable.includes("firstName: null"));
assert.ok(callable.includes("photoURL: null"));
assert.equal(callable.toLowerCase().includes("phone"), false);
assert.equal(callable.toLowerCase().includes("child"), false);
assert.equal(callable.toLowerCase().includes("location"), false);
assert.equal(callable.toLowerCase().includes("notificationtoken"), false);
assert.ok(sync.includes("resolveCanonicalPublicProfile"));
assert.ok(sync.includes("toMinimalPublicUserProfile"));
assert.ok(sync.includes("transaction.set(publicRef"));
assert.ok(sync.includes("admin.auth().updateUser"));
assert.ok(client.includes("MAX_PUBLIC_PROFILE_IDS = 50"));
assert.ok(client.includes("formatPublicUserName(profile.displayName) === profile.displayName"));
assert.equal(client.toLowerCase().includes("email"), false);

const publicRules = rules.slice(rules.indexOf("match /publicUserProfiles/{userId}"), rules.indexOf("notificationTokens collection"));
assert.ok(publicRules.includes("allow get: if signedIn();"));
assert.ok(publicRules.includes("allow list: if false;"));
assert.ok(publicRules.includes("allow create, update, delete: if false;"));
const privateRules = rules.slice(rules.indexOf("match /users/{userId}"), rules.indexOf("match /publicUserProfiles/{userId}"));
assert.ok(privateRules.includes("allow get: if isSelf(userId);"));
assert.ok(privateRules.includes("allow list: if false;"));

assert.ok(audit.includes('process.argv.includes("--apply")'));
assert.ok(audit.includes('mode: apply ? "apply" : "dry-run"'));
for (const privateWord of ["email", "phone", "children", "location"]) {
  assert.equal(audit.includes(`console.info(${privateWord}`), false);
}
console.log("Minimal authenticated public projection, casing fallback, self-heal, authorization, privacy, and dry-run audit tests passed.");
