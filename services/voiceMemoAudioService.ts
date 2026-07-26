let activePlayback: { sourceKey: string | null; stop: () => Promise<void> } | null = null;

export async function activateVoicePlayback(stop: () => Promise<void>, sourceKey: string | null = null) {
  if (activePlayback && activePlayback.stop !== stop) await activePlayback.stop();
  activePlayback = { sourceKey, stop };
}

export function releaseVoicePlayback(stop: () => Promise<void>) {
  if (activePlayback?.stop === stop) activePlayback = null;
}

export async function stopVoicePlayback() {
  if (activePlayback) await activePlayback.stop();
}

export async function stopVoicePlaybackForSource(sourceKey: string) {
  if (activePlayback?.sourceKey === sourceKey) await activePlayback.stop();
}
