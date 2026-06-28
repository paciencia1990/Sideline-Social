export type TriviaStatus = "lobby" | "playing" | "results";

export type TriviaQuestion = {
  category: string;
  question_en: string;
  question_es: string;
  options_en: string[];
  options_es: string[];
  answer: number;
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

export type TriviaSession = {
  status: TriviaStatus;
  turnIndex: number;
  questionIndex: number;
  teamStreak: number;
  totalPoints: number;
  correctAnswers: number;
  totalPlayers: number;
  selectedQuestions: TriviaQuestion[];
  allReady: boolean;
  currentSelection: TriviaSelection | null;
  selectionRevealed: boolean;
  hostPlayerId?: string;
  sessionCode?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type PlayerIdentity = {
  id: string;
  name: string;
  isAuthenticated: boolean;
};
