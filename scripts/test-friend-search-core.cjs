const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function transpile(relativePath) {
  return ts.transpileModule(fs.readFileSync(path.join(process.cwd(), relativePath), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
}

function load(relativePath, dependencies = {}) {
  const loaded = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier in dependencies) return dependencies[specifier];
    throw new Error(`Unexpected dependency: ${specifier}`);
  };
  new Function("module", "exports", "require", transpile(relativePath))(
    loaded,
    loaded.exports,
    localRequire,
  );
  return loaded.exports;
}

const profileCore = load("functions/src/publicUserProfileCore.ts");
const searchCore = load("functions/src/publicUserSearchCore.ts", {
  "./publicUserProfileCore": profileCore,
});

const courtland = profileCore.resolveCanonicalPublicProfile("courtland-uid", {
  firstName: "Courtland",
  lastName: "Tester",
});
const joann = profileCore.resolveCanonicalPublicProfile("joann-uid", {
  displayName: "Joann Pollard",
});
const exactCourt = profileCore.resolveCanonicalPublicProfile("court-uid", {
  firstName: "Court",
  lastName: "Parent",
});
assert.equal(profileCore.resolveCanonicalPublicProfile("full-name-uid", {
  displayName: "Courtland T.",
  firstName: "Courtland",
  lastName: "Tester",
}).displayName, "Courtland Tester", "an initial-only display name cannot replace a valid full name");
assert.deepEqual(profileCore.toSearchablePublicUserProfileProjection(courtland), {
  userId: "courtland-uid",
  firstName: "Courtland",
  lastName: "Tester",
  displayName: "Courtland Tester",
  photoURL: null,
  displayNameLower: "courtland tester",
  firstNameLower: "courtland",
  lastNameLower: "tester",
});
assert.equal(profileCore.isSearchablePublicProfileProjection(
  profileCore.toSearchablePublicUserProfileProjection(courtland),
  "courtland-uid",
), true);
assert.equal(profileCore.isSearchablePublicProfileProjection(
  profileCore.toMinimalPublicUserProfile(courtland),
  "courtland-uid",
), false, "legacy projection without normalized keys requires self-healing");
assert.equal(searchCore.publicUserProfileMatchesPrefix(courtland, "court"), true);
assert.equal(searchCore.publicUserProfileMatchesPrefix(courtland, "tester"), true);
assert.equal(searchCore.publicUserProfileMatchesPrefix(courtland, "land"), false);
assert.equal(searchCore.publicUserProfileMatchesPrefix(joann, "JOANN".toLocaleLowerCase()), true);
assert.deepEqual(
  searchCore.legacyPublicProfilePrefixVariants("  cOuRtLaNd   tester  "),
  ["cOuRtLaNd tester", "courtland tester", "Courtland Tester"],
);
assert.deepEqual(
  searchCore.rankAndLimitPublicUserSearchResults([joann, courtland, courtland, exactCourt], "court", 20)
    .map((profile) => profile.userId),
  ["court-uid", "courtland-uid"],
  "exact name matches rank before prefix matches and results deduplicate by UID",
);
assert.equal(searchCore.resolvePublicUserSearchRelationship({
  candidateUserId: "courtland-uid",
  friendUserIds: new Set(),
  outgoingPendingUserIds: new Set(),
  incomingPendingUserIds: new Set(),
}), "none");
assert.equal(searchCore.resolvePublicUserSearchRelationship({
  candidateUserId: "courtland-uid",
  friendUserIds: new Set(["courtland-uid"]),
  outgoingPendingUserIds: new Set(["courtland-uid"]),
  incomingPendingUserIds: new Set(["courtland-uid"]),
}), "friends", "accepted friendship takes precedence over stale request records");
assert.equal(searchCore.resolvePublicUserSearchRelationship({
  candidateUserId: "courtland-uid",
  friendUserIds: new Set(),
  outgoingPendingUserIds: new Set(["courtland-uid"]),
  incomingPendingUserIds: new Set(),
}), "outgoing-request");
assert.equal(searchCore.resolvePublicUserSearchRelationship({
  candidateUserId: "courtland-uid",
  friendUserIds: new Set(),
  outgoingPendingUserIds: new Set(),
  incomingPendingUserIds: new Set(["courtland-uid"]),
}), "incoming-request");

const functionsSource = fs.readFileSync(path.join(process.cwd(), "functions", "src", "index.ts"), "utf8");
const callable = functionsSource.slice(
  functionsSource.indexOf("export const searchPublicUserProfiles"),
  functionsSource.indexOf("export const getSuggestedConnections"),
);
const screen = fs.readFileSync(path.join(process.cwd(), "app", "(tabs)", "friends.tsx"), "utf8");
const service = fs.readFileSync(path.join(process.cwd(), "services", "publicProfileService.ts"), "utf8");
const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");
const translations = fs.readFileSync(path.join(process.cwd(), "i18n", "index.ts"), "utf8");
const audit = fs.readFileSync(path.join(process.cwd(), "scripts", "audit-public-user-profiles.cjs"), "utf8");

assert.ok(callable.includes("context.auth?.uid"));
assert.ok(functionsSource.includes("PUBLIC_USER_SEARCH_RATE_LIMIT"));
assert.ok(functionsSource.includes("enforcePublicUserSearchRateLimit(uid)"));
assert.ok(callable.includes("normalizedQuery.length < 2"));
assert.ok(callable.includes("publicUserProfiles"));
assert.ok(functionsSource.includes("'displayNameLower'"));
assert.ok(functionsSource.includes("'firstNameLower'"));
assert.ok(functionsSource.includes("'lastNameLower'"));
assert.ok(callable.includes("readBlockedRelationshipIds(uid)"));
assert.ok(callable.includes("friendRequestIdFor(uid, profile.userId)"));
assert.ok(callable.includes("friendRequestIdFor(profile.userId, uid)"));
assert.ok(callable.includes("toMinimalPublicUserProfile(profile)"));
for (const privateField of ["email", "phoneNumber", "location", "children", "notificationToken"]) {
  assert.equal(callable.includes(privateField), false, `${privateField} must not enter search output`);
}
assert.ok(screen.includes("searchParentsByName(normalizedSearchText)"));
assert.ok(screen.includes("setSearchResults([])"));
assert.ok(screen.includes("searchRequestSequence.current !== requestSequence"));
assert.ok(screen.includes("setSuggestedUsers(await searchUsers(searchText))") === false);
assert.ok(screen.indexOf('t("friends.findParents")') < screen.indexOf('t("friends.suggested")'));
assert.ok(service.includes('functions, "searchPublicUserProfiles"'));
assert.ok(rules.includes("allow list: if false;"));
assert.ok(audit.includes("isSearchablePublicProfileProjection"));
assert.ok(audit.includes("displayNameLower"));
for (const key of [
  "findParents",
  "searchResults",
  "searchMinimum",
  "noSearchResultsTitle",
  "searchUnavailableTitle",
  "searchRelationshipOutgoing",
  "searchRelationshipIncoming",
  "searchRelationshipFriends",
  "respondToRequest",
]) {
  assert.equal((translations.match(new RegExp(`${key}:`, "g")) || []).length, 2, `${key} needs English and Spanish copy`);
}

console.log("Friend Search projection, prefix, ranking, relationship, privacy, stale-response, UI-separation, and localization tests passed.");
