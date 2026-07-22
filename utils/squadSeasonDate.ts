export type SquadSeasonStatus = "upcoming" | "active" | "closed" | "canceled" | "unknown";

export type SeasonDateField = {
  calendarDate: Date | null;
  dateKey: string | null;
  displayValue: string;
};

export type NormalizedSquadSeason = {
  seasonId: string;
  squadId: string | null;
  name: string;
  startDateKey: string | null;
  endDateKey: string | null;
  startAt: Date | null;
  endAt: Date | null;
  timeZone: string;
  status: SquadSeasonStatus;
  isCurrent: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
  detailsAvailable: boolean;
};

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const DEFAULT_SQUAD_TIME_ZONE = "America/New_York";

export function toSafeDate(value: unknown): Date | null {
  if (value instanceof Date) return validDate(value);

  if (value && typeof value === "object") {
    const timestamp = value as {
      _seconds?: unknown;
      seconds?: unknown;
      toDate?: unknown;
      toMillis?: unknown;
    };
    if (typeof timestamp.toDate === "function") {
      try {
        return validDate(timestamp.toDate());
      } catch {
        return null;
      }
    }
    if (typeof timestamp.toMillis === "function") {
      try {
        return dateFromNumber(timestamp.toMillis());
      } catch {
        return null;
      }
    }
    const seconds = readFiniteNumber(timestamp.seconds ?? timestamp._seconds);
    if (seconds !== null) return validDate(new Date(seconds * 1000));
  }

  if (typeof value === "number") return dateFromNumber(value);
  if (typeof value === "string") {
    const dateKey = normalizeDateKey(value);
    if (dateKey) return dateKeyToLocalDate(dateKey);
    return validDate(new Date(value));
  }
  return null;
}

export function normalizeSquadSeason(
  value: unknown,
  fallback: { seasonId?: string; squadId?: string; timeZone?: string | null } = {},
): NormalizedSquadSeason {
  const raw = isRecord(value) ? value : {};
  const seasonId = readString(raw.seasonId) ?? readString(raw.id) ?? fallback.seasonId ?? "";
  const squadId = readString(raw.squadId) ?? fallback.squadId ?? null;
  const name = readString(raw.name) ?? "";
  const requestedTimeZone = readString(raw.timeZone) ?? readString(raw.timezone) ?? fallback.timeZone ?? "";
  const timeZoneValid = isValidIanaTimeZone(requestedTimeZone);
  const timeZone = timeZoneValid ? requestedTimeZone : DEFAULT_SQUAD_TIME_ZONE;

  const rawStart = firstDefined(raw.startAt, raw.startsAt, raw.startAtMs, raw.startDate, raw.startDateKey);
  const rawEnd = firstDefined(raw.endAt, raw.endsAt, raw.endAtMs, raw.endDate, raw.endDateKey);
  const startAt = toSafeDate(rawStart);
  const endAt = toSafeDate(rawEnd);
  const startDateKey = normalizeDateKey(raw.startDateKey) ??
    normalizeDateKey(raw.startDate) ??
    (startAt ? dateKeyInTimeZone(startAt, timeZone) : null);
  const endDateKey = normalizeDateKey(raw.endDateKey) ??
    normalizeDateKey(raw.endDate) ??
    (endAt ? dateKeyInTimeZone(new Date(endAt.getTime() - 1), timeZone) : null);
  const status = normalizeStatus(raw.status);
  const rangeValid = Boolean(startDateKey && endDateKey && endDateKey >= startDateKey);

  return {
    seasonId,
    squadId,
    name,
    startDateKey,
    endDateKey,
    startAt: startAt ?? (startDateKey ? dateKeyToLocalDate(startDateKey) : null),
    endAt: endAt ?? (endDateKey ? dateKeyToLocalDate(endDateKey) : null),
    timeZone,
    status,
    isCurrent: raw.isCurrent === true,
    createdAt: toSafeDate(firstDefined(raw.createdAt, raw.createdAtMs)),
    updatedAt: toSafeDate(firstDefined(raw.updatedAt, raw.updatedAtMs)),
    detailsAvailable: Boolean(seasonId && name && timeZoneValid && status !== "unknown" && rangeValid),
  };
}

export function sortSquadSeasons(seasons: NormalizedSquadSeason[]): NormalizedSquadSeason[] {
  return [...seasons].sort((left, right) => {
    if (left.startDateKey && right.startDateKey) {
      const dateOrder = right.startDateKey.localeCompare(left.startDateKey);
      if (dateOrder !== 0) return dateOrder;
    } else if (left.startDateKey) return -1;
    else if (right.startDateKey) return 1;
    return left.seasonId.localeCompare(right.seasonId);
  });
}

export function normalizeDateKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = CALENDAR_DATE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function dateKeyToLocalDate(value: string): Date | null {
  const key = normalizeDateKey(value);
  if (!key) return null;
  const [year, month, day] = key.split("-").map(Number);
  return validDate(new Date(year, month - 1, day));
}

export function localDateToDateKey(value: Date): string | null {
  const date = validDate(value);
  if (!date) return null;
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function formatUsDate(value: Date): string {
  const key = localDateToDateKey(value);
  return key ? formatUsDateKey(key) : "";
}

export function formatUsDateKey(value: string | null): string {
  const key = value ? normalizeDateKey(value) : null;
  if (!key) return "";
  const [year, month, day] = key.split("-");
  return `${month}/${day}/${year}`;
}

export function formatSeasonDateRange(season: Pick<NormalizedSquadSeason, "startDateKey" | "endDateKey">): string | null {
  const start = formatUsDateKey(season.startDateKey);
  const end = formatUsDateKey(season.endDateKey);
  return start && end ? `${start} – ${end}` : null;
}

export function formatSpokenDateKey(value: string | null, language: string): string {
  const date = value ? dateKeyToLocalDate(value) : null;
  if (!date) return "";
  return new Intl.DateTimeFormat(language.startsWith("es") ? "es-US" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function createSeasonDateField(dateKey: string | null): SeasonDateField {
  const normalized = dateKey ? normalizeDateKey(dateKey) : null;
  return {
    calendarDate: normalized ? dateKeyToLocalDate(normalized) : null,
    dateKey: normalized,
    displayValue: formatUsDateKey(normalized),
  };
}

export function isValidIanaTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function dateKeyInTimeZone(date: Date, timeZone: string): string | null {
  const valid = validDate(date);
  if (!valid || !isValidIanaTimeZone(timeZone)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).formatToParts(valid);
    const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return normalizeDateKey(`${map.year}-${map.month}-${map.day}`);
  } catch {
    return null;
  }
}

function normalizeStatus(value: unknown): SquadSeasonStatus {
  if (value === "upcoming" || value === "scheduled") return "upcoming";
  if (value === "active") return "active";
  if (value === "closed" || value === "completed") return "closed";
  if (value === "canceled" || value === "cancelled") return "canceled";
  return "unknown";
}

function validDate(value: unknown): Date | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

function dateFromNumber(value: unknown): Date | null {
  const numeric = readFiniteNumber(value);
  if (numeric === null) return null;
  const milliseconds = Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric;
  return validDate(new Date(milliseconds));
}

function readFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
