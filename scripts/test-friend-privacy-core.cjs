const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadTypeScript(relativePath) {
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", output)(loaded, loaded.exports);
  return loaded.exports;
}

const clientPrivacy = loadTypeScript("utils/friendPrivacy.ts");
const serverPrivacy = loadTypeScript("functions/src/friendSuggestionCore.ts");

assert.equal(clientPrivacy.formatPublicUserName("Joann Pollard"), "Joann Pollard");
assert.equal(clientPrivacy.formatPublicUserName("Mary Anne Van Buren"), "Mary Anne Van Buren");
assert.equal(clientPrivacy.formatPublicUserName("Madonna"), "Madonna");
assert.equal(clientPrivacy.formatPublicUserName("private@example.com"), null);
assert.equal(clientPrivacy.formatPublicUserName("Sideline Parent"), null);
assert.equal(clientPrivacy.formatSuggestedConnectionName("Joann Pollard"), "Joann Pollard");
assert.equal(clientPrivacy.formatSuggestedConnectionName("  Joann   Pollard  "), "Joann Pollard");
assert.equal(clientPrivacy.formatSuggestedConnectionName("Madonna"), "Madonna");
assert.equal(clientPrivacy.formatSuggestedConnectionName("Anne-Marie O'Neill"), "Anne-Marie O'Neill");
assert.equal(clientPrivacy.formatSuggestedConnectionName("María de la Cruz"), "María de la Cruz");
assert.equal(clientPrivacy.formatSuggestedConnectionName("joann@example.com"), "Sideline Social member");
assert.equal(clientPrivacy.formatSuggestedConnectionName("", "Padre o madre de Sideline"), "Padre o madre de Sideline");
assert.equal(clientPrivacy.formatFriendRequestSenderName("Joann Pollard"), "Joann Pollard");
assert.equal(clientPrivacy.formatFriendRequestSenderName("Alex"), "Alex");
assert.equal(clientPrivacy.formatFriendRequestSenderName("Anne-Marie O'Neill"), "Anne-Marie O'Neill");
assert.equal(clientPrivacy.formatFriendRequestSenderName("María Ríos"), "María Ríos");
assert.equal(clientPrivacy.formatFriendRequestSenderName("private@example.com"), "Sideline Social member");
assert.equal(clientPrivacy.formatPublicUserName("Joann P."), null);
assert.equal(clientPrivacy.formatFullPublicName("Joann Pollard"), "Joann Pollard");
assert.equal(clientPrivacy.formatFullPublicName("private@example.com"), null);
assert.equal(clientPrivacy.getFriendNameInitials("Joann P."), "JP");

assert.equal(serverPrivacy.resolvePublicProfileName({ displayName: "Joann Pollard", email: "private@example.com" }), "Joann Pollard");
assert.equal(serverPrivacy.resolvePublicProfileName({ displayName: "private@example.com" }), null);
assert.equal(serverPrivacy.resolvePublicProfileName({ firstName: "María", lastName: "Ríos" }), "María Ríos");
assert.equal(serverPrivacy.formatPublicUserName("Mary Anne Van Buren"), "Mary Anne Van Buren");
assert.equal(serverPrivacy.formatPublicUserName("Sideline Parent"), null);
assert.equal(serverPrivacy.formatSuggestedConnectionName("Joann Pollard"), "Joann Pollard");
assert.equal(serverPrivacy.formatSuggestedConnectionName("joann@example.com"), null);
assert.equal(serverPrivacy.findSharedActivity(["Youth Soccer", "Baseball"], ["baseball"]), "Baseball");
assert.equal(serverPrivacy.findSharedActivity(["Soccer"], ["Basketball"]), null);
assert.equal(serverPrivacy.countMutualConnections(["a", "b", "c"], ["b", "c", "d"]), 2);

