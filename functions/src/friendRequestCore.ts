export type FriendRequestSendStatus =
  | 'pending'
  | 'alreadyPending'
  | 'reversePending'
  | 'alreadyFriends';

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
}: {
  senderFriendIds: unknown;
  targetFriendIds: unknown;
  targetUserId: string;
  senderUserId: string;
  outgoingStatus: unknown;
  incomingStatus: unknown;
}): FriendRequestSendStatus {
  const senderFriends = readIds(senderFriendIds);
  const targetFriends = readIds(targetFriendIds);
  if (
    senderFriends.includes(targetUserId) ||
    targetFriends.includes(senderUserId) ||
    outgoingStatus === 'accepted' ||
    incomingStatus === 'accepted'
  ) return 'alreadyFriends';
  if (outgoingStatus === 'pending') return 'alreadyPending';
  if (incomingStatus === 'pending') return 'reversePending';
  return 'pending';
}

function readIds(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
