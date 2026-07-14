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

const core = loadTypeScript("functions/src/friendRequestCore.ts");
const privacy = loadTypeScript("utils/friendPrivacy.ts");
assert.equal(core.normalizeFriendTargetId("target-user"), "target-user");
assert.throws(() => core.normalizeFriendTargetId(""));
assert.throws(() => core.normalizeFriendTargetId("private/path"));
assert.equal(core.friendRequestIdFor("sender", "target"), "sender__target");
const outcome = (overrides = {}) => core.resolveFriendRequestSendStatus({
  senderFriendIds: [], targetFriendIds: [], targetUserId: "target", senderUserId: "sender",
  outgoingStatus: null, incomingStatus: null, ...overrides,
});
assert.equal(outcome(), "pending");
assert.equal(outcome({ outgoingStatus: "pending" }), "alreadyPending");
assert.equal(outcome({ incomingStatus: "pending" }), "reversePending");
assert.equal(outcome({ senderFriendIds: ["target"] }), "alreadyFriends");
assert.equal(outcome({ targetFriendIds: ["sender"] }), "alreadyFriends");
assert.equal(privacy.formatFriendRequestSenderName("Joann Pollard", "Sideline Parent"), "Joann P.");
assert.equal(privacy.formatFriendRequestSenderName("Alex", "Sideline Parent"), "Alex");
assert.equal(privacy.formatFriendRequestSenderName("Anne-Marie O'Neill", "Sideline Parent"), "Anne-Marie O.");
assert.equal(privacy.formatFriendRequestSenderName("María Ríos", "Sideline Parent"), "María R.");
assert.equal(privacy.formatFriendRequestSenderName("private@example.com", "Sideline Parent"), "Sideline Parent");
assert.equal(privacy.formatFriendRequestSenderName("Sideline Parent", "Padre o madre de Sideline"), "Padre o madre de Sideline");
assert.equal(privacy.formatFriendRequestSenderName("  Sideline   Parent  ", "Sideline Parent"), "Sideline Parent");
assert.equal(privacy.getFriendNameInitials("Joann P."), "JP");
assert.equal(privacy.getFriendNameInitials("Madonna"), "M");

const screen = read("app", "(tabs)", "friends.tsx");
const service = read("services", "friendsService.ts");
const publicProfiles = read("services", "publicProfileService.ts");
const functionsSource = read("functions", "src", "index.ts");
const rules = read("firestore.rules");
const translations = read("i18n", "index.ts");
const authContext = read("context", "AuthContext.tsx");

assert.equal(publicProfiles.includes("PublicUserProfile = PublicFriendProfileRecord"), true);
assert.equal(publicProfiles.includes("email"), false);
assert.equal(service.includes("id: profile.userId"), true);
assert.equal(screen.includes("sendFriendRequest(profile.id)"), true);
assert.equal(screen.includes('busy={busyAction === `add:${profile.id}`}'), true);
assert.equal(screen.includes("profile.email"), false);
assert.equal(screen.includes("setLoadError(failureMessage)"), false);
assert.equal(screen.includes("setActionError({ actionId"), true);
assert.equal(screen.includes("friendRequestReversePending"), true);
assert.equal(screen.includes('request.senderDisplayName || t("friends.sidelineParent")'), true);
assert.equal(screen.includes("friends.friendRequestFrom"), true);
assert.equal(screen.includes("friends.acceptFriendRequestFrom"), true);
assert.equal(screen.includes("friends.declineFriendRequestFrom"), true);
assert.equal(screen.includes("getFriendNameInitials(name)"), true);
assert.equal(screen.includes("getFriendRequestGroups(user.uid)"), true);
assert.equal(screen.includes("subscribeToFriendRequestChanges"), true);
assert.equal(screen.includes("useFocusEffect"), true);
assert.equal(screen.includes('request.senderProfileState === "loading"'), true);
assert.equal(screen.includes('request.recipientProfileState === "loading"'), true);
assert.equal(screen.includes("request.senderDisplayName"), true);
assert.equal(screen.includes("request.fromDisplayName, t"), false);

