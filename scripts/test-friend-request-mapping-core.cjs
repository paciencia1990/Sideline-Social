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

const mapping = loadTypeScript("utils/friendRequestMapping.ts");
const privacy = loadTypeScript("utils/friendPrivacy.ts");
const formatPublicName = (value) => privacy.formatFriendRequestSenderName(value, "") || null;

assert.equal(mapping.getIncomingRequestSenderId({ fromUserId: "sender_uid" }), "sender_uid");
assert.equal(mapping.getIncomingRequestSenderId({ fromUserId: " sender_uid " }), null);
assert.equal(mapping.getIncomingRequestSenderId({ fromUserId: "" }), null);
assert.equal(mapping.getOutgoingRequestRecipientId({ toUserId: "recipient_uid" }), "recipient_uid");
assert.deepEqual(
  mapping.deduplicateFriendUserIds(["sender_uid", "recipient_uid", "sender_uid", null]),
  ["sender_uid", "recipient_uid"],
);

const inspected = mapping.inspectPublicUserProfiles([
  { userId: "recipient_uid", displayName: "Riley Rivera" },
  { userId: "sender_uid", displayName: "Joann Pollard" },
]);
assert.equal(inspected.counts.returnedProfileCount, 2);
assert.equal(inspected.counts.returnedWithUserIdCount, 2);
assert.equal(inspected.counts.returnedWithNonEmptyDisplayNameCount, 2);
assert.equal(inspected.profilesByUserId.get("sender_uid").displayName, "Joann Pollard");

const incoming = [{
  id: "sender_uid__viewer_uid",
  fromUserId: "sender_uid",
  fromDisplayName: "Sideline Parent",
  toUserId: "viewer_uid",
}];
const outgoing = [{
  id: "viewer_uid__recipient_uid",
  fromUserId: "viewer_uid",
  toUserId: "recipient_uid",
  toDisplayName: "Sideline Parent",
}];
const hydrated = mapping.hydrateFriendRequestProfiles(
  incoming,
  outgoing,
  inspected.profilesByUserId,
  formatPublicName,
);
assert.equal(hydrated.incoming[0].senderDisplayName, "Joann P.");
assert.equal(hydrated.incoming[0].senderNameResolved, true);
assert.equal(hydrated.outgoing[0].recipientDisplayName, "Riley R.");
assert.equal(hydrated.outgoing[0].recipientNameResolved, true);
assert.notEqual(hydrated.incoming[0].senderDisplayName, hydrated.outgoing[0].recipientDisplayName);

const nullNameInspection = mapping.inspectPublicUserProfiles([
  { userId: "sender_uid", displayName: null },
]);
const nullNameHydration = mapping.hydrateFriendRequestProfiles(
  incoming,
  [],
  nullNameInspection.profilesByUserId,
  formatPublicName,
);
assert.equal(nullNameHydration.incoming[0].senderDisplayName, null);
assert.equal(nullNameHydration.incoming[0].senderNameResolved, false);
assert.equal(nullNameInspection.counts.returnedWithNullDisplayNameCount, 1);

const missingHydration = mapping.hydrateFriendRequestProfiles(incoming, [], new Map(), formatPublicName);
assert.equal(missingHydration.incoming[0].senderDisplayName, null);
assert.equal(missingHydration.incoming[0].senderNameResolved, false);

const malformed = mapping.inspectPublicUserProfiles([
  { displayName: "Missing ID" },
  { userId: "", displayName: "Empty ID" },
  { userId: " invalid ", displayName: "Invalid ID" },
  { userId: "valid_uid", displayName: 42 },
]);
assert.equal(malformed.counts.profilesMissingUserIdCount, 1);
assert.equal(malformed.counts.profilesWithEmptyUserIdCount, 1);
assert.equal(malformed.counts.profilesWithInvalidUserIdCount, 1);
assert.equal(malformed.counts.profilesWithInvalidDisplayNameCount, 1);
assert.equal(malformed.profiles.length, 0);

const sorted = [...hydrated.incoming].sort((first, second) => first.id.localeCompare(second.id));
assert.equal(sorted[0].senderDisplayName, "Joann P.");
const listenerRefresh = mapping.hydrateFriendRequestProfiles(incoming, outgoing, inspected.profilesByUserId, formatPublicName);
const pullToRefresh = mapping.hydrateFriendRequestProfiles(incoming, outgoing, inspected.profilesByUserId, formatPublicName);
assert.equal(listenerRefresh.incoming[0].senderDisplayName, "Joann P.");
assert.equal(pullToRefresh.incoming[0].senderDisplayName, "Joann P.");

assert.equal(privacy.getFriendNameInitials("Joann P."), "JP");
assert.equal(formatPublicName("private@example.com"), null);

const service = read("services", "friendsService.ts");
const screen = read("app", "(tabs)", "friends.tsx");
const publicProfileService = read("services", "publicProfileService.ts");
assert.equal(service.includes("profilesByUserId.get(senderId)"), true);
assert.equal(service.includes("inspectPublicUserProfiles(publicProfiles)"), true);
assert.equal(service.includes("getIncomingRequestSenderId"), true);
assert.equal(service.includes("incomingIdMatchedProfileCount"), true);
assert.equal(service.includes("incomingIdMatchedNullNameCount"), true);
assert.equal(service.includes("hydratedSenderNameCount"), true);
assert.equal(screen.includes("request.senderDisplayName || t(\"friends.sidelineParent\")"), true);
assert.equal(screen.includes("formatFriendRequestSenderName(request.senderDisplayName"), false);
assert.equal(screen.includes("getFriendNameInitials(name)"), true);
assert.equal(screen.includes("acceptFriendRequest(request.id)"), true);
assert.equal(screen.includes("declineFriendRequest(request.id)"), true);
assert.equal(screen.includes("request.fromDisplayName, t"), false);
assert.equal(screen.toLowerCase().includes("request.fromuserid}"), false);
assert.equal(screen.toLowerCase().includes("profile.email"), false);
assert.equal(publicProfileService.includes("userId.trim()"), false);

console.log("Incoming/outgoing exact-UID mapping, null-name distinction, state survival, rendering, and privacy tests passed.");
