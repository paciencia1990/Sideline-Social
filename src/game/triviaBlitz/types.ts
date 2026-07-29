export type TriviaStatus = "lobby" | "playing" | "results";

/**
 * The public question projection that participants may read.
 *
 * The answer key deliberately does not belong in this type. Correctness is
 * disclosed by the backend only in `answerResult`, after a submission has
 * been accepted.
 */
export type TriviaQuestion = {
  id: string;
  category: string;
  question_en: string;
  question_es: string;
  options_en: string[];
  options_es: string[];
};

export type TriviaPlayer = {
  id: string;
  name: string;
  playerIndex: number;
  score: number;
  ready: boolean;
  createdAt?: unknown;
};

export type TriviaSelection = {
  playerId: string;
  answerIndex: number;
  selectedAt: number;
};

export type ScoreResult = {
  correct: boolean;
  pointsAwarded: number;
  streakBonusAwarded: number;
  correctAnswerIndex: number;
};

export type TriviaAnswerResult = ScoreResult & {
  questionIndex: number;
  playerId?: string;
  answerIndex?: number;
  submissionId?: string;
  revealedAt?: unknown;
};

export type TriviaSession = {
  status: TriviaStatus;
  turnIndex: number;
  questionIndex: number;
  questionCount: number;
  teamStreak: number;
  totalPoints: number;
  correctAnswers: number;
  answeredQuestions: number;
  totalPlayers: number;
  allReady: boolean;
  currentQuestion: TriviaQuestion | null;
  currentSelection: TriviaSelection | null;
  answerResult: TriviaAnswerResult | null;
  hostPlayerId: string;
  questionStartedAt: unknown | null;
  questionEndsAt: unknown | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type TriviaParentSession = {
  sessionId: string;
  gameId: "triviaBlitz";
  gameType: "triviaBlitz";
  hostPlayerId: string;
  playerIds: string[];
  status: TriviaStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
};

/**
 * Kept for the read-only Firebase helpers while permanent-account migration is
 * completed. Session mutation code must use the authenticated callable APIs.
 */
export type PlayerIdentity = {
  id: string;
  name: string;
  isAuthenticated: boolean;
};
