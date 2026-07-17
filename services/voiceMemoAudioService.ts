let activeStop: (() => Promise<void>) | null = null;

export async function activateVoicePlayback(stop: () => Promise<void>) {
  if (activeStop && activeStop !== stop) await activeStop();
  activeStop = stop;
}

export function releaseVoicePlayback(stop: () => Promise<void>) {
  if (activeStop === stop) activeStop = null;
}

export async function stopVoicePlayback() {
  if (activeStop) await activeStop();
}
