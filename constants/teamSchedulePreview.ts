import type { TeamScheduleEvent } from "@/services/teamScheduleService";

export const TEAM_SCHEDULE_FIXTURE_ENABLED = __DEV__ && process.env.EXPO_PUBLIC_TEAM_SCHEDULE_FIXTURE === "true";

export function getSyntheticTeamSchedule(teamId: string, now = new Date()): TeamScheduleEvent[] {
  if (!TEAM_SCHEDULE_FIXTURE_ENABLED) return [];
  const year = now.getFullYear();
  const month = now.getMonth();
  const event = (
    id: string,
    type: TeamScheduleEvent["type"],
    title: string,
    dayOffset: number,
    status: TeamScheduleEvent["status"] = "scheduled",
    extras: Partial<TeamScheduleEvent> = {},
  ): TeamScheduleEvent => {
    const startAt = new Date(year, month, now.getDate() + dayOffset, 17, 30);
    const endAt = new Date(startAt.getTime() + 90 * 60 * 1000);
    return {
      id,
      teamId,
      type,
      title,
      startAt,
      endAt,
      arrivalAt: new Date(startAt.getTime() - 30 * 60 * 1000),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      isAllDay: false,
      opponentName: type === "game" ? "Northside United" : null,
      homeAway: type === "game" ? "home" : null,
      venueName: "Community Sports Complex",
      field: "Field 2",
      address: "100 Community Way",
      status,
      teamScore: status === "completed" && type === "game" ? 4 : null,
      opponentScore: status === "completed" && type === "game" ? 2 : null,
      notes: "Synthetic development fixture. Bring water and team equipment.",
      source: "manual",
      importFingerprint: null,
      recurrenceGroupId: null,
      recurrenceIndex: null,
      createdBy: "synthetic-coach",
      updatedBy: "synthetic-coach",
      createdAt: now,
      updatedAt: now,
      cancelledAt: status === "cancelled" ? now : null,
      ...extras,
    };
  };
  return [
    event("fixture-home", "game", "Home game", 3),
    event("fixture-away", "game", "Away game", 11, "scheduled", { homeAway: "away", venueName: "Riverside Field" }),
    event("fixture-practice", "practice", "Team practice", 6),
    event("fixture-team-event", "teamEvent", "Team photo night", 34),
    event("fixture-postponed", "game", "Postponed match", 18, "postponed"),
    event("fixture-cancelled", "practice", "Cancelled practice", 25, "cancelled"),
    event("fixture-completed", "game", "Season opener", -12, "completed"),
  ];
}
