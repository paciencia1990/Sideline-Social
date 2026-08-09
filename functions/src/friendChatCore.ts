import { createHash } from 'node:crypto';

export const MAX_CHAT_PARTICIPANTS = 10;
export const MAX_CHAT_MESSAGE_LENGTH = 500;
export const MAX_CHAT_GROUP_NAME_LENGTH = 60;
export const MAX_CHAT_PREVIEW_LENGTH = 100;
export const CHAT_SEND_COOLDOWN_MS = 750;
export const FRIEND_CHAT_MEDIA_RESERVATION_COOLDOWN_MS = 10_000;
export const FRIEND_CHAT_VOICE_MAX_DURATION_MS = 120_000;
export const FRIEND_CHAT_VOICE_MAX_SIZE_BYTES = 3 * 1024 * 1024;
export const FRIEND_CHAT_IMAGE_SOURCE_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const FRIEND_CHAT_IMAGE_MAX_SIZE_BYTES = 3 * 1024 * 1024;
export const FRIEND_CHAT_IMAGE_THUMBNAIL_MAX_SIZE_BYTES = 512 * 1024;
export const FRIEND_CHAT_IMAGE_MAX_EDGE = 1600;
export const FRIEND_CHAT_IMAGE_THUMBNAIL_MAX_EDGE = 512;
export const FRIEND_CHAT_QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
export const FRIEND_CHAT_REACTIONS = [
  ...FRIEND_CHAT_QUICK_REACTIONS,
  '🔥', '🎉', '👏', '💪', '🙌', '😄',
  '😍', '😎', '🤔', '😬', '😤', '🤯',
  '🥳', '💯', '✅', '⭐', '🏆', '⚾',
  '🏀', '⚽', '🏈',
] as const;
export const FRIEND_CHAT_FORWARD_MAX_DESTINATIONS = 3;
export const FRIEND_CHAT_FORWARD_COOLDOWN_MS = 5_000;
export const FRIEND_CHAT_PIN_DURATIONS = ['24h', '7d', '30d'] as const;

const FRIEND_CHAT_AUDIO_MIME_TYPES = new Set(['audio/mp4', 'audio/m4a', 'audio/x-m4a']);
const FRIEND_CHAT_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
]);
const PROCESSED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/webp']);

export type FriendConversationType = 'direct' | 'group';
export type FriendConversationMemberStatus = 'invited' | 'active' | 'declined' | 'left' | 'removed';
export type FriendConversationMemberRole = 'owner' | 'admin' | 'member';
export type FriendChatMessageType = 'text' | 'image' | 'voice' | 'system';
export type FriendChatReaction = typeof FRIEND_CHAT_REACTIONS[number];

export type FriendChatVoiceMetadata = {
  durationMilliseconds: number;
  mimeType: 'audio/mp4' | 'audio/m4a' | 'audio/x-m4a';
  sizeBytes: number;
};

export type FriendChatImageVariantMetadata = {
  height: number;
  mimeType: 'image/jpeg' | 'image/webp';
  sizeBytes: number;
  width: number;
};

export type FriendChatImageMetadata = {
  main: FriendChatImageVariantMetadata;
  sourceMimeType: string | null;
  sourceSizeBytes: number;
  thumbnail: FriendChatImageVariantMetadata;
};

export type FriendChatMediaStorageReference = {
  conversationId: string;
  fileName: 'voice.m4a' | 'image.jpg' | 'thumbnail.jpg';
  kind: 'voice' | 'image' | 'thumbnail';
  messageId: string;
  reservationId: string;
};

export function normalizeChatUserId(value: unknown) {
  return typeof value === 'string' && /^[^/\s]{1,128}$/u.test(value) ? value : null;
}

export function normalizeConversationId(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/u.test(value) ? value : null;
}

export function normalizeClientMessageId(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/u.test(value) ? value : null;
}

export function normalizeFriendChatReaction(value: unknown): FriendChatReaction | null {
  return FRIEND_CHAT_REACTIONS.includes(value as FriendChatReaction) ? value as FriendChatReaction : null;
}

export function normalizeFriendChatMessageType(value: unknown): FriendChatMessageType {
  return value === 'image' || value === 'voice' || value === 'system' ? value : 'text';
}

export function directConversationIdFor(userA: string, userB: string) {
  const participants = [userA, userB].sort();
  return `direct_${createHash('sha256').update(JSON.stringify(participants)).digest('hex')}`;
}

export function messageIdFor(userId: string, clientMessageId: string) {
  return `message_${createHash('sha256').update(`${userId}:${clientMessageId}`).digest('hex')}`;
}

export function mediaReservationIdFor(userId: string, clientMessageId: string, kind: 'image' | 'voice') {
  return `media_${createHash('sha256').update(`${kind}:${userId}:${clientMessageId}`).digest('hex')}`;
}

export function friendChatVoiceStoragePath(input: { conversationId: string; messageId: string; reservationId: string }) {
  return `friendChatMedia/${input.conversationId}/${input.messageId}/${input.reservationId}/voice.m4a`;
}

