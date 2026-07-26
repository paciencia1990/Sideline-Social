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

const errorCore = loadTypeScript("functions/src/friendsCallableErrorCore.ts");

assert.deepEqual(errorCore.classifyFriendsCallableUnexpectedError({
  code: 9,
  message: "The query requires a COLLECTION_GROUP_ASC index for collection blockedUsers and field blockedUserId.",
}), {
  code: "failed-precondition",
  reason: "firestore_index_required",
});
assert.deepEqual(errorCore.classifyFriendsCallableUnexpectedError({
  code: 7,
  message: "Caller lacks backend permission.",
}), {
  code: "permission-denied",
  reason: "backend_permission_denied",
});
assert.deepEqual(errorCore.classifyFriendsCallableUnexpectedError({
  code: "resource-exhausted",
}), {
  code: "resource-exhausted",
  reason: "backend_resource_exhausted",
});
assert.deepEqual(errorCore.classifyFriendsCallableUnexpectedError(new Error("boom")), {
  code: "internal",
  reason: "unexpected_failure",
});

const safeError = errorCore.toSafeFriendsCallableError(Object.assign(new Error("database failed"), {
  code: "FAILED_PRECONDITION",
  privateProfile: { email: "must-not-be-copied@example.test" },
}));
assert.equal(safeError.originalCode, "FAILED_PRECONDITION");
assert.equal(safeError.originalMessage, "database failed");
assert.equal(typeof safeError.originalStack, "string");
assert.equal(Object.hasOwn(safeError, "privateProfile"), false);

const indexes = JSON.parse(read("firestore.indexes.json"));
const blockedUserOverride = indexes.fieldOverrides.find(
  (override) => override.collectionGroup === "blockedUsers" && override.fieldPath === "blockedUserId",
);
assert.ok(blockedUserOverride, "blocked-user reverse lookup needs a declared single-field override");
assert.equal(
  blockedUserOverride.indexes.some(
    (index) => index.order === "ASCENDING" && index.queryScope === "COLLECTION_GROUP",
  ),
  true,
  "the exact COLLECTION_GROUP_ASC index required by production must be deployed",
);

const functionsSource = read("functions", "src", "index.ts");
const diagnosticHelper = functionsSource.slice(
  functionsSource.indexOf("async function runFriendsCallable"),
  functionsSource.indexOf("async function readBlockedRelationshipIds"),
);
for (const diagnosticField of [
  "functionName",
  "authenticatedUserId",
  "validationStage",
  "originalCode",
  "originalMessage",
  "originalStack",
]) {
  assert.ok(diagnosticHelper.includes(diagnosticField), `diagnostics must include ${diagnosticField}`);
}
for (const privateField of ["rawQuery", "queryText", "email", "phoneNumber", "profile"]) {
  assert.equal(
    diagnosticHelper.includes(privateField),
    false,
    `diagnostics must not log the private/request field ${privateField}`,
  );
}
assert.ok(diagnosticHelper.includes("error instanceof functions.https.HttpsError"));
assert.ok(diagnosticHelper.includes("classification.code"));

for (const callableName of [
  "getActiveFriendRequests",
  "searchPublicUserProfiles",
  "getSuggestedConnections",
]) {
  const callableStart = functionsSource.indexOf(`export const ${callableName}`);
  const nextExport = functionsSource.indexOf("export const ", callableStart + 20);
  const callable = functionsSource.slice(callableStart, nextExport < 0 ? undefined : nextExport);
  assert.ok(callable.includes("runFriendsCallable("), `${callableName} must use safe diagnostics`);
  assert.ok(callable.includes(`'${callableName}'`), `${callableName} must log its exact function name`);
  assert.ok(callable.includes("setValidationStage("), `${callableName} must record its processing stage`);
}

const firebaseConfig = read("config", "firebase.ts");
assert.ok(
  firebaseConfig.includes('getFunctions(firebaseApp, "us-central1")'),
  "client callables must use the deployed us-central1 region explicitly",
);

const friendsService = read("services", "friendsService.ts");
const searchUsers = friendsService.slice(
  friendsService.indexOf("export async function searchUsers"),
  friendsService.indexOf("export async function searchParentsByName"),
);
assert.ok(searchUsers.includes('logFriendsIssue("searchUsers", error)'));
assert.ok(searchUsers.includes("throw error;"), "suggestion failures must reach the Friends retry UI");
assert.equal(searchUsers.includes("return [];\n  }"), false);

const requestGroups = friendsService.slice(
  friendsService.indexOf("export async function getFriendRequestGroups"),
  friendsService.indexOf("export async function getIncomingFriendRequests"),
);
const finalCatch = requestGroups.slice(requestGroups.lastIndexOf("} catch (error)"));
assert.ok(finalCatch.includes('logFriendsIssue("getFriendRequestGroups", error)'));
assert.ok(finalCatch.includes("throw error;"), "request-group failures must reach the Friends retry UI");
assert.equal(finalCatch.includes("return emptyFriendRequestGroups()"), false);

const friendsScreen = read("app", "(tabs)", "friends.tsx");
assert.ok(friendsScreen.includes("setLoadError(t(\"friends.errorBody\"))"));
assert.ok(friendsScreen.includes("onPress={onRefresh}"));
assert.ok(friendsScreen.includes("}, 350);"), "parent search remains debounced");
assert.ok(friendsScreen.includes("searchRequestSequence.current !== requestSequence"));

console.log("Friends backend index, callable error normalization, safe diagnostics, explicit region, retry propagation, debounce, and stale-response tests passed.");
