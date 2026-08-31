export type TriviaAnswerVisualState =
  | "idle"
  | "selected-pending"
  | "selected-correct"
  | "selected-incorrect"
  | "revealed-correct"
  | "disabled";

export type TriviaAnswerFeedbackIcon = "check" | "x" | null;

export type TriviaAnswerAccessibilityLabels = {
  correctAnswer: string;
  yourAnswerCorrect: string;
  yourAnswerIncorrect: string;
  selectedAnswerIncorrect: string;
  notSelected: string;
};

export type TriviaAnswerSubmissionClaim = {
  accepted: boolean;
  submissionKey: string;
};

export function claimTriviaAnswerSubmission(
  questionKey: string,
  inFlightQuestionKey: string,
): TriviaAnswerSubmissionClaim {
  if (!questionKey || inFlightQuestionKey === questionKey) {
    return { accepted: false, submissionKey: inFlightQuestionKey };
  }
  return { accepted: true, submissionKey: questionKey };
}

type ResolveTriviaAnswerVisualStateInput = {
  answerIndex: number;
  selectedAnswerIndex: number | null;
  correctAnswerIndex: number;
  resultKnown: boolean;
  currentQuestionKey: string;
  feedbackQuestionKey: string | null;
};

export function createTriviaQuestionKey(questionIndex: number, questionIdentity: string) {
  return `${questionIndex}:${questionIdentity}`;
}

export function resolveTriviaAnswerVisualState({
  answerIndex,
  selectedAnswerIndex,
  correctAnswerIndex,
  resultKnown,
  currentQuestionKey,
  feedbackQuestionKey,
}: ResolveTriviaAnswerVisualStateInput): TriviaAnswerVisualState {
  const selected = selectedAnswerIndex === answerIndex;
  const resultBelongsToCurrentQuestion =
    selectedAnswerIndex !== null &&
    resultKnown &&
    feedbackQuestionKey !== null &&
    feedbackQuestionKey === currentQuestionKey;

  if (!resultBelongsToCurrentQuestion) {
    return selected ? "selected-pending" : "idle";
  }

  if (selected && answerIndex === correctAnswerIndex) {
    return "selected-correct";
  }

  if (selected) {
    return "selected-incorrect";
  }

  if (answerIndex === correctAnswerIndex) {
    return "revealed-correct";
  }

  return "disabled";
}

export function getTriviaAnswerFeedbackIcon(
  visualState: TriviaAnswerVisualState,
): TriviaAnswerFeedbackIcon {
  if (visualState === "selected-correct" || visualState === "revealed-correct") {
    return "check";
  }

  return visualState === "selected-incorrect" ? "x" : null;
}

export function getTriviaAnswerAccessibilityLabel(
  answer: string,
  visualState: TriviaAnswerVisualState,
  labels: TriviaAnswerAccessibilityLabels,
  isOwnSelection: boolean,
) {
  let stateLabel: string | null = null;

  if (visualState === "selected-correct") {
    stateLabel = isOwnSelection ? labels.yourAnswerCorrect : labels.correctAnswer;
  } else if (visualState === "selected-incorrect") {
    stateLabel = isOwnSelection ? labels.yourAnswerIncorrect : labels.selectedAnswerIncorrect;
  } else if (visualState === "revealed-correct") {
    stateLabel = labels.correctAnswer;
  } else if (visualState === "disabled") {
    stateLabel = labels.notSelected;
  }

  return stateLabel ? `${answer}, ${stateLabel}` : answer;
}
