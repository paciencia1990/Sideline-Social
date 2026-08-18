const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

function loadTypeScript(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
    },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", output)(loaded, loaded.exports, require);
  return loaded.exports;
}

const deletion = loadTypeScript("utils/friendChatDeletionCore.ts");
const dates = loadTypeScript("utils/friendChatDateSeparatorCore.ts");

const imageMessage = {
  caption: "Team photo",
  image: { fullPath: "full", thumbnailPath: "thumb" },
  messageId: "image-1",
  reactions: [{ count: 1, emoji: "👍" }],
  replyTo: { messageId: "older" },
  starredBySelf: true,
  status: "active",
  text: "",
  voiceMemo: null,
};
const textMessage = {
  caption: null,
  image: null,
  messageId: "text-1",
  reactions: [],
  replyTo: null,
  starredBySelf: false,
  status: "active",
  text: "Hello",
  voiceMemo: null,
};

const forMe = new Map([["image-1", { message: imageMessage, mode: "forMe", operationId: "delete-a" }]]);
assert.deepEqual(
  deletion.reconcileFriendChatDeletionState([textMessage, imageMessage], forMe).map((message) => message.messageId),
  ["text-1"],
  "delete for me must hide content immediately for only the local user",
);

const forEveryone = new Map([["image-1", { message: imageMessage, mode: "forEveryone", operationId: "delete-b" }]]);
const optimistic = deletion.reconcileFriendChatDeletionState([textMessage, imageMessage], forEveryone);
const tombstone = optimistic.find((message) => message.messageId === "image-1");
assert.equal(tombstone.status, "removed");
assert.equal(tombstone.image, null);
assert.equal(tombstone.caption, null);
assert.equal(tombstone.replyTo, null);
assert.deepEqual(tombstone.reactions, []);
assert.equal(tombstone.starredBySelf, false);
assert.equal(
  deletion.reconcileFriendChatDeletionState([textMessage, imageMessage], forEveryone).find((message) => message.messageId === "image-1").status,
  "removed",
  "an older active listener result must not restore optimistically deleted content",
);
assert.equal(
  deletion.reconcileFriendChatDeletionState([textMessage, imageMessage], new Map()).find((message) => message.messageId === "image-1").status,
  "active",
  "removing a failed pending operation restores the server message",
);
assert.equal(
  deletion.deletionOperationKey("forEveryone", ["image-1", "text-1"]),
  deletion.deletionOperationKey("forEveryone", ["text-1", "image-1", "image-1"]),
  "duplicate taps and reordered selections share one operation key",
);

const now = new Date(2026, 7, 18, 12, 0, 0);
const english = { today: "Today", yesterday: "Yesterday" };
const spanish = { today: "Hoy", yesterday: "Ayer" };
assert.equal(dates.createFriendChatDateSeparator(new Date(2026, 7, 18, 1), "en-US", english, now).label, "Today");
assert.equal(dates.createFriendChatDateSeparator(new Date(2026, 7, 17, 23), "en-US", english, now).label, "Yesterday");
assert.equal(dates.createFriendChatDateSeparator(new Date(2026, 7, 15, 12), "en-US", english, now).label, "Saturday");
assert.equal(dates.createFriendChatDateSeparator(new Date(2026, 7, 15, 12), "es", spanish, now).label.toLowerCase(), "sábado");
assert.match(dates.createFriendChatDateSeparator(new Date(2026, 6, 1, 12), "en-US", english, now).label, /July 1, 2026/u);
assert.match(dates.createFriendChatDateSeparator(new Date(2026, 6, 1, 12), "es", spanish, now).label.toLowerCase(), /1 de julio de 2026/u);
assert.equal(dates.createFriendChatDateSeparator(null, "en-US", english, now), null);
assert.equal(dates.createFriendChatDateSeparator(new Date(0), "en-US", english, now), null);
assert.equal(dates.createFriendChatDateSeparator(new Date(now.getTime() + (6 * 60 * 1000)), "en-US", english, now), null);
assert.equal(dates.shouldShowFriendChatDateSeparator(new Date(2026, 7, 18, 2), new Date(2026, 7, 18, 1), now), false);
assert.equal(dates.shouldShowFriendChatDateSeparator(new Date(2026, 7, 18, 0), new Date(2026, 7, 17, 23, 59), now), true);
assert.equal(
  dates.shouldShowFriendChatDateSeparator(new Date(2026, 2, 9, 0, 30), new Date(2026, 2, 8, 23, 30), new Date(2026, 2, 9, 12)),
  true,
  "date grouping must use calendar boundaries across daylight-saving changes",
);

