import { isActiveSquadAdmin } from './squadAdminCore';

export type SquadSeasonStatus = 'upcoming' | 'active' | 'closed';

export type SquadSeasonState = {
  seasonId: string;
  status: SquadSeasonStatus;
  startAtMs: number;
  endAtMs: number;
};

export type SquadSeasonStateChange = {
  seasonId: string;
  status: SquadSeasonStatus;
  activatedAtMs?: number;
  closedAtMs?: number;
  closeReason?: 'scheduledEnd';
};

export type SeasonRankableEntry = {
  userId: string;
  displayName: string | null;
  seasonStars: number;
};

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function normalizeSeasonName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('INVALID_SEASON_NAME');
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < 2 || normalized.length > 80) throw new Error('INVALID_SEASON_NAME');
  return normalized;
}

export function normalizeIanaTimeZone(value: unknown): string {
  if (typeof value !== 'string') throw new Error('INVALID_TIME_ZONE');
  const normalized = value.trim();
  if (!normalized || normalized.length > 80) throw new Error('INVALID_TIME_ZONE');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(0);
  } catch {
    throw new Error('INVALID_TIME_ZONE');
  }
  return normalized;
}

export function parseCalendarDate(value: unknown): { year: number; month: number; day: number } {
  if (typeof value !== 'string') throw new Error('INVALID_CALENDAR_DATE');
  const match = CALENDAR_DATE.exec(value);
  if (!match) throw new Error('INVALID_CALENDAR_DATE');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('INVALID_CALENDAR_DATE');
  }
  return { year, month, day };
}

export function addCalendarDays(value: string, days: number): string {
  const { year, month, day } = parseCalendarDate(value);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function localMidnightToUtcMs(value: string, timeZoneValue: string): number {
  const timeZone = normalizeIanaTimeZone(timeZoneValue);
  const target = parseCalendarDate(value);
  const targetAsUtc = Date.UTC(target.year, target.month - 1, target.day);
  let candidate = targetAsUtc;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]));
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const difference = representedAsUtc - targetAsUtc;
    if (difference === 0) return candidate;
    candidate -= difference;
  }

  throw new Error('INVALID_TIME_ZONE_BOUNDARY');
}

export function resolveSeasonBoundaries(input: {
  startDate: string;
  endDate: string;
  timeZone: string;
  startNow: boolean;
  nowMs: number;
}): { startAtMs: number; endAtMs: number; timeZone: string } {
  const timeZone = normalizeIanaTimeZone(input.timeZone);
  parseCalendarDate(input.startDate);
  parseCalendarDate(input.endDate);
  const startAtMs = input.startNow
    ? input.nowMs
    : localMidnightToUtcMs(input.startDate, timeZone);
  const endAtMs = localMidnightToUtcMs(addCalendarDays(input.endDate, 1), timeZone);
  if (!input.startNow && startAtMs < input.nowMs) throw new Error('START_IN_PAST');
  if (endAtMs <= startAtMs) throw new Error('END_NOT_AFTER_START');
  return { startAtMs, endAtMs, timeZone };
}

export function seasonRangesOverlap(
  left: { startAtMs: number; endAtMs: number },
  right: { startAtMs: number; endAtMs: number },
): boolean {
  return left.startAtMs < right.endAtMs && right.startAtMs < left.endAtMs;
}

export function seasonContainsTimestamp(
  season: { startAtMs: number; endAtMs: number },
  awardedAtMs: number,
): boolean {
  return season.startAtMs <= awardedAtMs && awardedAtMs < season.endAtMs;
}

export function planSeasonStateSynchronization(
  seasons: SquadSeasonState[],
  nowMs: number,
  currentSeasonId: string | null,
): { changes: SquadSeasonStateChange[]; currentSeasonId: string | null } {
  const changes: SquadSeasonStateChange[] = [];
  const liveActive = seasons.filter((season) => (
    season.status === 'active' && season.startAtMs <= nowMs && nowMs < season.endAtMs
  ));
  if (liveActive.length > 1) throw new Error('MULTIPLE_ACTIVE_SEASONS');

  seasons.forEach((season) => {
    if (season.endAtMs <= nowMs && season.status !== 'closed') {
      changes.push({
        seasonId: season.seasonId,
        status: 'closed',
        closedAtMs: season.endAtMs,
        closeReason: 'scheduledEnd',
      });
    }
  });

  let active = liveActive[0] ?? null;
  if (!active) {
    const due = seasons
      .filter((season) => season.status === 'upcoming' && season.startAtMs <= nowMs && nowMs < season.endAtMs)
      .sort((left, right) => left.startAtMs - right.startAtMs || left.seasonId.localeCompare(right.seasonId));
    if (due.length > 1) throw new Error('OVERLAPPING_UPCOMING_SEASONS');
    active = due[0] ?? null;
    if (active) {
      changes.push({
        seasonId: active.seasonId,
        status: 'active',
        activatedAtMs: nowMs,
      });
    }
  }

  const nextCurrentSeasonId = active?.seasonId ?? null;
  if (currentSeasonId === nextCurrentSeasonId && changes.length === 0) {
    return { changes: [], currentSeasonId };
  }
  return { changes, currentSeasonId: nextCurrentSeasonId };
}

export function rankSeasonLeaderboardEntries<T extends SeasonRankableEntry>(
  entries: T[],
): Array<T & { rank: number }> {
  const sorted = [...entries].sort((left, right) => {
    const starDifference = normalizeSeasonStars(right.seasonStars) - normalizeSeasonStars(left.seasonStars);
    if (starDifference !== 0) return starDifference;
    const nameDifference = (left.displayName ?? '').localeCompare(right.displayName ?? '', 'en', { sensitivity: 'base' });
    return nameDifference !== 0 ? nameDifference : left.userId.localeCompare(right.userId);
  });

  let previousStars: number | null = null;
  let previousRank = 0;
  return sorted.map((entry, index) => {
    const seasonStars = normalizeSeasonStars(entry.seasonStars);
    const rank = seasonStars === previousStars ? previousRank : index + 1;
    previousStars = seasonStars;
    previousRank = rank;
    return { ...entry, seasonStars, rank };
  });
}

export function normalizeSeasonStars(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

export function isAuthorizedSeasonManager(input: {
  squadId: string;
  userId: string;
  isPlatformAdmin: boolean;
  membershipStatus: unknown;
  squadRole: unknown;
  squadCreatorId: unknown;
}): boolean {
  if (input.isPlatformAdmin) return true;
  return isActiveSquadAdmin({
    squad: { createdBy: input.squadCreatorId },
    membership: {
      userId: input.userId,
      squadId: input.squadId,
      membershipStatus: input.membershipStatus,
      squadRole: input.squadRole,
    },
    squadId: input.squadId,
    userId: input.userId,
  });
}
