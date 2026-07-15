import { createHash } from 'node:crypto';

export const MAX_CHAT_PARTICIPANTS = 10;
export const MAX_CHAT_MESSAGE_LENGTH = 500;
export const MAX_CHAT_GROUP_NAME_LENGTH = 60;
export const MAX_CHAT_PREVIEW_LENGTH = 100;
export const CHAT_SEND_COOLDOWN_MS = 750;

export type FriendConversationType = 'direct' | 'group';
export type FriendConversationMemberStatus = 'invited' | 'active' | 'declined' | 'left' | 'removed';
export type FriendConversationMemberRole = 'owner' | 'admin' | 'member';

export function normalizeChatUserId(value: unknown) {
  return typeof value === 'string' && /^[^/\s]{1,128}$/u.test(value) ? value : null;
}

export function normalizeConversationId(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/u.test(value) ? value : null;
}

export function normalizeClientMessageId(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/u.test(value) ? value : null;
}

export function directConversationIdFor(userA: string, userB: string) {
  const participants = [userA, userB].sort();
  return `direct_${createHash('sha256').update(JSON.stringify(participants)).digest('hex')}`;
}

export function messageIdFor(userId: string, clientMessageId: string) {
  return `message_${createHash('sha256').update(`${userId}:${clientMessageId}`).digest('hex')}`;
}

export function normalizeFriendIds(value: unknown, callerId: string) {
  if (!Array.isArray(value)) return [];
  const ids = value.map(normalizeChatUserId).filter((id): id is string => Boolean(id));
  return Array.from(new Set(ids.filter((id) => id !== callerId)));
}

export function sanitizeGroupName(value: unknown) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error('Group name must be text.');
  const normalized = normalizeChatText(value);
  if (!normalized) return null;
  if (normalized.length > MAX_CHAT_GROUP_NAME_LENGTH) throw new Error('Group name is too long.');
  return normalized;
}

export function sanitizeChatMessage(value: unknown) {
  if (typeof value !== 'string') throw new Error('Message text is required.');
  const normalized = normalizeChatText(value);
  if (!normalized) throw new Error('Message cannot be blank.');
  if (normalized.length > MAX_CHAT_MESSAGE_LENGTH) throw new Error('Message is too long.');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)) {
    throw new Error('Message contains unsupported characters.');
  }
  return normalized;
}

export function sanitizeMessagePreview(text: string) {
  return Array.from(text).slice(0, MAX_CHAT_PREVIEW_LENGTH).join('');
}

export function isAcceptedFriend(user: unknown, friend: unknown, userId: string, friendId: string) {
  const userFriends = readStringArray((user as { friendIds?: unknown } | null)?.friendIds);
  const friendFriends = readStringArray((friend as { friendIds?: unknown } | null)?.friendIds);
  return userFriends.includes(friendId) && friendFriends.includes(userId);
}

export function isUnreadConversation(input: {
  lastMessageAt: number | null;
  lastMessageSenderId: string | null;
  lastReadAt: number | null;
  currentUserId: string;
}) {
  return input.lastMessageAt !== null &&
    input.lastMessageSenderId !== input.currentUserId &&
    (input.lastReadAt === null || input.lastMessageAt > input.lastReadAt);
}

function normalizeChatText(value: string) {
  return value.replace(/\r\n?/gu, '\n').replace(/[\t ]+/gu, ' ').replace(/ *\n */gu, '\n').trim();
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
