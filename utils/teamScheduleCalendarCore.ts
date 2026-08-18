export type TeamScheduleCalendarErrorCode =
  | "calendar_permission_denied"
  | "calendar_permission_permanent"
  | "calendar_unavailable"
  | "calendar_build_required"
  | "calendar_failed";

export function normalizeTeamScheduleCalendarError(error: unknown): TeamScheduleCalendarErrorCode {
  if (isErrorCode(error, "calendar_build_required")) return "calendar_build_required";
  const text = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : "";
  if (text.includes("denied") || text.includes("permission")) {
    return text.includes("again") || text.includes("settings")
      ? "calendar_permission_permanent"
      : "calendar_permission_denied";
  }
  if (text.includes("unavailable") || text.includes("not available")) return "calendar_unavailable";
  return "calendar_failed";
}

export function shouldOfferCalendarSettings(code: TeamScheduleCalendarErrorCode) {
  return code === "calendar_permission_permanent";
}

function isErrorCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
