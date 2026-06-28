import { getDoc, serverTimestamp, updateDoc } from "firebase/firestore";

import { getTriviaSessionRef } from "./firebaseUtils";
import type { TriviaSession } from "./types";

export async function advanceTurn(sessionId: string) {
  const sessionRef = getTriviaSessionRef(sessionId);
  const sessionSnap = await getDoc(sessionRef);

  if (!sessionSnap.exists()) {
    throw new Error("Trivia Blitz session was not found.");
  }

  const session = sessionSnap.data() as TriviaSession;
  const nextQuestionIndex = (session.questionIndex ?? 0) + 1;
  const totalPlayers = Math.max(session.totalPlayers ?? 0, 1);
  const nextTurnIndex = ((session.turnIndex ?? 0) + 1) % totalPlayers;
  const totalQuestions = session.selectedQuestions?.length ?? 0;

  if (nextQuestionIndex >= totalQuestions) {
    await updateDoc(sessionRef, {
      status: "results",
      currentSelection: null,
      selectionRevealed: false,
      updatedAt: serverTimestamp(),
    });
    return;
  }

  await updateDoc(sessionRef, {
    questionIndex: nextQuestionIndex,
    turnIndex: nextTurnIndex,
    currentSelection: null,
    selectionRevealed: false,
    updatedAt: serverTimestamp(),
  });
}
