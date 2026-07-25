import { createHash } from 'node:crypto';

export const TEAM_VOICE_MAX_DURATION_MS = 90_000;
export const TEAM_VOICE_MAX_SIZE_BYTES = 2 * 1024 * 1024;
export const TEAM_VOICE_MIME_TYPES = ['audio/mp4', 'audio/m4a', 'audio/x-m4a'] as const;
export type TeamVoiceMimeType = typeof TEAM_VOICE_MIME_TYPES[number];
export type TeamVoiceUploadKind = 'announcement' | 'privateMessage';
export type TeamPrivateMessageContentType = 'text' | 'voice';
export type TeamVoiceStorageReference = {
  kind: TeamVoiceUploadKind;
  messageId: string;
  reservationId: string;
  teamId: string;
  conversationId?: string;
};

export type TeamVoiceMemoMetadata = {
  storagePath: string;
  durationMilliseconds: number;
  sizeBytes: number;
  mimeType: TeamVoiceMimeType;
};

export function readRequiredIdentifier(value: unknown, code: string) {
  if (typeof value !== 'string') throw new Error(code);
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(normalized)) throw new Error(code);
  return normalized;
}

export function readClientIdentifier(value: unknown) {
  return readRequiredIdentifier(value, 'invalid_client_message_id');
}

export function readBoundedText(value: unknown, min: number, max: number, code: string) {
  if (typeof value !== 'string') throw new Error(code);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw new Error(code);
  return normalized;
}

export function readOptionalBoundedText(value: unknown, max: number, code: string) {
  if (value == null || value === '') return undefined;
  return readBoundedText(value, 1, max, code);
}

export function readAnnouncementAudience(value: unknown) {
  if (value !== 'all' && value !== 'parents' && value !== 'staff') throw new Error('invalid_audience');
  return value;
}

export function validateVoiceMemoMetadata(value: unknown): Omit<TeamVoiceMemoMetadata, 'storagePath'> {
  if (!value || typeof value !== 'object') throw new Error('invalid_voice_metadata');
  const data = value as Record<string, unknown>;
  const durationMilliseconds = data.durationMilliseconds;
  const sizeBytes = data.sizeBytes;
  const mimeType = data.mimeType;
  if (
    typeof durationMilliseconds !== 'number' ||
    !Number.isInteger(durationMilliseconds) ||
    durationMilliseconds < 500 ||
    durationMilliseconds > TEAM_VOICE_MAX_DURATION_MS
  ) throw new Error('recording_too_long');
  if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > TEAM_VOICE_MAX_SIZE_BYTES) {
    throw new Error('voice_file_too_large');
  }
  if (typeof mimeType !== 'string' || !TEAM_VOICE_MIME_TYPES.includes(mimeType as TeamVoiceMimeType)) {
    throw new Error('unsupported_audio_type');
  }
  return { durationMilliseconds, sizeBytes, mimeType: mimeType as TeamVoiceMimeType };
}

export function teamPrivateConversationId(teamId: string, coachUserId: string, parentUserId: string) {
  return `tpc_${createHash('sha256').update(`${teamId}\u001f${coachUserId}\u001f${parentUserId}`).digest('hex')}`;
}

export function teamPrivateMessageId(conversationId: string, senderUserId: string, clientMessageId: string) {
  return `tpm_${createHash('sha256').update(`${conversationId}\u001f${senderUserId}\u001f${clientMessageId}`).digest('hex')}`;
}

export function teamVoiceStoragePath(input: {
  announcementId?: string;
  conversationId?: string;
  messageId?: string;
  reservationId: string;
  teamId: string;
}) {
  if (input.announcementId) {
    return `teamVoiceMemos/${input.teamId}/announcements/${input.announcementId}/${input.reservationId}/memo.m4a`;
  }
  if (input.conversationId && input.messageId) {
    return `teamVoiceMemos/${input.teamId}/privateConversations/${input.conversationId}/${input.messageId}/${input.reservationId}/memo.m4a`;
  }
  throw new Error('invalid_voice_target');
}

export function parseTeamVoiceStoragePath(storagePath: unknown): TeamVoiceStorageReference | null {
  if (typeof storagePath !== 'string') return null;
  const announcement = /^teamVoiceMemos\/([A-Za-z0-9_-]+)\/announcements\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/memo\.m4a$/u.exec(storagePath);
  if (announcement) {
    return {
      kind: 'announcement',
      teamId: announcement[1],
      messageId: announcement[2],
      reservationId: announcement[3],
    };
  }
  const privateMessage = /^teamVoiceMemos\/([A-Za-z0-9_-]+)\/privateConversations\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/memo\.m4a$/u.exec(storagePath);
  if (!privateMessage) return null;
  return {
    kind: 'privateMessage',
    teamId: privateMessage[1],
    conversationId: privateMessage[2],
    messageId: privateMessage[3],
    reservationId: privateMessage[4],
  };
}

export function isExplicitConversationParticipant(
  conversation: Record<string, unknown> | undefined,
  userId: string,
) {
  return Boolean(
    conversation &&
    Array.isArray(conversation.participantUserIds) &&
    conversation.participantUserIds.length === 2 &&
    conversation.participantUserIds.includes(userId) &&
    (conversation.coachUserId === userId || conversation.parentUserId === userId),
  );
}

export function shouldReceiveAnnouncement(member: Record<string, unknown>, audience: unknown) {
  if (member.status !== 'active') return false;
  const roles = member.roles && typeof member.roles === 'object' ? member.roles as Record<string, unknown> : {};
  const parent = roles.parent === true || member.role === 'parent';
  const coach = roles.coach === true || member.role === 'coach';
  const staff = roles.staff === true || member.role === 'assistantCoach' || member.role === 'teamParent';
  if (audience === 'parents') return parent;
  if (audience === 'staff') return coach || staff;
  return audience === 'all' && (parent || coach || staff);
}

export function privateMessagePreview(contentType: TeamPrivateMessageContentType, text?: string, durationMilliseconds?: number) {
  if (contentType === 'voice') return `voice:${Math.max(0, Math.min(TEAM_VOICE_MAX_DURATION_MS, durationMilliseconds ?? 0))}`;
  const normalized = typeof text === 'string' ? text.trim().replace(/\s+/gu, ' ') : '';
  return normalized.slice(0, 160);
}
