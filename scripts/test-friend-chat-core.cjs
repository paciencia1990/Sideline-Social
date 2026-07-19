const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");

function read(...segments) { return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8"); }
function loadTypeScript(relativePath) {
  const output = ts.transpileModule(read(relativePath), { compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", output)(loaded, loaded.exports, require);
  return loaded.exports;
}

const core = loadTypeScript("functions/src/friendChatCore.ts");
const errorCore = loadTypeScript("utils/friendChatError.ts");
assert.equal(core.directConversationIdFor("parent-b", "parent-a"), core.directConversationIdFor("parent-a", "parent-b"));
assert.notEqual(core.directConversationIdFor("a_b", "c"), core.directConversationIdFor("a", "b_c"), "direct IDs must not be delimiter-collision prone");
assert.match(core.directConversationIdFor("a", "b"), /^direct_[a-f0-9]{64}$/u);
assert.equal(core.messageIdFor("user-a", "client_message_123"), core.messageIdFor("user-a", "client_message_123"));
assert.notEqual(core.messageIdFor("user-a", "client_message_123"), core.messageIdFor("user-b", "client_message_123"));
assert.deepEqual(core.normalizeFriendIds(["b", "a", "b", "self", "bad/path"], "self"), ["b", "a"]);
assert.equal(core.sanitizeChatMessage("  hello   friend\r\n next  "), "hello friend\nnext");
assert.throws(() => core.sanitizeChatMessage("   "));
assert.throws(() => core.sanitizeChatMessage("x".repeat(501)));
assert.equal(core.sanitizeGroupName("  Weekend   Crew "), "Weekend Crew");
assert.equal(core.sanitizeGroupName("  "), null);
assert.throws(() => core.sanitizeGroupName("x".repeat(61)));
assert.equal(core.sanitizeMessagePreview("x".repeat(120)).length, 100);
assert.equal(core.isAcceptedFriend({ friendIds: ["b"] }, { friendIds: ["a"] }, "a", "b"), true);
assert.equal(core.isAcceptedFriend({ friendIds: ["b"] }, { friendIds: [] }, "a", "b"), false);
assert.equal(core.isUnreadConversation({ lastMessageAt: 20, lastMessageSenderId: "b", lastReadAt: 10, currentUserId: "a" }), true);
assert.equal(core.isUnreadConversation({ lastMessageAt: 20, lastMessageSenderId: "a", lastReadAt: 10, currentUserId: "a" }), false);
const chatError = (code, message) => Object.assign(new Error(message), { code });
assert.equal(errorCore.mapFriendChatError(chatError("functions/unavailable", "offline")), "network");
assert.equal(errorCore.mapFriendChatError(chatError("functions/permission-denied", "Active membership required")), "permission");
assert.equal(errorCore.mapFriendChatError(chatError("functions/permission-denied", "Messaging is unavailable for this connection")), "blocked");
assert.equal(errorCore.mapFriendChatError(chatError("functions/failed-precondition", "You are no longer friends")), "friendshipEnded");
assert.equal(errorCore.mapFriendChatError(chatError("functions/failed-precondition", "Invitation required")), "invited");
assert.equal(errorCore.mapFriendChatError(chatError("functions/not-found", "Conversation unavailable")), "removed");
assert.equal(errorCore.mapFriendChatError(chatError("functions/failed-precondition", "The query requires an index")), "missingIndex");

const service = read("services", "chatService.ts");
const functionsSource = read("functions", "src", "friendChat.ts");
const rules = read("firestore.rules");
const indexes = JSON.parse(read("firestore.indexes.json"));
const friendChatFeatureCommit = execFileSync(
  "git",
  ["log", "--diff-filter=A", "--format=%H", "--", "scripts/test-friend-chat-core.cjs"],
  { encoding: "utf8" },
).trim().split(/\r?\n/u)[0];
const legacyRevision = `${friendChatFeatureCommit}^`;
const originalService = execFileSync("git", ["show", `${legacyRevision}:services/chatService.ts`], { encoding: "utf8" });
const originalRules = execFileSync("git", ["show", `${legacyRevision}:firestore.rules`], { encoding: "utf8" });
const originalLanding = execFileSync("git", ["show", `${legacyRevision}:app/(social)/chat/index.tsx`], { encoding: "utf8" });
const originalTranslations = execFileSync("git", ["show", `${legacyRevision}:i18n/index.ts`], { encoding: "utf8" });
assert.equal(originalService.includes('const CHATS_COLLECTION = "chats"'), true, "legacy failure fixture must use the denied chats collection");
assert.equal(originalRules.includes("match /chats/"), false, "legacy rules must reproduce default-deny for chats");
assert.equal(originalLanding.includes('setError(t("chat.errorBody"))'), true, "legacy listener must map the failure to the placeholder");
assert.equal(originalTranslations.includes("Chat is unavailable right now. Please try again in a moment."), true, "exact legacy unavailable copy must remain reproducible from HEAD");
const repoSource = [read("app", "(social)", "chat", "index.tsx"), read("app", "(social)", "chat", "[chatId].tsx"), service].join("\n");
assert.equal(repoSource.includes('collection(db, "chats")'), false);
assert.equal(fs.existsSync(path.join(process.cwd(), "app", "(social)", "squad-chat.tsx")), false);
assert.equal(read("app", "(tabs)", "index.tsx").includes("squad-chat"), false);
assert.equal(read("app", "(social)", "squad-detail.tsx").includes("squad-chat"), false);
assert.equal(service.includes("limit(CHAT_INITIAL_MESSAGE_LIMIT)"), true);
assert.equal(service.includes("startAfter(before)"), true);
assert.equal(service.includes('where("visibleToUserIds", "array-contains", uid)'), true);
assert.equal(functionsSource.includes("CHAT_SEND_COOLDOWN_MS"), true);
assert.equal(functionsSource.includes("clientMessageId"), true);
assert.equal(functionsSource.includes("isAcceptedFriend"), true);
assert.equal(functionsSource.includes("userBlocks"), true);
assert.equal(rules.includes("allow create, update, delete: if false;"), true);
for (const projection of ["activeParticipantIds", "invitedParticipantIds"]) {
  assert.ok(indexes.indexes.some((index) => index.collectionGroup === "friendConversations" && index.fields.some((field) => field.fieldPath === projection && field.arrayConfig === "CONTAINS")), `missing ${projection} index`);
}
assert.ok(indexes.indexes.some((index) => index.collectionGroup === "messages" && index.fields.some((field) => field.fieldPath === "visibleToUserIds" && field.arrayConfig === "CONTAINS")), "missing visibleToUserIds message index");
console.log("Friend Chat identity, validation, bounded-read, idempotency, safety, route-removal, and index tests passed.");
