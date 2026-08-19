"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

function loadTypeScript(relativePath, requireModule = require) {
  const filename = path.join(root, relativePath);
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", "__DEV__", output)(
    loaded,
    loaded.exports,
    requireModule,
    false,
  );
  return loaded.exports;
}

const resumeCore = loadTypeScript("utils/friendChatImagePickerResumeCore.ts");
const imageProfile = loadTypeScript("constants/friendChatImageProfile.ts");
const storage = new Map();
const asyncStorage = {
  getItem: async (key) => storage.get(key) ?? null,
  removeItem: async (key) => { storage.delete(key); },
  setItem: async (key, value) => { storage.set(key, value); },
};
const resumeService = loadTypeScript("services/systemRouteResumeService.ts", (name) => {
  if (name === "@react-native-async-storage/async-storage") return asyncStorage;
  if (name === "@/utils/friendChatImagePickerResumeCore") return resumeCore;
  throw new Error(`Unexpected resume-service import: ${name}`);
});

const directContext = { conversationId: "direct_conversation_123", uid: "user_parent_123" };
const groupContext = { conversationId: "group_conversation_456", uid: "user_parent_123" };
const operationId = "picker_operation_123456";
const pickerReturnKey = "sidelineSocial.friendChatImagePickerReturn.v1";
const pickerHandoffKey = "sidelineSocial.friendChatImagePickerHandoff.v1";
const now = Date.now();

for (const context of [directContext, groupContext]) {
  const intent = resumeCore.createFriendChatImagePickerReturnIntent({
    ...context,
    now,
    operationId,
  });
  assert.equal(intent.phase, "launched");
  assert.deepEqual(resumeCore.parseFriendChatImagePickerReturnIntent(JSON.stringify(intent), now), intent);
  assert.equal(resumeCore.isFriendChatImagePickerReturnForContext(intent, context), true);
  assert.equal(resumeCore.isFriendChatImagePickerReturnForContext(intent, {
    ...context,
    conversationId: `${context.conversationId}_other`,
  }), false);
}

const expiringIntent = resumeCore.createFriendChatImagePickerReturnIntent({
  ...directContext,
  now,
  operationId,
});
assert.equal(
  resumeCore.parseFriendChatImagePickerReturnIntent(JSON.stringify(expiringIntent), expiringIntent.expiresAt),
  null,
  "Expired picker returns must not restore a chat.",
);
assert.equal(resumeCore.parseFriendChatImagePickerReturnIntent(JSON.stringify({
  ...expiringIntent,
  route: "/(tabs)",
}), now), null, "Only the exact allowlisted chat route is accepted.");
assert.equal(JSON.stringify(expiringIntent).includes("uri"), false);
assert.equal(JSON.stringify(expiringIntent).includes("token"), false);

let launchResult = null;
let pendingResult = null;
let pendingPromise = null;
let processingPromise = null;
let launchCalls = 0;
let pendingCalls = 0;
let processedCount = 0;
let processedSizeQueue = [];
const deletedUris = [];
const imagePicker = {
  getPendingResultAsync: async () => {
    pendingCalls += 1;
    return pendingPromise ?? pendingResult;
  },
  launchImageLibraryAsync: async () => {
    launchCalls += 1;
    return launchResult;
  },
};
const imageManipulator = {
  SaveFormat: { JPEG: "jpeg" },
  manipulateAsync: async (_uri, actions) => {
    if (processingPromise) await processingPromise;
    processedCount += 1;
    const resize = actions[0]?.resize ?? {};
    const width = resize.width ?? (resize.height ? Math.round(resize.height * (4 / 3)) : 1200);
    const height = resize.height ?? (resize.width ? Math.round(resize.width * (3 / 4)) : 800);
    return {
      height,
      uri: `file:///cache/processed-${processedCount}.jpg`,
      width,
    };
  },
};
const fileSystem = {
  deleteAsync: async (uri) => { deletedUris.push(uri); },
  getInfoAsync: async () => ({ exists: true, size: processedSizeQueue.length ? processedSizeQueue.shift() : 64_000 }),
};
const imageService = loadTypeScript("services/friendChatImageService.ts", (name) => {
  if (name === "@react-native-async-storage/async-storage") return asyncStorage;
  if (name === "react-native") return { Platform: { OS: "android" } };
  if (name === "expo-file-system/legacy") return fileSystem;
  if (name === "@/services/systemRouteResumeService") return resumeService;
  if (name === "@/utils/friendChatImagePickerResumeCore") return resumeCore;
  if (name === "@/constants/friendChatImageProfile") return imageProfile;
  if (name === "@/utils/performanceDiagnostics") return { measureDevelopmentPerformance: (_name, operation) => operation() };
  if (name === "expo-image-picker") return imagePicker;
  if (name === "expo-image-manipulator") return imageManipulator;
  throw new Error(`Unexpected image-service import: ${name}`);
});

