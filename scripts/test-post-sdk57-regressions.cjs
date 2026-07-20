"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText;
  module._compile(compiled, filename);
};

const root = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const questionBank = JSON.parse(read("assets", "triviaBlitz", "questions.json"));
const {
  RECENT_TRIVIA_QUESTION_LIMIT,
  createStableQuestionId,
  normalizeQuestionBank,
  selectTriviaQuestions,
} = require(path.join(root, "src", "game", "triviaBlitz", "questionSelection.ts"));
const {
  clampSpotDifferenceTranslation,
  screenPointToSourcePoint,
} = require(path.join(root, "src", "game", "spotDifference", "geometry.ts"));

const transformedGeometry = require("@babel/core").transformFileSync(
  path.join(root, "src", "game", "spotDifference", "geometry.ts"),
  { configFile: path.join(root, "babel.config.js") },
).code;
const transformedGeometryModule = { exports: {} };
new Function("exports", "module", "require", transformedGeometry)(
  transformedGeometryModule.exports,
  transformedGeometryModule,
  require,
);
const {
  clampSpotDifferenceTranslation: transformedClampSpotDifferenceTranslation,
  screenPointToSourcePoint: transformedScreenPointToSourcePoint,
} = transformedGeometryModule.exports;

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const normalizedQuestions = normalizeQuestionBank(questionBank);
assert.equal(normalizedQuestions.length, questionBank.length, "Every shipped Trivia question must be well formed.");
assert.equal(new Set(normalizedQuestions.map(({ id }) => id)).size, normalizedQuestions.length, "Question IDs must be unique.");
assert.equal(
  normalizedQuestions[0].id,
  createStableQuestionId(questionBank[0]),
  "Generated IDs must be deterministic and language independent.",
);

const firstGame = selectTriviaQuestions({
  count: 10,
  questions: questionBank,
  random: seededRandom(1),
});
assert.equal(firstGame.selectedQuestions.length, 10);
assert.equal(new Set(firstGame.selectedQuestions.map(({ id }) => id)).size, 10, "A game must not repeat a question ID.");

const secondGame = selectTriviaQuestions({
  count: 10,
  questions: questionBank,
  random: seededRandom(2),
  recentQuestionIds: firstGame.nextRecentQuestionIds,
});
assert.equal(
  secondGame.selectedQuestions.some(({ id }) => firstGame.nextRecentQuestionIds.includes(id)),
  false,
  "Recent questions must be excluded while enough unused questions exist.",
);
assert.notDeepEqual(
  secondGame.selectedQuestions.map(({ id }) => id),
  firstGame.selectedQuestions.map(({ id }) => id),
  "A newly created game must perform a fresh shuffle.",
);

const sportsOnly = selectTriviaQuestions({
  category: "Sports",
  count: 10,
  questions: questionBank,
  random: seededRandom(3),
});
assert.ok(sportsOnly.selectedQuestions.every(({ category }) => category === "Sports"), "Category filtering must use the eligible pool.");

const fullyRecentPool = normalizedQuestions.slice(0, 12);
const leastRecentlyUsed = selectTriviaQuestions({
  count: 5,
  questions: fullyRecentPool,
  random: seededRandom(4),
  recentQuestionIds: fullyRecentPool.map(({ id }) => id),
});
assert.deepEqual(
  leastRecentlyUsed.selectedQuestions.map(({ id }) => id),
  fullyRecentPool.slice(0, 5).map(({ id }) => id),
  "When history covers the pool, least-recently-used questions must return first.",
);

const boundedHistory = selectTriviaQuestions({
  count: 10,
  questions: questionBank,
  random: seededRandom(5),
  recentQuestionIds: normalizedQuestions.map(({ id }) => id),
});
assert.equal(boundedHistory.nextRecentQuestionIds.length, RECENT_TRIVIA_QUESTION_LIMIT, "Trivia history must stay bounded.");

for (const selected of firstGame.selectedQuestions) {
  const original = questionBank.find((question) => createStableQuestionId(question) === selected.id);
  assert.ok(original, `Question ${selected.id} must resolve in both languages.`);
  assert.equal(selected.options_en[selected.answer], original.options_en[original.answer]);
  assert.equal(selected.options_es[selected.answer], original.options_es[original.answer]);
}

const gameState = read("src", "game", "triviaBlitz", "gameState.ts");
assert.doesNotMatch(gameState, /sort\(\(\)\s*=>\s*Math\.random\(\)\s*-\s*0\.5\)/, "Production Trivia must not use random comparator sorting.");
const initializeSessionSource = gameState.slice(
  gameState.indexOf("export async function initializeFirestoreSession"),
  gameState.indexOf("export async function submitSessionSelection"),
);
assert.ok(initializeSessionSource.indexOf("if (childSnapshot.exists())") < initializeSessionSource.indexOf("selectTriviaQuestions({"), "Rejoining an existing session must not generate a replacement selection.");
assert.match(gameState, /selectedQuestions,[\s\S]*await setDoc\(sessionRef, session\)/, "The host selection must be stored in the canonical session.");