const friendsScreen = fs.readFileSync(path.join(process.cwd(), "app", "(tabs)", "friends.tsx"), "utf8");
const friendsService = fs.readFileSync(path.join(process.cwd(), "services", "friendsService.ts"), "utf8");
const publicProfileService = fs.readFileSync(path.join(process.cwd(), "services", "publicProfileService.ts"), "utf8");
const functionsSource = fs.readFileSync(path.join(process.cwd(), "functions", "src", "index.ts"), "utf8");
const chatService = fs.readFileSync(path.join(process.cwd(), "services", "chatService.ts"), "utf8");
const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");
const translations = fs.readFileSync(path.join(process.cwd(), "i18n", "index.ts"), "utf8");

assert.equal(friendsScreen.includes("profile.email"), false);
assert.equal(friendsScreen.includes("formatPublicUserName"), true);
assert.equal(friendsScreen.includes("profile.sharedSquadName || profile.sharedActivity"), true);
assert.equal(friendsScreen.includes('t("friends.mutualConnections"'), true);
assert.equal(friendsScreen.includes('<UserPlus size={18} color={Colors.surface} />'), true);
assert.equal(friendsScreen.includes("styles.iconButton"), true);
assert.equal(friendsScreen.includes('accessibilityRole="button"'), true);
assert.equal(friendsScreen.includes('t("friends.sendFriendRequestTo"'), true);
assert.equal(friendsService.includes("email:"), false);
assert.equal(friendsService.includes("data?.email"), false);
assert.equal(friendsService.includes("getSuggestedConnections(queryText)"), true);
assert.equal(friendsService.includes("getPublicUserProfiles(friendIds)"), true);
assert.equal(publicProfileService.includes('functions, "getPublicUserProfiles"'), true);
assert.equal(publicProfileService.includes('functions, "getSuggestedConnections"'), true);
assert.equal(chatService.includes("formatPublicUserName"), true);
assert.equal(chatService.includes("getSafeProfileName(chat.participantNames"), false);

const publicProfilesCallable = functionsSource.slice(
  functionsSource.indexOf("export const getPublicUserProfiles"),
  functionsSource.indexOf("export const getSuggestedConnections"),
);
const suggestionsCallable = functionsSource.slice(
  functionsSource.indexOf("export const getSuggestedConnections"),
  functionsSource.indexOf("function normalizePublicProfileIds"),
);
assert.equal(publicProfilesCallable.includes("context.auth?.uid"), true);
assert.equal(publicProfilesCallable.includes("admin.auth().getUsers"), true);
assert.equal(publicProfilesCallable.includes("resolveCanonicalPublicProfile"), true);
assert.equal(publicProfilesCallable.includes("toMinimalPublicUserProfile"), true);
assert.equal(publicProfilesCallable.includes("email"), false);
assert.equal(suggestionsCallable.includes("context.auth?.uid"), true);
assert.equal(suggestionsCallable.includes("sharedSquadName"), true);
assert.equal(suggestionsCallable.includes("sharedActivity"), true);
assert.equal(suggestionsCallable.includes("mutualConnectionCount"), true);
assert.equal(suggestionsCallable.includes("email"), false);
assert.equal(suggestionsCallable.includes("venueName"), false);
assert.equal(suggestionsCallable.includes("child"), false);
assert.equal(rules.includes("allow get: if isSelf(userId);"), true);
assert.equal(rules.includes("allow list: if false;"), true);

for (const key of [
  "sidelineParent",
  "suggestedParentContext",
  "mutualConnections",
  "sendFriendRequestTo",
  "friendRequestSent",
  "friendRequestError",
]) {
  assert.equal((translations.match(new RegExp(`${key}:`, "g")) || []).length, 2, `${key} needs English and Spanish copy.`);
}
assert.equal(translations.includes("Search parents by name or email"), false);
assert.equal(translations.includes("Buscar padres por nombre o correo"), false);

console.log("Suggested Connections name, context, email-privacy, accessibility, callable, and translation tests passed.");
