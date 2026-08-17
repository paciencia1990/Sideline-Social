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
const uploadCancellation = loadTypeScript("utils/friendChatUploadCancellation.ts");
assert.equal(core.directConversationIdFor("parent-b", "parent-a"), core.directConversationIdFor("parent-a", "parent-b"));
assert.notEqual(core.directConversationIdFor("a_b", "c"), core.directConversationIdFor("a", "b_c"), "direct IDs must not be delimiter-collision prone");
assert.match(core.directConversationIdFor("a", "b"), /^direct_[a-f0-9]{64}$/u);
assert.equal(core.messageIdFor("user-a", "client_message_123"), core.messageIdFor("user-a", "client_message_123"));
assert.notEqual(core.messageIdFor("user-a", "client_message_123"), core.messageIdFor("user-b", "client_message_123"));
const forwardClientMessageId = core.forwardClientMessageIdFor("forward_operation_001", "source_message_001", "destination_001");
assert.equal(forwardClientMessageId, core.forwardClientMessageIdFor("forward_operation_001", "source_message_001", "destination_001"));
assert.notEqual(forwardClientMessageId, core.forwardClientMessageIdFor("forward_operation_002", "source_message_001", "destination_001"));
assert.notEqual(forwardClientMessageId, core.forwardClientMessageIdFor("forward_operation_001", "source_message_002", "destination_001"));
assert.notEqual(forwardClientMessageId, core.forwardClientMessageIdFor("forward_operation_001", "source_message_001", "destination_002"));
assert.match(forwardClientMessageId, /^forward_[a-f0-9]{64}$/u);
assert.deepEqual(core.normalizeFriendIds(["b", "a", "b", "self", "bad/path"], "self"), ["b", "a"]);
assert.equal(core.sanitizeChatMessage("  hello   friend\r\n next  "), "hello friend\nnext");
assert.throws(() => core.sanitizeChatMessage("   "));
assert.throws(() => core.sanitizeChatMessage("x".repeat(501)));
assert.equal(core.sanitizeGroupName("  Weekend   Crew "), "Weekend Crew");
assert.equal(core.sanitizeGroupName("  "), null);
assert.throws(() => core.sanitizeGroupName("x".repeat(61)));
assert.equal(core.sanitizeMessagePreview("x".repeat(120)).length, 100);
assert.equal(core.FRIEND_CHAT_VOICE_MAX_DURATION_MS, 120_000);
assert.equal(core.FRIEND_CHAT_VOICE_MAX_SIZE_BYTES, 3 * 1024 * 1024);
assert.equal(core.FRIEND_CHAT_IMAGE_SOURCE_MAX_SIZE_BYTES, 5 * 1024 * 1024);
assert.equal(core.FRIEND_CHAT_IMAGE_MAX_SIZE_BYTES, 3 * 1024 * 1024);
assert.equal(core.FRIEND_CHAT_IMAGE_THUMBNAIL_MAX_SIZE_BYTES, 512 * 1024);
assert.equal(core.FRIEND_CHAT_IMAGE_MAX_EDGE, 1600);
assert.equal(core.FRIEND_CHAT_IMAGE_THUMBNAIL_MAX_EDGE, 512);
assert.equal(core.FRIEND_CHAT_MEDIA_RESERVATION_COOLDOWN_MS, 10_000);
assert.deepEqual(core.FRIEND_CHAT_REACTIONS.slice(0, core.FRIEND_CHAT_QUICK_REACTIONS.length), core.FRIEND_CHAT_QUICK_REACTIONS);
assert.equal(core.FRIEND_CHAT_REACTIONS.length, 27, "expanded reaction allowlist should include quick, expressive, and sport reactions");
assert.equal(core.normalizeFriendChatReaction(core.FRIEND_CHAT_REACTIONS[0]), core.FRIEND_CHAT_REACTIONS[0]);
assert.equal(core.normalizeFriendChatReaction(core.FRIEND_CHAT_REACTIONS.at(-1)), core.FRIEND_CHAT_REACTIONS.at(-1));
assert.equal(core.normalizeFriendChatReaction("not-a-reaction"), null);
assert.equal(core.sanitizeOptionalChatCaption("  photo   caption  "), "photo caption");
assert.throws(() => core.sanitizeOptionalChatCaption("x".repeat(501)));
assert.equal(core.friendChatMediaPreview("image", ""), "photo");
assert.equal(core.friendChatMediaPreview("voice", null), "voice");
assert.equal(core.friendChatMediaPreview("image", "Sideline photo"), "Sideline photo");
const mediaMessageId = core.messageIdFor("user-a", "client_media_001");
const mediaReservationId = core.mediaReservationIdFor("user-a", "client_media_001", "image");
assert.match(mediaMessageId, /^message_[a-f0-9]{64}$/u);
assert.match(mediaReservationId, /^media_[a-f0-9]{64}$/u);
const voicePath = core.friendChatVoiceStoragePath({ conversationId: "direct_123", messageId: mediaMessageId, reservationId: mediaReservationId });
const imagePaths = core.friendChatImageStoragePaths({ conversationId: "direct_123", messageId: mediaMessageId, reservationId: mediaReservationId });
assert.equal(voicePath, `friendChatMedia/direct_123/${mediaMessageId}/${mediaReservationId}/voice.m4a`);
assert.equal(imagePaths.fullPath, `friendChatMedia/direct_123/${mediaMessageId}/${mediaReservationId}/image.jpg`);
assert.equal(imagePaths.thumbnailPath, `friendChatMedia/direct_123/${mediaMessageId}/${mediaReservationId}/thumbnail.jpg`);
assert.deepEqual(core.parseFriendChatMediaStoragePath(imagePaths.thumbnailPath), {
  conversationId: "direct_123",
  fileName: "thumbnail.jpg",
  kind: "thumbnail",
  messageId: mediaMessageId,
  reservationId: mediaReservationId,
});
assert.deepEqual(core.validateFriendChatVoiceMetadata({ durationMilliseconds: 120_000, mimeType: "audio/mp4", sizeBytes: 3 * 1024 * 1024 }), {
  durationMilliseconds: 120_000,
  mimeType: "audio/mp4",
  sizeBytes: 3 * 1024 * 1024,
});
assert.throws(() => core.validateFriendChatVoiceMetadata({ durationMilliseconds: 120_001, mimeType: "audio/mp4", sizeBytes: 1 }));
assert.throws(() => core.validateFriendChatVoiceMetadata({ durationMilliseconds: 1000, mimeType: "audio/wav", sizeBytes: 1 }));
const validImage = {
  main: { height: 900, mimeType: "image/jpeg", sizeBytes: 2_000_000, width: 1600 },
  sourceMimeType: "image/png",
  sourceSizeBytes: 5 * 1024 * 1024,
  thumbnail: { height: 288, mimeType: "image/jpeg", sizeBytes: 100_000, width: 512 },
};
assert.deepEqual(core.validateFriendChatImageMetadata(validImage), validImage);
assert.throws(() => core.validateFriendChatImageMetadata({ ...validImage, sourceMimeType: "image/gif" }));
assert.throws(() => core.validateFriendChatImageMetadata({ ...validImage, sourceSizeBytes: (5 * 1024 * 1024) + 1 }));
assert.throws(() => core.validateFriendChatImageMetadata({ ...validImage, main: { ...validImage.main, width: 1601 } }));
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
assert.equal(errorCore.mapFriendChatError(chatError("functions/resource-exhausted", "Please wait a moment")), "rateLimited");

