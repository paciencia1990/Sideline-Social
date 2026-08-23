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
  new Function("module", "exports", "require", output)(loaded, loaded.exports, requireModule);
  return loaded.exports;
}

const experience = loadTypeScript("utils/coachAiExperienceCore.ts");

assert.equal(experience.toggleCoachAiSavedExpanded(false), true);
assert.equal(experience.toggleCoachAiSavedExpanded(true), false);
assert.equal(experience.resolveKeyboardRevealOffset("android", 0), 32);
assert.equal(experience.resolveKeyboardRevealOffset("android", 48), 64);
assert.equal(experience.resolveKeyboardRevealOffset("ios", 48), 16);
assert.equal(experience.resolveKeyboardRevealOffset("web", Number.NaN), 16);

const now = Date.now();
const requestId = "coach_request_12345";
const userId = "coach_user_123";
const intent = experience.createCoachAiResultReturnIntent({ now, requestId, userId });
assert.deepEqual(experience.parseCoachAiResultReturnIntent(JSON.stringify(intent), now), intent);
assert.equal(
  experience.parseCoachAiResultReturnIntent(JSON.stringify(intent), intent.expiresAt),
  null,
  "Expired Coach AI return markers must fail closed.",
);
assert.equal(experience.parseCoachAiResultReturnIntent(JSON.stringify({ ...intent, route: "/(tabs)" }), now), null);
assert.equal(experience.parseCoachAiResultReturnIntent(JSON.stringify({ ...intent, requestId: "../parent" }), now), null);
assert.throws(
  () => experience.createCoachAiResultReturnIntent({ now, requestId: "bad", userId }),
  /invalid_coach_ai_return_context/,
);
assert.equal(JSON.stringify(intent).includes("body"), false);
assert.equal(JSON.stringify(intent).includes("title"), false);

