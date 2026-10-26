/** Resolve the phone's current IANA zone without assigning a regional default. */
export function getDeviceTimeZone(): string {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
      return timezone;
    }
  } catch {
    // A platform without usable zone data can still display a labelled UTC time.
  }
  return "UTC";
}

export function scheduleDisplayTimeZone(
  event: { timezone: string; isAllDay?: boolean },
  deviceTimeZone: string,
) {
  // All-day entries represent source calendar dates, not instants to shift.
  return event.isAllDay ? event.timezone : deviceTimeZone;
}

export function formatSchedulePreview(
  event: { startAtMillis: number; timezone: string; isAllDay: boolean },
  locale: string,
  deviceTimeZone: string,
) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: event.isAllDay ? undefined : "short",
    timeZone: scheduleDisplayTimeZone(event, deviceTimeZone),
  }).format(new Date(event.startAtMillis));
}
