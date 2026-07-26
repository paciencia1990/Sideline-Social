const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PLAUSIBLE_SENT_AGE_MS = 366 * DAY_MS;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type FriendRequestDateValue = Date | null;

type RequestIdentity = {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: string;
  expiresAt: FriendRequestDateValue;
};

export type SentAge =
  | { kind: "recent" }
  | { kind: "today" }
  | { kind: "days"; count: number };

export function decodeFriendRequestDate(value: unknown): FriendRequestDateValue {
  const milliseconds = timestampMilliseconds(value);
  if (milliseconds === null || milliseconds <= 0) return null;
  const decoded = new Date(milliseconds);
  return Number.isFinite(decoded.getTime()) ? decoded : null;
}

export function reconcilePendingFriendRequests<T extends RequestIdentity>(
  incoming: readonly T[],
  outgoing: readonly T[],
  friendUserIds: ReadonlySet<string>,
  nowMillis = Date.now(),
) {
  const seenRequestIds = new Set<string>();
  const seenOtherUserIds = new Set<string>();
  const keep = (request: T, otherUserId: string) => {
    const expiresAtMillis = request.expiresAt?.getTime() ?? Number.NaN;
    if (
      request.status !== "pending" ||
      !request.id ||
      !otherUserId ||
      friendUserIds.has(otherUserId) ||
      !Number.isFinite(expiresAtMillis) ||
      expiresAtMillis <= nowMillis ||
      seenRequestIds.has(request.id) ||
      seenOtherUserIds.has(otherUserId)
    ) {
      return false;
    }
    seenRequestIds.add(request.id);
    seenOtherUserIds.add(otherUserId);
    return true;
  };

  return {
    incoming: incoming.filter((request) => keep(request, request.fromUserId)),
    outgoing: outgoing.filter((request) => keep(request, request.toUserId)),
  };
}

export function getSentAge(createdAt: FriendRequestDateValue, nowMillis = Date.now()): SentAge {
  const createdAtMillis = createdAt?.getTime() ?? Number.NaN;
  const elapsedMillis = nowMillis - createdAtMillis;
  if (
    !Number.isFinite(createdAtMillis) ||
    createdAtMillis <= 0 ||
    !Number.isFinite(elapsedMillis) ||
    elapsedMillis < -MAX_FUTURE_CLOCK_SKEW_MS ||
    elapsedMillis > MAX_PLAUSIBLE_SENT_AGE_MS
  ) {
    return { kind: "recent" };
  }
  if (elapsedMillis <= 0) return { kind: "today" };
  const elapsedDays = Math.floor(elapsedMillis / DAY_MS);
  return elapsedDays === 0 ? { kind: "today" } : { kind: "days", count: elapsedDays };
}

function timestampMilliseconds(value: unknown): number | null {
  if (value instanceof Date) return finiteNumber(value.getTime());
  if (typeof value === "number") return finiteNumber(value);
  if (typeof value === "string") return finiteNumber(Date.parse(value));
  if (!value || typeof value !== "object") return null;

  const timestamp = value as Record<string, unknown>;
  if (typeof timestamp.toMillis === "function") {
    try {
      return finiteNumber(timestamp.toMillis());
    } catch {
      return null;
    }
  }
  if (typeof timestamp.toDate === "function") {
    try {
      const date = timestamp.toDate();
      return date instanceof Date ? finiteNumber(date.getTime()) : null;
    } catch {
      return null;
    }
  }

  const seconds = finiteNumber(timestamp.seconds) ?? finiteNumber(timestamp._seconds);
  if (seconds === null) return null;
  const nanoseconds = finiteNumber(timestamp.nanoseconds) ?? finiteNumber(timestamp._nanoseconds) ?? 0;
  return finiteNumber((seconds * 1000) + (nanoseconds / 1_000_000));
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
