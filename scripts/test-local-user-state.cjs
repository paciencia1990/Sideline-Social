"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const corePath = path.join(root, "utils", "localUserStateCore.ts");
const source = fs.readFileSync(corePath, "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: corePath,
}).outputText;
const loaded = { exports: {} };
new Function("module", "exports", output)(loaded, loaded.exports);

const {
  RETAINED_DEVICE_PREFERENCE_KEYS,
  clearLocalUserStateWithDependencies,
  completeLocalSignOut,
  getLocalUserStateKeysToRemove,
} = loaded.exports;

assert.deepEqual(RETAINED_DEVICE_PREFERENCE_KEYS, [
  "onboardingComplete",
  "@sideline_squad_language",
]);

const currentUserKeys = [
  "firebase:authUser:app",
  "sidelineSocial.activeMode",
  "sidelineSocial.coachChecklistProgress.v1.user-123.checklist",
  "sidelineSocial.coachGeneratedHelp.v1.user-123.request",
  "sidelineSocial.coachSavedHelp.v1.user-123",
  "@sideline-social/notification-dismissal-retry-ids-v1:user-123",
  "sideline:selectedSquad:user-123",
  "sidelineSocial.systemRouteResume",
  "sidelineSocial.friendChatImagePickerReturn.v1",
  "sidelineSocial.friendChatImagePickerHandoff.v1",
  "@sideline-social/trivia/recent-question-ids/user-123",
  "future-user-specific-key",
];
assert.deepEqual(
  getLocalUserStateKeysToRemove([
    "onboardingComplete",
    ...currentUserKeys,
    "@sideline_squad_language",
    currentUserKeys[0],
  ]),
  currentUserKeys,
  "Logout removes auth remnants and all current or future user-specific state while preserving device preferences.",
);

async function run() {
  const calls = [];
  let removed = [];
  await clearLocalUserStateWithDependencies({
    clearInMemoryState: () => calls.push("memory"),
    clearNotificationResponse: async () => calls.push("notification"),
    getAllStorageKeys: async () => {
      calls.push("read");
      return ["onboardingComplete", ...currentUserKeys, "@sideline_squad_language"];
    },
    removeStorageKeys: async (keys) => {
      calls.push("remove");
      removed = [...keys];
    },
  });
  assert.deepEqual(removed, currentUserKeys);
  assert.equal(calls.includes("memory"), true);
  assert.equal(calls.includes("notification"), true);
  assert.equal(calls.includes("read"), true);
  assert.equal(calls.includes("remove"), true);

  let removeCalled = false;
  await clearLocalUserStateWithDependencies({
    clearInMemoryState: () => {},
    clearNotificationResponse: async () => {},
    getAllStorageKeys: async () => [...RETAINED_DEVICE_PREFERENCE_KEYS],
    removeStorageKeys: async () => {
      removeCalled = true;
    },
  });
  assert.equal(removeCalled, false, "No storage write is needed when only retained device preferences exist.");

  const attempted = [];
  await assert.rejects(
    () => clearLocalUserStateWithDependencies({
      clearInMemoryState: () => {
        attempted.push("memory");
        throw new Error("private detail");
      },
      clearNotificationResponse: async () => {
        attempted.push("notification");
      },
      getAllStorageKeys: async () => {
        attempted.push("storage");
        return [];
      },
      removeStorageKeys: async () => {},
    }),
    (error) => error.message === "local_user_state_cleanup_failed" && !error.message.includes("private detail"),
  );
  assert.deepEqual(attempted.sort(), ["memory", "notification", "storage"]);

  const failedSignOutCalls = [];
  await completeLocalSignOut({
    firebaseSignOut: async () => {
      failedSignOutCalls.push("firebase");
      throw new Error("private Firebase detail");
    },
    clearLocalUserState: async () => {
      failedSignOutCalls.push("cleanup");
    },
    reportFailure: (stage, error) => {
      failedSignOutCalls.push(`report:${stage}`);
      assert.equal(error instanceof Error, true);
    },
    resetLocalAuthContext: () => failedSignOutCalls.push("reset"),
  });
  assert.deepEqual(failedSignOutCalls, [
    "firebase",
    "report:firebase-sign-out",
    "cleanup",
    "reset",
  ]);

  const failedCleanupCalls = [];
  await completeLocalSignOut({
    firebaseSignOut: async () => failedCleanupCalls.push("firebase"),
    clearLocalUserState: async () => {
      failedCleanupCalls.push("cleanup");
      throw new Error("private storage detail");
    },
    reportFailure: (stage) => failedCleanupCalls.push(`report:${stage}`),
    resetLocalAuthContext: () => failedCleanupCalls.push("reset"),
  });
  assert.deepEqual(failedCleanupCalls, [
    "firebase",
    "cleanup",
    "report:local-user-state",
    "reset",
  ]);

  const service = fs.readFileSync(path.join(root, "services", "localUserStateService.ts"), "utf8");
  assert.match(service, /AsyncStorage\.getAllKeys\(\)/);
  assert.match(service, /AsyncStorage\.multiRemove/);
  assert.match(service, /Notifications\.clearLastNotificationResponseAsync\(\)/);
  assert.match(service, /clearVoicePlaybackUrlCache/);
  assert.match(service, /clearFriendChatImagePickerLocalState/);

  const authContext = fs.readFileSync(path.join(root, "context", "AuthContext.tsx"), "utf8");
  const implementationStart = authContext.lastIndexOf("signOut: async () => {");
  assert.notEqual(implementationStart, -1);
  assert.notEqual(authContext.indexOf("await completeLocalSignOut({", implementationStart), -1);
  assert.notEqual(authContext.indexOf("firebaseSignOut: () => firebaseSignOut(auth)", implementationStart), -1);
  assert.notEqual(authContext.indexOf("clearLocalUserState: clearSignedInUserLocalState", implementationStart), -1);
  assert.notEqual(authContext.indexOf("setVoicePlaybackAuthorizationContext(null)", implementationStart), -1);

  const deletionScreen = fs.readFileSync(path.join(root, "app", "settings", "delete-account.tsx"), "utf8");
  assert.equal(deletionScreen.includes("AsyncStorage.clear"), false);
  assert.equal(
    deletionScreen.indexOf("await signOut();") > deletionScreen.indexOf("await deleteOwnAccount(password);"),
    true,
    "Account deletion must reuse the shared local sign-out cleanup after server deletion.",
  );

  console.log("Logout and account-deletion local user-state cleanup checks passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
