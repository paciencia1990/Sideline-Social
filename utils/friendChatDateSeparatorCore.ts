const MIN_PLAUSIBLE_CHAT_DATE = new Date(2000, 0, 1).getTime();
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type FriendChatDateLabels = {
  today: string;
  yesterday: string;
};

export type FriendChatDateSeparator = {
  accessibilityLabel: string;
  dayKey: string;
  label: string;
};

export function friendChatCalendarDayKey(value: Date | null | undefined, now = new Date()) {
  if (!isPlausibleChatDate(value, now)) return null;
  return [
    value!.getFullYear().toString().padStart(4, "0"),
    (value!.getMonth() + 1).toString().padStart(2, "0"),
    value!.getDate().toString().padStart(2, "0"),
  ].join("-");
}

export function createFriendChatDateSeparator(
  value: Date | null | undefined,
  locale: string,
  labels: FriendChatDateLabels,
  now = new Date(),
): FriendChatDateSeparator | null {
  const dayKey = friendChatCalendarDayKey(value, now);
  if (!dayKey || !value) return null;
  const dayDifference = calendarDayDifference(now, value);
  const fullDate = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(value);
  const label = dayDifference === 0
    ? labels.today
    : dayDifference === 1
      ? labels.yesterday
      : dayDifference >= 2 && dayDifference <= 7
        ? new Intl.DateTimeFormat(locale, { weekday: "long" }).format(value)
        : fullDate;
  return { accessibilityLabel: fullDate, dayKey, label };
}

export function shouldShowFriendChatDateSeparator(
  current: Date | null | undefined,
  previous: Date | null | undefined,
  now = new Date(),
) {
  const currentKey = friendChatCalendarDayKey(current, now);
  if (!currentKey) return false;
  return currentKey !== friendChatCalendarDayKey(previous, now);
}

export function millisecondsUntilNextLocalDay(now = new Date()) {
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1_000, nextDay.getTime() - now.getTime() + 50);
}

function isPlausibleChatDate(value: Date | null | undefined, now: Date): value is Date {
  if (!(value instanceof Date)) return false;
  const milliseconds = value.getTime();
  return Number.isFinite(milliseconds) &&
    milliseconds >= MIN_PLAUSIBLE_CHAT_DATE &&
    milliseconds <= now.getTime() + MAX_FUTURE_SKEW_MS;
}

function calendarDayDifference(later: Date, earlier: Date) {
  const laterDay = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
  const earlierDay = Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  return Math.round((laterDay - earlierDay) / DAY_MS);
}
