export type JoinableGameSessionInput = {
  status: string;
  startedAtMs: number | null;
  endsAtMs: number | null;
  durationSeconds: number | null;
  joinCodeStatus: string | null;
  participantCount: number;
  capacity: number | null;
  callerIsParticipant?: boolean;
  nowMs: number;
};

export type JoinableGameSessionResult = {
  isActive: boolean;
  isJoinable: boolean;
  isExpired: boolean;
  reason: "lobby" | "playing" | "completed" | "expired" | "canceled" | "full" | "unknown";
  endsAtMs: number | null;
};

const TERMINAL_STATUSES = new Set([
  "abandoned",
  "cancelled",
  "canceled",
  "completed",
  "ended",
  "expired",
  "failed",
  "results",
]);

export function resolveJoinableGameSession(
  input: JoinableGameSessionInput,
): JoinableGameSessionResult {
  const status = normalizeStatus(input.status);
  const joinCodeStatus = input.joinCodeStatus == null
    ? null
    : normalizeStatus(input.joinCodeStatus);
  const derivedEndsAtMs =
    isFinitePositive(input.startedAtMs) && isFinitePositive(input.durationSeconds)
      ? input.startedAtMs + input.durationSeconds * 1000
      : null;
  const endsAtMs = earliestTimestamp(input.endsAtMs, derivedEndsAtMs);

  if (status === "canceled" || status === "cancelled" || joinCodeStatus === "canceled" || joinCodeStatus === "cancelled") {
    return inactive("canceled", endsAtMs);
  }
  if (TERMINAL_STATUSES.has(status) || (joinCodeStatus != null && TERMINAL_STATUSES.has(joinCodeStatus))) {
    return inactive(status === "expired" || joinCodeStatus === "expired" ? "expired" : "completed", endsAtMs);
  }
  if (endsAtMs != null && endsAtMs <= input.nowMs) {
    return inactive("expired", endsAtMs, true);
  }

  if (status === "lobby" || status === "waiting") {
    if (joinCodeStatus !== "lobby") return inactive("unknown", endsAtMs);
    if (
      input.callerIsParticipant !== true &&
      isFinitePositive(input.capacity) &&
      Math.max(0, input.participantCount) >= input.capacity
    ) {
      return {
        isActive: true,
        isJoinable: false,
        isExpired: false,
        reason: "full",
        endsAtMs,
      };
    }
    return {
      isActive: true,
      isJoinable: true,
      isExpired: false,
      reason: "lobby",
      endsAtMs,
    };
  }

  if (status === "active" || status === "countdown" || status === "playing" || status === "started") {
    if (joinCodeStatus !== "started" || endsAtMs == null) return inactive("unknown", endsAtMs);
    const reconnectable = input.callerIsParticipant === true;
    return {
      isActive: reconnectable,
      isJoinable: reconnectable,
      isExpired: false,
      reason: "playing",
      endsAtMs,
    };
  }

  return inactive("unknown", endsAtMs);
}

function earliestTimestamp(left: number | null, right: number | null) {
  const values = [left, right].filter(isFinitePositive);
  return values.length ? Math.min(...values) : null;
}

function inactive(
  reason: JoinableGameSessionResult["reason"],
  endsAtMs: number | null,
  isExpired = reason === "expired",
): JoinableGameSessionResult {
  return { isActive: false, isJoinable: false, isExpired, reason, endsAtMs };
}

function isFinitePositive(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeStatus(value: string) {
  return value.trim().toLowerCase();
}