const viewport = { width: 200, height: 100 };
const imageRect = { width: 200, height: 100, offsetX: 0, offsetY: 0 };
assert.deepEqual(
  screenPointToSourcePoint(50, 25, viewport, imageRect, { scale: 1, translateX: 0, translateY: 0 }),
  { x: 0.25, y: 0.25 },
  "Default-scale image coordinates must remain accurate after page scrolling.",
);
assert.deepEqual(
  screenPointToSourcePoint(20, 25, viewport, imageRect, { scale: 2, translateX: 20, translateY: -5 }),
  { x: 0.25, y: 0.4 },
  "Coordinate conversion must invert zoom and pan transforms.",
);
assert.deepEqual(
  clampSpotDifferenceTranslation({ scale: 1, translateX: 30, translateY: -20 }, viewport, imageRect, 1, 4, 0.01),
  { scale: 1, translateX: 0, translateY: 0 },
  "Returning to default zoom must reset translation.",
);
assert.deepEqual(
  clampSpotDifferenceTranslation({ scale: 2, translateX: 500, translateY: -500 }, viewport, imageRect, 1, 4, 0.01),
  { scale: 2, translateX: 100, translateY: -50 },
  "Zoomed image translation must remain clamped to the viewport.",
);
assert.deepEqual(
  transformedClampSpotDifferenceTranslation(
    { scale: 2, translateX: 500, translateY: -500 },
    viewport,
    imageRect,
    1,
    4,
    0.01,
  ),
  { scale: 2, translateX: 100, translateY: -50 },
  "Babel-transformed worklet helpers must capture an initialized clamp function.",
);
assert.deepEqual(
  transformedScreenPointToSourcePoint(
    50,
    25,
    viewport,
    imageRect,
    { scale: 1, translateX: 0, translateY: 0 },
  ),
  { x: 0.25, y: 0.25 },
  "Babel-transformed tap conversion must capture an initialized viewport helper.",
);

const spotScreen = read("src", "game", "spotDifference", "SpotDifferenceScreen.tsx");
assert.match(spotScreen, /Gesture\.Native\(\)/, "The parent ScrollView must participate in gesture arbitration.");
assert.match(spotScreen, /simultaneousWithExternalGesture\(scrollGesture\)/, "Image gestures must coexist with native scrolling.");
assert.match(spotScreen, /\.manualActivation\(true\)/, "One-finger image pan must use explicit activation arbitration.");
assert.match(spotScreen, /scale\.value <= MIN_ZOOM \+ ZOOM_EPSILON[\s\S]*state\.fail\(\)/, "At default zoom, image pan must fail immediately so native scrolling wins.");
assert.match(spotScreen, /\.blocksExternalGesture\(scrollGesture\)/, "Pinch and zoomed pan must take precedence over native scroll after activation.");
assert.match(spotScreen, /\.maxDistance\(PAN_MIN_DISTANCE\)/, "A swipe must fail the tap recognizer.");
assert.match(spotScreen, /\.onFinalize\(settleTransform\)/, "Pinch cancellation and failure must settle the transform.");
assert.match(spotScreen, /useSharedValue/, "Zoom and pan values must stay on the UI thread.");
assert.match(spotScreen, /useAnimatedStyle/, "The scene transform must be driven by Reanimated.");
assert.match(spotScreen, /runOnJS\(onTap\)/, "Only a completed tap should cross back to JavaScript.");
assert.match(spotScreen, /tapBlockedByMultitouch/, "A pinch or other multi-touch interaction must not select a difference.");
assert.doesNotMatch(spotScreen, /numberOfTaps\(2\)|onDoubleTap|Gesture\.Exclusive/, "Double-tap arbitration must not delay a deliberate single tap or first swipe.");
assert.match(spotScreen, /useFocusEffect/, "Route blur must reset zoom and scroll state.");
assert.match(spotScreen, /AppState\.addEventListener/, "App backgrounding must reset the active transform.");
assert.match(spotScreen, /cancelAnimation/, "Cleanup must cancel active UI-thread animations.");
assert.equal((spotScreen.match(/<ScrollView/g) ?? []).length, 1, "The fix must not add a nested vertical ScrollView.");
assert.match(spotScreen, /foundCount >= totalDifferences/, "Existing completion reset behavior must remain.");
assert.match(spotScreen, /secondsLeft === 0/, "Existing timer-expiration reset behavior must remain.");

for (let index = 1; index <= 21; index += 1) {
  const sceneId = String(index).padStart(3, "0");
  const scene = JSON.parse(read("assets", "games", "spot-the-difference", `scene_${sceneId}.json`));
  const differences = Array.isArray(scene) ? scene : scene.differences;
  assert.equal(differences.length, 10, `scene_${sceneId} must keep its 10 differences.`);
  assert.ok(fs.existsSync(path.join(root, "assets", "games", "spot-the-difference", `scene_${sceneId}_A.png`)));
  assert.ok(fs.existsSync(path.join(root, "assets", "games", "spot-the-difference", `scene_${sceneId}_B.png`)));
}

