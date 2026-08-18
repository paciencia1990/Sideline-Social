import { Linking, Platform } from "react-native";

import type { TeamScheduleEvent } from "@/services/teamScheduleService";
import { normalizeTeamScheduleCalendarError } from "@/utils/teamScheduleCalendarCore";

type ExpoCalendarLegacyModule = {
  createEventInCalendarAsync: (details: {
    title: string;
    startDate: Date;
    endDate: Date;
    allDay?: boolean;
    location?: string;
    notes?: string;
    timeZone?: string;
  }) => Promise<{ action?: string } | string>;
};

export type CalendarAddResult = "saved" | "cancelled";

export async function addTeamEventToPersonalCalendar(event: TeamScheduleEvent): Promise<CalendarAddResult> {
  try {
    const calendar = loadCalendar();
    const result = await calendar.createEventInCalendarAsync({
      title: event.title,
      startDate: event.startAt,
      endDate: event.endAt,
      allDay: event.isAllDay,
      location: [event.venueName, event.field, event.address].filter(Boolean).join(" - ") || undefined,
      notes: event.notes ?? undefined,
      timeZone: event.timezone,
    });
    const action = typeof result === "string" ? result : result?.action;
    return action === "saved" || action === "done" ? "saved" : "cancelled";
  } catch (error) {
    throw calendarError(normalizeTeamScheduleCalendarError(error));
  }
}

export async function openCalendarSettings() {
  await Linking.openSettings();
}

export function calendarRequiresNativeBuild() {
  return Platform.OS === "android" || Platform.OS === "ios";
}

function loadCalendar(): ExpoCalendarLegacyModule {
  try {
    // Metro requires a literal package name while preserving deferred native-module loading.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-calendar/legacy") as ExpoCalendarLegacyModule;
  } catch {
    throw calendarError("calendar_build_required");
  }
}

function calendarError(code: string) {
  const error = new Error(code);
  (error as { code?: string }).code = code;
  return error;
}