const chatScreen = read("app", "(social)", "chat", "[chatId].tsx");
const imageThumbnail = read("components", "FriendChatImageMessage.tsx");
const imageViewer = read("components", "FriendChatImageViewer.tsx");
const service = read("services", "chatService.ts");
const functionsSource = read("functions", "src", "friendChat.ts");
const translations = read("i18n", "index.ts");

assert.doesNotMatch(imageThumbnail, /function PhotoAction|styles\.actionSheet|actionMenuVisible/u, "the thumbnail must not mount the removed photo-actions bottom sheet");
assert.match(imageThumbnail, /onPress=\{handlePress\}/u);
assert.match(imageThumbnail, /onLongPress=\{handleLongPress\}/u);
assert.match(imageThumbnail, /LONG_PRESS_TAP_GUARD_MS/u, "long press must not fall through to the single-tap viewer");
assert.match(imageViewer, /presentationStyle="overFullScreen"/u);
assert.match(imageViewer, /useSafeAreaInsets/u);
assert.match(imageViewer, /Gesture\.Pinch\(\)/u);
assert.match(imageViewer, /Gesture\.Pan\(\)/u);
assert.match(imageViewer, /getFriendChatMediaDownloadUrl/u, "full-resolution media remains protected and reauthorized");
assert.match(imageViewer, /chat\.savePhoto/u);
assert.match(imageViewer, /chat\.forwardPhoto/u);
assert.match(imageViewer, /chat\.morePhotoActions/u);
assert.match(chatScreen, /FriendChatImageViewer/u);
assert.match(chatScreen, /runDeleteMessages\("forMe"/u);
assert.match(chatScreen, /runDeleteMessages\("forEveryone"/u);
assert.match(chatScreen, /pendingDeletionsRef/u);
assert.match(chatScreen, /clearFriendChatImageMemoryCache/u);
assert.match(chatScreen, /createFriendChatDateSeparator/u);
assert.match(chatScreen, /shouldShowFriendChatDateSeparator/u);
assert.match(service, /currentGeneration === hydrationGeneration/u, "out-of-order hydration must be discarded");
assert.match(service, /lastMessageStates\[index\]\?\.hiddenForMe/u, "delete-for-me must hide stale conversation previews");
assert.match(functionsSource, /message\.data\(\)\?\.senderUserId !== uid/u, "delete-for-everyone ownership stays server-authorized");
assert.match(functionsSource, /message\.data\(\)\?\.conversationId !== conversationId/u, "cross-conversation deletion must be rejected");
assert.match(functionsSource, /revokeFriendChatMediaGrants/u);
assert.match(functionsSource, /removeFriendChatMessageReactions/u);
assert.match(functionsSource, /redactFriendChatReplyPreviews/u);
assert.match(functionsSource, /moderationEvidenceRetained/u, "reported media must be retained for moderation");
assert.match(functionsSource, /retainedForModeration/u);
assert.match(functionsSource, /transaction\.delete\(userMessageStateRef/u, "stars and per-user state must be cleared for everyone deletion");

for (const key of [
  "today", "yesterday", "dateSeparatorAccessibility", "messageDeleted", "youDeletedMessage",
  "deleteForMe", "deleteForEveryone", "deleteFailedRetry", "closePhotoViewer",
  "fullScreenPhotoAccessibility",
]) {
  const count = translations.match(new RegExp(`\\n\\s*${key}:`, "gu"))?.length ?? 0;
  assert.ok(count >= 2, `${key} must be localized in English and Spanish`);
}

console.log("Friend Chat optimistic deletion, secure viewer, and localized date-separator contracts passed.");
