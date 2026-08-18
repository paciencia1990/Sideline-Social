import { Linking, Platform } from "react-native";

import type { TeamScheduleEvent } from "@/services/teamScheduleService";
import {
  buildTeamScheduleCalendarPayload,
  createTeamScheduleCalendarError,
  createTeamScheduleCalendarSingleFlight,
  isTeamScheduleCalendarErrorCode,
  isTeamScheduleCalendarNativeBuildRequired,
  isTeamScheduleCalendarNativeModuleMissing,
  normalizeTeamScheduleCalendarDialogResult,
  normalizeTeamScheduleCalendarError,
  type TeamScheduleCalendarDialogOutcome,
  type TeamScheduleCalendarErrorCode,
  type TeamScheduleCalendarPayload,
} from "@/utils/teamScheduleCalendarCore";

type CalendarPermissionResponse = {
  status?: string;
  canAskAgain?: boolean;
};

type ExpoCalendarLegacyModule = {
  CalendarDialogResultActions: {
    saved: string;
    canceled: string;
    deleted: string;
    done: string;
  };
  PermissionStatus?: { GRANTED?: string };
  createEventInCalendarAsync: (
    details: TeamScheduleCalendarPayload,
    presentationOptions?: { startNewActivityTask?: boolean },
  ) => Promise<{ action?: string; id?: string | null }>;
  isAvailableAsync?: () => Promise<boolean>;
  requestCalendarPermissionsAsync?: () => Promise<CalendarPermissionResponse>;
};

export type CalendarAddResult = Extract<TeamScheduleCalendarDialogOutcome, "saved" | "cancelled" | "closed">;

const runCalendarEditor = createTeamScheduleCalendarSingleFlight<CalendarAddResult>();

export function addTeamEventToPersonalCalendar(
  event: TeamScheduleEvent,
  cancelledTitlePrefix: string,
): Promise<CalendarAddResult> {
  calendarDiagnostic("button_pressed");
  return runCalendarEditor(() => launchCalendarEditor(event, cancelledTitlePrefix));
}

export async function openCalendarSettings() {
  await Linking.openSettings();
}

async function launchCalendarEditor(
  event: TeamScheduleEvent,
  cancelledTitlePrefix: string,
): Promise<CalendarAddResult> {
  try {
    const calendar = loadCalendar();
    calendarDiagnostic("native_module_loaded", { platform: Platform.OS });

    const payload = buildTeamScheduleCalendarPayload(event, cancelledTitlePrefix);
    calendarDiagnostic("event_payload_validated", { allDay: payload.allDay });

    if (calendar.isAvailableAsync && !(await calendar.isAvailableAsync())) {
      throw createTeamScheduleCalendarError("calendar_editor_unavailable");
    }
    await requestLegacyIosCalendarPermissionIfNeeded(calendar);

    calendarDiagnostic("native_editor_requested");
    const editorResult = calendar.createEventInCalendarAsync(
      payload,
      Platform.OS === "android" ? { startNewActivityTask: false } : undefined,
    );
    calendarDiagnostic("native_editor_opened");

    const outcome = normalizeTeamScheduleCalendarDialogResult(
      await editorResult,
      calendar.CalendarDialogResultActions,
    );
    calendarDiagnostic("result_action_received", { outcome });
    if (outcome === "unexpected") {
      throw createTeamScheduleCalendarError("calendar_unexpected");
    }
    calendarDiagnostic(outcome === "saved" ? "event_saved" : outcome === "cancelled" ? "editor_cancelled" : "editor_closed");
    return outcome;
  } catch (error) {
    const code = isTeamScheduleCalendarNativeBuildRequired(error)
      ? "calendar_build_required"
      : normalizeTeamScheduleCalendarError(error);
    calendarDiagnostic("structured_failure", { code });
    throw createTeamScheduleCalendarError(code);
  }
}

async function requestLegacyIosCalendarPermissionIfNeeded(calendar: ExpoCalendarLegacyModule) {
  if (Platform.OS !== "ios" || iosMajorVersion(Platform.Version) >= 17) return;
  if (!calendar.requestCalendarPermissionsAsync) {
    throw createTeamScheduleCalendarError("calendar_editor_unavailable");
  }

  const response = await calendar.requestCalendarPermissionsAsync();
  const grantedStatus = calendar.PermissionStatus?.GRANTED ?? "granted";
  if (response.status === grantedStatus) return;
  throw createTeamScheduleCalendarError(
    response.canAskAgain === false ? "calendar_permission_permanent" : "calendar_permission_denied",
  );
}

function loadCalendar(): ExpoCalendarLegacyModule {
  try {
    // The SDK 57 legacy editor lets the user choose a calendar without reading calendar data.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-calendar/legacy") as ExpoCalendarLegacyModule;
  } catch (error) {
    if (isTeamScheduleCalendarNativeModuleMissing(error)) {
      throw createTeamScheduleCalendarError("calendar_build_required");
    }
    if (isTeamScheduleCalendarErrorCode(readErrorCode(error))) throw error;
    throw createTeamScheduleCalendarError("calendar_unexpected");
  }
}

function iosMajorVersion(value: string | number) {
  const parsed = Number.parseInt(String(value).split(".")[0] ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : null;
}

function calendarDiagnostic(
  stage:
    | "button_pressed"
    | "native_module_loaded"
    | "event_payload_validated"
    | "native_editor_requested"
    | "native_editor_opened"
    | "result_action_received"
    | "event_saved"
    | "editor_cancelled"
    | "editor_closed"
    | "structured_failure",
  metadata?: { platform?: string; allDay?: boolean; outcome?: TeamScheduleCalendarDialogOutcome; code?: TeamScheduleCalendarErrorCode },
) {
  if (!__DEV__) return;
  if (metadata) console.debug(`[team-schedule-calendar] ${stage}`, metadata);
  else console.debug(`[team-schedule-calendar] ${stage}`);
}
