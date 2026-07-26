export type FriendRequestSendStatus =
  | 'pending'
  | 'alreadyPending'
  | 'reversePending'
  | 'alreadyFriends';

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined' | 'canceled' | 'expired' | 'superseded';
export const FRIEND_REQUEST_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeFriendTargetId(value: unknown) {
  if (typeof value !== 'string') throw new Error('invalid-target');
  const targetUserId = value.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(targetUserId)) throw new Error('invalid-target');
  return targetUserId;
}

export function friendRequestIdFor(fromUserId: string, toUserId: string) {
  return `${fromUserId}__${toUserId}`;
}

export function resolveFriendRequestSendStatus({
  senderFriendIds,
  targetFriendIds,
  targetUserId,
  senderUserId,
  outgoingStatus,
  incomingStatus,
  outgoingExpiresAtMillis,
  incomingExpiresAtMillis,
  nowMillis = Date.now(),
}: {
  senderFriendIds: unknown;
  targetFriendIds: unknown;
  targetUserId: string;
  senderUserId: string;
  outgoingStatus: unknown;
  incomingStatus: unknown;
  outgoingExpiresAtMillis?: number | null;
  incomingExpiresAtMillis?: number | null;
  nowMillis?: number;
}): FriendRequestSendStatus {
  const senderFriends = readIds(senderFriendIds);
  const targetFriends = readIds(targetFriendIds);
  if (
    senderFriends.includes(targetUserId) ||
    targetFriends.includes(senderUserId)
  ) return 'alreadyFriends';
  if (isActivePendingRequest(outgoingStatus, outgoingExpiresAtMillis, nowMillis)) return 'alreadyPending';
  if (isActivePendingRequest(incomingStatus, incomingExpiresAtMillis, nowMillis)) return 'reversePending';
  return 'pending';
}

export function isActivePendingRequest(status: unknown, expiresAtMillis: number | null | undefined, nowMillis: number) {
  return status === 'pending' && typeof expiresAtMillis === 'number' && expiresAtMillis > nowMillis;
}

export function friendRequestExpiresAtMillis(createdAtMillis: number) {
  return createdAtMillis + FRIEND_REQUEST_LIFETIME_MS;
}

export function resolveLegacyFriendRequestExpiresAtMillis(
  expiresAtMillis: number | null,
  createdAtMillis: number | null,
) {
  if (expiresAtMillis !== null) return expiresAtMillis;
  return createdAtMillis === null ? null : friendRequestExpiresAtMillis(createdAtMillis);
}

function readIds(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
