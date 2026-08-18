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

const saveCore = loadTypeScript("utils/friendChatPhotoSaveCore.ts");
const sendStatusCore = loadTypeScript("utils/friendChatSendStatusCore.ts");
const input = {
  conversationId: "direct_test",
  messageId: "message_test",
  storagePath: "friendChatMedia/direct_test/message_test/media_test/image.jpg",
  uid: "user_test",
};

function makeDependencies(overrides = {}) {
  const calls = { authorize: 0, cleanup: 0, download: 0, permission: 0, request: 0, save: 0, url: 0 };
  const dependencies = {
    authorize: async () => { calls.authorize += 1; return true; },
    cleanup: async () => { calls.cleanup += 1; },
    createTemporaryUri: () => "file:///private/cache/friend-chat-photo.jpg",
    download: async () => { calls.download += 1; return { status: 200 }; },
    getDownloadUrl: async () => { calls.url += 1; return "https://protected.example.test/photo"; },
    getPermission: async () => { calls.permission += 1; return { canAskAgain: true, granted: true }; },
    requestPermission: async () => { calls.request += 1; return { canAskAgain: true, granted: true }; },
    save: async () => { calls.save += 1; },
    ...overrides,
  };
  return { calls, dependencies };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof saveCore.FriendChatPhotoSaveError && error.code === code);
}

