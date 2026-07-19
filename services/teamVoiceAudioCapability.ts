import { requireOptionalNativeModule } from "expo-modules-core";

let cachedAvailability: boolean | null = null;

export function isTeamVoiceAudioAvailable() {
  if (cachedAvailability != null) return cachedAvailability;
  try {
    cachedAvailability = requireOptionalNativeModule("ExpoAudio") != null;
  } catch {
    cachedAvailability = false;
  }
  return cachedAvailability;
}