function selectedAsset(uri = "content://selected-photo") {
  return {
    assets: [{
      fileName: "photo.jpg",
      fileSize: 256_000,
      height: 2400,
      mimeType: "image/jpeg",
      uri,
      width: 3200,
    }],
    canceled: false,
  };
}

async function tick() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function resetPickerState() {
  await imageService.clearFriendChatImagePickerLocalState();
  storage.clear();
  launchResult = null;
  pendingResult = null;
  pendingPromise = null;
  processingPromise = null;
  launchCalls = 0;
  pendingCalls = 0;
  processedCount = 0;
  processedSizeQueue = [];
  deletedUris.length = 0;
}

async function acknowledge(context, result) {
  assert.equal(await imageService.claimFriendChatImagePickerResult(context, result.operationId), true);
  assert.equal(
    await imageService.claimFriendChatImagePickerResult(context, result.operationId),
    false,
    "Only one component may claim an operation.",
  );
  assert.equal(await imageService.acknowledgeFriendChatImagePickerResult(context, result.operationId), true);
  assert.equal(await resumeService.readFriendChatImagePickerReturn(context.uid), null);
  assert.equal(storage.has(pickerHandoffKey), false);
}

async function run() {
  // Exact physical-device ordering: processing finishes, the original chat is gone,
  // root still sees the intent, and the remounted chat consumes the completed draft.
  await resetPickerState();
  launchResult = selectedAsset();
  const selected = await imageService.pickFriendChatImageDraft(directContext);
  assert.equal(selected.status, "selected");
  assert.equal(selected.draft.sourceSizeBytes, 256_000);
  assert.equal(selected.draft.mediaProfileVersion, 2);
  assert.equal(processedCount, 2, "The existing full and thumbnail processing path remains intact.");
  assert.equal((await resumeService.readFriendChatImagePickerReturn(directContext.uid)).phase, "draft-ready");
  assert.equal(storage.has(pickerHandoffKey), true, "Draft-ready does not clear the return intent or handoff.");
  const rootReturn = await imageService.readFriendChatImagePickerNavigationReturn(directContext.uid);
  assert.equal(rootReturn.conversationId, directContext.conversationId);
  const restored = await imageService.recoverFriendChatImageDraft(directContext);
  assert.equal(restored.status, "selected");
  assert.equal(restored.operationId, selected.operationId);
  assert.equal(pendingCalls, 0, "A completed handoff prevents a second native pending-result read.");
  await acknowledge(directContext, restored);
  assert.equal(deletedUris.length, 0, "Acknowledgment transfers the local files to the visible draft instead of deleting them.");

  // The normal path stays local to the still-mounted originating chat.
  await resetPickerState();
  launchResult = selectedAsset("content://still-mounted-photo");
  const mountedChatResult = await imageService.pickFriendChatImageDraft(directContext);
  assert.equal(mountedChatResult.status, "selected");
  assert.equal(pendingCalls, 0);
  await acknowledge(directContext, mountedChatResult);

  // Oversized outputs step through quality in a bounded order and delete rejected candidates.
  await resetPickerState();
  launchResult = selectedAsset("content://iterative-photo");
  processedSizeQueue = [1_200_000, 900_000, 130_000, 100_000];
  const iterativeResult = await imageService.pickFriendChatImageDraft(directContext);
  assert.equal(iterativeResult.status, "selected");
  assert.equal(processedCount, 4);
  assert.equal(deletedUris.length, 2, "each rejected encoded candidate is removed immediately");
  await acknowledge(directContext, iterativeResult);

  await resetPickerState();
  launchResult = selectedAsset("content://uncompressible-photo");
  processedSizeQueue = Array(12).fill(1_200_000);
  const uncompressibleResult = await imageService.pickFriendChatImageDraft(directContext);
  assert.equal(uncompressibleResult.status, "failed");
  assert.equal(uncompressibleResult.errorCode, "image_processing_too_large");
  assert.equal(processedCount, 12, "compression cannot loop beyond the centralized attempt schedule");
  assert.equal(deletedUris.length, 12, "all unsuccessful temporary encodes are removed");
  await acknowledge(directContext, uncompressibleResult);

  // The restored chat can mount while image processing is still running and joins the active operation.
  await resetPickerState();
  launchResult = selectedAsset("content://slow-photo");
  let finishProcessing;
  processingPromise = new Promise((resolve) => { finishProcessing = resolve; });
  const originalOperation = imageService.pickFriendChatImageDraft(groupContext);
  await tick();
  await tick();
  const processingReturn = await imageService.readFriendChatImagePickerNavigationReturn(groupContext.uid);
  assert.equal(processingReturn.conversationId, groupContext.conversationId);
  const restoredDuringProcessing = imageService.recoverFriendChatImageDraft(groupContext);
  await tick();
  assert.equal(pendingCalls, 0, "An active operation wins before getPendingResultAsync.");
  finishProcessing();
  const [originalResult, remountedResult] = await Promise.all([originalOperation, restoredDuringProcessing]);
  assert.strictEqual(originalResult, remountedResult);
  assert.equal(remountedResult.status, "selected");
  await acknowledge(groupContext, remountedResult);

  // Cancellation and recoverable failure both restore and remain outstanding until consumed.
  await resetPickerState();
  launchResult = { assets: null, canceled: true };
  const cancelled = await imageService.pickFriendChatImageDraft(directContext);
  assert.equal(cancelled.status, "cancelled");
  assert.ok(await imageService.readFriendChatImagePickerNavigationReturn(directContext.uid));
  assert.equal((await imageService.recoverFriendChatImageDraft(directContext)).status, "cancelled");
  await acknowledge(directContext, cancelled);

  await resetPickerState();
  launchResult = { code: "E_PICKER", message: "private native detail" };
  const failed = await imageService.pickFriendChatImageDraft(directContext);
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorCode, "image_picker_failed");
  assert.equal(JSON.stringify(failed).includes("private native detail"), false);
  assert.ok(await imageService.readFriendChatImagePickerNavigationReturn(directContext.uid));
  assert.equal((await imageService.recoverFriendChatImageDraft(directContext)).status, "failed");
  await acknowledge(directContext, failed);

  // A killed activity uses Expo's pending result once, then the persisted handoff.
  await resetPickerState();
  await resumeService.rememberFriendChatImagePickerReturn({
    ...groupContext,
    operationId: "pending_group_picker_123",
  });
  pendingResult = selectedAsset("content://recovered-group-photo");
  const recovered = await imageService.recoverFriendChatImageDraft(groupContext);
  assert.equal(recovered.status, "selected");
  assert.equal(pendingCalls, 1);
  assert.equal((await imageService.recoverFriendChatImageDraft(groupContext)).operationId, recovered.operationId);
  assert.equal(pendingCalls, 1);
  await acknowledge(groupContext, recovered);

  // Concurrent recovery observers share one pending call and one claim.
  await resetPickerState();
  await resumeService.rememberFriendChatImagePickerReturn({
    ...directContext,
    operationId: "duplicate_picker_result_123",
  });
  let resolvePending;
  pendingPromise = new Promise((resolve) => { resolvePending = resolve; });
  const firstRecovery = imageService.recoverFriendChatImageDraft(directContext);
  await tick();
  const duplicateRecovery = imageService.recoverFriendChatImageDraft(directContext);
  await tick();
  assert.equal(pendingCalls, 1);
  resolvePending(selectedAsset("content://single-result"));
  const [firstResult, duplicateResult] = await Promise.all([firstRecovery, duplicateRecovery]);
  assert.strictEqual(firstResult, duplicateResult);
  await acknowledge(directContext, firstResult);

  // Chat A's result is neither consumed nor attached by chat B.
  await resetPickerState();
  await resumeService.rememberFriendChatImagePickerReturn({
    ...directContext,
    operationId: "conversation_guard_12345",
  });
  pendingResult = selectedAsset("content://chat-a-only");
  assert.deepEqual(await imageService.recoverFriendChatImageDraft(groupContext), { status: "none" });
  assert.equal(pendingCalls, 0);
  const chatAResult = await imageService.recoverFriendChatImageDraft(directContext);
  assert.equal(chatAResult.status, "selected");
  assert.equal(await imageService.claimFriendChatImagePickerResult(groupContext, chatAResult.operationId), false);
  await acknowledge(directContext, chatAResult);

  // Revoked membership discards the handoff and its temporary processed files.
  await resetPickerState();
  launchResult = selectedAsset("content://revoked-member-photo");
  const revokedResult = await imageService.pickFriendChatImageDraft(groupContext);
  assert.equal(revokedResult.status, "selected");
  assert.equal(await imageService.discardFriendChatImagePickerOperation(groupContext, revokedResult.operationId), true);
  assert.equal(await imageService.readFriendChatImagePickerNavigationReturn(groupContext.uid), null);
  assert.equal(deletedUris.length, 2);

  // Sign-out/user mismatch clears records and temporary files.
  await resetPickerState();
  launchResult = selectedAsset("content://signed-out-photo");
  assert.equal((await imageService.pickFriendChatImageDraft(directContext)).status, "selected");
  assert.equal(await imageService.readFriendChatImagePickerNavigationReturn("different_user_456"), null);
  assert.equal(storage.has(pickerReturnKey), false);
  assert.equal(storage.has(pickerHandoffKey), false);
  assert.equal(deletedUris.length, 2);

  // An expired persisted handoff is removed with its local files.
  await resetPickerState();
  const oldNow = Date.now() - resumeCore.FRIEND_CHAT_IMAGE_PICKER_RETURN_TTL_MS - 100;
  const expiredIntent = resumeCore.createFriendChatImagePickerReturnIntent({
    ...directContext,
    now: oldNow,
    operationId: "expired_picker_handoff_123",
  });
  const expiredHandoff = resumeCore.createFriendChatImagePickerHandoff(expiredIntent, {
    draft: {
      full: { height: 800, mimeType: "image/jpeg", sizeBytes: 128_000, uri: "file:///cache/expired-full.jpg", width: 1200 },
      mediaProfileVersion: 2,
      sourceMimeType: "image/jpeg",
      sourceSizeBytes: 256_000,
      thumbnail: { height: 400, mimeType: "image/jpeg", sizeBytes: 64_000, uri: "file:///cache/expired-thumb.jpg", width: 512 },
    },
    status: "selected",
  }, oldNow + 10);
  storage.set(pickerReturnKey, JSON.stringify(expiredIntent));
  storage.set(pickerHandoffKey, JSON.stringify(expiredHandoff));
  assert.equal(await imageService.readFriendChatImagePickerNavigationReturn(directContext.uid), null);
  assert.deepEqual(deletedUris.sort(), ["file:///cache/expired-full.jpg", "file:///cache/expired-thumb.jpg"].sort());

  // Clearing state while processing makes the delayed result stale instead of recreating a handoff.
  await resetPickerState();
  launchResult = selectedAsset("content://stale-photo");
  let finishStaleProcessing;
  processingPromise = new Promise((resolve) => { finishStaleProcessing = resolve; });
  const staleOperation = imageService.pickFriendChatImageDraft(directContext);
  await tick();
  await tick();
  await imageService.clearFriendChatImagePickerLocalState();
  finishStaleProcessing();
  assert.equal((await staleOperation).status, "stale");
  assert.equal(storage.has(pickerHandoffKey), false);

  // The independent Squad permission-return record remains untouched.
  await resetPickerState();
  await resumeService.rememberSquadSystemReturn();
  const squadRaw = storage.get("sidelineSocial.systemRouteResume");
  assert.equal(await imageService.readFriendChatImagePickerNavigationReturn(directContext.uid), null);
  assert.equal(storage.get("sidelineSocial.systemRouteResume"), squadRaw);
  assert.equal(await resumeService.consumeSystemReturnRoute(), "/(tabs)/squad");

  const imageSource = read("services", "friendChatImageService.ts");
  const chatSource = read("app", "(social)", "chat", "[chatId].tsx");
  const rootSource = read("app", "index.tsx");
  const gateSource = read("components", "AuthenticatedRouteGate.tsx");
  const pickerStart = chatSource.indexOf("const pickImage = useCallback");
  const sendStart = chatSource.indexOf("const send = useCallback", pickerStart);
  const pickerFlow = chatSource.slice(pickerStart, sendStart);
  const operationStart = imageSource.indexOf("function runPickerOperation");
  const operationEnd = imageSource.indexOf("async function completePickerSelection", operationStart);
  assert.match(imageSource, /getPendingResultAsync/);
  assert.match(imageSource, /completedPickerOperations/);
  assert.match(imageSource, /FRIEND_CHAT_IMAGE_PICKER_HANDOFF_KEY/);
  assert.doesNotMatch(
    imageSource.slice(operationStart, operationEnd),
    /clearFriendChatImagePickerReturn/,
    "Picker completion must not clear the return intent before chat acknowledgment.",
  );
  assert.match(chatSource, /claimFriendChatImagePickerResult/);
  assert.match(chatSource, /acknowledgeFriendChatImagePickerResult/);
  assert.match(chatSource, /discardFriendChatImagePickerOperation/);
  assert.match(chatSource, /source=\{\{ uri: imageDraft\.thumbnail\.uri \}\}/);
  assert.doesNotMatch(pickerFlow, /reserveFriendChatImageUpload|uploadReservedFriendChatImage|finalizeFriendChatImageMessage/);

  const pickerRouteIndex = rootSource.indexOf("readFriendChatImagePickerNavigationReturn(user.uid)");
  const notificationIndex = rootSource.indexOf("getPendingNotificationOpenTarget({ activeMode })", pickerRouteIndex);
  const homeIndex = rootSource.indexOf('router.replace("/(tabs)")', notificationIndex);
  assert.ok(pickerRouteIndex >= 0 && notificationIndex > pickerRouteIndex);
  assert.ok(homeIndex > notificationIndex);
  assert.match(rootSource.slice(pickerRouteIndex, notificationIndex), /readFriendChatImagePickerNavigationReturn/);
  assert.match(rootSource.slice(pickerRouteIndex, notificationIndex), /getFriendConversationAccess/);
  assert.match(rootSource.slice(pickerRouteIndex, notificationIndex), /pathname: imagePickerReturn\.route/);
  assert.doesNotMatch(rootSource.slice(pickerRouteIndex, notificationIndex), /router\.replace\("\/\(tabs\)"/);
  assert.match(gateSource, /if \(loading\)/);

  for (const event of ["launched", "draft-ready", "restoring-authorized-chat", "draft-consumed"]) {
    assert.equal(`${imageSource}\n${rootSource}`.includes(event), true);
  }
  assert.doesNotMatch(imageSource, /console\.(?:info|log)\([^\n]*(?:uid|conversationId|filename|uri)/i);

  console.log("Friend-chat image-picker acknowledged handoff, routing race, cleanup, and exact-conversation checks passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
