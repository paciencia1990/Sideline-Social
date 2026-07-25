import type { StoredVoiceMemo, TeamVoiceMimeType } from "@/types/teamVoiceMessaging";

const MAX_VOICE_DURATION_MS = 90_000;
const MAX_VOICE_SIZE_BYTES = 2 * 1024 * 1024;
const VOICE_MIME_TYPES = new Set<TeamVoiceMimeType>(["audio/mp4", "audio/m4a", "audio/x-m4a"]);
const LOCAL_URI_PREFIX = /^(?:file|content|cache):/iu;

export type NormalizedVoiceMessageFields = {
  caption: string | null;
  contentType: "text" | "voice";
  senderUserId: string;
  voiceMemo: StoredVoiceMemo | null;
};

export function normalizeVoiceMessageFields(data: Record<string, unknown>): NormalizedVoiceMessageFields {
  const nestedVoice = readRecord(data.voiceMemo) ??
    readRecord(data.voice) ??
    readRecord(data.audio) ??
    readRecord(data.media);
  const declaredType = firstString(data.contentType, data.messageType, data.type);
  const hasVoiceFields = Boolean(
    nestedVoice ||
    firstString(data.storagePath, data.audioPath, data.voicePath, data.mediaPath),
  );
  const contentType = declaredType === "voice" || hasVoiceFields ? "voice" : "text";
  const source = nestedVoice ?? data;

  return {
    caption: firstNullableString(data.caption, source.caption),
    contentType,
    senderUserId: firstString(data.senderUserId, data.senderId, data.userId) ?? "",
    voiceMemo: contentType === "voice" ? normalizeStoredVoiceMemo(source, data) : null,
  };
}

export function normalizeStoredVoiceMemo(
  source: Record<string, unknown>,
  fallback: Record<string, unknown> = {},
): StoredVoiceMemo | null {
  const storagePath = firstString(
    source.storagePath,
    source.audioPath,
    source.voicePath,
    source.mediaPath,
    fallback.storagePath,
    fallback.audioPath,
    fallback.voicePath,
    fallback.mediaPath,
  );
  if (!storagePath || !isCanonicalTeamVoiceStoragePath(storagePath)) return null;

  const durationMilliseconds = firstFiniteNumber(
    source.durationMilliseconds,
    source.durationMs,
    source.durationMillis,
    fallback.durationMilliseconds,
    fallback.durationMs,
    fallback.durationMillis,
  );
  if (
    durationMilliseconds == null ||
    !Number.isInteger(durationMilliseconds) ||
    durationMilliseconds < 1 ||
    durationMilliseconds > MAX_VOICE_DURATION_MS
  ) return null;

  const sizeBytes = firstFiniteNumber(
    source.sizeBytes,
    source.fileSizeBytes,
    fallback.sizeBytes,
    fallback.fileSizeBytes,
  );
  if (
    sizeBytes != null &&
    (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_VOICE_SIZE_BYTES)
  ) return null;

  const mimeType = normalizeVoiceMimeType(firstString(source.mimeType, fallback.mimeType));
  return {
    storagePath,
    durationMilliseconds,
    sizeBytes: sizeBytes ?? 0,
    mimeType,
  };
}

export function isCanonicalTeamVoiceStoragePath(value: string) {
  if (
    LOCAL_URI_PREFIX.test(value) ||
    value.includes("://") ||
    value.includes("\\") ||
    value.includes("..") ||
    value.includes("?") ||
    value.includes("#")
  ) return false;
  return /^teamVoiceMemos\/[^/]+\/(?:announcements\/[^/]+|privateConversations\/[^/]+\/[^/]+)\/[^/]+\/memo\.m4a$/u.test(value);
}

function normalizeVoiceMimeType(value: string | null): TeamVoiceMimeType {
  return value && VOICE_MIME_TYPES.has(value as TeamVoiceMimeType)
    ? value as TeamVoiceMimeType
    : "audio/mp4";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstNullableString(...values: unknown[]): string | null {
  return firstString(...values);
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const numericValue = typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
    if (Number.isFinite(numericValue)) return numericValue;
  }
  return null;
}
