export const TEAM_SCHEDULE_EVENT_TYPES = ["game", "practice", "teamEvent"] as const;
export const TEAM_SCHEDULE_STATUSES = ["scheduled", "postponed", "cancelled", "completed"] as const;
export const TEAM_SCHEDULE_HOME_AWAY = ["home", "away", "neutral"] as const;
export const TEAM_SCHEDULE_MAX_RECURRENCES = 52;
export const TEAM_SCHEDULE_MAX_IMPORT_ROWS = 200;
export const TEAM_SCHEDULE_MAX_CSV_BYTES = 256 * 1024;

export type TeamScheduleEventType = (typeof TEAM_SCHEDULE_EVENT_TYPES)[number];
export type TeamScheduleStatus = (typeof TEAM_SCHEDULE_STATUSES)[number];
export type TeamScheduleHomeAway = (typeof TEAM_SCHEDULE_HOME_AWAY)[number];

export type TeamScheduleDraft = {
  type: TeamScheduleEventType;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  arrivalTime: string;
  timezone: string;
  isAllDay: boolean;
  opponentName: string;
  homeAway: TeamScheduleHomeAway | "";
  venueName: string;
  field: string;
  address: string;
  status: TeamScheduleStatus;
  teamScore: number | null;
  opponentScore: number | null;
  notes: string;
};

export type ScheduleEventLike = {
  id: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
};

export type ScheduleDayGroup<T extends ScheduleEventLike> = {
  dateKey: string;
  events: T[];
};

export type ScheduleMonthGroup<T extends ScheduleEventLike> = {
  monthKey: string;
  days: ScheduleDayGroup<T>[];
};

export type ParsedScheduleCsvRow = {
  rowNumber: number;
  draft: TeamScheduleDraft | null;
  errors: string[];
  problems: { field: string; code: string }[];
  fingerprint: string | null;
};

export type TeamScheduleCsvAnalysis = {
  delimiter: "," | ";";
  rows: ParsedScheduleCsvRow[];
  fileErrors: string[];
  headerMap: Record<string, string>;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u;

export function createDefaultScheduleDraft(now = new Date()): TeamScheduleDraft {
  const date = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join("-");
  return {
    type: "practice",
    title: "",
    date,
    startTime: "17:30",
    endTime: "19:00",
    arrivalTime: "17:15",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    isAllDay: false,
    opponentName: "",
    homeAway: "",
    venueName: "",
    field: "",
    address: "",
    status: "scheduled",
    teamScore: null,
    opponentScore: null,
    notes: "",
  };
}

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return Boolean(value.trim());
  } catch {
    return false;
  }
}

export function validateScheduleDraft(draft: TeamScheduleDraft) {
  const errors: Record<string, string> = {};
  if (!TEAM_SCHEDULE_EVENT_TYPES.includes(draft.type)) errors.type = "invalidType";
  if (!draft.title.trim()) errors.title = "required";
  else if (draft.title.trim().length > 120) errors.title = "tooLong";
  if (!DATE_PATTERN.test(draft.date) || !isRealDate(draft.date)) errors.date = "invalidDate";
  if (!isValidTimeZone(draft.timezone)) errors.timezone = "invalidTimezone";
  if (!draft.isAllDay) {
    if (!TIME_PATTERN.test(draft.startTime)) errors.startTime = "invalidTime";
    if (!TIME_PATTERN.test(draft.endTime)) errors.endTime = "invalidTime";
    if (TIME_PATTERN.test(draft.startTime) && TIME_PATTERN.test(draft.endTime) && draft.endTime <= draft.startTime) {
      errors.endTime = "endBeforeStart";
    }
    if (draft.arrivalTime && !TIME_PATTERN.test(draft.arrivalTime)) errors.arrivalTime = "invalidTime";
    if (draft.arrivalTime && TIME_PATTERN.test(draft.arrivalTime) && draft.arrivalTime > draft.startTime) {
      errors.arrivalTime = "arrivalAfterStart";
    }
    if (!errors.date && !errors.timezone && !errors.startTime && !errors.endTime && !errors.arrivalTime) {
      try {
        zonedDateTimeToMillis(draft.date, draft.startTime, draft.timezone);
        zonedDateTimeToMillis(draft.date, draft.endTime, draft.timezone);
        if (draft.arrivalTime) zonedDateTimeToMillis(draft.date, draft.arrivalTime, draft.timezone);
      } catch {
        errors.startTime = "invalidLocalTime";
      }
    }
  }
  if (!TEAM_SCHEDULE_STATUSES.includes(draft.status)) errors.status = "invalidStatus";
  if (draft.homeAway && !TEAM_SCHEDULE_HOME_AWAY.includes(draft.homeAway)) errors.homeAway = "invalidHomeAway";
  if (draft.teamScore !== null && !isValidScore(draft.teamScore)) errors.teamScore = "invalidScore";
  if (draft.opponentScore !== null && !isValidScore(draft.opponentScore)) errors.opponentScore = "invalidScore";
  if (draft.type !== "game" && (draft.teamScore !== null || draft.opponentScore !== null)) errors.teamScore = "scoreOnlyForGame";
  if (draft.status !== "completed" && (draft.teamScore !== null || draft.opponentScore !== null)) errors.teamScore = "scoreOnlyWhenCompleted";
  if (draft.opponentName.trim().length > 120) errors.opponentName = "tooLong";
  if (draft.venueName.trim().length > 160) errors.venueName = "tooLong";
  if (draft.field.trim().length > 80) errors.field = "tooLong";
  if (draft.address.trim().length > 240) errors.address = "tooLong";
  if (draft.notes.trim().length > 2000) errors.notes = "tooLong";
  return errors;
}

