const MAX_VOICE_DURATION_MS = 90_000;
const MAX_VOICE_SIZE_BYTES = 2 * 1024 * 1024;
const VOICE_MIME_TYPES = new Set(["audio/mp4", "audio/m4a", "audio/x-m4a"]);

export type NormalizedAnnouncementContentType = "text" | "voice";

export function isValidTeamVoiceMetadata(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const voice = value as Record<string, unknown>;
  return typeof voice.storagePath === "string" &&
    voice.storagePath.startsWith("teamVoiceMemos/") &&
    Number.isFinite(voice.durationMilliseconds) &&
    Number(voice.durationMilliseconds) > 0 &&
    Number(voice.durationMilliseconds) <= MAX_VOICE_DURATION_MS &&
    Number.isFinite(voice.sizeBytes) &&
    Number(voice.sizeBytes) > 0 &&
    Number(voice.sizeBytes) <= MAX_VOICE_SIZE_BYTES &&
    typeof voice.mimeType === "string" &&
    VOICE_MIME_TYPES.has(voice.mimeType);
}

export function resolveAnnouncementContentType(
  contentType: unknown,
  voiceMemo: unknown,
): NormalizedAnnouncementContentType {
  return contentType === "voice" && isValidTeamVoiceMetadata(voiceMemo) ? "voice" : "text";
}
