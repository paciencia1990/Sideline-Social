const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(path.join(process.cwd(), "utils", "friendRequestState.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const loaded = { exports: {} };
new Function("module", "exports", output)(loaded, loaded.exports);

const { decodeFriendRequestDate, getSentAge, reconcilePendingFriendRequests } = loaded.exports;
const now = Date.UTC(2026, 6, 15, 12);
const day = 24 * 60 * 60 * 1000;
const epochSeconds = Math.floor((now - day) / 1000);

for (const value of [
  now - day,
  new Date(now - day).toISOString(),
  new Date(now - day),
  { seconds: epochSeconds, nanoseconds: 0 },
  { _seconds: epochSeconds, _nanoseconds: 0 },
  { toMillis: () => now - day },
  { toDate: () => new Date(now - day) },
]) {
  assert.equal(decodeFriendRequestDate(value).getTime(), now - day);
}
for (const value of [undefined, null, 0, Number.NaN, "not-a-date", {}, { seconds: "bad" }]) {
  assert.equal(decodeFriendRequestDate(value), null);
}

assert.deepEqual(getSentAge(new Date(now - (2 * day)), now), { kind: "days", count: 2 });
assert.deepEqual(getSentAge(new Date(now - 1000), now), { kind: "today" });
assert.deepEqual(getSentAge(null, now), { kind: "recent" });
assert.deepEqual(getSentAge(new Date(0), now), { kind: "recent" });
assert.deepEqual(getSentAge(new Date(now + day), now), { kind: "recent" });
assert.deepEqual(getSentAge(new Date(now - (20_660 * day)), now), { kind: "recent" });

const request = (id, fromUserId, toUserId, status = "pending", expiresAt = new Date(now + day)) => ({
  id, fromUserId, toUserId, status, expiresAt,
});
const incoming = [
  request("incoming-pending", "incoming-user", "viewer"),
  request("incoming-accepted", "accepted-user", "viewer", "accepted"),
  request("incoming-declined", "declined-user", "viewer", "declined"),
  request("incoming-expired", "expired-user", "viewer", "pending", new Date(now - 1)),
  request("incoming-superseded", "friend-user", "viewer"),
];
const outgoing = [
  request("outgoing-pending", "viewer", "outgoing-user"),
  request("outgoing-canceled", "viewer", "canceled-user", "canceled"),
  request("outgoing-expired-status", "viewer", "expired-status-user", "expired"),
  request("outgoing-duplicate", "viewer", "incoming-user"),
  request("outgoing-friend", "viewer", "friend-user"),
];
const firstLoad = reconcilePendingFriendRequests(incoming, outgoing, new Set(["friend-user"]), now);
assert.deepEqual(firstLoad.incoming.map((item) => item.id), ["incoming-pending"]);
assert.deepEqual(firstLoad.outgoing.map((item) => item.id), ["outgoing-pending"]);
assert.equal(firstLoad.incoming.length, 1, "incoming section count matches displayed rows");
assert.equal(firstLoad.outgoing.length, 1, "outgoing section count matches displayed rows");

const reopened = reconcilePendingFriendRequests(incoming, outgoing, new Set(["friend-user", "incoming-user"]), now);
assert.deepEqual(reopened.incoming, [], "refreshing cannot restore a resolved request");
assert.deepEqual(reopened.outgoing.map((item) => item.id), ["outgoing-pending"]);

const service = fs.readFileSync(path.join(process.cwd(), "services", "friendsService.ts"), "utf8");
const screen = fs.readFileSync(path.join(process.cwd(), "app", "(tabs)", "friends.tsx"), "utf8");
const translations = fs.readFileSync(path.join(process.cwd(), "i18n", "index.ts"), "utf8");
assert.match(service, /if \(data\.status !== "pending"\) return null/);
assert.match(service, /decodeFriendRequestDate\(data\.createdAt\)/);
assert.match(screen, /friendsLoadSequence/);
assert.match(screen, /reconcilePendingFriendRequests/);
assert.match(screen, /nextExpiry - Date\.now\(\)/, "an open Friends tab refreshes when its next request expires");
assert.match(screen, /friends\.sentRecently/);
assert.match(translations, /sentRecently: 'recently'/);
assert.match(translations, /sentRecently: 'recientemente'/);

console.log("Friend request pending-state reconciliation and timestamp decoding tests passed.");