let fullCancelCalls = 0;
let thumbnailCancelCalls = 0;
assert.deepEqual(uploadCancellation.cancelFriendChatImageUploadTasks(
  { cancel: () => { fullCancelCalls += 1; return true; } },
  { cancel: () => { thumbnailCancelCalls += 1; return true; } },
), { canceled: true, errors: 0, full: true, thumbnail: true });
assert.equal(fullCancelCalls, 1, "full-size upload cancel must be attempted");
assert.equal(thumbnailCancelCalls, 1, "thumbnail upload cancel must be attempted even when full cancel succeeds");
assert.deepEqual(uploadCancellation.cancelFriendChatImageUploadTasks(
  { cancel: () => false },
  { cancel: () => true },
), { canceled: true, errors: 0, full: false, thumbnail: true });
assert.deepEqual(uploadCancellation.cancelFriendChatImageUploadTasks(
  { cancel: () => { throw new Error("native cancel failed"); } },
  null,
), { canceled: false, errors: 1, full: false, thumbnail: false });

const service = read("services", "chatService.ts");
const functionsSource = read("functions", "src", "friendChat.ts");
const accountStanding = read("functions", "src", "accountStanding.ts");
const chatScreen = read("app", "(social)", "chat", "[chatId].tsx");
const chatList = read("app", "(social)", "chat", "index.tsx");
const imageService = read("services", "friendChatImageService.ts");
const imageMessage = read("components", "FriendChatImageMessage.tsx");
const actionsModal = read("components", "MessageActionsModal.tsx");
const voiceComposer = read("components", "VoiceMemoComposer.tsx");
const localUserState = read("services", "localUserStateService.ts");
const imageCacheService = read("services", "friendChatImageCacheService.ts");
const standingContext = read("context", "AccountStandingContext.tsx");
const accountDeletion = read("functions", "src", "accountDeletion.ts");
const notificationCore = read("utils", "notificationCore.ts");
const rules = read("firestore.rules");
const storageRules = read("storage.rules");
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
for (const callable of [
  "createFriendChatVoiceUpload",
  "finalizeFriendChatVoiceMessage",
  "createFriendChatImageUpload",
  "finalizeFriendChatImageMessage",
  "toggleFriendChatReaction",
  "setFriendChatMessagesStarred",
  "deleteFriendChatMessagesForMe",
  "forwardFriendChatMessages",
  "pinFriendChatMessage",
  "unpinFriendChatMessage",
  "getFriendChatMediaDownloadUrl",
  "streamFriendChatMedia",
  "cleanupAbandonedFriendChatMediaUploads",
]) {
  assert.equal(functionsSource.includes(callable), true, `${callable} must remain exported from friend chat Functions`);
}
assert.equal(functionsSource.includes("friendChatMediaPlaybackGrants"), true);
assert.equal(functionsSource.includes("FRIEND_CHAT_MEDIA_SIGNED_URL_MS"), true, "media access should stay short-lived");
assert.equal(functionsSource.includes("friendChatMediaPlaybackGrants"), true, "media streaming should require an authorized playback grant");
assert.equal(functionsSource.includes("friendChatMediaReservationRateLimits"), true, "media reservations must be throttled server-side");
assert.equal(functionsSource.includes("assertMediaReservationThrottle"), true, "media reservations must reject rapid non-idempotent retries");
assert.equal(functionsSource.includes("'resource-exhausted'"), true, "rapid media reservations must surface a retryable rate-limit error");
assert.equal(functionsSource.includes("accountCanCommunicate(userId)"), true, "streaming must revalidate current account standing on every media request");
assert.equal(functionsSource.includes("reactionCounts"), true, "reaction summaries should stay bounded on message documents");
assert.equal(functionsSource.includes("replyTo"), true, "reply metadata must be created by the callable after validating membership and visibility");
assert.equal(functionsSource.includes("forwarded: true"), true, "forwarded messages must be marked without exposing original sender identity");
assert.equal(functionsSource.includes("friendChatForwardRateLimits"), true, "forwarding must be rate limited server-side");
assert.equal(functionsSource.includes("loadForwardImageBytes"), true, "image forwarding must reauthorize and load protected source media server-side");
assert.equal(functionsSource.includes("requestedClientForwardId ?? `legacy_${randomUUID()}`"), true, "installed clients without operation IDs must retain the legacy throttled forwarding path");
assert.equal(functionsSource.includes("canAccessFriendChatMedia(firestore(), userId, source.fullPath)"), true, "source image access must be revalidated before forwarding");
assert.equal(functionsSource.includes("friendChatImageStoragePaths({ conversationId: destination.conversationId"), true, "forwarded images must use destination-specific storage paths");
assert.equal(functionsSource.includes("forwardedFrom: { messageType: plan.source.messageType }"), true, "forward metadata must not reveal the source conversation or sender");
assert.equal(functionsSource.includes("unsupportedMediaMessageIds.push(snapshot.id)"), true, "voice messages must remain unsupported for forwarding");
assert.equal(functionsSource.includes("userMessageStates"), true, "star and delete-for-me state must be private per user");
assert.equal(functionsSource.includes("sendMessagePushes(conversationId, uid, 'image'"), true, "image pushes must use neutral message-type previews");
assert.equal(functionsSource.includes("sendMessagePushes(conversationId, uid, 'voice'"), true, "voice pushes must use neutral message-type previews");
assert.equal(service.includes("uploadBytesResumable"), true);
assert.equal(service.includes("reserveFriendChatImageUpload"), true);
assert.equal(service.includes("reserveFriendChatVoiceUpload"), true);
assert.equal(service.includes("cancelFriendChatImageUploadTasks"), true, "image upload cancel must use the shared dual-task cancel helper");
assert.equal(service.includes("full.task.cancel() || thumbnail.task.cancel()"), false, "short-circuit upload cancellation would skip thumbnail cancel");
assert.equal(service.includes("void full.completion.catch"), true, "failed thumbnail startup must settle the abandoned full upload safely");
assert.equal(service.includes("media_upload_canceled"), true, "cancelled uploads must not finalize and must keep the draft recoverable");
assert.equal(service.includes("loadOwnMessageReactions"), true);
assert.equal(service.includes("loadOwnMessageStates"), true);
assert.equal(service.includes("subscribeToStarredFriendChatMessages"), true);
assert.equal(service.includes("replyToMessageId"), true);
assert.equal(chatScreen.includes("VoiceMemoComposer"), true);
assert.equal(chatScreen.includes("FriendChatImageMessage"), true);
assert.equal(chatScreen.includes("toggleFriendChatReaction"), true);
assert.equal(chatScreen.includes("FriendChatExpandedReactionPicker"), true);
assert.equal(chatScreen.includes("FriendChatSelectionOverflowMenu"), true);
assert.equal(chatScreen.includes("ForwardMessagesSheet"), true);
assert.equal(chatScreen.includes("setFriendChatMessagesStarred"), true);
assert.equal(chatScreen.includes("deleteFriendChatMessagesForMe"), true);
assert.equal(chatScreen.includes("forwardFriendChatMessages"), true);
assert.equal(chatScreen.includes("friendChatSendStatusTranslationKey"), true, "upload and finalization copy must be selected by actual media type");
assert.equal(chatScreen.includes("saveFriendChatPhoto"), true, "photo actions must expose the protected explicit save flow");
assert.equal(chatScreen.includes("pinFriendChatMessage"), true);
assert.equal(read("app", "(social)", "chat", "manage.tsx").includes("/(social)/chat/starred"), true, "chat settings should expose the private Starred Messages view");
assert.equal(read("app", "(social)", "chat", "starred.tsx").includes("subscribeToStarredFriendChatMessages"), true, "Starred Messages view should read only private starred state");
assert.equal(chatScreen.includes("source={{ uri: imageDraft.thumbnail.uri }}"), true, "selected image drafts must show the real local thumbnail");
assert.equal(chatScreen.includes("imageDraftAccessibility"), true, "selected image draft thumbnail keeps an accessible label");
assert.equal(chatScreen.includes("voiceAutoStartKey"), true, "friend chat mic uses one-tap recording without changing shared coach composers");
assert.equal(chatScreen.includes("chat.rateLimited"), true, "friend chat media reservation throttles surface localized copy");
assert.equal(chatScreen.includes("chat.mediaUploadCanceled"), true, "cancelled uploads keep recoverable localized copy");
assert.equal(chatScreen.includes("keyboardVerticalOffset"), false, "friend chat composer must not use device-specific keyboard offsets");
assert.equal(voiceComposer.includes("autoStartKey"), true, "VoiceMemoComposer exposes optional auto-start for friend chat");
assert.equal(voiceComposer.includes("void startRecording()"), true, "auto-start uses the same guarded start path as the manual record button");
assert.equal(voiceComposer.includes("voiceMemo.limitReached"), true, "max-duration auto-stop explains why recording ended");
assert.equal(chatList.includes("chat.photoPreview"), true);
assert.equal(chatList.includes("chat.voicePreview"), true);
assert.equal(imageService.includes("launchImageLibraryAsync"), true);
assert.equal(imageService.includes("getPendingResultAsync"), true, "Android activity recreation must recover Expo's pending picker result");
assert.equal(imageService.includes("rememberFriendChatImagePickerReturn"), true, "the picker must persist a short-lived exact-chat return intent before launch");
assert.equal(imageService.includes("activePickerOperations"), true, "repeated lifecycle observers must share one picker operation");
assert.equal(imageService.includes("allowsMultipleSelection: false"), true);
assert.equal(imageService.includes("exif: false"), true);
assert.equal(imageService.includes("FRIEND_CHAT_IMAGE_SOURCE_LIMIT_BYTES"), true);
assert.equal(imageMessage.includes("getFriendChatMediaDownloadUrl"), true);
assert.equal(imageMessage.includes("onPress={handlePress}"), true, "single-tap photo actions must replace immediate viewer navigation");
assert.equal(imageMessage.includes("onLongPress={handleLongPress}"), true, "photo long press must remain wired to reactions and selection");
assert.equal(actionsModal.includes("chat.reactions"), true);
assert.equal(accountDeletion.includes("friendChatMediaStoragePaths"), true);
assert.equal(accountStanding.includes("friendChatUploadReservations"), true, "account-standing cleanup must revoke pending friend media uploads");
assert.equal(accountStanding.includes("friendChatMediaPlaybackGrants"), true, "account-standing cleanup must revoke friend media playback grants");
assert.equal(accountStanding.includes('status: "deletePending"'), true, "restricted pending friend media must be marked for cleanup");
assert.equal(localUserState.includes("clearProtectedMediaMemoryState"), true, "restricted local cleanup must include protected media caches");
assert.equal(imageCacheService.includes("clearMemoryCache"), true, "friend image cache cleanup must clear expo-image memory cache when available");
assert.equal(standingContext.includes('next.status === "messagingRestricted"'), true, "messaging restriction should clear protected media without wiping auth state");
assert.equal(notificationCore.includes('"friendChatMessage"'), true);
assert.equal(rules.includes("allow create, update, delete: if false;"), true);
assert.equal(rules.includes("match /reactions/{userId}"), true);
assert.equal(rules.includes("match /friendChatUploadReservations/{reservationId}"), true);
assert.equal(rules.includes("match /userMessageStates/{userId}/messages/{messageId}"), true);
assert.equal(rules.includes("match /friendChatForwardRateLimits/{userHash}"), true);
assert.equal(rules.includes("match /friendChatMediaPlaybackGrants/{grantId}"), true);
assert.equal(storageRules.includes("match /friendChatMedia/{conversationId}/{messageId}/{reservationId}/voice.m4a"), true);
assert.equal(storageRules.includes("match /friendChatMedia/{conversationId}/{messageId}/{reservationId}/image.jpg"), true);
assert.equal(storageRules.includes("match /friendChatMedia/{conversationId}/{messageId}/{reservationId}/thumbnail.jpg"), true);
assert.equal(storageRules.includes("allow read, update, delete: if false;"), true);
for (const projection of ["activeParticipantIds", "invitedParticipantIds"]) {
  assert.ok(indexes.indexes.some((index) => index.collectionGroup === "friendConversations" && index.fields.some((field) => field.fieldPath === projection && field.arrayConfig === "CONTAINS")), `missing ${projection} index`);
}
assert.ok(indexes.indexes.some((index) => index.collectionGroup === "messages" && index.fields.some((field) => field.fieldPath === "visibleToUserIds" && field.arrayConfig === "CONTAINS")), "missing visibleToUserIds message index");
assert.ok(indexes.indexes.some((index) => index.collectionGroup === "friendChatUploadReservations" &&
  index.queryScope === "COLLECTION" &&
  JSON.stringify(index.fields) === JSON.stringify([
    { fieldPath: "status", order: "ASCENDING" },
    { fieldPath: "expiresAt", order: "ASCENDING" },
  ])), "missing friendChatUploadReservations status/expiresAt cleanup index");
assert.match(
  functionsSource,
  /collection\('friendChatUploadReservations'\)[\s\S]*where\('status', '==', 'pending'\)[\s\S]*where\('expiresAt', '<=', Timestamp\.now\(\)\)/u,
  "cleanup query must match the configured friendChatUploadReservations index",
);
console.log("Friend Chat identity, media validation, reactions, bounded-read, idempotency, safety, route-removal, protected media, and index tests passed.");
