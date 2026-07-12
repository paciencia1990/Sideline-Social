import { httpsCallable } from "firebase/functions";

import { functions } from "@/config/firebase";

export interface UserWeeklyChallenge {
  weekKey: string;
  challengeId: string;
  title: string;
  description: string;
  points: number;
  category: "sidelineConnection";
  completed: boolean;
  completedAt: string | null;
  pointsAwarded: boolean;
  timezone: string;
  nextResetKey: string;
}

export interface WeeklyChallengeCompletionResult {
  challenge: UserWeeklyChallenge;
  alreadyCompleted: boolean;
  pointsAwarded: number;
  sidelineStars: number;
}

type AssignmentResponse = { challenge: UserWeeklyChallenge };

export async function getCurrentWeeklyChallenge(): Promise<UserWeeklyChallenge> {
  const callable = httpsCallable<{ timezone?: string }, AssignmentResponse>(functions, "getCurrentWeeklyChallenge");
  const response = await callable({ timezone: getDeviceTimeZone() });
  return response.data.challenge;
}

export async function completeWeeklyChallenge(weekKey: string): Promise<WeeklyChallengeCompletionResult> {
  const callable = httpsCallable<{ weekKey: string }, WeeklyChallengeCompletionResult>(functions, "completeWeeklyChallenge");
  const response = await callable({ weekKey });
  return response.data;
}

function getDeviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}