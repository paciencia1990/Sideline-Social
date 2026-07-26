const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function read(...segments) { return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8"); }
function loadTypeScript(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", output)(loaded, loaded.exports);
  return loaded.exports;
}

const lifecycle = loadTypeScript("functions/src/friendRequestCore.ts");
const publicProfiles = loadTypeScript("functions/src/publicUserProfileCore.ts");
const now = Date.UTC(2026, 6, 15, 12);
const future = now + 1000;
const past = now - 1000;

assert.equal(lifecycle.normalizeFriendTargetId("target-user"), "target-user");
assert.throws(() => lifecycle.normalizeFriendTargetId(""));
assert.throws(() => lifecycle.normalizeFriendTargetId("private/path"));
assert.equal(lifecycle.friendRequestIdFor("sender", "target"), "sender__target");
assert.equal(lifecycle.friendRequestExpiresAtMillis(now), now + 30 * 24 * 60 * 60 * 1000);
assert.equal(lifecycle.resolveLegacyFriendRequestExpiresAtMillis(null, now), lifecycle.friendRequestExpiresAtMillis(now));
assert.equal(lifecycle.isActivePendingRequest("pending", future, now), true);
assert.equal(lifecycle.isActivePendingRequest("pending", past, now), false);
assert.equal(lifecycle.isActivePendingRequest("declined", future, now), false);

const outcome = (overrides = {}) => lifecycle.resolveFriendRequestSendStatus({
  senderFriendIds: [], targetFriendIds: [], targetUserId: "target", senderUserId: "sender",
  outgoingStatus: null, incomingStatus: null, outgoingExpiresAtMillis: null,
  incomingExpiresAtMillis: null, nowMillis: now, ...overrides,
});
assert.equal(outcome(), "pending");
assert.equal(outcome({ outgoingStatus: "pending", outgoingExpiresAtMillis: future }), "alreadyPending");
assert.equal(outcome({ outgoingStatus: "pending", outgoingExpiresAtMillis: past }), "pending", "expired pending is not active");
assert.equal(outcome({ incomingStatus: "pending", incomingExpiresAtMillis: future }), "reversePending");
assert.equal(outcome({ senderFriendIds: ["target"] }), "alreadyFriends");
assert.equal(outcome({ targetFriendIds: ["sender"] }), "alreadyFriends");

// Regression reproduction: the old shared two-snapshot counter could consume
// a real removal from one query while the other query was still initializing.
let oldInitialSnapshotsRemaining = 2;
let oldRefreshCount = 0;
const oldSharedHandler = () => {
  if (oldInitialSnapshotsRemaining > 0) { oldInitialSnapshotsRemaining -= 1; return; }
  oldRefreshCount += 1;
};
oldSharedHandler(); // incoming initial
oldSharedHandler(); // outgoing removal after decline, incorrectly swallowed
assert.equal(oldRefreshCount, 0);
oldSharedHandler(); // outgoing initial arrives later, too late to refresh the removal

let newRefreshCount = 0;
const independentHandler = () => {
  let initialized = false;
  return () => { if (!initialized) { initialized = true; return; } newRefreshCount += 1; };
};
const incomingHandler = independentHandler();
const outgoingHandler = independentHandler();
incomingHandler(); outgoingHandler(); outgoingHandler();
assert.equal(newRefreshCount, 1, "a post-initial decline removal always refreshes the sender");

assert.deepEqual(publicProfiles.resolveCanonicalPublicName({ firstName: " Joann ", lastName: " Pollard " }), {
  firstName: "Joann", lastName: "Pollard", displayName: "Joann Pollard",
});
assert.equal(publicProfiles.resolveCanonicalPublicName({ FirstName: "Maria", LastName: "Garcia" }).displayName, "Maria Garcia");
assert.equal(publicProfiles.resolveCanonicalPublicName({ name: "D’Andre Smith" }).displayName, "D’Andre Smith");
assert.equal(publicProfiles.resolveCanonicalPublicName({ displayName: "Mary Anne Van Buren" }).lastName, "Anne Van Buren");
assert.equal(publicProfiles.resolveCanonicalPublicName({ displayName: "private@example.test" }), null);
assert.equal(publicProfiles.resolveCanonicalPublicName({ displayName: "Sideline Parent" }), null);
assert.equal(publicProfiles.resolveCanonicalPublicName({ displayName: "Joann P." }), null, "an initial is not a full last name");
const projected = publicProfiles.resolveCanonicalPublicProfile("uid", {
  firstName: "Joann", lastName: "Pollard", photoURL: "https://example.test/photo.jpg", email: "private@example.test",
});
assert.deepEqual(projected, {
  userId: "uid", firstName: "Joann", lastName: "Pollard", displayName: "Joann Pollard",
  photoURL: "https://example.test/photo.jpg",
});
assert.equal(Object.hasOwn(projected, "email"), false);
assert.deepEqual(publicProfiles.toMinimalPublicUserProfile(projected), {
  userId: "uid", firstName: "Joann", lastName: "Pollard", displayName: "Joann Pollard",
  photoURL: "https://example.test/photo.jpg",
});

const functionsSource = read("functions", "src", "index.ts");
const friendChatSource = read("functions", "src", "friendChat.ts");
const service = read("services", "friendsService.ts");
const screen = read("app", "(tabs)", "friends.tsx");
const rules = read("firestore.rules");
const indexes = JSON.parse(read("firestore.indexes.json"));

const send = functionsSource.slice(functionsSource.indexOf("export const sendFriendRequest"), functionsSource.indexOf("export const respondToFriendRequest"));
assert.ok(send.includes("Timestamp.now()"));
assert.ok(send.includes("friendRequestExpiresAtMillis(now.toMillis())"));
assert.ok(send.includes("respondedAt: null"));
assert.ok(send.includes("resolveCanonicalPublicProfile(senderUserId"));
assert.ok(send.includes("toMinimalPublicUserProfile(senderCanonicalProfile)"));
assert.ok(send.includes("Add your first and last name"));
assert.ok(send.includes("priorOutcomes: preserveTerminalRequestOutcomes(outgoing)"));
assert.equal(send.toLowerCase().includes("email"), false);

const respond = functionsSource.slice(functionsSource.indexOf("export const respondToFriendRequest"), functionsSource.indexOf("export const cancelFriendRequest"));
for (const field of ["respondedAt", "acceptedAt", "declinedAt", "updatedAt"]) assert.ok(respond.includes(field));
assert.ok(respond.includes("request.toUserId !== userId"));
assert.ok(respond.includes("FieldValue.arrayUnion"));
assert.ok(respond.includes("request.status !== 'pending'"));

const cancel = functionsSource.slice(functionsSource.indexOf("export const cancelFriendRequest"), functionsSource.indexOf("export const removeFriendConnection"));
assert.ok(cancel.includes("request.fromUserId !== userId"));
assert.ok(cancel.includes("status: 'canceled'"));
assert.ok(cancel.includes("canceledAt"));
assert.ok(functionsSource.includes("export const expirePendingFriendRequests"));
assert.ok(functionsSource.includes(".schedule('15 4 * * *')"));
assert.ok(functionsSource.includes(".limit(400)"));
assert.ok(functionsSource.includes("resolveFriendRequestNotification"));
assert.equal(functionsSource.includes("declined notification"), false);
assert.ok(friendChatSource.includes("status: 'canceled', canceledAt: now"), "blocking resolves pending requests");

const activeRequests = functionsSource.slice(
  functionsSource.indexOf("function publicFriendRequest"),
  functionsSource.indexOf("export const sendFriendRequest"),
);
assert.ok(activeRequests.includes(".where('status', '==', 'pending')"));
assert.equal(activeRequests.includes("deletePending"), false, "cleanup states are never active requests");
assert.ok(activeRequests.includes("request.status !== 'pending'"));
assert.ok(activeRequests.includes("friendUserIds.has(otherUserId)"));
assert.ok(activeRequests.includes("status: 'superseded'"));
assert.ok(activeRequests.includes("createdAt: timestampMillis(request.createdAt)"));
assert.ok(activeRequests.includes("expiresAt: expiresAtMillis"));

assert.ok(service.includes('"getActiveFriendRequests"'));
assert.ok(service.includes('where("expiresAt", ">", Timestamp.now())'));
assert.ok(service.includes("createSnapshotHandler"), "each listener owns its initialization gate");
assert.equal(service.includes("initialSnapshotsRemaining"), false, "shared listener race is removed");
assert.ok(service.includes("export async function cancelFriendRequest"));
assert.ok(screen.includes("<AccordionHeader"));
assert.ok(screen.includes("accessibilityState={{ expanded }}"));
assert.ok(screen.includes("setIncomingExpanded"));
assert.ok(screen.includes("setOutgoingExpanded"));
assert.ok(screen.indexOf('title={t("friends.myFriends")}') > screen.indexOf('title={t("friends.outgoing")}'));
assert.ok(screen.includes("setIncomingRequests((current) => current.filter"));
assert.ok(screen.includes("setOutgoingRequests((current) => current.filter"));

const requestRules = rules.slice(rules.indexOf("match /friendRequests/{requestId}"), rules.indexOf("// squads collection"));
assert.ok(requestRules.includes("allow create, update, delete: if false;"));
const indexFields = indexes.indexes.map((index) => index.fields.map((field) => field.fieldPath).join("+"));
assert.ok(indexFields.includes("toUserId+status+expiresAt"));
assert.ok(indexFields.includes("fromUserId+status+expiresAt"));
assert.ok(indexFields.includes("status+expiresAt"));

console.log("Friend request lifecycle, exact expiry, identity, listener-race, accordion, block, rule, and index tests passed.");