const passwordInput = read("components", "PasswordInput.tsx");
const emailLogin = read("app", "(auth)", "email-login.tsx");
const signUp = read("app", "(auth)", "sign-up.tsx");
const translations = read("i18n", "index.ts");
assert.match(passwordInput, /useState\(false\)/, "Password visibility must default to hidden.");
assert.match(passwordInput, /secureTextEntry=!\{?passwordVisible\}?|secureTextEntry=\{!passwordVisible\}/, "The eye toggle must control secureTextEntry.");
assert.match(passwordInput, /accessibilityRole="button"/, "The eye toggle must expose a button role.");
assert.match(passwordInput, /height: 44[\s\S]*width: 44/, "The eye toggle must meet the 44x44 touch target.");
assert.match(passwordInput, /inputRef\.current\?\.focus\(\)/, "Toggling must preserve input focus.");
assert.match(emailLogin, /<PasswordInput/, "Email Sign In must use the shared password input.");
assert.match(signUp, /<PasswordInput/, "Create Account must use the shared password input.");
assert.equal((translations.match(/showPassword:/g) ?? []).length, 2, "Show-password text must resolve in English and Spanish.");
assert.equal((translations.match(/hidePassword:/g) ?? []).length, 2, "Hide-password text must resolve in English and Spanish.");
assert.ok(translations.includes("showPassword: 'Show password'"));
assert.ok(translations.includes("hidePassword: 'Hide password'"));
assert.ok(translations.includes("showPassword: 'Mostrar contraseña'"));
assert.ok(translations.includes("hidePassword: 'Ocultar contraseña'"));

const tabs = read("app", "(tabs)", "_layout.tsx");
assert.match(tabs, /useSafeAreaInsets\(\)/, "The tab bar must consume the current safe-area inset.");
assert.match(tabs, /height: TAB_BAR_CONTENT_HEIGHT \+ insets\.bottom/, "Tab height must include the real bottom inset.");
assert.match(tabs, /paddingBottom: insets\.bottom/, "Safe-area padding must stay inside the tab-bar background.");
assert.match(tabs, /safeAreaInsets=\{\{ bottom: 0 \}\}/, "React Navigation must not apply the bottom inset a second time.");
assert.match(tabs, /tabBarHideOnKeyboard: true/, "The keyboard must not leave the tab bar floating.");
for (const route of ["index", "squad", "games", "friends", "profile"]) {
  assert.match(tabs, new RegExp(`<Tabs\\.Screen name="${route}"`), `The ${route} tab must remain present.`);
}

const lobbyBase = read("components", "LobbyBase.tsx");
const safeAreaLayout = read("utils", "safeAreaLayout.ts");
assert.match(lobbyBase, /useSafeAreaInsets\(\)/, "The shared lobby shell must use the device bottom inset.");
assert.match(lobbyBase, /getFixedFooterBottomPadding\(insets\.bottom\)/, "All game lobby actions must share the safe-area footer calculation.");
assert.ok(lobbyBase.indexOf("<ScrollView") < lobbyBase.indexOf("styles.actionFooter"), "The scrolling player list must stop above the action footer.");
assert.doesNotMatch(lobbyBase, /actionFooter:[\s\S]{0,240}position:\s*["']absolute/, "The lobby footer must remain in normal layout flow.");
assert.match(safeAreaLayout, /Math\.max\(bottomInset, MINIMUM_FIXED_FOOTER_PADDING\)/, "The footer must preserve safe spacing even when an inset reports zero.");
for (const game of ["bomb-defusal", "trivia-blitz", "spot-the-difference"]) {
  assert.match(read("app", "(games)", game, "Lobby.tsx"), /<LobbyBase/, `${game} must retain the shared lobby shell.`);
}

const squadScreen = read("app", "(tabs)", "squad.tsx");
assert.equal((squadScreen.match(/<FlatList\s/g) ?? []).length, 1, "Squad discovery must use one vertical virtualized list.");
assert.match(squadScreen, /ListHeaderComponent=\{\(/, "Discovery controls and map must be inside the list header.");
assert.match(squadScreen, /scrollEnabled=\{false\}/, "The preview map must not trap vertical drag gestures.");
assert.match(squadScreen, /getParentTabScrollBottomPadding\(insets\.bottom\)/, "Squad results must clear the dynamic parent tab bar.");
assert.ok(squadScreen.indexOf("ListHeaderComponent") < squadScreen.indexOf("<SquadSelector"), "The Squad selector must participate in the page scroll.");

const sizeAudit = read("scripts", "audit-app-size.cjs");
const packageSource = read("package.json");
assert.match(sizeAudit, /sha256/, "The app-size audit must hash assets for exact duplicates.");
assert.match(sizeAudit, /top30/, "The app-size audit must report the largest assets and modules.");
assert.match(sizeAudit, /readZipCentralDirectory/, "Existing APK/AAB analysis must be read-only and contribution based.");
assert.match(sizeAudit, /atlas\.jsonl/, "The app-size audit must consume Expo Atlas output when present.");
assert.match(packageSource, /"audit:app-size": "node scripts\/audit-app-size\.cjs"/, "The deterministic app-size audit must be reusable through npm.");

console.log("Post-SDK 57 game gestures, lobby/squad safe areas, size audit, Trivia, password, and tab checks passed.");
