import { httpsCallable } from "firebase/functions";

import { functions } from "@/config/firebase";

export type RewardGameType = "triviaBlitz" | "spotDifferences" | "bombDefusal";
export type GameRewardStatus = "awarded" | "alreadyAwarded" | "notEligible";

export type GameRewardResult = {
  status: GameRewardStatus;
  starsAwarded: number;
  totalSidelineStars: number;
  breakdown: {
    completionStars: number;
    performanceStars: number;
    achievementStars: number;
  };
};

type CreateGameRewardSessionResult = { sessionId: string; sourceSquadId: string | null };

export async function createGameRewardSession(input: {
  gameType: Exclude<RewardGameType, "triviaBlitz">;
  sessionId?: string | null;
  sourceSquadId?: string | null;
}): Promise<CreateGameRewardSessionResult> {
  const callable = httpsCallable<typeof input, CreateGameRewardSessionResult>(functions, "createGameRewardSession");
  return (await callable(input)).data;
}

export async function recordGameSessionResult(input:
  | {
      gameType: "spotDifferences";
      sessionId: string;
    }
  | {
      gameType: "bombDefusal";
      sessionId: string;
      outcome: "defused" | "exploded";
      firstAttemptCorrectStepCount: number;
      totalSteps: number;
    }
): Promise<{ status: "recorded" | "alreadyRecorded" }> {
  const callable = httpsCallable<typeof input, { status: "recorded" | "alreadyRecorded" }>(functions, "recordGameSessionResult");
  return (await callable(input)).data;
}

export async function finalizeGameReward(
  gameType: RewardGameType,
  sessionId: string,
): Promise<GameRewardResult> {
  const callable = httpsCallable<{ gameType: RewardGameType; sessionId: string }, GameRewardResult>(functions, "finalizeGameReward");
  return (await callable({ gameType, sessionId })).data;
}
