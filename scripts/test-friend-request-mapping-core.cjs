const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
function read(...segments) { return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8"); }
function load(relativePath) {
  const output = ts.transpileModule(read(relativePath), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  const loaded = { exports: {} }; new Function("module", "exports", output)(loaded, loaded.exports); return loaded.exports;
}
const mapping = load("utils/friendRequestMapping.ts");
const privacy = load("utils/friendPrivacy.ts");
const format = (value) => privacy.formatFullPublicName(value);

assert.equal(mapping.getIncomingRequestSenderId({ fromUserId: "sender_uid" }), "sender_uid");
assert.equal(mapping.getOutgoingRequestRecipientId({ toUserId: "recipient_uid" }), "recipient_uid");
assert.deepEqual(mapping.deduplicateFriendUserIds(["sender_uid", "sender_uid", null]), ["sender_uid"]);

const profiles = mapping.inspectPublicUserProfiles([
  { userId: "sender_uid", firstName: "Joann", lastName: "Pollard", displayName: "Joann Pollard", photoURL: "https://example.test/a.jpg" },
  { userId: "recipient_uid", firstName: "Riley", lastName: "Rivera", displayName: "Riley Rivera", photoURL: null },
]);
const incoming = [{ id: "sender_uid__viewer", fromUserId: "sender_uid", fromDisplayName: "Old Sender", fromPhotoURL: null, toUserId: "viewer" }];
const outgoing = [{ id: "viewer__recipient_uid", fromUserId: "viewer", toUserId: "recipient_uid", toDisplayName: "Old Recipient", toPhotoURL: null }];
const current = mapping.hydrateFriendRequestProfiles(incoming, outgoing, profiles.profilesByUserId, format);
assert.equal(current.incoming[0].senderDisplayName, "Joann Pollard", "current public name replaces stale snapshot");
assert.equal(current.incoming[0].senderNameSource, "publicProfile");
assert.equal(current.incoming[0].senderPhotoURL, "https://example.test/a.jpg");
assert.equal(current.outgoing[0].recipientDisplayName, "Riley Rivera");

const snapshot = mapping.hydrateFriendRequestProfiles(incoming, outgoing, new Map(), format);
const oldPublicOnlyName = new Map().get("sender_uid")?.displayName ?? null;
assert.equal(oldPublicOnlyName, null, "reproduces the old placeholder path when the public lookup misses");
assert.equal(snapshot.incoming[0].senderDisplayName, "Old Sender", "trusted snapshot is the resilient fallback");
assert.equal(snapshot.incoming[0].senderNameSource, "requestSnapshot");
assert.equal(snapshot.outgoing[0].recipientDisplayName, "Old Recipient");
const unavailable = mapping.hydrateFriendRequestProfiles([{ ...incoming[0], fromDisplayName: "Sideline Parent" }], [], new Map(), format);
assert.equal(unavailable.incoming[0].senderDisplayName, null);
assert.equal(unavailable.incoming[0].senderNameSource, "unavailable");
assert.equal(format("private@example.test"), null);

const service = read("services", "friendsService.ts");
const screen = read("app", "(tabs)", "friends.tsx");
assert.ok(service.includes("loadPublicProfilesWithRetry"));
assert.ok(service.includes("hydrateFriendRequestProfiles"));
assert.ok(screen.includes('t("friends.publicNameUnavailable")'));
assert.equal(screen.includes('request.senderDisplayName || t("friends.sidelineParent")'), false);
assert.equal(screen.toLowerCase().includes("profile.email"), false);
console.log("Full-name current-profile, trusted-snapshot fallback, retry, photo, and neutral fallback mapping tests passed.");
