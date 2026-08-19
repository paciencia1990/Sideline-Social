export const TEAM_HISTORY_PAGE_SIZES = Object.freeze({
  announcements: 20,
  announcementReplies: 30,
  privateMessages: 40,
  upcomingSchedule: 50,
  pastSchedule: 20,
  archivedTeams: 20,
  inbox: 25,
});

export const TEAM_HISTORY_RETAINED_OLDER_PAGES = 4;

export type TeamHistoryCursor = Readonly<{
  id: string;
  timestampMillis: number;
}>;
