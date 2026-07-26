import { stopVoicePlaybackForSource } from "@/services/voiceMemoAudioService";
import { deleteLocalVoiceMemo } from "@/services/voiceMemoFileService";
import {
  invalidateVoicePlaybackSource,
  voicePlaybackSourceIdentity,
  type PersistedVoicePlaybackSource,
} from "@/utils/voicePlaybackCore";
import {
  registerVoicePlaybackMediaFile,
  takeVoicePlaybackMediaFiles,
} from "@/utils/voicePlaybackMediaCache";

export function registerLocalVoicePlaybackFile(source: PersistedVoicePlaybackSource, uri: string) {
  registerVoicePlaybackMediaFile(voicePlaybackSourceIdentity(source), uri);
}

export async function clearPersistedVoicePlaybackArtifacts(
  source: PersistedVoicePlaybackSource,
  deleteFile: (uri: string) => Promise<void> = deleteLocalVoiceMemo,
) {
  const key = voicePlaybackSourceIdentity(source);
  await stopVoicePlaybackForSource(key).catch(() => {});
  invalidateVoicePlaybackSource(source);
  const files = takeVoicePlaybackMediaFiles(key);
  if (!files.length) return;
  await Promise.allSettled(files.map((uri) => deleteFile(uri)));
}
