import { httpsCallable } from "firebase/functions";
import { Timestamp } from "firebase/firestore";

import { functions } from "@/config/firebase";
import type { SquadSportId } from "@/constants/sports";
import type { LeaderboardTierKey } from "@/constants/sidelineStars";

export type SquadSeasonStatus = "upcoming" | "active" | "closed";

export type SquadSeasonSummary = {
  seasonId: string;
  name: string;
  startAt: Timestamp;
  endAt: Timestamp;
  timeZone: string;
  status: SquadSeasonStatus;
  isCurrent: boolean;
};

export type SquadLeaderboardEntry = {
  userId: string;
  displayName: string | null;
  seasonStars: number;
  rank: number;
  lifetimeTier: LeaderboardTierKey;
  isCurrentUser: boolean;
};

export type SquadLeaderboardResult = {
  squad: {
    squadId: string;
    venueName: string;
    sportId: SquadSportId;
    sportDisplayName: string;
  };
  season: SquadSeasonSummary | null;
  entries: SquadLeaderboardEntry[];
  currentUserEntry: SquadLeaderboardEntry | null;
  currentUserLifetimeStars: number;
  totalMemberCount: number;
  availableSeasons: SquadSeasonSummary[];
  nextSeason: SquadSeasonSummary | null;
  canManageSeasons: boolean;
};

export type GetSquadSeasonsResult = {
  squadId: string;
  currentSeasonId: string | null;
  canManageSeasons: boolean;
  timeZone: string | null;
  seasons: SquadSeasonSummary[];
};

export type CreateSquadSeasonInput = {
  squadId: string;
  name: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  startNow?: boolean;
};

export type UpdateSquadSeasonInput = {
  squadId: string;
  seasonId: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  timeZone?: string;
};

export async function getSquadLeaderboard(
  squadId: string,
  seasonId?: string,
): Promise<SquadLeaderboardResult> {
  const callable = httpsCallable<
    { squadId: string; seasonId?: string },
    SquadLeaderboardResult
  >(functions, "getSquadLeaderboard");
  return (await callable({ squadId, ...(seasonId ? { seasonId } : {}) })).data;
}

export async function getSquadSeasons(squadId: string): Promise<GetSquadSeasonsResult> {
  const callable = httpsCallable<{ squadId: string }, GetSquadSeasonsResult>(functions, "getSquadSeasons");
  return (await callable({ squadId })).data;
}

export async function createSquadSeason(input: CreateSquadSeasonInput) {
  const callable = httpsCallable<CreateSquadSeasonInput, { seasonId: string; status: SquadSeasonStatus }>(
    functions,
    "createSquadSeason",
  );
  return (await callable(input)).data;
}

export async function updateSquadSeason(input: UpdateSquadSeasonInput) {
  const callable = httpsCallable<UpdateSquadSeasonInput, { seasonId: string; status: SquadSeasonStatus }>(
    functions,
    "updateSquadSeason",
  );
  return (await callable(input)).data;
}

export async function endSquadSeason(squadId: string, seasonId: string) {
  const callable = httpsCallable<
    { squadId: string; seasonId: string },
    { seasonId: string; status: "closed" }
  >(functions, "endSquadSeason");
  return (await callable({ squadId, seasonId })).data;
}
