export const SCHEDULE_EVENT_TYPES = ['game', 'practice', 'teamEvent'] as const;
export const SCHEDULE_STATUSES = ['scheduled', 'postponed', 'cancelled', 'completed'] as const;
export const SCHEDULE_HOME_AWAY = ['home', 'away', 'neutral'] as const;
export const MAX_SCHEDULE_RECURRENCES = 52;
export const MAX_SCHEDULE_IMPORT_ROWS = 200;

export type ScheduleEventType = (typeof SCHEDULE_EVENT_TYPES)[number];
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];
export type ScheduleHomeAway = (typeof SCHEDULE_HOME_AWAY)[number];

export type NormalizedScheduleInput = {
  type: ScheduleEventType;
  title: string;
  localDate: string;
  startAtMillis: number;
  endAtMillis: number;
  arrivalAtMillis: number | null;
  timezone: string;
  isAllDay: boolean;
  opponentName: string | null;
  homeAway: ScheduleHomeAway | null;
  venueName: string | null;
  field: string | null;
  address: string | null;
  status: ScheduleStatus;
  teamScore: number | null;
  opponentScore: number | null;
  notes: string | null;
};

type ScheduleInput = {
  type?: unknown;
  title?: unknown;
  date?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  arrivalTime?: unknown;
  timezone?: unknown;
  isAllDay?: unknown;
  opponentName?: unknown;
  homeAway?: unknown;
  venueName?: unknown;
  field?: unknown;
  address?: unknown;
  status?: unknown;
  teamScore?: unknown;
  opponentScore?: unknown;
  notes?: unknown;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u;

export function normalizeScheduleInput(value: unknown): NormalizedScheduleInput {
  const input = isRecord(value) ? value as ScheduleInput : {};
  const type = readEnum(input.type, SCHEDULE_EVENT_TYPES, 'event type');
  const title = readRequiredString(input.title, 'title', 120);
  const localDate = readDate(input.date);
  const timezone = readTimeZone(input.timezone);
  const isAllDay = input.isAllDay === true;
  const startTime = isAllDay ? '00:00' : readTime(input.startTime, 'start time');
  const endTime = isAllDay ? '00:00' : readTime(input.endTime, 'end time');
  const startAtMillis = zonedDateTimeToMillis(localDate, startTime, timezone);
  const endAtMillis = isAllDay
    ? zonedDateTimeToMillis(addDateDays(localDate, 1), '00:00', timezone)
    : zonedDateTimeToMillis(localDate, endTime, timezone);
  if (endAtMillis <= startAtMillis) throw new Error('end_before_start');
  const arrivalTime = isAllDay ? '' : readOptionalTime(input.arrivalTime);
  const arrivalAtMillis = arrivalTime
    ? zonedDateTimeToMillis(localDate, arrivalTime, timezone)
    : null;
  if (arrivalAtMillis !== null && arrivalAtMillis > startAtMillis) throw new Error('arrival_after_start');
  const status = readOptionalEnum(input.status, SCHEDULE_STATUSES, 'status') ?? 'scheduled';
  const homeAway = readOptionalEnum(input.homeAway, SCHEDULE_HOME_AWAY, 'home or away');
  const teamScore = readOptionalScore(input.teamScore);
  const opponentScore = readOptionalScore(input.opponentScore);
  if ((teamScore !== null || opponentScore !== null) && type !== 'game') throw new Error('score_only_for_game');
  if ((teamScore !== null || opponentScore !== null) && status !== 'completed') throw new Error('score_requires_completed');
  return {
    type,
    title,
    localDate,
    startAtMillis,
    endAtMillis,
    arrivalAtMillis,
    timezone,
    isAllDay,
    opponentName: readOptionalString(input.opponentName, 'opponent', 120),
    homeAway,
    venueName: readOptionalString(input.venueName, 'venue', 160),
    field: readOptionalString(input.field, 'field', 80),
    address: readOptionalString(input.address, 'address', 240),
    status,
    teamScore,
    opponentScore,
    notes: readOptionalString(input.notes, 'notes', 2000),
  };
}

export function generateWeeklyScheduleDates(
  startDate: string,
  weekdaysValue: unknown,
  endDateValue: unknown,
) {
  const endDate = readDate(endDateValue);
  if (endDate < startDate) throw new Error('recurrence_end_before_start');
  const weekdays = Array.isArray(weekdaysValue)
    ? Array.from(new Set(weekdaysValue.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)))
    : [];
  if (weekdays.length === 0) throw new Error('recurrence_weekday_required');
  const dates: string[] = [];
  const cursor = dateKeyToUtcDate(startDate);
  const finalDate = dateKeyToUtcDate(endDate);
  while (cursor <= finalDate) {
    if (weekdays.includes(cursor.getUTCDay())) dates.push(toUtcDateKey(cursor));
    if (dates.length > MAX_SCHEDULE_RECURRENCES) throw new Error('recurrence_limit');
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (dates.length === 0) throw new Error('recurrence_empty');
  return dates;
}

export function scheduleFingerprintCanonical(input: NormalizedScheduleInput) {
  return [
    input.type,
    clean(input.title),
    input.localDate,
    input.startAtMillis,
    input.endAtMillis,
    input.arrivalAtMillis ?? '',
    input.timezone,
    clean(input.opponentName ?? ''),
    input.homeAway ?? '',
    clean(input.venueName ?? ''),
    clean(input.field ?? ''),
    clean(input.address ?? ''),
    input.status,
    input.teamScore ?? '',
    input.opponentScore ?? '',
    clean(input.notes ?? ''),
  ].join('|');
}

export function scheduleMaterialChange(
  before: Record<string, unknown>,
  after: NormalizedScheduleInput,
) {
  if (before.status !== after.status && after.status === 'cancelled') return 'cancelled';
  if (before.status !== after.status && after.status === 'postponed') return 'postponed';
  if (timestampMillis(before.startAt) !== after.startAtMillis || timestampMillis(before.endAt) !== after.endAtMillis) return 'timeChanged';
  if ((before.venueName ?? null) !== after.venueName || (before.field ?? null) !== after.field) return 'venueChanged';
  return 'updated';
}

export function zonedDateTimeToMillis(date: string, time: string, timezone: string) {
  readDate(date);
  readTime(time, 'time');
  readTimeZone(timezone);
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = dateTimeParts(new Date(guess), timezone);
    const rendered = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const difference = target - rendered;
    if (difference === 0) break;
    guess += difference;
  }
  const verified = dateTimeParts(new Date(guess), timezone);
  if (
    verified.year !== year || verified.month !== month || verified.day !== day ||
    verified.hour !== hour || verified.minute !== minute
  ) {
    throw new Error('invalid_local_time');
  }
  return guess;
}

