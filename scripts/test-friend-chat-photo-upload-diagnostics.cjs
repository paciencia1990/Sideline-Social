const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function loadTypeScript(relativePath, dependencyOverrides = {}) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const loaded = { exports: {} };
  const scopedRequire = (request) => request in dependencyOverrides
    ? dependencyOverrides[request]
    : require(request);
  new Function("module", "exports", "require", output)(loaded, loaded.exports, scopedRequire);
  return loaded.exports;
}

const diagnostic = loadTypeScript("utils/friendChatPhotoUploadDiagnostic.ts");
const nativeUploadBlob = loadTypeScript("utils/nativeUploadBlob.ts");
const transfer = loadTypeScript("utils/friendChatPhotoUploadTransfer.ts", {
  "./nativeUploadBlob": nativeUploadBlob,
});
const uploadAuth = loadTypeScript("utils/friendChatPhotoUploadAuth.ts");

async function rejected(stage, error) {
  try {
    await diagnostic.withFriendChatPhotoUploadDiagnostic(stage, async () => { throw error; });
    assert.fail("expected rejection");
  } catch (result) {
    return result;
  }
}

(async () => {
  const authenticatedUser = { uid: "approved-user", isAnonymous: false, async getIdToken(forceRefresh) {
    assert.equal(forceRefresh, true);
    return "private-token-not-retained";
  } };
  let currentUser = authenticatedUser;
  await uploadAuth.prepareFriendChatPhotoUploadAuth(() => currentUser, "approved-user");
  await assert.rejects(uploadAuth.prepareFriendChatPhotoUploadAuth(() => null), /photo_upload_auth_missing/u);
  await assert.rejects(uploadAuth.prepareFriendChatPhotoUploadAuth(() => ({ ...authenticatedUser, isAnonymous: true })), /photo_upload_auth_anonymous/u);
  await assert.rejects(uploadAuth.prepareFriendChatPhotoUploadAuth(() => authenticatedUser, "different-user"), /photo_upload_auth_changed/u);
  await assert.rejects(uploadAuth.prepareFriendChatPhotoUploadAuth(() => ({ ...authenticatedUser, async getIdToken() { throw new Error("private"); } })), /photo_upload_auth_refresh_failed/u);
  const switchingUser = { ...authenticatedUser, async getIdToken() { currentUser = { ...authenticatedUser, uid: "changed-user" }; return "private"; } };
  currentUser = switchingUser;
  await assert.rejects(uploadAuth.prepareFriendChatPhotoUploadAuth(() => currentUser, "approved-user"), /photo_upload_auth_changed/u);
  currentUser = authenticatedUser;

  function requestFor(response, event = "load", status = 200) {
    return () => ({
      response, status,
      open(method, uri, async) {
        assert.equal(method, "GET");
        assert.match(uri, /^file:\/\//u);
        assert.equal(async, true);
      },
      send() {
        assert.equal(this.responseType, "blob");
        assert.equal(this.timeout, 30_000);
        this[`on${event}`]();
      },
    });
  }
  const mainBlob = new Blob(["main"], { type: "image/jpeg" });
  const thumbnailBlob = new Blob(["tn"], { type: "image/jpeg" });
  assert.equal(await transfer.readFriendChatPhotoUploadBlob("file:///cache/main.jpg", 4, requestFor(mainBlob)), mainBlob);
  assert.equal(await transfer.readFriendChatPhotoUploadBlob("file:///cache/thumbnail.jpg", 2, requestFor(thumbnailBlob, "load", 0)), thumbnailBlob);
  await assert.rejects(
    transfer.readFriendChatPhotoUploadBlob("content://picker/private", 2, requestFor(thumbnailBlob)),
    /invalid_local_media_uri/u,
  );

  let pairCanceled = 0;
  await transfer.settleFriendChatPhotoUploadPair(Promise.resolve(), Promise.resolve(), () => { pairCanceled++; });
  assert.equal(pairCanceled, 0);
  let finishSibling;
  const delayedSibling = new Promise(resolve => { finishSibling = resolve; });
  const denied = Object.assign(new Error("private"), { code: "storage/unauthorized" });
  const pairFailure = transfer.settleFriendChatPhotoUploadPair(
    Promise.reject(denied),
    delayedSibling,
    () => { pairCanceled++; finishSibling(); },
  );
  await assert.rejects(pairFailure, error => error === denied);
  assert.equal(pairCanceled, 1, "The sibling transfer must be canceled and drained after the first failure");
  let closed = 0;
  mainBlob.close = () => { closed++; };
  await assert.rejects(
    transfer.readFriendChatPhotoUploadBlob("file:///cache/main.jpg", 5, requestFor(mainBlob)),
    /media_upload_size_mismatch/u,
  );
  assert.equal(closed, 1);
  await assert.rejects(
    transfer.readFriendChatPhotoUploadBlob("file:///cache/main.jpg", 4, requestFor(Uint8Array.from([1, 2, 3, 4]))),
    /media_upload_size_mismatch/u,
  );
  for (const [event, message] of [["error", "media_local_read_failed"], ["timeout", "media_local_read_timeout"], ["abort", "media_upload_canceled"]]) {
    await assert.rejects(transfer.readFriendChatPhotoUploadBlob("file:///cache/main.jpg", 4, requestFor(null, event)), new RegExp(message, "u"));
  }
  await assert.rejects(transfer.readFriendChatPhotoUploadBlob("file:///cache/main.jpg", 4, requestFor(mainBlob, "load", 404)), /media_local_read_failed/u);
  assert.equal(closed, 2);
  await assert.rejects(transfer.readFriendChatPhotoUploadBlob("file:///cache/main.jpg", 4, () => ({ open() { throw new Error("private path"); } })), /media_local_read_failed/u);

  function fakeTask({ finalSnapshot, progressSnapshots = [], transferError = null }) {
    return {
      snapshot: finalSnapshot,
      on(_event, next, error, complete) {
        for (const snapshot of progressSnapshots) next(snapshot);
        if (transferError) error(transferError);
        else complete();
      },
    };
  }
  const completedSnapshot = { bytesTransferred: 4, totalBytes: 4, metadata: { contentType: "image/jpeg" } };
  const progress = [];
  await transfer.observeFriendChatUploadTask(fakeTask({
    finalSnapshot: completedSnapshot,
    progressSnapshots: [
      { ...completedSnapshot, bytesTransferred: 1 },
      { ...completedSnapshot, bytesTransferred: 4 },
    ],
  }), 4, "image/jpeg", (value) => progress.push(value));
  assert.deepEqual(progress, [0.25, 1]);
  await assert.rejects(
    transfer.observeFriendChatUploadTask(fakeTask({
      finalSnapshot: completedSnapshot,
      transferError: Object.assign(new Error("denied"), { code: "storage/unauthorized" }),
    }), 4, "image/jpeg"),
    (error) => error.code === "storage/unauthorized",
  );
  await assert.rejects(
    transfer.observeFriendChatUploadTask(fakeTask({
      finalSnapshot: { ...completedSnapshot, totalBytes: 3 },
    }), 4, "image/jpeg"),
    /media_upload_verification_failed/u,
  );

  assert.equal(await diagnostic.withFriendChatPhotoUploadDiagnostic("reservation", async () => "ok"), "ok");

  const cases = [
    ["authentication", new Error("photo_upload_auth_missing"), "auth-missing"],
    ["authentication", new Error("photo_upload_auth_anonymous"), "auth-anonymous"],
    ["authentication", new Error("photo_upload_auth_refresh_failed"), "auth-refresh-failed"],
    ["authentication", new Error("photo_upload_auth_changed"), "auth-account-changed"],
    ["main-local-read", new Error("media_upload_size_mismatch"), "local-size-mismatch"],
    ["main-local-read", new Error("media_local_read_failed"), "local-read-failed"],
    ["thumbnail-local-read", new Error("media_local_read_timeout"), "local-read-failed"],
    ["thumbnail-local-read", new Error("media_upload_canceled"), "storage-canceled"],
    ["main-transfer", { code: "storage/unauthorized", message: "private provider detail" }, "storage-unauthorized"],
    ["thumbnail-transfer", { code: "storage/retry-limit-exceeded" }, "storage-retry-limit-exceeded"],
    ["thumbnail-verification", new Error("media_upload_verification_failed"), "upload-verification-failed"],
    ["reservation", { code: "functions/permission-denied" }, "callable-permission-denied"],
    ["finalization", { code: "functions/unavailable" }, "callable-unavailable"],
    ["main-transfer", { code: "storage/a-new-provider-code" }, "transfer-failed"],
    ["main-local-read", new Error("token=secret path=file:///private/photo.jpg"), "unknown"],
  ];

  for (const [stage, source, expectedCode] of cases) {
    const result = await rejected(stage, source);
    assert.equal(result.stage, stage);
    assert.equal(result.diagnosticCode, expectedCode);
    assert.equal(result.message, "friend_chat_photo_upload_failed");
    assert.equal(JSON.stringify(result).includes("secret"), false);
    assert.equal(JSON.stringify(result).includes("photo.jpg"), false);
  }

  const originalWarn = console.warn;
  const captured = [];
  console.warn = (...values) => captured.push(values.join(" "));
  try {
    const result = await rejected("main-transfer", { code: "storage/unauthorized", message: "token=secret" });
    assert.equal(diagnostic.recordFriendChatPhotoUploadDiagnostic(result), true);
    assert.equal(diagnostic.recordFriendChatPhotoUploadDiagnostic(new Error("raw failure")), false);
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(captured, ["[friend-chat-photo-upload] stage=main-transfer code=storage-unauthorized"]);

  const service = read("services/chatService.ts");
  const screen = read("app/(social)/chat/[chatId].tsx");
  assert.match(service, /withFriendChatPhotoUploadDiagnostic\("reservation"/u);
  assert.match(service, /prepareFriendChatPhotoUploadAuth\(\(\) => auth\.currentUser, clientOwnerUserId\)/u);
  assert.match(service, /prepareFriendChatPhotoUploadAuth\(\(\) => auth\.currentUser, reservation\.clientOwnerUserId\)/u);
  assert.match(service, /diagnosticVariant\?: "main" \| "thumbnail"/u);
  assert.match(service, /stage\("local-read"\)/u);
  assert.match(service, /stage\("transfer"\)/u);
  assert.match(service, /part = error instanceof Error[\s\S]*\? "verification"[\s\S]*: "transfer"/u);
  assert.match(service, /readFriendChatPhotoUploadBlob\(uri, expectedSizeBytes\)/u);
  assert.match(service, /if \(diagnosticVariant\) void completion\.catch/u);
  assert.match(service, /if \(diagnosticVariant\) closeFriendChatPhotoUploadBlob\(uploadData\)/u);
  assert.match(service, /uploadBytesResumable\(ref\(storage, storagePath\), uploadData/u);
  assert.match(service, /observeFriendChatUploadTask\(task, expectedSizeBytes, contentType/u);
  assert.match(service, /settleFriendChatPhotoUploadPair\(/u);
  assert.match(service, /withFriendChatPhotoUploadDiagnostic\("finalization"/u);
  assert.match(screen, /recordFriendChatPhotoUploadDiagnostic\(error\)/u);
  assert.match(screen, /error\.stage === "finalization"[\s\S]*chat\.mediaFinalizationError/u,
    "Finalization failures must not be mislabeled as transfer failures");
  assert.match(screen, /await upload\.completion;[\s\S]*finalizeFriendChatImageMessage/u,
    "Finalization must remain after both transfers complete");
  assert.match(screen, /finalizeFriendChatImageMessage[\s\S]*deleteFriendChatImageDraft/u,
    "The recoverable draft must be deleted only after finalization succeeds");
  assert.doesNotMatch(service, /console\.(?:log|warn|error)/u);

  // Exercise the actual service helper with delayed caller observation (the
  // main upload can reject while the thumbnail is still being read).
  const serviceAst = ts.createSourceFile("chatService.ts", service, ts.ScriptTarget.Latest, true);
  const helper = serviceAst.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "uploadBlobToReservedPath");
  assert.ok(helper);
  const helperJs = ts.transpileModule(helper.getText(serviceAst), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
  }).outputText;
  let released = 0;
  let setupThrows = false;
  const uploadError = Object.assign(new Error("private provider error"), { code: "storage/unauthorized" });
  const serviceHelper = new Function(
    "readFriendChatPhotoUploadBlob", "closeFriendChatPhotoUploadBlob", "uploadBytesResumable", "ref", "storage",
    "observeFriendChatUploadTask", "createFriendChatPhotoUploadDiagnostic", `${helperJs}\nreturn uploadBlobToReservedPath;`,
  )(
    async () => ({ size: 4, close() { released++; } }),
    transfer.closeFriendChatPhotoUploadBlob,
    () => {
      if (setupThrows) throw uploadError;
      return fakeTask({ finalSnapshot: completedSnapshot, transferError: uploadError });
    },
    () => ({}), {}, transfer.observeFriendChatUploadTask, diagnostic.createFriendChatPhotoUploadDiagnostic,
  );
  const unhandled = [];
  const observeUnhandled = error => unhandled.push(error);
  process.on("unhandledRejection", observeUnhandled);
  try {
    const upload = await serviceHelper("synthetic/image.jpg", "file:///synthetic/image.jpg", 4, "image/jpeg", undefined, "main");
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, [], "Early transfer error must not become an unhandled rejection");
    await assert.rejects(upload.completion, error => error.stage === "main-transfer" && error.diagnosticCode === "storage-unauthorized");
    assert.equal(released, 1);
    setupThrows = true;
    await assert.rejects(serviceHelper("synthetic/image.jpg", "file:///synthetic/image.jpg", 4, "image/jpeg", undefined, "main"), error => error.diagnosticCode === "storage-unauthorized");
    assert.equal(released, 2, "Synchronous task creation failure must release the local native blob");
  } finally {
    process.removeListener("unhandledRejection", observeUnhandled);
  }

  console.log("PASS: photo upload auth binding, paired-transfer settlement, and privacy-safe stage/code diagnostics cover preflight through finalization.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