export function generateWeeklyRecurrenceDates(
  startDate: string,
  weekdays: number[],
  endDate: string,
  maximum = TEAM_SCHEDULE_MAX_RECURRENCES,
) {
  if (!isRealDate(startDate) || !isRealDate(endDate) || endDate < startDate) return [];
  const selected = new Set(weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  if (selected.size === 0) return [];
  const dates: string[] = [];
  const cursor = dateKeyToUtcDate(startDate);
  const finalDate = dateKeyToUtcDate(endDate);
  while (cursor <= finalDate && dates.length <= maximum) {
    if (selected.has(cursor.getUTCDay())) dates.push(toUtcDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates.length > maximum ? [] : dates;
}

export function splitScheduleEvents<T extends ScheduleEventLike>(events: T[], now = new Date()) {
  const upcoming = events
    .filter((event) => event.endAt.getTime() >= now.getTime())
    .sort((first, second) => first.startAt.getTime() - second.startAt.getTime());
  const past = events
    .filter((event) => event.endAt.getTime() < now.getTime())
    .sort((first, second) => second.startAt.getTime() - first.startAt.getTime());
  return { upcoming, past };
}

export function groupScheduleEvents<T extends ScheduleEventLike>(events: T[]): ScheduleMonthGroup<T>[] {
  const months = new Map<string, Map<string, T[]>>();
  events.forEach((event) => {
    const dateKey = formatDateKeyInTimeZone(event.startAt, event.timezone);
    const monthKey = dateKey.slice(0, 7);
    const days = months.get(monthKey) ?? new Map<string, T[]>();
    days.set(dateKey, [...(days.get(dateKey) ?? []), event]);
    months.set(monthKey, days);
  });
  return Array.from(months, ([monthKey, days]) => ({
    monthKey,
    days: Array.from(days, ([dateKey, dayEvents]) => ({ dateKey, events: dayEvents })),
  }));
}

export function formatDateKeyInTimeZone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatTimeKeyInTimeZone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.hour}:${values.minute}`;
}

export function buildScheduleFingerprint(draft: TeamScheduleDraft) {
  const startAtMillis = zonedDateTimeToMillis(
    draft.date,
    draft.isAllDay ? "00:00" : draft.startTime,
    draft.timezone,
  );
  const endAtMillis = zonedDateTimeToMillis(
    draft.isAllDay ? addDateDays(draft.date, 1) : draft.date,
    draft.isAllDay ? "00:00" : draft.endTime,
    draft.timezone,
  );
  const arrivalAtMillis = !draft.isAllDay && draft.arrivalTime
    ? zonedDateTimeToMillis(draft.date, draft.arrivalTime, draft.timezone)
    : null;
  return [
    draft.type,
    clean(draft.title),
    draft.date,
    startAtMillis,
    endAtMillis,
    arrivalAtMillis ?? "",
    draft.timezone.trim(),
    clean(draft.opponentName),
    draft.homeAway,
    clean(draft.venueName),
    clean(draft.field),
    clean(draft.address),
    draft.status,
    draft.teamScore ?? "",
    draft.opponentScore ?? "",
    clean(draft.notes),
  ].join("|");
}

export function zonedDateTimeToMillis(date: string, time: string, timezone: string) {
  if (!isRealDate(date) || !TIME_PATTERN.test(time) || !isValidTimeZone(timezone)) {
    throw new Error("invalid_zoned_date_time");
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
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
    throw new Error("invalid_local_time");
  }
  return guess;
}

export function addDateDays(date: string, days: number) {
  const value = dateKeyToUtcDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return toUtcDateKey(value);
}

export function parseTeamScheduleCsv(text: string): ParsedScheduleCsvRow[] {
  const analysis = analyzeTeamScheduleCsv(text);
  if (analysis.fileErrors.length > 0) {
    return [{ rowNumber: 1, draft: null, errors: analysis.fileErrors, problems: analysis.fileErrors.map((code) => ({ field: "file", code })), fingerprint: null }];
  }
  return analysis.rows;
}

const CSV_HEADER_ALIASES: Record<string, string[]> = {
  type: ["type", "event type"],
  title: ["title", "event name"],
  date: ["date", "start date"],
  start_time: ["start time"],
  end_date: ["end date"],
  end_time: ["end time"],
  arrival_time: ["arrival time"],
  timezone: ["timezone", "time zone"],
  all_day: ["all day", "all-day"],
  opponent: ["opponent"],
  home_away: ["home away", "home/away"],
  venue: ["venue", "location"],
  field: ["field"],
  address: ["address"],
  status: ["status"],
  team_score: ["team score"],
  opponent_score: ["opponent score"],
  notes: ["notes", "description"],
};

const REQUIRED_CSV_HEADERS = ["type", "title", "date", "start_time", "end_time", "timezone"];

export function analyzeTeamScheduleCsv(text: string): TeamScheduleCsvAnalysis {
  if (/^\uFFFE/u.test(text) || /\u0000/u.test(text)) {
    return { delimiter: ",", rows: [], fileErrors: ["invalidEncoding"], headerMap: {} };
  }
  const normalizedText = text.replace(/^\uFEFF/u, "");
  const delimiter = detectCsvDelimiter(normalizedText);
  const rows = parseCsvRows(normalizedText, delimiter);
  if (rows.length === 0) return { delimiter, rows: [], fileErrors: ["noValidEvents"], headerMap: {} };
  const normalizedHeaders = rows[0].map(normalizeCsvHeader);
  const headerMap: Record<string, string> = {};
  const ambiguous: string[] = [];
  Object.entries(CSV_HEADER_ALIASES).forEach(([canonical, aliases]) => {
    const indexes = normalizedHeaders.flatMap((header, index) => aliases.includes(header) ? [index] : []);
    if (indexes.length > 1) ambiguous.push(canonical);
    else if (indexes.length === 1) headerMap[canonical] = String(indexes[0]);
  });
  if (ambiguous.length > 0) return { delimiter, rows: [], fileErrors: ["ambiguousHeaders"], headerMap };
  if (REQUIRED_CSV_HEADERS.some((header) => headerMap[header] === undefined)) {
    return { delimiter, rows: [], fileErrors: ["missingHeaders"], headerMap };
  }
  const parsed = rows.slice(1, TEAM_SCHEDULE_MAX_IMPORT_ROWS + 1).map((row, index) => {
    const value = (header: string) => {
      const mappedIndex = headerMap[header];
      return mappedIndex === undefined ? "" : row[Number(mappedIndex)]?.trim() ?? "";
    };
    const rawType = value("type");
    const rawStatus = value("status");
    const rawHomeAway = value("home_away");
    const type = parseEventType(rawType);
    const status = parseStatus(rawStatus);
    const homeAway = parseHomeAway(rawHomeAway);
    const date = normalizeCsvDate(value("date"));
    const endDate = normalizeCsvDate(value("end_date")) || date;
    const startTime = normalizeCsvTime(value("start_time"));
    const endTime = normalizeCsvTime(value("end_time"));
    const allDay = parseBoolean(value("all_day"));
    const draft: TeamScheduleDraft = {
      type,
      title: value("title"),
      date,
      startTime: allDay ? "" : startTime,
      endTime: allDay ? "" : endDate === date ? endTime : endTime,
      arrivalTime: allDay ? "" : normalizeCsvTime(value("arrival_time")),
      timezone: value("timezone"),
      isAllDay: allDay,
      opponentName: value("opponent"),
      homeAway,
      venueName: value("venue"),
      field: value("field"),
      address: value("address"),
      status,
      teamScore: parseOptionalScore(value("team_score")),
      opponentScore: parseOptionalScore(value("opponent_score")),
      notes: value("notes"),
    };
    const validation = validateScheduleDraft(draft);
    if (!recognizedEventType(rawType)) validation.type = "invalidType";
    if (rawStatus && !recognizedStatus(rawStatus)) validation.status = "invalidStatus";
    if (rawHomeAway && !recognizedHomeAway(rawHomeAway)) validation.homeAway = "invalidHomeAway";
    if (endDate !== date) validation.endDate = "multiDayUnsupported";
    const problems = Object.entries(validation).map(([field, code]) => ({ field, code }));
    const errors = problems.map((problem) => problem.code);
    return {
      rowNumber: index + 2,
      draft: errors.length === 0 ? draft : null,
      errors: Array.from(new Set(errors)),
      problems,
      fingerprint: errors.length === 0 ? buildScheduleFingerprint(draft) : null,
    };
  });
  if (rows.length - 1 > TEAM_SCHEDULE_MAX_IMPORT_ROWS) {
    parsed.push({
      rowNumber: TEAM_SCHEDULE_MAX_IMPORT_ROWS + 2,
      draft: null,
      errors: ["rowLimit"],
      problems: [{ field: "file", code: "rowLimit" }],
      fingerprint: null,
    });
  }
  return { delimiter, rows: parsed, fileErrors: [], headerMap };
}

export const TEAM_SCHEDULE_SAMPLE_CSV = [
  "type,title,date,start_time,end_time,arrival_time,timezone,all_day,opponent,home_away,venue,field,address,status,team_score,opponent_score,notes",
  "game,Home opener,2027-03-14,10:00,12:00,09:30,America/New_York,false,River City,home,Community Field,Field 2,100 Main St,scheduled,,,Bring both jerseys",
  "practice,Weekly practice,2027-03-18,17:30,19:00,17:15,America/New_York,false,,,Training Center,North Field,200 Park Ave,scheduled,,,Water and cleats",
].join("\n");

function parseCsvRows(text: string, delimiter: "," | ";") {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function detectCsvDelimiter(text: string): "," | ";" {
  const firstRecord = firstCsvRecord(text);
  const commas = countUnquoted(firstRecord, ",");
  const semicolons = countUnquoted(firstRecord, ";");
  return semicolons > commas ? ";" : ",";
}

function firstCsvRecord(text: string) {
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '"') quoted = text[index + 1] === '"' && quoted ? quoted : !quoted;
    if (!quoted && (text[index] === "\r" || text[index] === "\n")) return text.slice(0, index);
  }
  return text;
}

function countUnquoted(text: string, delimiter: string) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '"') quoted = text[index + 1] === '"' && quoted ? quoted : !quoted;
    else if (!quoted && text[index] === delimiter) count += 1;
  }
  return count;
}

function normalizeCsvHeader(value: string) {
  return value.trim().toLocaleLowerCase("en-US").replace(/^\uFEFF/u, "").replace(/[_-]+/gu, " ").replace(/\s+/gu, " ");
}

function normalizeCsvDate(value: string) {
  const trimmed = value.trim();
  if (DATE_PATTERN.test(trimmed)) return trimmed;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(trimmed);
  return match ? `${match[3]}-${pad(Number(match[1]))}-${pad(Number(match[2]))}` : trimmed;
}

function normalizeCsvTime(value: string) {
  const trimmed = value.trim();
  if (TIME_PATTERN.test(trimmed)) return trimmed;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?$/iu.exec(trimmed);
  if (!match) return trimmed;
  let hour = Number(match[1]);
  const suffix = match[3]?.toUpperCase();
  if (suffix === "AM" && hour === 12) hour = 0;
  if (suffix === "PM" && hour < 12) hour += 12;
  return hour <= 23 ? `${pad(hour)}:${match[2]}` : trimmed;
}

function parseEventType(value: string): TeamScheduleEventType {
  const normalized = value.trim().toLocaleLowerCase("en-US").replace(/[\s_-]+/gu, "");
  if (normalized === "game" || normalized === "match") return "game";
  if (normalized === "practice" || normalized === "training") return "practice";
  return "teamEvent";
}

function parseStatus(value: string): TeamScheduleStatus {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (normalized === "postponed" || normalized === "cancelled" || normalized === "completed") return normalized;
  return "scheduled";
}

function parseHomeAway(value: string): TeamScheduleHomeAway | "" {
  const normalized = value.trim().toLocaleLowerCase("en-US").replace(/\s+site$/u, "");
  if (normalized === "home" || normalized === "away" || normalized === "neutral") return normalized;
  return "";
}

function recognizedEventType(value: string) {
  const normalized = value.trim().toLocaleLowerCase("en-US").replace(/[\s_-]+/gu, "");
  return ["game", "match", "practice", "training", "teamevent", "event", "meeting", "other"].includes(normalized);
}

function recognizedStatus(value: string) {
  return TEAM_SCHEDULE_STATUSES.includes(value.trim().toLocaleLowerCase("en-US") as TeamScheduleStatus);
}

function recognizedHomeAway(value: string) {
  const normalized = value.trim().toLocaleLowerCase("en-US").replace(/\s+site$/u, "");
  return TEAM_SCHEDULE_HOME_AWAY.includes(normalized as TeamScheduleHomeAway);
}

function parseBoolean(value: string) {
  return value.toLowerCase() === "true" || value === "1" || value.toLowerCase() === "yes";
}

function parseOptionalScore(value: string) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function isValidScore(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= 999;
}

function dateTimeParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
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

function clean(value: string) {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function isRealDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  return toUtcDateKey(dateKeyToUtcDate(value)) === value;
}

function dateKeyToUtcDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toUtcDateKey(value: Date) {
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
