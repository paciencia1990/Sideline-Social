export type TeamScheduleCalendarErrorCode =
  | "calendar_build_required"
  | "calendar_editor_unavailable"
  | "calendar_invalid_event"
  | "calendar_permission_denied"
  | "calendar_permission_permanent"
  | "calendar_no_destination"
  | "calendar_editor_launch_failed"
  | "calendar_unexpected";

export type TeamScheduleCalendarEventInput = {
  title: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  isAllDay: boolean;
  venueName: string | null;
  field: string | null;
  address: string | null;
  notes: string | null;
  status: string;
};

export type TeamScheduleCalendarPayload = {
  title: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  location?: string;
  notes?: string;
  timeZone: string;
};

export type TeamScheduleCalendarDialogOutcome = "saved" | "cancelled" | "closed" | "unexpected";

type CalendarDialogActions = {
  saved: string;
  canceled: string;
  deleted: string;
  done: string;
};

const TEAM_SCHEDULE_CALENDAR_ERROR_CODES = new Set<TeamScheduleCalendarErrorCode>([
  "calendar_build_required",
  "calendar_editor_unavailable",
  "calendar_invalid_event",
  "calendar_permission_denied",
  "calendar_permission_permanent",
  "calendar_no_destination",
  "calendar_editor_launch_failed",
  "calendar_unexpected",
]);

export function buildTeamScheduleCalendarPayload(
  event: TeamScheduleCalendarEventInput,
  cancelledTitlePrefix: string,
): TeamScheduleCalendarPayload {
  const title = cleanText(event.title);
  const timezone = cleanText(event.timezone);
  const startDate = copyValidDate(event.startAt);
  const endDate = copyValidDate(event.endAt);

  if (!title || !timezone || !startDate || !endDate || endDate.getTime() <= startDate.getTime()) {
    throw createTeamScheduleCalendarError("calendar_invalid_event");
  }
  if (!isSupportedTimeZone(timezone)) {
    throw createTeamScheduleCalendarError("calendar_invalid_event");
  }

  const locationParts = [event.venueName, event.field, event.address]
    .map(cleanText)
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  const notes = cleanText(event.notes);
  const cancelledPrefix = cleanText(cancelledTitlePrefix);

  return {
    title: event.status === "cancelled" && cancelledPrefix ? `${cancelledPrefix}: ${title}` : title,
    startDate,
    endDate,
    allDay: event.isAllDay === true,
    ...(locationParts.length > 0 ? { location: locationParts.join(" \u00b7 ") } : {}),
    ...(notes ? { notes } : {}),
    timeZone: timezone,
  };
}

export function normalizeTeamScheduleCalendarDialogResult(
  result: unknown,
  actions: CalendarDialogActions,
): TeamScheduleCalendarDialogOutcome {
  if (!isRecord(result) || typeof result.action !== "string") return "unexpected";
  if (result.action === actions.saved) return "saved";
  if (result.action === actions.canceled || result.action === actions.deleted) return "cancelled";
  if (result.action === actions.done) return "closed";
  return "unexpected";
}

export function createTeamScheduleCalendarSingleFlight<T>() {
  let active: Promise<T> | null = null;

  return (operation: () => Promise<T>): Promise<T> => {
    if (active) return active;
    const launched = Promise.resolve().then(operation);
    const tracked = launched.finally(() => {
      if (active === tracked) active = null;
    });
    active = tracked;
    return tracked;
  };
}

export function normalizeTeamScheduleCalendarError(error: unknown): TeamScheduleCalendarErrorCode {
  const code = readErrorCode(error);
  if (isTeamScheduleCalendarErrorCode(code)) return code;
  if (code === "E_MISSING_PERMISSIONS" || code === "ERR_PERMISSION_DENIED") {
    return "calendar_permission_denied";
  }
  if (code === "ERR_UNAVAILABLE") return "calendar_editor_unavailable";
  if (code === "E_EVENT_DIALOG_IN_PROGRESS") return "calendar_editor_launch_failed";

  const message = error instanceof Error ? error.message : "";
  if (/ActivityNotFoundException|No Activity found|no compatible calendar/i.test(message)) {
    return "calendar_no_destination";
  }
  if (/Invalid (date|time zone)|Expected format/i.test(message)) return "calendar_invalid_event";
  if (/Different calendar dialog is already being presented/i.test(message)) {
    return "calendar_editor_launch_failed";
  }
  return "calendar_unexpected";
}

export function isTeamScheduleCalendarNativeModuleMissing(error: unknown) {
  return error instanceof Error && error.message.includes("Cannot find native module 'ExpoCalendar'");
}

export function isTeamScheduleCalendarNativeBuildRequired(error: unknown) {
  if (isTeamScheduleCalendarNativeModuleMissing(error)) return true;
  return readErrorCode(error) === "ERR_UNAVAILABLE"
    && error instanceof Error
    && /Calendar.*createEventInCalendarAsync/i.test(error.message);
}

export function isTeamScheduleCalendarErrorCode(value: unknown): value is TeamScheduleCalendarErrorCode {
  return typeof value === "string" && TEAM_SCHEDULE_CALENDAR_ERROR_CODES.has(value as TeamScheduleCalendarErrorCode);
}

export function shouldOfferCalendarSettings(code: TeamScheduleCalendarErrorCode) {
  return code === "calendar_permission_permanent";
}

export function createTeamScheduleCalendarError(code: TeamScheduleCalendarErrorCode) {
  const error = new Error(code);
  (error as { code?: TeamScheduleCalendarErrorCode }).code = code;
  return error;
}

function readErrorCode(error: unknown) {
  return isRecord(error) && typeof error.code === "string" ? error.code : null;
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized || null;
}

function copyValidDate(value: unknown) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return null;
  return new Date(value.getTime());
}

function isSupportedTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