export function friendChatImageStoragePaths(input: { conversationId: string; messageId: string; reservationId: string }) {
  const prefix = `friendChatMedia/${input.conversationId}/${input.messageId}/${input.reservationId}`;
  return { fullPath: `${prefix}/image.jpg`, thumbnailPath: `${prefix}/thumbnail.jpg` };
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

export function sanitizeOptionalChatCaption(value: unknown, maxLength = MAX_CHAT_MESSAGE_LENGTH) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error('Caption must be text.');
  const normalized = normalizeChatText(value);
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new Error('Caption is too long.');
  if (containsUnsupportedControls(normalized)) {
    throw new Error('Caption contains unsupported characters.');
  }
  return normalized;
}

export function sanitizeMessagePreview(text: string) {
  return Array.from(text).slice(0, MAX_CHAT_PREVIEW_LENGTH).join('');
}

export function friendChatMediaPreview(messageType: 'image' | 'text' | 'voice', captionOrText: string | null | undefined) {
  if (messageType === 'text') return sanitizeMessagePreview(captionOrText ?? '');
  const caption = sanitizeMessagePreview(captionOrText ?? '');
  if (caption) return caption;
  return messageType === 'image' ? 'photo' : 'voice';
}

export function validateFriendChatVoiceMetadata(value: unknown): FriendChatVoiceMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_voice_metadata');
  const data = value as Record<string, unknown>;
  const durationMilliseconds = finiteInteger(data.durationMilliseconds);
  const sizeBytes = finiteInteger(data.sizeBytes);
  const mimeType = typeof data.mimeType === 'string' ? data.mimeType.trim().toLowerCase() : '';
  if (!durationMilliseconds || durationMilliseconds < 1 || durationMilliseconds > FRIEND_CHAT_VOICE_MAX_DURATION_MS) {
    throw new Error('recording_too_long');
  }
  if (!sizeBytes || sizeBytes < 1 || sizeBytes > FRIEND_CHAT_VOICE_MAX_SIZE_BYTES) throw new Error('voice_file_too_large');
  if (!FRIEND_CHAT_AUDIO_MIME_TYPES.has(mimeType)) throw new Error('unsupported_audio_type');
  return { durationMilliseconds, sizeBytes, mimeType: mimeType as FriendChatVoiceMetadata['mimeType'] };
}

export function validateFriendChatImageMetadata(value: unknown): FriendChatImageMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_image_metadata');
  const data = value as Record<string, unknown>;
  const sourceSizeBytes = finiteInteger(data.sourceSizeBytes);
  if (!sourceSizeBytes || sourceSizeBytes < 1 || sourceSizeBytes > FRIEND_CHAT_IMAGE_SOURCE_MAX_SIZE_BYTES) {
    throw new Error('image_source_too_large');
  }
  const sourceMimeType = typeof data.sourceMimeType === 'string' ? data.sourceMimeType.trim().toLowerCase() : null;
  if (sourceMimeType && !FRIEND_CHAT_IMAGE_MIME_TYPES.has(sourceMimeType)) throw new Error('unsupported_image_type');
  return {
    main: validateImageVariant((data as { main?: unknown }).main, FRIEND_CHAT_IMAGE_MAX_SIZE_BYTES, FRIEND_CHAT_IMAGE_MAX_EDGE),
    sourceMimeType,
    sourceSizeBytes,
    thumbnail: validateImageVariant(
      (data as { thumbnail?: unknown }).thumbnail,
      FRIEND_CHAT_IMAGE_THUMBNAIL_MAX_SIZE_BYTES,
      FRIEND_CHAT_IMAGE_THUMBNAIL_MAX_EDGE,
    ),
  };
}

export function parseFriendChatMediaStoragePath(storagePath: unknown): FriendChatMediaStorageReference | null {
  if (typeof storagePath !== 'string') return null;
  const match = /^friendChatMedia\/([A-Za-z0-9_-]+)\/(message_[a-f0-9]{64})\/(media_[a-f0-9]{64})\/(voice\.m4a|image\.jpg|thumbnail\.jpg)$/u.exec(storagePath);
  if (!match) return null;
  const fileName = match[4] as FriendChatMediaStorageReference['fileName'];
  return {
    conversationId: match[1],
    fileName,
    kind: fileName === 'voice.m4a' ? 'voice' : fileName === 'image.jpg' ? 'image' : 'thumbnail',
    messageId: match[2],
    reservationId: match[3],
  };
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

function containsUnsupportedControls(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 10) || code === 127;
  });
}

function validateImageVariant(value: unknown, maxSizeBytes: number, maxEdge: number): FriendChatImageVariantMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_image_metadata');
  const data = value as Record<string, unknown>;
  const width = finiteInteger(data.width);
  const height = finiteInteger(data.height);
  const sizeBytes = finiteInteger(data.sizeBytes);
  const mimeType = typeof data.mimeType === 'string' ? data.mimeType.trim().toLowerCase() : '';
  if (!width || !height || width < 1 || height < 1 || Math.max(width, height) > maxEdge) throw new Error('invalid_image_dimensions');
  if (!sizeBytes || sizeBytes < 1 || sizeBytes > maxSizeBytes) throw new Error('image_file_too_large');
  if (!PROCESSED_IMAGE_MIME_TYPES.has(mimeType)) throw new Error('unsupported_image_type');
  return { height, mimeType: mimeType as FriendChatImageVariantMetadata['mimeType'], sizeBytes, width };
}

function finiteInteger(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number.NaN;
  return Number.isInteger(numberValue) ? numberValue : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
