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
const {
  createTriviaQuestionKey,
  getTriviaAnswerAccessibilityLabel,
  getTriviaAnswerFeedbackIcon,
  resolveTriviaAnswerVisualState,
} = require(path.join(root, "src", "game", "triviaBlitz", "answerFeedback.ts"));

const questionOneKey = createTriviaQuestionKey(0, "question-one");
const questionTwoKey = createTriviaQuestionKey(1, "question-two");

function statesFor({
  selectedAnswerIndex,
  correctAnswerIndex,
  resultKnown,
  currentQuestionKey = questionOneKey,
  feedbackQuestionKey = questionOneKey,
}) {
  return [0, 1, 2, 3].map((answerIndex) =>
    resolveTriviaAnswerVisualState({
      answerIndex,
      selectedAnswerIndex,
      correctAnswerIndex,
      resultKnown,
      currentQuestionKey,
      feedbackQuestionKey,
    }),
  );
}

function iconsFor(options) {
  return statesFor(options).map(getTriviaAnswerFeedbackIcon);
}

assert.deepEqual(
  iconsFor({ selectedAnswerIndex: 1, correctAnswerIndex: 1, resultKnown: false }),
  [null, null, null, null],
  "No icon may appear while a selected answer is still pending.",
);
assert.deepEqual(
  statesFor({ selectedAnswerIndex: 1, correctAnswerIndex: 1, resultKnown: false }),
  ["idle", "selected-pending", "idle", "idle"],
);
assert.deepEqual(
  iconsFor({ selectedAnswerIndex: null, correctAnswerIndex: 1, resultKnown: true }),
  [null, null, null, null],
  "Correctness must not be revealed before an answer is locked.",
);

const correctStates = statesFor({
  selectedAnswerIndex: 1,
  correctAnswerIndex: 1,
  resultKnown: true,
});
assert.deepEqual(correctStates, ["disabled", "selected-correct", "disabled", "disabled"]);
assert.deepEqual(
  correctStates.map(getTriviaAnswerFeedbackIcon),
  [null, "check", null, null],
  "A correct selection must show exactly one Check and no X.",
);

const wrongStates = statesFor({
  selectedAnswerIndex: 2,
  correctAnswerIndex: 1,
  resultKnown: true,
});
assert.deepEqual(
  wrongStates,
  ["disabled", "revealed-correct", "selected-incorrect", "disabled"],
);
assert.deepEqual(
  wrongStates.map(getTriviaAnswerFeedbackIcon),
  [null, "check", "x", null],
  "A wrong selection must show one X and reveal the correct answer with one Check.",
);
assert.equal(wrongStates.map(getTriviaAnswerFeedbackIcon).filter(Boolean).length, 2);

assert.deepEqual(
  iconsFor({
    selectedAnswerIndex: 2,
    correctAnswerIndex: 1,
    resultKnown: true,
    currentQuestionKey: questionTwoKey,
    feedbackQuestionKey: questionOneKey,
  }),
  [null, null, null, null],
  "Feedback scoped to a previous question must never appear on the next question.",
);
assert.deepEqual(
  iconsFor({ selectedAnswerIndex: 2, correctAnswerIndex: 1, resultKnown: true }),
  iconsFor({ selectedAnswerIndex: 2, correctAnswerIndex: 1, resultKnown: true }),
  "Repeated renders during the feedback interval must keep one stable icon per applicable row.",
);

const englishLabels = {
  correctAnswer: "Correct answer",
  yourAnswerCorrect: "Your answer, correct",
  yourAnswerIncorrect: "Your answer, incorrect",
  selectedAnswerIncorrect: "Selected answer, incorrect",
  notSelected: "Not selected",
};
const spanishLabels = {
  correctAnswer: "Respuesta correcta",
  yourAnswerCorrect: "Tu respuesta, correcta",
  yourAnswerIncorrect: "Tu respuesta, incorrecta",
  selectedAnswerIncorrect: "Respuesta seleccionada, incorrecta",
  notSelected: "No seleccionada",
};

