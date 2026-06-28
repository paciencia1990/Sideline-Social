import { getDoc, getDocs, increment, serverTimestamp, writeBatch } from "firebase/firestore";

import { getTriviaPlayersRef, getTriviaSessionRef } from "./firebaseUtils";
import type { TriviaQuestion, TriviaSession } from "./types";

export type ScoreResult = {
  correct: boolean;
  pointsAwarded: number;
  streakBonusAwarded: number;
  correctAnswerIndex: number;
};

export async function scoreSessionAnswer(
  sessionId: string,
  answerIndex: number,
  secondsRemaining: number,
): Promise<ScoreResult> {
  const sessionRef = getTriviaSessionRef(sessionId);
  const sessionSnap = await getDoc(sessionRef);

  if (!sessionSnap.exists()) {
    throw new Error("Trivia Blitz session was not found.");
  }

  const session = sessionSnap.data() as TriviaSession;
  const question = session.selectedQuestions[session.questionIndex] as TriviaQuestion | undefined;

  if (!question) {
    throw new Error("Trivia Blitz question was not found.");
  }

  const correct = answerIndex === question.answer;
  let pointsAwarded = 0;
  let nextTeamStreak = 0;
  let streakBonusAwarded = 0;

  if (correct) {
    pointsAwarded = 10;

    if (secondsRemaining >= 7) {
      pointsAwarded += 5;
    }

    nextTeamStreak = (session.teamStreak ?? 0) + 1;

    if (nextTeamStreak >= 3) {
      streakBonusAwarded = 20;
      pointsAwarded += streakBonusAwarded;
      nextTeamStreak = 0;
    }
  }

  const playersSnap = await getDocs(getTriviaPlayersRef(sessionId));
  const batch = writeBatch(sessionRef.firestore);

  batch.update(sessionRef, {
    totalPoints: increment(pointsAwarded),
    teamStreak: nextTeamStreak,
    correctAnswers: correct ? increment(1) : session.correctAnswers ?? 0,
    selectionRevealed: true,
    updatedAt: serverTimestamp(),
  });

  playersSnap.docs.forEach((playerDoc) => {
    batch.update(playerDoc.ref, {
      score: increment(pointsAwarded),
    });
  });

  await batch.commit();

  return {
    correct,
    pointsAwarded,
    streakBonusAwarded,
    correctAnswerIndex: question.answer,
  };
}

