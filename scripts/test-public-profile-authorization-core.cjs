const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

function loadTypeScript(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", output)(loaded, loaded.exports);
  return loaded.exports;
}

const serverPrivacy = loadTypeScript("functions/src/friendSuggestionCore.ts");
assert.equal(serverPrivacy.formatPublicUserName("Joann Pollard"), "Joann P.");
assert.equal(serverPrivacy.formatPublicUserName("  Joann   Pollard  "), "Joann P.");
assert.equal(serverPrivacy.formatPublicUserName("Maria Garcia"), "Maria G.");
assert.equal(serverPrivacy.formatPublicUserName("D’Andre Smith"), "D’Andre S.");
assert.equal(serverPrivacy.formatPublicUserName("Mary Anne Van Buren"), "Mary V.");
assert.equal(serverPrivacy.formatPublicUserName("Madonna"), "Madonna");
assert.equal(serverPrivacy.formatPublicUserName(""), null);
assert.equal(serverPrivacy.formatPublicUserName("private@example.com"), null);
assert.equal(serverPrivacy.formatPublicUserName("Sideline Parent"), null);
assert.equal(serverPrivacy.resolvePublicProfileName({ displayName: "Joann Pollard" }), "Joann Pollard");
assert.equal(serverPrivacy.resolvePublicProfileName({ firstName: "Maria", lastName: "Garcia" }), "Maria Garcia");

const functionsSource = read("functions", "src", "index.ts");
const publicProfilesCallable = functionsSource.slice(
  functionsSource.indexOf("export const getPublicUserProfiles"),
  functionsSource.indexOf("export const getSuggestedConnections"),
);
const publicProfileIdValidation = functionsSource.slice(
  functionsSource.indexOf("function normalizePublicProfileIds"),
  functionsSource.indexOf("// ---------------------------------------------------------------------------\n// Team announcement replies"),
);
const clientService = read("services", "publicProfileService.ts");
const friendsService = read("services", "friendsService.ts");
const friendsScreen = read("app", "(tabs)", "friends.tsx");
const friendRequestMapping = read("utils", "friendRequestMapping.ts");
const rules = read("firestore.rules");

assert.equal(publicProfilesCallable.includes("context.auth?.uid"), true);
assert.equal(publicProfilesCallable.includes("Authentication is required."), true);
assert.equal(publicProfilesCallable.includes("normalizePublicProfileIds"), true);
assert.equal(publicProfilesCallable.includes("admin.auth().getUsers"), true);
assert.equal(publicProfilesCallable.includes("formatPublicUserName"), true);
assert.equal(publicProfilesCallable.includes("userId: snapshot.id"), true);
assert.equal(publicProfilesCallable.includes("displayName:"), true);
assert.equal(publicProfilesCallable.includes("!snapshot.exists && !authUserIds.has(snapshot.id)"), true);
assert.equal(publicProfileIdValidation.includes("userIds.length > 50"), true);
assert.equal(publicProfileIdValidation.includes("^[A-Za-z0-9_-]{1,128}$"), true);

for (const relationshipGate of [
  "requesterProfile",
  "friendIds",
  "sharedTeam",
  "sharedSquad",
  "pendingFriendRequest",
  "isActivePendingFriendRequestBetween",
  "resolvePublicProfileAuthorizationReason",
  "deniedTargetCount",
]) {
  assert.equal(publicProfilesCallable.includes(relationshipGate), false, `${relationshipGate} must not gate public names.`);
}

for (const safeCount of [
  "requestedCount",
  "validIdCount",
  "profileDocumentFoundCount",
  "firestoreNameCount",
  "authNameCount",
  "nullNameCount",
  "returnedProfileCount",
]) {
  assert.equal(publicProfilesCallable.includes(safeCount), true, `${safeCount} diagnostic is required.`);
}

for (const privateField of [
  "email",
  "phoneNumber",
  "photoURL",
  "child",
  "notificationToken",
  "teamIds",
  "squadIds",
]) {
  assert.equal(publicProfilesCallable.toLowerCase().includes(privateField.toLowerCase()), false, `${privateField} must stay private.`);
}

assert.equal(clientService.includes("MAX_PUBLIC_PROFILE_IDS = 50"), true);
assert.equal(clientService.includes("inspectPublicUserProfiles(response.data.profiles)"), true);
assert.equal(clientService.includes("formatPublicUserName(profile.displayName) === profile.displayName"), true);
assert.equal(clientService.includes("index += MAX_PUBLIC_PROFILE_IDS"), true);
assert.equal(clientService.includes("return profiles"), true);
assert.equal(clientService.toLowerCase().includes("email"), false);
assert.equal(friendRequestMapping.includes("profilesByUserId: new Map"), true);
assert.equal(friendRequestMapping.includes("getIncomingRequestSenderId(request)"), true);
assert.equal(friendsService.includes("getPublicUserProfiles(requestProfileUserIds)"), true);
assert.equal(friendsScreen.includes('request.senderDisplayName || t("friends.sidelineParent")'), true);
assert.equal(friendsScreen.includes("request.fromDisplayName, t"), false);

assert.equal(rules.includes("allow get: if isSelf(userId);"), true);
assert.equal(rules.includes("allow list: if false;"), true);

console.log("Authenticated universal public-name lookup, server formatting, response privacy, and private Firestore rules tests passed.");
