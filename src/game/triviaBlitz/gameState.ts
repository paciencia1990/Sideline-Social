import { httpsCallable } from "firebase/functions";

import { functions } from "@/config/firebase";
import type { ScoreResult } from "./types";

export type TriviaSessionIdentity = {
  sessionId: string;
  playerId: string;
  isHost: boolean;
};

export type CreateTriviaGameSessionInput = {
  requestedSessionId?: string;
};

export type ResumeTriviaGameSessionInput = {
  sessionId: string;
};

export type SetTriviaPlayerReadyInput = {
  sessionId: string;
  ready: boolean;
};

export type StartTriviaGameSessionInput = {
  sessionId: string;
};

export type SubmitTriviaAnswerInput = {
  sessionId: string;
  questionIndex: number;
  answerIndex: number;
  submissionId: string;
};

export type AdvanceTriviaGameSessionInput = {
  sessionId: string;
  questionIndex: number;
};

export type ResetTriviaGameSessionInput = {
  sessionId: string;
};

export type EndTriviaGameSessionInput = {
  sessionId: string;
};

export async function createTriviaGameSession(
  input: CreateTriviaGameSessionInput = {},
): Promise<TriviaSessionIdentity> {
  return callTriviaFunction<CreateTriviaGameSessionInput, TriviaSessionIdentity>(
    "createTriviaGameSession",
    input,
  );
}

export async function resumeTriviaGameSession(
  input: ResumeTriviaGameSessionInput,
): Promise<TriviaSessionIdentity> {
  return callTriviaFunction<ResumeTriviaGameSessionInput, TriviaSessionIdentity>(
    "resumeTriviaGameSession",
    input,
  );
}

export async function setTriviaPlayerReady(input: SetTriviaPlayerReadyInput) {
  return callTriviaFunction<SetTriviaPlayerReadyInput, { ready: boolean }>(
    "setTriviaPlayerReady",
    input,
  );
}

export async function startTriviaGameSession(input: StartTriviaGameSessionInput) {
  return callTriviaFunction<StartTriviaGameSessionInput, { status: "playing" }>(
    "startTriviaGameSession",
    input,
  );
}

export async function submitTriviaAnswer(input: SubmitTriviaAnswerInput): Promise<ScoreResult> {
  return callTriviaFunction<SubmitTriviaAnswerInput, ScoreResult>(
    "submitTriviaAnswer",
    input,
  );
}

export async function advanceTriviaGameSession(input: AdvanceTriviaGameSessionInput) {
  return callTriviaFunction<
    AdvanceTriviaGameSessionInput,
    { status: "playing" | "results"; questionIndex: number }
  >("advanceTriviaGameSession", input);
}

export async function resetTriviaGameSession(input: ResetTriviaGameSessionInput) {
  return callTriviaFunction<ResetTriviaGameSessionInput, { status: "lobby" }>(
    "resetTriviaGameSession",
    input,
  );
}

export async function endTriviaGameSession(input: EndTriviaGameSessionInput) {
  return callTriviaFunction<EndTriviaGameSessionInput, { status: "results" }>(
    "endTriviaGameSession",
    input,
  );
}

async function callTriviaFunction<Input, Output>(name: string, input: Input): Promise<Output> {
  const callable = httpsCallable<Input, Output>(functions, name);
  return (await callable(input)).data;
}

/**
 * Compatibility wrappers for callers migrating from the direct-write API.
 * Every wrapper delegates to the same authenticated callable boundary.
 */
export async function createGameSession(_hostName: string, requestedSessionId?: string) {
  return createTriviaGameSession(requestedSessionId ? { requestedSessionId } : {});
}

export async function joinGameSession(sessionId: string, _playerName: string) {
  return resumeTriviaGameSession({ sessionId });
}

export async function startGameSession(sessionId: string) {
  await startTriviaGameSession({ sessionId });
}

export async function togglePlayerReady(sessionId: string, _playerId: string, ready: boolean) {
  await setTriviaPlayerReady({ sessionId, ready });
}

export async function resetGameSession(sessionId: string) {
  await resetTriviaGameSession({ sessionId });
}

export async function forceEndGameSession(sessionId: string) {
  await endTriviaGameSession({ sessionId });
}
