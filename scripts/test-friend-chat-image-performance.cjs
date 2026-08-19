"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
function loadTypeScript(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", output)(loaded, loaded.exports, require);
  return loaded.exports;
}

const profile = loadTypeScript("constants/friendChatImageProfile.ts");
const cacheCore = loadTypeScript("utils/friendChatImageCacheCore.ts");
const picker = read("services", "friendChatImageService.ts");
const cache = read("services", "friendChatImageCacheService.ts");
const chatService = read("services", "chatService.ts");
const timeline = read("app", "(social)", "chat", "[chatId].tsx");
const messageImage = read("components", "FriendChatImageMessage.tsx");
const viewer = read("components", "FriendChatImageViewer.tsx");
const functionsCore = read("functions", "src", "friendChatCore.ts");
const functions = read("functions", "src", "friendChat.ts");
const storageRules = read("storage.rules");

assert.equal(profile.FRIEND_CHAT_IMAGE_MEDIA_PROFILE_VERSION, 2);
assert.equal(profile.FRIEND_CHAT_IMAGE_PROFILE_V2.display.initialMaxEdge, 1440);
assert.equal(profile.FRIEND_CHAT_IMAGE_PROFILE_V2.display.maxBytes, 1024 * 1024);
assert.equal(profile.FRIEND_CHAT_IMAGE_PROFILE_V2.thumbnail.initialMaxEdge, 480);
assert.equal(profile.FRIEND_CHAT_IMAGE_PROFILE_V2.thumbnail.maxBytes, 120 * 1024);
for (const variant of [profile.FRIEND_CHAT_IMAGE_PROFILE_V2.display, profile.FRIEND_CHAT_IMAGE_PROFILE_V2.thumbnail]) {
  const attempts = profile.createFriendChatImageCompressionAttempts(variant);
  assert.equal(attempts.length, variant.qualitySteps.length * variant.scaleSteps.length);
  assert.ok(attempts.length <= 12, "encoding attempts must terminate within a strict bound");
  assert.ok(attempts.every((attempt) => attempt.quality >= variant.minimumQuality));
  assert.ok(attempts.every((attempt) => attempt.maxEdge <= variant.initialMaxEdge));
}
assert.match(picker, /sizeBytes <= profile\.maxBytes/u);
assert.match(picker, /deleteTemporaryImage\(result\.uri\)/u, "failed compression attempts clean temporary files");
assert.match(picker, /mediaProfileVersion: FRIEND_CHAT_IMAGE_MEDIA_PROFILE_VERSION/u);
assert.doesNotMatch(picker, /FRIEND_CHAT_IMAGE_PROCESSED_LIMIT_BYTES/u, "new uploads no longer use the legacy 3 MB profile");

const thumbnailIdentity = cacheCore.friendChatImageCacheIdentity({
  conversationId: "conversation",
  mediaProfileVersion: 2,
  messageId: "message",
  uid: "account",
  variant: "thumbnail",
});
assert.equal(thumbnailIdentity, cacheCore.friendChatImageCacheIdentity({ conversationId: "conversation", mediaProfileVersion: 2, messageId: "message", uid: "account", variant: "thumbnail" }));
assert.notEqual(thumbnailIdentity, cacheCore.friendChatImageCacheIdentity({ conversationId: "conversation", mediaProfileVersion: 2, messageId: "message", uid: "account", variant: "display" }));
assert.match(cache, /secureHash\(friendChatImageCacheIdentity/u, "identifiers are hashed before persistence or filenames");
assert.match(cache, /CACHE_MAX_BYTES = 64 \* 1024 \* 1024/u);
assert.match(cache, /CACHE_MAX_ENTRIES = 128/u);
assert.match(cache, /MAX_CONCURRENT_DOWNLOADS = 3/u);
assert.match(cache, /inFlightDownloads/u);
assert.match(cache, /signal\?\.addEventListener\("abort"/u);
assert.match(cache, /auth\.currentUser\?\.uid !== uid/u, "cross-account results are discarded");
assert.match(cache, /clearFriendChatMediaGrantCache/u);
assert.doesNotMatch(cache, /console\.(?:info|log|warn)\([^\n]*(?:url|storagePath|messageId|conversationId|uid)/u, "diagnostics never print protected identifiers or URLs");

assert.match(chatService, /friendChatMediaGrantRequests/u);
assert.match(chatService, /MEDIA_GRANT_EXPIRY_BUFFER_MS/u);
assert.match(timeline, /onViewableItemsChanged/u);
assert.match(timeline, /token\.index - 2/u);
assert.match(timeline, /token\.index \+ 2/u);
assert.match(timeline, /primeFriendChatImageCache/u);
assert.match(messageImage, /variant: "thumbnail"/u);
assert.doesNotMatch(messageImage, /variant: "display"/u);
assert.match(messageImage, /image\.thumbnailWidth \/ image\.thumbnailHeight/u);
assert.match(messageImage, /t\("common\.retry"\)/u);
assert.match(viewer, /variant: "thumbnail"/u);
assert.match(viewer, /variant: "display"/u);
assert.match(viewer, /fullUri \?\? thumbnailUri/u);

assert.match(functionsCore, /mediaProfileVersion: 1 \| typeof FRIEND_CHAT_IMAGE_PROFILE_V2/u);
assert.match(functionsCore, /data\.mediaProfileVersion == null[\s\S]*\? 1/u, "absent versions retain legacy behavior");
assert.match(functionsCore, /unsupported_image_profile/u);
assert.match(functions, /readJpegDimensions\(fullBytes\)/u);
assert.match(functions, /fullDimensions\.width !== image\.main\.width/u, "server rejects spoofed dimensions");
assert.match(storageRules, /image\.mediaProfileVersion == 2/u);
assert.match(storageRules, /image\.main\.sizeBytes <= 1024 \* 1024/u);
assert.match(storageRules, /image\.thumbnail\.sizeBytes <= 120 \* 1024/u);
assert.match(storageRules, /allow read, update, delete: if false;/u, "Storage remains deny-by-default for direct reads");

console.log("Friend Chat image v2 profile, protected cache, grant reuse, lazy loading, viewer, and backend validation tests passed.");
