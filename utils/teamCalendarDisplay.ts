export function displayCalendarTimezone(timezone: string, displayInViewerTimezone: boolean, viewerTimezone?: string): string {
  if (!displayInViewerTimezone) return timezone;
  try { return viewerTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || timezone; }
  catch { return timezone; }
}