async function run() {
  assert.equal(sendStatusCore.friendChatSendStatusTranslationKey({ mediaType: "image", phase: "uploading" }), "chat.uploadingPhoto");
  assert.equal(sendStatusCore.friendChatSendStatusTranslationKey({ mediaType: "image", phase: "finalizing" }), "chat.finalizingPhoto");
  assert.equal(sendStatusCore.friendChatSendStatusTranslationKey({ mediaType: "voice", phase: "uploading" }), "voiceMemo.uploading");
  assert.equal(sendStatusCore.friendChatSendStatusTranslationKey({ mediaType: "voice", phase: "finalizing" }), "voiceMemo.finalizing");

  const success = makeDependencies();
  assert.deepEqual(await saveCore.createFriendChatPhotoSaver(success.dependencies)(input), { status: "saved" });
  assert.equal(success.calls.authorize, 2, "membership and standing are revalidated after the protected download");
  assert.equal(success.calls.url, 2, "message and media authorization are revalidated immediately before saving");
  assert.equal(success.calls.save, 1);
  assert.equal(success.calls.cleanup, 1, "the private temporary file is always deleted");

  const unauthorized = makeDependencies({ authorize: async () => false });
  await expectCode(saveCore.createFriendChatPhotoSaver(unauthorized.dependencies)(input), "photo_save_unavailable");
  assert.equal(unauthorized.calls.save, 0);

  let authorizationCheck = 0;
  const revoked = makeDependencies({ authorize: async () => { authorizationCheck += 1; return authorizationCheck === 1; } });
  await expectCode(saveCore.createFriendChatPhotoSaver(revoked.dependencies)(input), "photo_save_unavailable");
  assert.equal(revoked.calls.save, 0, "a photo is not saved after access is revoked during download");
  assert.equal(revoked.calls.cleanup, 1);

  let mediaAuthorizationCheck = 0;
  const removedDuringDownload = makeDependencies({
    getDownloadUrl: async () => {
      mediaAuthorizationCheck += 1;
      if (mediaAuthorizationCheck > 1) throw Object.assign(new Error("removed"), { code: "functions/not-found" });
      return "https://protected.example.test/photo";
    },
  });
  await expectCode(saveCore.createFriendChatPhotoSaver(removedDuringDownload.dependencies)(input), "photo_save_unavailable");
  assert.equal(removedDuringDownload.calls.save, 0, "removed media is never written to the device library");
  assert.equal(removedDuringDownload.calls.cleanup, 1);

  const denied = makeDependencies({
    getPermission: async () => ({ canAskAgain: true, granted: false }),
    requestPermission: async () => ({ canAskAgain: true, granted: false }),
  });
  await expectCode(saveCore.createFriendChatPhotoSaver(denied.dependencies)(input), "photo_save_permission_denied");

  const permanentlyDenied = makeDependencies({
    getPermission: async () => ({ canAskAgain: false, granted: false }),
  });
  await expectCode(saveCore.createFriendChatPhotoSaver(permanentlyDenied.dependencies)(input), "photo_save_permission_permanently_denied");

  const unavailable = makeDependencies({ download: async () => ({ status: 403 }) });
  await expectCode(saveCore.createFriendChatPhotoSaver(unavailable.dependencies)(input), "photo_save_unavailable");
  assert.equal(unavailable.calls.cleanup, 1);

  const network = makeDependencies({ download: async () => { throw new Error("network timeout"); } });
  await expectCode(saveCore.createFriendChatPhotoSaver(network.dependencies)(input), "photo_save_network");
  assert.equal(network.calls.cleanup, 1);

  const saveFailure = makeDependencies({ save: async () => { throw new Error("native save failed"); } });
  await expectCode(saveCore.createFriendChatPhotoSaver(saveFailure.dependencies)(input), "photo_save_failed");
  assert.equal(saveFailure.calls.cleanup, 1);

  let releaseDownload;
  const deferred = makeDependencies({
    download: () => new Promise((resolve) => { releaseDownload = resolve; }),
  });
  const save = saveCore.createFriendChatPhotoSaver(deferred.dependencies);
  const first = save(input);
  await Promise.resolve();
  await Promise.resolve();
  await expectCode(save(input), "photo_save_in_progress");
  releaseDownload({ status: 200 });
  await first;
  assert.equal(deferred.calls.save, 1, "duplicate taps cannot create duplicate library saves");

  const imageMessage = read("components", "FriendChatImageMessage.tsx");
  const imageViewer = read("components", "FriendChatImageViewer.tsx");
  const chatScreen = read("app", "(social)", "chat", "[chatId].tsx");
  const saveService = read("services", "friendChatPhotoSaveService.ts");
  const functionsSource = read("functions", "src", "friendChat.ts");
  const appConfig = read("app.config.js");
  const translations = read("i18n", "index.ts");

  assert.match(imageMessage, /onPress=\{handlePress\}/);
  assert.match(imageMessage, /onLongPress=\{handleLongPress\}/);
  assert.match(imageMessage, /lastLongPressAtRef/);
  assert.match(imageMessage, /onUnavailableRef\.current\(\)/, "failed protected-thumbnail access must disable parent forwarding actions");
  assert.doesNotMatch(imageMessage, /styles\.actionSheet|function PhotoAction|actionMenuVisible/, "single-tap image handling must not open the removed photo-actions bottom sheet");
  assert.match(imageMessage, /chat\.viewPhoto/);
  assert.match(imageMessage, /name: "reactToPhoto"/);
  assert.match(imageMessage, /name: "morePhotoActions"/);
  assert.match(imageViewer, /getFriendChatMediaDownloadUrl/);
  assert.match(imageViewer, /chat\.forwardPhoto/);
  assert.match(imageViewer, /chat\.savePhoto/);
  assert.match(imageViewer, /chat\.morePhotoActions/);
  assert.match(imageViewer, /Gesture\.Pinch\(\)/);
  assert.match(imageViewer, /Gesture\.Pan\(\)/);
  assert.match(chatScreen, /onLongPress=\{openReactionTray\}/);
  assert.match(chatScreen, /FriendChatExpandedReactionPicker/);
  assert.match(chatScreen, /MessageActionsModal/);
  assert.match(chatScreen, /isFriendChatMessageForwardable/);
  assert.match(chatScreen, /message\.messageType === "image"/);
  assert.match(chatScreen, /message\.messageType === "voice"/);
  assert.match(chatScreen, /photoSaveInFlightRef/);
  assert.match(chatScreen, /unavailableImageMessageIds/);
  assert.match(chatScreen, /onImageUnavailable=\{\(\) => markImageUnavailable\(item\.messageId\)\}/);
  assert.match(saveService, /require\("expo-media-library\/legacy"\)/, "native media library loading stays deferred and statically bundleable");
  assert.match(saveService, /getPermissionsAsync\(true, \["photo"\]\)/, "Save Photo requests write-only photo permission");
  assert.match(saveService, /getFriendChatMediaDownloadUrl/);
  assert.match(saveService, /fetchMyAccountStanding/);
  assert.match(saveService, /getFriendConversationAccess/);
  assert.match(functionsSource, /loadForwardImageBytes/);
  assert.match(functionsSource, /forwardClientMessageIdFor/);
  assert.match(functionsSource, /friendChatImageStoragePaths\(\{ conversationId: destination\.conversationId/);
  assert.match(functionsSource, /forwardedFrom: \{ messageType: plan\.source\.messageType \}/);
  assert.doesNotMatch(functionsSource, /forwardedFrom: \{[^}]*sourceConversationId/u);
  assert.match(appConfig, /NSPhotoLibraryAddUsageDescription/);
  assert.match(appConfig, /android\.permission\.READ_MEDIA_IMAGES/);
  assert.match(appConfig, /blockedPermissions/);

  for (const key of [
    "uploadingPhoto", "finalizingPhoto", "closePhotoViewer", "viewPhoto", "forwardPhoto",
    "savePhoto", "savingPhoto", "photoSavedTitle", "savePhotoBuildRequired",
    "savePhotoPermissionDenied", "savePhotoUnavailable", "savePhotoNetworkError",
  ]) {
    const definitionCount = translations.match(new RegExp(`\\n\\s*${key}:`, "gu"))?.length ?? 0;
    assert.equal(definitionCount, 2, `${key} must be localized in English and Spanish`);
  }

  console.log("Friend Chat image status, actions, secure save, forwarding, localization, and permission contracts passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