assert.equal(
  getTriviaAnswerAccessibilityLabel("Paris", "selected-correct", englishLabels, true),
  "Paris, Your answer, correct",
);
assert.equal(
  getTriviaAnswerAccessibilityLabel("London", "selected-incorrect", englishLabels, true),
  "London, Your answer, incorrect",
);
assert.equal(
  getTriviaAnswerAccessibilityLabel("Paris", "revealed-correct", englishLabels, true),
  "Paris, Correct answer",
);
assert.equal(
  getTriviaAnswerAccessibilityLabel("París", "revealed-correct", spanishLabels, true),
  "París, Respuesta correcta",
);
assert.equal(
  getTriviaAnswerAccessibilityLabel("Londres", "selected-incorrect", spanishLabels, true),
  "Londres, Tu respuesta, incorrecta",
);

const screen = read("src", "game", "triviaBlitz", "TriviaBlitzScreen.tsx");
const styles = screen.slice(screen.indexOf("const styles = StyleSheet.create"));
const translations = read("i18n", "index.ts");
const playRoute = read("app", "games", "trivia-blitz", "play.tsx");
const legacyRoute = read("app", "(games)", "trivia-blitz.tsx");
const scoring = read("src", "game", "triviaBlitz", "scoring.ts");

assert.match(screen, /import \{ Check, X \} from "lucide-react-native"/);
assert.match(screen, /session\?\.selectionRevealed/);
assert.match(screen, /createTriviaQuestionKey\(session\?\.questionIndex \?\? -1, currentQuestion\.id\)/);
assert.match(screen, /lastResult\?\.questionKey === currentQuestionKey/);
assert.match(screen, /disabled=\{busy \|\| answerLocked\}/);
assert.match(screen, /if \(hasAlreadyAnswered\)/);
assert.equal((screen.match(/submitSessionSelection\(/g) ?? []).length, 1);
assert.match(screen, /pointerEvents="none"/);
assert.match(screen, /accessibilityElementsHidden/);
assert.match(screen, /importantForAccessibility="no-hide-descendants"/);
assert.match(screen, /AccessibilityInfo\.announceForAccessibility/);
assert.match(screen, /announcedFeedbackRef\.current === feedbackQuestionKey/);
assert.match(screen, /announcedFeedbackRef\.current = null/);
assert.match(styles, /answerContent:[\s\S]*flexDirection: "row"[\s\S]*minHeight: 24/);
assert.match(styles, /answerText:[\s\S]*flex: 1[\s\S]*flexShrink: 1/);
assert.match(styles, /feedbackIconSlot:[\s\S]*flexShrink: 0[\s\S]*minHeight: 24[\s\S]*width: 24/);
assert.doesNotMatch(screen, /numberOfLines=|adjustsFontSizeToFit=/);
assert.match(screen, /const QUESTION_SECONDS = 15/);
assert.match(screen, /}, 1400\)/);
assert.match(screen, /}, 1000\)/);

assert.equal(playRoute.trim(), legacyRoute.trim(), "Host and joining routes must use the same screen.");
assert.match(playRoute, /TriviaBlitzScreen/);

for (const text of [
  "Correct answer",
  "Your answer, correct",
  "Your answer, incorrect",
  "Not selected",
  "Respuesta correcta",
  "Tu respuesta, correcta",
  "Tu respuesta, incorrecta",
  "No seleccionada",
]) {
  assert.ok(translations.includes(`'${text}'`), `Missing localized feedback text: ${text}`);
}

assert.match(scoring, /pointsAwarded = 10/);
assert.match(scoring, /secondsRemaining >= 7/);
assert.match(scoring, /streakBonusAwarded = 20/);

console.log("Trivia Blitz answer feedback state, icons, layout, accessibility, and localization checks passed.");