const requestGroupsClient = service.slice(
  service.indexOf("export async function getFriendRequestGroups"),
  service.indexOf("export async function getIncomingFriendRequests"),
);
assert.equal(requestGroupsClient.includes("incoming.map(getIncomingRequestSenderId)"), true);
assert.equal(requestGroupsClient.includes("...outgoing.map(getOutgoingRequestRecipientId)"), true);
assert.equal(requestGroupsClient.includes("getPublicUserProfiles(requestProfileUserIds)"), true);
assert.equal(requestGroupsClient.includes("inspectPublicUserProfiles(publicProfiles)"), true);
assert.equal(requestGroupsClient.includes("profilesByUserId"), true);
assert.equal(requestGroupsClient.includes("hydrateFriendRequestGroups(incoming, outgoing"), true);
assert.equal(requestGroupsClient.includes('logIncomingProfileHydration("start"'), true);
assert.equal(requestGroupsClient.includes('logIncomingProfileHydration("success"'), true);
assert.equal(requestGroupsClient.includes('logIncomingProfileHydration("failure"'), true);
assert.equal(requestGroupsClient.toLowerCase().includes("email"), false);
assert.equal(service.includes('export type RequestProfileState = "loading" | "resolved" | "unresolved"'), true);
assert.equal(service.includes('senderProfileState: request.senderNameResolved ? "resolved" : "unresolved"'), true);
assert.equal(service.includes('recipientProfileState: request.recipientNameResolved ? "resolved" : "unresolved"'), true);
assert.equal(service.includes("senderNameResolved"), true);
assert.equal(service.includes("recipientNameResolved"), true);
assert.equal(service.includes("emptyFriendRequestGroups()"), true);
assert.equal(service.includes("onChange();"), true);
assert.equal(authContext.includes("firstName,"), true);
assert.equal(authContext.includes("lastName,"), true);
assert.equal(authContext.includes("displayName: displayName || null"), true);

const sendClient = service.slice(
  service.indexOf("export async function sendFriendRequest"),
  service.indexOf("export async function acceptFriendRequest"),
);
assert.equal(sendClient.includes('functions, "sendFriendRequest"'), true);
assert.equal(sendClient.includes("{ targetUserId: normalizedTargetUserId }"), true);
assert.equal(sendClient.includes("getPublicUserProfiles"), false);
assert.equal(sendClient.toLowerCase().includes("email"), false);
assert.equal(sendClient.includes("setDoc"), false);

const sendCallable = functionsSource.slice(
  functionsSource.indexOf("export const sendFriendRequest"),
  functionsSource.indexOf("export const respondToFriendRequest"),
);
assert.equal(sendCallable.includes("context.auth?.uid"), true);
assert.equal(sendCallable.includes("data?.targetUserId"), true);
assert.equal(sendCallable.includes("data?.sender"), false);
assert.equal(sendCallable.includes("runTransaction"), true);
assert.equal(sendCallable.includes("reversePending"), false);
assert.equal(sendCallable.toLowerCase().includes("email"), false);
assert.equal(functionsSource.includes("export const respondToFriendRequest"), true);
assert.equal(functionsSource.includes("export const removeFriendConnection"), true);
assert.equal(functionsSource.includes("createPersonalNotificationAndPush"), true);
const publicProfilesCallable = functionsSource.slice(
  functionsSource.indexOf("export const getPublicUserProfiles"),
  functionsSource.indexOf("export const getSuggestedConnections"),
);
assert.equal(publicProfilesCallable.includes("admin.auth().getUsers"), true);
assert.equal(publicProfilesCallable.includes("formatSuggestedConnectionName"), false);
assert.equal(publicProfilesCallable.includes("isActivePendingFriendRequestBetween"), false);
assert.equal(publicProfilesCallable.includes("pendingFriendRequestAuthorizationCount"), false);
assert.equal(publicProfilesCallable.includes("deniedTargetCount"), false);
assert.equal(publicProfilesCallable.includes("formatPublicUserName"), true);
assert.equal(publicProfilesCallable.toLowerCase().includes("email"), false);

const requestRules = rules.slice(rules.indexOf("match /friendRequests/{requestId}"), rules.indexOf("// squads collection"));
assert.equal(requestRules.includes("resource.data.fromUserId == request.auth.uid"), true);
assert.equal(requestRules.includes("resource.data.toUserId == request.auth.uid"), true);
assert.equal(requestRules.includes("allow create, update, delete: if false;"), true);

for (const key of [
  "actionErrorTitle", "friendRequestAlreadySent", "friendRequestAlreadyConnected",
  "friendRequestReversePending", "friendRequestUnavailable", "friendRequestNetworkError",
  "friendRequestFrom", "acceptFriendRequestFrom", "declineFriendRequestFrom",
  "loadingParentName",
]) {
  assert.equal((translations.match(new RegExp(`${key}:`, "g")) || []).length, 2, `${key} needs English and Spanish copy.`);
}

console.log("UID-based friend request callable, state outcomes, privacy, error separation, and notification tests passed.");
