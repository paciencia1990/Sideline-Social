import { requireOptionalNativeModule } from "expo-modules-core";

let cachedAvailability: boolean | null = null;

export function isTeamVoiceAudioAvailable() {
  if (cachedAvailability != null) return cachedAvailability;
  try {
    cachedAvailability = requireOptionalNativeModule("ExponentAV") != null;
  } catch {
    cachedAvailability = false;
  }
  return cachedAvailability;
}
