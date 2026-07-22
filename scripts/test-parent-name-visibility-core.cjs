const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

function load(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", output)(loaded, loaded.exports);
  return loaded.exports;
}

const profiles = load("functions/src/publicUserProfileCore.ts");
const privacy = load("utils/friendPrivacy.ts");

assert.equal(profiles.resolveCanonicalPublicName({ displayName: "Preferred Parent", firstName: "Joann", lastName: "Pollard" }).displayName, "Preferred Parent");
assert.equal(profiles.resolveCanonicalPublicName({ firstName: "Joann", lastName: "Pollard" }).displayName, "Joann Pollard");
assert.equal(profiles.resolveCanonicalPublicName({ firstName: "Joann" }).displayName, "Joann");
assert.equal(profiles.resolveCanonicalPublicName({ lastName: "Pollard" }).displayName, "Pollard");
assert.equal(profiles.resolveCanonicalPublicName({ displayName: "Joann P." }), null);
assert.equal(profiles.resolveCanonicalPublicName({ displayName: "joann@example.test" }), null);
assert.equal(privacy.formatPublicUserName("Joann Pollard"), "Joann Pollard");
assert.equal(privacy.formatPublicUserName("Sideline Social member"), null);

const minimal = profiles.toMinimalPublicUserProfile(profiles.resolveCanonicalPublicProfile("parent_uid", {
  displayName: "Joann Pollard",
  email: "joann.private@example.test",
  phone: "+15555550100",
  location: "Private location",
  children: ["private_child"],
  friendIds: ["private_friend"],
}));
assert.deepEqual(Object.keys(minimal).sort(), ["displayName", "firstName", "lastName", "photoURL", "userId"]);

for (const sourcePath of [
  "services/chatService.ts",
  "services/friendsService.ts",
  "services/parentTeamService.ts",
  "services/teamMessageService.ts",
  "services/teamPrivateMessageService.ts",
  "services/teamRosterService.ts",
]) {
  assert.ok(read(sourcePath).includes("getPublicUserProfiles") || read(sourcePath).includes("getTeamRosterProfiles"), `${sourcePath} must hydrate current public names.`);
}

const appAndServiceSource = [
  read("app", "(tabs)", "friends.tsx"),
  read("app", "(social)", "chat", "[chatId].tsx"),
  read("app", "coach", "team.tsx"),
  read("services", "teamMessageService.ts"),
  read("services", "teamPrivateMessageService.ts"),
].join("\n");
for (const roleFallback of ["Team Parent", "Sideline Parent", "Squad member"]) {
  assert.equal(appAndServiceSource.includes(roleFallback), false, `${roleFallback} must not substitute for a person's name.`);
}

const functionsSource = read("functions", "src", "index.ts");
const callable = functionsSource.slice(
  functionsSource.indexOf("export const getPublicUserProfiles"),
  functionsSource.indexOf("export const getSuggestedConnections"),
);
assert.ok(callable.includes("profileState: 'unnamed'"));
assert.ok(callable.includes("profileState: 'deleted'"));
for (const privateField of ["email", "phone", "children", "location", "friendIds"]) {
  assert.equal(callable.includes(privateField), false, `${privateField} must stay outside the public profile response.`);
}

const translations = read("i18n", "index.ts");
assert.equal((translations.match(/formerMember:/g) || []).length, 2);
assert.equal((translations.match(/sidelineSocialMember:/g) || []).length, 2);

console.log("Parent full-name visibility, current-profile propagation, fallbacks, and private-field exclusion tests passed.");
