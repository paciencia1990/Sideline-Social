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
assert.equal(experience.resolveKeyboardResponderOffset(16, 47), 63);
assert.equal(experience.resolveKeyboardResponderOffset(32, Number.NaN), 32);
assert.equal(experience.COACH_AI_MULTILINE_INPUT_PREFERRED_HEIGHT, 144);
assert.equal(experience.COACH_AI_MULTILINE_INPUT_MIN_HEIGHT, 64);
const compactAndroidKeyboardViewport = 480 - 300;
const compactIphoneKeyboardViewport = 667 - 346;
const compactAndroidRevealOffset = experience.resolveKeyboardRevealOffset("android", 48);
const compactAndroidInputHeight = experience.resolveCoachAiMultilineInputHeight(
  compactAndroidKeyboardViewport,
  compactAndroidRevealOffset,
);
assert.equal(compactAndroidInputHeight, 72);
assert.ok(
  compactAndroidInputHeight + 44 + compactAndroidRevealOffset <= compactAndroidKeyboardViewport,
  "A short Android viewport with three-button navigation must dynamically cap the Coach AI multiline field.",
);
assert.equal(
  experience.resolveCoachAiMultilineInputHeight(
    compactIphoneKeyboardViewport,
    experience.resolveKeyboardRevealOffset("ios", 0),
  ),
  experience.COACH_AI_MULTILINE_INPUT_PREFERRED_HEIGHT,
  "An iPhone SE-sized viewport must fit the bounded Coach AI multiline field above the keyboard.",
);
assert.equal(
  experience.resolveCoachAiMultilineInputHeight(Number.NaN, 32),
  experience.COACH_AI_MULTILINE_INPUT_PREFERRED_HEIGHT,
);
const accessibilityInputHeight = experience.resolveCoachAiMultilineInputHeight(
  compactAndroidKeyboardViewport,
  compactAndroidRevealOffset,
  2,
);
assert.equal(accessibilityInputHeight, 78);
assert.ok(
  accessibilityInputHeight >= 32 + (22 * 2) + 2,
  "The capped Coach AI field must show a complete line and caret at 2x accessibility text.",
);
assert.ok(accessibilityInputHeight + compactAndroidRevealOffset <= compactAndroidKeyboardViewport);
const tallerIphoneKeyboardGrowth = 64;
const tallerIphoneKeyboardSupplement = experience.resolveCoachAiKeyboardFrameSupplement(321, 321 - tallerIphoneKeyboardGrowth);
assert.equal(tallerIphoneKeyboardSupplement, tallerIphoneKeyboardGrowth);
assert.equal(experience.resolveCoachAiKeyboardFrameSupplement(321, 350), 0);
assert.equal(experience.resolveCoachAiKeyboardFrameSupplement(Number.NaN, 300), 0);
assert.ok(
  48 + tallerIphoneKeyboardSupplement >= tallerIphoneKeyboardGrowth + experience.resolveKeyboardRevealOffset("ios", 0),
  "A taller iOS keyboard frame must add enough last-field scroll extent for the reveal gap.",
);