export function addDateDays(date: string, days: number) {
  const value = dateKeyToUtcDate(readDate(date));
  value.setUTCDate(value.getUTCDate() + days);
  return toUtcDateKey(value);
}

function readDate(value: unknown) {
  const date = typeof value === 'string' ? value.trim() : '';
  if (!DATE_PATTERN.test(date) || toUtcDateKey(dateKeyToUtcDate(date)) !== date) throw new Error('invalid_date');
  return date;
}

function readTime(value: unknown, label: string) {
  const time = typeof value === 'string' ? value.trim() : '';
  if (!TIME_PATTERN.test(time)) throw new Error(`invalid_${label.replace(/\s+/gu, '_')}`);
  return time;
}

function readOptionalTime(value: unknown) {
  if (value == null || value === '') return '';
  return readTime(value, 'arrival_time');
}

function readTimeZone(value: unknown) {
  const timezone = typeof value === 'string' ? value.trim() : '';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error('invalid_timezone');
  }
  if (!timezone || timezone.length > 80) throw new Error('invalid_timezone');
  return timezone;
}

function readRequiredString(value: unknown, label: string, maximum: number) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
  if (!text) throw new Error(`${label}_required`);
  if (text.length > maximum) throw new Error(`${label}_too_long`);
  return text;
}

function readOptionalString(value: unknown, label: string, maximum: number) {
  if (value == null || value === '') return null;
  const text = typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
  if (!text) return null;
  if (text.length > maximum) throw new Error(`${label}_too_long`);
  return text;
}

function readEnum<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`invalid_${label.replace(/\s+/gu, '_')}`);
  return value as T;
}

function readOptionalEnum<T extends string>(value: unknown, values: readonly T[], label: string): T | null {
  if (value == null || value === '') return null;
  return readEnum(value, values, label);
}

function readOptionalScore(value: unknown) {
  if (value == null || value === '') return null;
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 999) throw new Error('invalid_score');
  return Number(value);
}

function dateTimeParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

function timestampMillis(value: unknown) {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis();
  return 0;
}

function clean(value: string) {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

function dateKeyToUtcDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toUtcDateKey(value: Date) {
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
