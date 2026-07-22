import { httpsCallable } from "firebase/functions";

import { functions } from "@/config/firebase";
import type { SquadSportId } from "@/constants/sports";
import type { LeaderboardTierKey } from "@/constants/sidelineStars";
import {
  DEFAULT_SQUAD_TIME_ZONE,
  normalizeSquadSeason,
  sortSquadSeasons,
  type NormalizedSquadSeason,
} from "@/utils/squadSeasonDate";

export type { SquadSeasonStatus } from "@/utils/squadSeasonDate";
export type SquadSeasonSummary = NormalizedSquadSeason;
type ManagedSquadSeasonStatus = "upcoming" | "active" | "closed";

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
  idempotencyKey: string;
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
    unknown
  >(functions, "getSquadLeaderboard");
  return normalizeLeaderboardResult(
    (await callable({ squadId, ...(seasonId ? { seasonId } : {}) })).data,
    squadId,
  );
}

export async function getSquadSeasons(squadId: string): Promise<GetSquadSeasonsResult> {
  const callable = httpsCallable<{ squadId: string }, unknown>(functions, "getSquadSeasons");
  return normalizeSeasonManagementResult((await callable({ squadId })).data, squadId);
}

export async function createSquadSeason(input: CreateSquadSeasonInput) {
  const callable = httpsCallable<CreateSquadSeasonInput, { seasonId: string; status: ManagedSquadSeasonStatus; alreadyCreated?: boolean }>(
    functions,
    "createSquadSeason",
  );
  return (await callable(input)).data;
}

export async function updateSquadSeason(input: UpdateSquadSeasonInput) {
  const callable = httpsCallable<UpdateSquadSeasonInput, { seasonId: string; status: ManagedSquadSeasonStatus }>(
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

function normalizeSeasonManagementResult(value: unknown, squadId: string): GetSquadSeasonsResult {
  const raw = asRecord(value);
  const timeZone = readString(raw.timeZone);
  return {
    squadId: readString(raw.squadId) ?? squadId,
    currentSeasonId: readString(raw.currentSeasonId),
    canManageSeasons: raw.canManageSeasons === true,
    timeZone,
    seasons: normalizeSeasonList(raw.seasons, squadId, timeZone),
  };
}

function normalizeLeaderboardResult(value: unknown, squadId: string): SquadLeaderboardResult {
  const raw = asRecord(value);
  const rawSquad = asRecord(raw.squad);
  const availableSeasons = normalizeSeasonList(raw.availableSeasons, squadId, null);
  return {
    squad: {
      squadId: readString(rawSquad.squadId) ?? squadId,
      venueName: readString(rawSquad.venueName) ?? "Sports Venue",
      sportId: (readString(rawSquad.sportId) ?? "other") as SquadSportId,
      sportDisplayName: readString(rawSquad.sportDisplayName) ?? "Sports",
    },
    season: raw.season == null ? null : normalizeSquadSeason(raw.season, { squadId }),
    entries: Array.isArray(raw.entries) ? raw.entries as SquadLeaderboardEntry[] : [],
    currentUserEntry: raw.currentUserEntry && typeof raw.currentUserEntry === "object"
      ? raw.currentUserEntry as SquadLeaderboardEntry
      : null,
    currentUserLifetimeStars: readFiniteNumber(raw.currentUserLifetimeStars),
    totalMemberCount: readFiniteNumber(raw.totalMemberCount),
    availableSeasons,
    nextSeason: raw.nextSeason == null ? null : normalizeSquadSeason(raw.nextSeason, { squadId }),
    canManageSeasons: raw.canManageSeasons === true,
  };
}

function normalizeSeasonList(value: unknown, squadId: string, timeZone: string | null): SquadSeasonSummary[] {
  if (!Array.isArray(value)) return [];
  return sortSquadSeasons(value.map((season, index) => normalizeSquadSeason(season, {
    seasonId: `unavailable-${index}`,
    squadId,
    timeZone: timeZone ?? DEFAULT_SQUAD_TIME_ZONE,
  })));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