async function run() {
  const completedEvents = [];
  const completed = await experience.runCoachAiResultAction({
    rememberReturn: async () => completedEvents.push("remember"),
    execute: async () => {
      completedEvents.push("execute");
      return "shared";
    },
    clearReturn: async () => completedEvents.push("clear"),
  });
  assert.equal(completed, "shared");
  assert.deepEqual(completedEvents, ["remember", "execute", "clear"]);

  const canceledEvents = [];
  const canceled = await experience.runCoachAiResultAction({
    rememberReturn: async () => canceledEvents.push("remember"),
    execute: async () => {
      canceledEvents.push("execute");
      return "dismissed";
    },
    clearReturn: async () => canceledEvents.push("clear"),
  });
  assert.equal(canceled, "dismissed");
  assert.deepEqual(canceledEvents, ["remember", "execute", "clear"]);

  const failureEvents = [];
  await assert.rejects(
    () => experience.runCoachAiResultAction({
      rememberReturn: async () => failureEvents.push("remember"),
      execute: async () => {
        failureEvents.push("execute");
        throw new Error("save_failed");
      },
      clearReturn: async () => failureEvents.push("clear"),
    }),
    /save_failed/,
  );
  assert.deepEqual(failureEvents, ["remember", "execute", "clear"]);

  let actionExecuted = false;
  assert.equal(await experience.runCoachAiResultAction({
    rememberReturn: async () => { throw new Error("storage_unavailable"); },
    execute: async () => {
      actionExecuted = true;
      return "saved";
    },
    clearReturn: async () => { throw new Error("must_not_run"); },
  }), "saved");
  assert.equal(actionExecuted, true, "Resume storage must not block the requested action.");

  const storage = new Map();
  const asyncStorage = {
    getItem: async (key) => storage.get(key) ?? null,
    removeItem: async (key) => { storage.delete(key); },
    setItem: async (key, value) => { storage.set(key, value); },
  };
  const friendResume = loadTypeScript("utils/friendChatImagePickerResumeCore.ts");
  const resumeService = loadTypeScript("services/systemRouteResumeService.ts", (name) => {
    if (name === "@react-native-async-storage/async-storage") return asyncStorage;
    if (name === "@/utils/coachAiExperienceCore") return experience;
    if (name === "@/utils/friendChatImagePickerResumeCore") return friendResume;
    throw new Error(`Unexpected resume-service import: ${name}`);
  });

  await resumeService.rememberCoachAiResultReturn({ requestId, userId }, now);
  const storedReturn = [...storage.values()].find((value) => value.includes(requestId));
  assert.ok(storedReturn);
  assert.equal(storedReturn.includes("body"), false);
  assert.equal(await resumeService.consumeCoachAiResultReturn("another_user", now), null);
  assert.equal(storage.size, 0, "A return marker must be consumed even when the account changed.");

  await resumeService.rememberCoachAiResultReturn({ requestId, userId }, now);
  assert.deepEqual(await resumeService.consumeCoachAiResultReturn(userId, now), {
    params: { requestId },
    pathname: "/coach/resources/help/result",
    requiredMode: "coach",
  });
  assert.equal(storage.size, 0);

  await resumeService.rememberCoachAiResultReturn({ requestId, userId }, now);
  await resumeService.clearCoachAiResultReturn({ requestId: "different_request", userId });
  assert.equal(storage.size, 1, "A different result must not clear the active return marker.");
  await resumeService.clearCoachAiResultReturn({ requestId, userId });
  assert.equal(storage.size, 0);

  const help = read("app", "coach", "resources", "help", "index.tsx");
  const result = read("app", "coach", "resources", "help", "result.tsx");
  const rootIndex = read("app", "index.tsx");
  const keyboard = read("components", "CoachAiKeyboardAwareScrollView.tsx");
  const translations = read("i18n", "index.ts");

  const saveStart = result.indexOf("const saveResult");
  const saveEnd = result.indexOf("const confirmDelete", saveStart);
  const shareStart = result.indexOf("const shareResult", saveEnd);
  const shareEnd = result.indexOf("const sendToComposer", shareStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart && shareStart > saveEnd && shareEnd > shareStart);
  assert.match(result.slice(saveStart, saveEnd), /runCoachAiResultAction/);
  assert.match(result.slice(shareStart, shareEnd), /rememberCoachAiResultReturn/);
  assert.match(result.slice(shareStart, shareEnd), /Share\.share/);
  assert.match(result.slice(shareStart, shareEnd), /Share\.dismissedAction[\s\S]*clearPendingShareReturn/);
  assert.doesNotMatch(result.slice(saveStart, saveEnd), /router\./, "Saving must not navigate away.");
  assert.doesNotMatch(result.slice(shareStart, shareEnd), /router\./, "Sharing must not navigate away.");
  assert.match(result, /AppState\.addEventListener\("change"[\s\S]*shareBackgroundedRef\.current[\s\S]*clearPendingShareReturn/);

  const notificationIndex = rootIndex.indexOf("getPendingNotificationOpenTarget({ activeMode })");
  const coachReturnIndex = rootIndex.indexOf("consumeCoachAiResultReturn(user.uid)", notificationIndex);
  const systemReturnIndex = rootIndex.indexOf("consumeSystemReturnRoute()", coachReturnIndex);
  const homeFallbackIndex = rootIndex.indexOf('router.replace("/(tabs)")', systemReturnIndex);
  assert.ok(notificationIndex >= 0 && coachReturnIndex > notificationIndex);
  assert.ok(systemReturnIndex > coachReturnIndex && homeFallbackIndex > systemReturnIndex);
  assert.match(rootIndex.slice(coachReturnIndex, systemReturnIndex), /setActiveMode\(coachAiReturn\.requiredMode\)/);
  assert.match(rootIndex.slice(coachReturnIndex, systemReturnIndex), /pathname: coachAiReturn\.pathname/);

  assert.match(help, /accessibilityState=\{\{ expanded: savedExpanded \}\}/);
  assert.match(help, /setSavedExpanded\(toggleCoachAiSavedExpanded\)/);
  assert.match(help, /savedExpanded[\s\S]*saved\.map/);
  assert.match(help, /onContentSizeChange=\{multiline \? revealInput : undefined\}/);
  assert.match(help, /onSelectionChange=\{multiline \? revealInput : undefined\}/);
  assert.match(keyboard, /useSafeAreaInsets/);
  assert.match(keyboard, /resolveKeyboardRevealOffset\(Platform\.OS, insets\.bottom\)/);
  assert.match(keyboard, /scrollResponderScrollNativeHandleToKeyboard[\s\S]*revealOffset/);

  assert.match(translations, /savedHelp: 'Saved'/);
  assert.match(translations, /savedHelp: 'Guardados'/);
  assert.equal((translations.match(/savedExpandHint:/g) ?? []).length, 2);
  assert.equal((translations.match(/savedCollapseHint:/g) ?? []).length, 2);

  console.log("Coach AI result persistence, Saved accordion, and keyboard-following regressions passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
