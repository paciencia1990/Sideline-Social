export const GAME_START_SCHEMA_VERSION = 1;
export const GAME_START_SAFETY_LEAD_MS = 2_500;
export const GAME_START_COUNTDOWN_MS = 3_800;
export const GAME_START_READY_TIMEOUT_MS = 20_000;

export type FrozenGameStartParticipant = {
  uid: string;
  joinOrder: number;
  teamId: "A" | "B" | null;
  role: "defuser" | "expert" | "support" | null;
};

export function nextSharedGameTimeline(serverNowMs: number) {
  const countdownStartsAtMs = serverNowMs + GAME_START_SAFETY_LEAD_MS;
  return {
    countdownStartsAtMs,
    gameplayStartsAtMs: countdownStartsAtMs + GAME_START_COUNTDOWN_MS,
  };
}

export function appendReadinessAcknowledgement(
  acknowledgedUserIds: unknown,
  uid: string,
  participantUserIds: readonly string[],
) {
  if (!participantUserIds.includes(uid)) return null;
  const current = Array.isArray(acknowledgedUserIds)
    ? acknowledgedUserIds.filter((value): value is string => typeof value === "string" && participantUserIds.includes(value))
    : [];
  const unique = [...new Set(current)];
  if (!unique.includes(uid)) unique.push(uid);
  return {
    acknowledgedUserIds: unique,
    acknowledgedCount: unique.length,
    allReady: unique.length === participantUserIds.length,
  };
}

export function participantSnapshotMatches(
  frozen: readonly FrozenGameStartParticipant[],
  current: readonly FrozenGameStartParticipant[],
) {
  if (frozen.length !== current.length) return false;
  const normalize = (items: readonly FrozenGameStartParticipant[]) => [...items]
    .sort((left, right) => left.joinOrder - right.joinOrder || left.uid.localeCompare(right.uid))
    .map(({ uid, joinOrder, teamId, role }) => ({ uid, joinOrder, teamId, role }));
  return JSON.stringify(normalize(frozen)) === JSON.stringify(normalize(current));
}