let shareTransition = experience.resolveCoachAiShareAppStateTransition(false, "inactive");
assert.deepEqual(shareTransition, { backgrounded: true, shouldClearReturn: false });
shareTransition = experience.resolveCoachAiShareAppStateTransition(shareTransition.backgrounded, "background");
assert.deepEqual(shareTransition, { backgrounded: true, shouldClearReturn: false });
shareTransition = experience.resolveCoachAiShareAppStateTransition(shareTransition.backgrounded, "active");
assert.deepEqual(shareTransition, { backgrounded: false, shouldClearReturn: true });
assert.deepEqual(
  experience.resolveCoachAiShareAppStateTransition(false, "active"),
  { backgrounded: false, shouldClearReturn: false },
  "An active app that never backgrounded must not consume the share return marker early.",
);
assert.equal(experience.shouldRetainCoachAiShareReturnAfterResponse("android", "sharedAction", "sharedAction"), true);
assert.equal(experience.shouldRetainCoachAiShareReturnAfterResponse("android", "dismissedAction", "sharedAction"), false);
assert.equal(experience.shouldRetainCoachAiShareReturnAfterResponse("ios", "sharedAction", "sharedAction"), false);

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
  let failingGetKey = null;
  let failingRemoveKey = null;
  let failingSetKey = null;
  let removeBlock = null;
  let setBlock = null;
  const createStorageBlock = (key) => {
    let release;
    let signalReached;
    return {
      key,
      reached: new Promise((resolve) => { signalReached = resolve; }),
      release: () => release(),
      signalReached: () => signalReached(),
      wait: new Promise((resolve) => { release = resolve; }),
    };
  };
  const asyncStorage = {
    getItem: async (key) => {
      if (key === failingGetKey) throw new Error("local_get_failed");
      return storage.get(key) ?? null;
    },
    removeItem: async (key) => {
      if (key === failingRemoveKey) throw new Error("local_remove_failed");
      if (removeBlock?.key === key) {
        const block = removeBlock;
        removeBlock = null;
        block.signalReached();
        await block.wait;
      }
      storage.delete(key);
    },
    setItem: async (key, value) => {
      if (key === failingSetKey) throw new Error("local_set_failed");
      if (setBlock?.key === key) {
        const block = setBlock;
        setBlock = null;
        block.signalReached();
        await block.wait;
      }
      storage.set(key, value);
    },
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

  const resources = loadTypeScript("services/coachResourcesService.ts", (name) => {
    if (name === "@react-native-async-storage/async-storage") return asyncStorage;
    if (name === "firebase/functions") return { httpsCallable: () => async () => ({ data: null }) };
    if (name === "@/config/featureFlags") return { FEATURE_FLAGS: { coachAiEnabled: false } };
    if (name === "@/config/firebase") return { functions: {} };
    if (name === "@/content/coachResources/checklists") return { COACH_CHECKLISTS: [] };
    if (name === "@/content/coachResources/communicationTemplates") return { COACH_COMMUNICATION_TEMPLATES: [] };
    if (name === "@/content/coachResources/proTips") return { COACH_PRO_TIPS: [] };
    if (name === "@/utils/coachAiErrors") {
      return {
        CoachAiRequestError: class CoachAiRequestError extends Error {},
        classifyCoachAiRequestError: (error) => error,
      };
    }
    throw new Error(`Unexpected Coach Resources service import: ${name}`);
  });
  const originalResult = {
    resultType: "message",
    title: "Original generated guide",
    body: "Original local content.",
    canSendAsAnnouncement: false,
  };
  const editedResult = {
    ...originalResult,
    title: "Edited saved guide",
    body: "Edited local content.",
  };
  await resources.cacheGeneratedCoachHelpResult(userId, requestId, originalResult);
  await resources.saveCoachHelpResult(userId, requestId, editedResult);
  const cachedResult = await resources.getCachedCoachHelpResult(userId, requestId);
  const savedResults = await resources.getSavedCoachHelpResults(userId);
  assert.deepEqual(savedResults.find((entry) => entry.id === requestId)?.result, editedResult);
  assert.deepEqual(savedResults.find((entry) => entry.id === requestId)?.result ?? cachedResult, editedResult);
  await resources.saveCoachHelpResult("another_coach_user", requestId, originalResult);
  assert.equal((await resources.getSavedCoachHelpResults("another_coach_user")).length, 1);
  const generatedStorageKey = `sidelineSocial.coachGeneratedHelp.v1.${userId}.${requestId}`;
  const savedStorageKey = `sidelineSocial.coachSavedHelp.v1.${userId}`;
  const secondRequestId = "coach_request_67890";
  await resources.saveCoachHelpResult(userId, secondRequestId, originalResult);
  failingGetKey = savedStorageKey;
  await assert.rejects(() => resources.saveCoachHelpResult(userId, requestId, editedResult), /local_get_failed/);
  await assert.rejects(() => resources.deleteCoachHelpResult(userId, requestId), /local_get_failed/);
  failingGetKey = null;
  assert.equal((await resources.getSavedCoachHelpResults(userId)).length, 2);
  await resources.deleteCoachHelpResult(userId, secondRequestId);
  failingRemoveKey = generatedStorageKey;
  await assert.rejects(() => resources.deleteCoachHelpResult(userId, requestId), /local_remove_failed/);
  assert.equal((await resources.getSavedCoachHelpResults(userId)).length, 1);
  assert.deepEqual(await resources.getCachedCoachHelpResult(userId, requestId), originalResult);
  failingRemoveKey = null;
  failingSetKey = savedStorageKey;
  await assert.rejects(() => resources.deleteCoachHelpResult(userId, requestId), /local_set_failed/);
  assert.equal((await resources.getSavedCoachHelpResults(userId)).length, 1);
  assert.equal(await resources.getCachedCoachHelpResult(userId, requestId), null);
  failingSetKey = null;
  await resources.deleteCoachHelpResult(userId, requestId);
  assert.equal((await resources.getSavedCoachHelpResults(userId)).length, 0);
  assert.equal(await resources.getCachedCoachHelpResult(userId, requestId), null);
  assert.equal((await resources.getSavedCoachHelpResults("another_coach_user")).length, 1);
  storage.set(savedStorageKey, JSON.stringify([{
    id: requestId,
    result: null,
    createdAt: null,
  }]));
  global.__DEV__ = false;
  assert.deepEqual(await resources.getSavedCoachHelpResults(userId), []);
  await assert.rejects(() => resources.saveCoachHelpResult(userId, requestId, editedResult), /invalid_saved_coach_help/);
  await assert.rejects(() => resources.deleteCoachHelpResult(userId, requestId), /invalid_saved_coach_help/);
  storage.delete(savedStorageKey);
  const concurrentRequestA = "coach_request_concurrent_a";
  const concurrentRequestB = "coach_request_concurrent_b";
  const firstSaveBlock = createStorageBlock(savedStorageKey);
  setBlock = firstSaveBlock;
  const firstConcurrentSave = resources.saveCoachHelpResult(userId, concurrentRequestA, originalResult);
  await firstSaveBlock.reached;
  const secondConcurrentSave = resources.saveCoachHelpResult(userId, concurrentRequestB, editedResult);
  firstSaveBlock.release();
  await Promise.all([firstConcurrentSave, secondConcurrentSave]);
  assert.deepEqual(
    new Set((await resources.getSavedCoachHelpResults(userId)).map((entry) => entry.id)),
    new Set([concurrentRequestA, concurrentRequestB]),
    "Concurrent same-user saves must serialize without losing either guide.",
  );
  const concurrentRequestC = "coach_request_concurrent_c";
  const deleteCacheKey = `sidelineSocial.coachGeneratedHelp.v1.${userId}.${concurrentRequestA}`;
  const deleteBlock = createStorageBlock(deleteCacheKey);
  removeBlock = deleteBlock;
  const concurrentDelete = resources.deleteCoachHelpResult(userId, concurrentRequestA);
  await deleteBlock.reached;
  const saveDuringDelete = resources.saveCoachHelpResult(userId, concurrentRequestC, originalResult);
  deleteBlock.release();
  await Promise.all([concurrentDelete, saveDuringDelete]);
  assert.deepEqual(
    new Set((await resources.getSavedCoachHelpResults(userId)).map((entry) => entry.id)),
    new Set([concurrentRequestB, concurrentRequestC]),
    "A queued save must not be lost or resurrect a concurrently deleted guide.",
  );

  const help = read("app", "coach", "resources", "help", "index.tsx");
  const result = read("app", "coach", "resources", "help", "result.tsx");
  const rootIndex = read("app", "index.tsx");
  const keyboard = read("components", "CoachAiKeyboardAwareScrollView.tsx");
  const resourcesService = read("services", "coachResourcesService.ts");
  const translations = read("i18n", "index.ts");

  const generateStart = help.indexOf("const generate");
  const generateEnd = help.indexOf("const cancelGeneration", generateStart);
  const generateSource = help.slice(generateStart, generateEnd);
  const generateCatchStart = generateSource.indexOf("} catch (requestError)");
  const generateFinallyStart = generateSource.indexOf("} finally", generateCatchStart);
  assert.ok(generateStart >= 0 && generateEnd > generateStart && generateCatchStart >= 0 && generateFinallyStart > generateCatchStart);
  assert.equal((generateSource.match(/router\.push\(/g) ?? []).length, 1, "Generation may navigate exactly once.");
  assert.match(generateSource, /router\.push\(\{ pathname: "\/coach\/resources\/help\/result", params: \{ requestId: request\.clientRequestId \} \}/);
  const generateFailureSource = generateSource.slice(generateCatchStart, generateFinallyStart);
  assert.doesNotMatch(generateFailureSource, /router\./, "A failed generation must remain on the completed form.");
  assert.doesNotMatch(
    generateFailureSource,
    /set(?:Category|Sport|AgeGroup|Situation|DesiredOutcome|Tone|PracticeMinutes|PlayerCount|Equipment)\(/,
    "A failed generation must preserve every form entry.",
  );

  const saveStart = result.indexOf("const saveResult");
  const saveEnd = result.indexOf("const confirmDelete", saveStart);
  const shareStart = result.indexOf("const shareResult", saveEnd);
  const shareEnd = result.indexOf("const sendToComposer", shareStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart && shareStart > saveEnd && shareEnd > shareStart);
  assert.match(result.slice(saveStart, saveEnd), /runCoachAiResultAction/);
  assert.match(result.slice(shareStart, shareEnd), /rememberCoachAiResultReturn/);
  assert.match(result.slice(shareStart, shareEnd), /Share\.share/);
  assert.match(result.slice(shareStart, shareEnd), /shouldRetainCoachAiShareReturnAfterResponse\(Platform\.OS, response\.action, Share\.sharedAction\)[\s\S]*clearPendingShareReturn/);
  assert.doesNotMatch(result.slice(saveStart, saveEnd), /router\./, "Saving must not navigate away.");
  assert.doesNotMatch(result.slice(shareStart, shareEnd), /router\./, "Sharing must not navigate away.");
  assert.match(result, /AppState\.addEventListener\("change"[\s\S]*resolveCoachAiShareAppStateTransition[\s\S]*transition\.shouldClearReturn[\s\S]*clearPendingShareReturn/);
  assert.match(result, /const next = savedEntry\?\.result \?\? cached \?\? null;/);
  assert.match(result, /deleteCoachHelpResult[\s\S]*resultDeleteError/);
  assert.match(result, /loadedContext\.userId === user\.uid[\s\S]*loadedContext\.requestId === requestId/);
  assert.match(result, /setResult\(null\)[\s\S]*setSaved\(false\)[\s\S]*setEditableText\(""\)/);
  assert.match(result, /accessibilityLiveRegion="assertive" accessibilityRole="alert"[\s\S]*deleteError/);
  assert.match(result, /activeResultContextKeyRef\.current === contextKey/);
  assert.match(result, /useLayoutEffect\(\(\) => \{[\s\S]*activeResultContextKeyRef\.current = activeResultContextKey/);
  assert.match(result, /useLayoutEffect\(\(\) => \{[\s\S]*return \(\) => \{ resultScreenMountedRef\.current = false; \}/);
  assert.match(result, /const applyEdit[\s\S]*persistenceInFlightRef\.current/);
  assert.match(result.slice(saveStart, saveEnd), /isActiveResultContext\(actionContextKey\)[\s\S]*setSaved\(true\)/);
  assert.match(result.slice(saveStart, saveEnd), /!beginPersistence\(\)[\s\S]*finally[\s\S]*finishPersistence\(\)/);
  assert.match(result.slice(saveEnd, shareStart), /isActiveResultContext\(actionContextKey\)[\s\S]*router\.replace/);
  assert.match(result.slice(saveEnd, shareStart), /!beginPersistence\(\)[\s\S]*\.finally\(finishPersistence\)/);
  assert.match(result.slice(shareStart, shareEnd), /isActiveResultContext\(actionContextKey\)/);
  assert.match(result, /persistenceInFlightRef\.current[\s\S]*setPersistenceInFlight\(true\)/);
  assert.match(result, /disabled=\{persistenceInFlight\} Icon=\{Edit3\}/);
  assert.match(result, /disabled=\{persistenceInFlight\} Icon=\{Save\}/);
  assert.match(result, /disabled=\{persistenceInFlight\} Icon=\{Trash2\}/);
  const deleteServiceStart = resourcesService.indexOf("export async function deleteCoachHelpResult");
  const deleteServiceEnd = resourcesService.indexOf("export function formatCoachHelpResultForSharing", deleteServiceStart);
  const deleteService = resourcesService.slice(deleteServiceStart, deleteServiceEnd);
  assert.ok(deleteService.indexOf("AsyncStorage.removeItem") < deleteService.indexOf("AsyncStorage.setItem"));
  assert.doesNotMatch(deleteService, /catch/);
  assert.match(resourcesService, /saveCoachHelpResult[\s\S]*readSavedCoachHelpResults\(userId\)/);
  assert.match(resourcesService, /deleteCoachHelpResult[\s\S]*readSavedCoachHelpResults\(userId\)/);
  assert.match(resourcesService, /parsed\.every\(isSavedHelpResult\)/);
  assert.match(resourcesService, /savedHelpMutationQueues[\s\S]*previous\.then\(mutation\)/);
  assert.match(resourcesService, /saveCoachHelpResult[\s\S]*enqueueSavedHelpMutation\(userId/);
  assert.match(resourcesService, /deleteCoachHelpResult[\s\S]*enqueueSavedHelpMutation\(userId/);
  assert.match(resourcesService, /isCoachHelpResult\(entry\.result\)/);
  assert.match(resourcesService, /section\.items\.every\(\(item\) => typeof item === "string"\)/);

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
  assert.match(help, /setSaved\(\[\]\)/);
  assert.doesNotMatch(help, /savedOwnerId === user\?\.uid && saved\.length > 0 \? \(\s*<View style=\{styles\.savedSection\}/);
  assert.match(help, /<View style=\{styles\.savedSection\}>[\s\S]*accessibilityState=\{\{ expanded: savedExpanded \}\}/);
  assert.match(help, /savedOwnerId === user\?\.uid && saved\.length > 0 \? saved\.map[\s\S]*coach\.resources\.savedEmpty/);
  assert.match(help, /useLayoutEffect\(\(\) => \{[\s\S]*generationToken\.current \+= 1[\s\S]*return \(\) => \{[\s\S]*generationToken\.current \+= 1[\s\S]*\}, \[user\?\.uid\]\)/);
  assert.match(help, /useFocusEffect[\s\S]*return \(\) => \{[\s\S]*generationToken\.current \+= 1[\s\S]*generationInFlight\.current = false/);
  assert.ok((help.match(/operationToken !== generationToken\.current/g) ?? []).length >= 3);
  assert.match(help, /setSituation\(""\)[\s\S]*setDesiredOutcome\(""\)[\s\S]*setRetryRequest\(null\)/);
  assert.match(help, /useFocusEffect[\s\S]*let active = true[\s\S]*return \(\) => \{[\s\S]*active = false;[\s\S]*\}/);
  assert.match(help, /onContentSizeChange=\{multiline \? revealInput : undefined\}/);
  assert.match(help, /onSelectionChange=\{multiline \? revealInput : undefined\}/);
  assert.match(help, /scrollEnabled=\{multiline \? true : undefined\}/);
  assert.match(help, /onChangeText=\{\(text\) => \{[\s\S]*onChangeText\(text\);[\s\S]*if \(multiline\) revealInput\(\)/);
  assert.match(keyboard, /useSafeAreaInsets/);
  assert.match(keyboard, /resolveKeyboardRevealOffset\(Platform\.OS, insets\.bottom\)/);
  assert.match(keyboard, /resolveKeyboardResponderOffset\(revealOffset, insets\.top\)/);
  assert.match(keyboard, /scrollResponderScrollNativeHandleToKeyboard\([\s\S]*responderRevealOffset/);
  assert.match(keyboard, /resolveCoachAiMultilineInputHeight\(keyboardViewportHeight, revealOffset, fontScale\)/);
  assert.match(keyboard, /fontScale/);
  assert.match(keyboard, /event\.endCoordinates\.screenY/);
  assert.match(keyboard, /Keyboard\.metrics\(\)/);
  assert.match(keyboard, /keyboardWillChangeFrame/);
  assert.match(keyboard, /scrollResponderKeyboardWillShow\(event as never\)[\s\S]*revealFocusedInput\(\)/);
  assert.match(keyboard, /resolveCoachAiKeyboardFrameSupplement[\s\S]*keyboardFrameSupplement/);
  assert.match(keyboard, /pointerEvents="none" style=\{\{ height: keyboardFrameSupplement \}\}/);
  assert.match(keyboard, /!keyboardVisibleRef\.current \|\| !revealTarget \|\| revealTarget !== focusedInput/);
  assert.match(keyboard, /hideSubscription[\s\S]*cancelAnimationFrame\(pendingRevealFrameRef\.current\)/);
  assert.match(result, /from "@\/components\/CoachAiKeyboardAwareScrollView"/);
  assert.equal((result.match(/<CoachAiMultilineTextInput/g) ?? []).length, 2);
  assert.match(result, /onChangeText=\{\(text\) => \{[\s\S]*onChangeText\?\.\(text\);[\s\S]*revealInput\(\)/);

  assert.match(translations, /savedHelp: 'Saved'/);
  assert.match(translations, /savedHelp: 'Guardados'/);
  assert.equal((translations.match(/savedExpandHint:/g) ?? []).length, 2);
  assert.equal((translations.match(/savedCollapseHint:/g) ?? []).length, 2);
  assert.equal((translations.match(/savedEmpty:/g) ?? []).length, 2);
  assert.equal((translations.match(/resultDeleteError:/g) ?? []).length, 2);

  console.log("Coach AI result persistence, Saved accordion, and keyboard-following regressions passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
