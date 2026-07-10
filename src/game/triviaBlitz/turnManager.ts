import { getDoc, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";

import {
  getTriviaParentSessionRef,
  getTriviaSessionPath,
  getTriviaSessionRef,
  logTriviaFirebaseError,
} from "./firebaseUtils";
import type { TriviaSession } from "./types";

export async function advanceTurn(sessionId: string) {
  const sessionRef = getTriviaSessionRef(sessionId);

  try {
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
      const batch = writeBatch(sessionRef.firestore);
      batch.update(sessionRef, {
        status: "results",
        currentSelection: null,
        selectionRevealed: false,
        updatedAt: serverTimestamp(),
      });
      batch.update(getTriviaParentSessionRef(sessionId), {
        status: "results",
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return;
    }

    await updateDoc(sessionRef, {
      questionIndex: nextQuestionIndex,
      turnIndex: nextTurnIndex,
      currentSelection: null,
      selectionRevealed: false,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    logTriviaFirebaseError("advanceTurn", { sessionId, path: getTriviaSessionPath(sessionId) }, error);
    throw error;
  }
}
