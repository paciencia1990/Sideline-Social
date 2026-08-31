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
  claimTriviaAnswerSubmission,
  createTriviaQuestionKey,
  getTriviaAnswerAccessibilityLabel,
  getTriviaAnswerFeedbackIcon,
  resolveTriviaAnswerVisualState,
} = require(path.join(root, "src", "game", "triviaBlitz", "answerFeedback.ts"));

const questionOneKey = createTriviaQuestionKey(0, "question-one");
const questionTwoKey = createTriviaQuestionKey(1, "question-two");

const firstTap = claimTriviaAnswerSubmission(questionOneKey, "");
assert.deepEqual(firstTap, { accepted: true, submissionKey: questionOneKey });
assert.deepEqual(
  claimTriviaAnswerSubmission(questionOneKey, firstTap.submissionKey),
  { accepted: false, submissionKey: questionOneKey },
  "A second tap for the same question must not create another submission.",
);
assert.deepEqual(
  claimTriviaAnswerSubmission(questionTwoKey, firstTap.submissionKey),
  { accepted: true, submissionKey: questionTwoKey },
  "The next question must accept its first normal tap.",
);

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
const serverGame = read("functions", "src", "triviaGame.ts");

assert.match(screen, /import \{ Check, X \} from "lucide-react-native"/);
assert.match(screen, /session\?\.answerResult/);
assert.match(screen, /session\?\.currentQuestion/);
assert.match(screen, /createTriviaQuestionKey\(session\?\.questionIndex \?\? -1, currentQuestion\.id\)/);
assert.match(screen, /lastResult\?\.questionKey === currentQuestionKey/);
assert.match(screen, /currentResult\?\.correctAnswerIndex \?\? -1/);
assert.match(screen, /disabled=\{busy \|\| answerLocked\}/);
assert.match(screen, /if \(hasAlreadyAnswered\)/);
assert.match(screen, /claimTriviaAnswerSubmission\(questionKey, answerSubmissionKeyRef\.current\)/);
assert.match(screen, /answerSubmissionKeyRef\.current = claim\.submissionKey/);
assert.match(screen, /setOptimisticSelection\(\{ answerIndex, questionKey \}\)/);
assert.match(screen, /session\?\.currentSelection\?\.answerIndex \?\?[\s\S]*optimisticSelection/);
assert.equal((screen.match(/submitTriviaAnswer\(\{/g) ?? []).length, 1);
assert.match(screen, /submissionId = createTriviaSessionId\(\)/);
assert.match(screen, /resolveClientGameAuthority\(\{/);
assert.match(screen, /readTimestampMillis\(session\.questionEndsAt\)/);
assert.doesNotMatch(screen, /selectedQuestions|selectionRevealed|currentQuestion\.answer/);
assert.match(screen, /pointerEvents="none"/);
assert.match(screen, /accessibilityElementsHidden/);
assert.match(screen, /importantForAccessibility="no-hide-descendants"/);
assert.match(screen, /AccessibilityInfo\.announceForAccessibility/);
assert.match(screen, /announcedFeedbackRef\.current === feedbackQuestionKey/);
assert.match(screen, /announcedFeedbackRef\.current = null/);
assert.match(styles, /answerContent:[\s\S]*flexDirection: "row"[\s\S]*minHeight: 24/);
assert.match(styles, /answerButton:[\s\S]*minHeight: 52/);
assert.match(styles, /answerPressed:[\s\S]*backgroundColor/);
assert.match(styles, /answerText:[\s\S]*flex: 1[\s\S]*flexShrink: 1/);
assert.match(styles, /feedbackIconSlot:[\s\S]*flexShrink: 0[\s\S]*minHeight: 24[\s\S]*width: 24/);
assert.doesNotMatch(screen, /numberOfLines=|adjustsFontSizeToFit=/);
assert.match(screen, /const QUESTION_SECONDS = 15/);
assert.match(screen, /currentResult\s*\?\s*1400/);

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

assert.doesNotMatch(scoring, /firebase\/firestore|pointsAwarded\s*=/);
assert.match(scoring, /submitTriviaAnswer/);
assert.match(serverGame, /pointsAwarded = 10 \+ \(remainingMs >= 7000 \? 5 : 0\)/);
assert.match(serverGame, /streakBonusAwarded = 20/);
assert.match(serverGame, /transaction\.create\(submission/);
assert.match(serverGame, /toPublicQuestion\(firstQuestion\)/);
assert.doesNotMatch(
  screen,
  /from ["']@\/assets\/triviaBlitz\/questions\.json["']/,
  "The client screen must not bundle the answer bank.",
);

console.log("Trivia Blitz server-scoped answer feedback, icons, layout, accessibility, and localization checks passed.");
