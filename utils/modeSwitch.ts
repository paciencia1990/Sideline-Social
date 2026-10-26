import type { AppMode } from "@/utils/onboardingMode";

/** Mode is a navigation preference, never an authorization decision. */
export async function switchModeImmediately(options: {
  inFlight: { current: boolean };
  mode: AppMode;
  isCurrentAccount: () => boolean;
  setMode: (mode: AppMode) => void;
  navigate: () => void;
  persist: (mode: AppMode) => Promise<void>;
  onPersistenceError: (error: unknown) => void;
}): Promise<void> {
  if (options.inFlight.current || !options.isCurrentAccount()) return;
  options.inFlight.current = true;
  // Queue the preference write before the destination reads the same profile.
  // Rejection is handled immediately, without delaying navigation.
  const persistence = (async () => {
    try {
      await options.persist(options.mode);
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error };
    }
  })();
  try {
    options.setMode(options.mode);
    options.navigate();
  } catch (error) {
    options.inFlight.current = false;
    throw error;
  }
  const outcome = await persistence;
  if (!outcome.ok && options.isCurrentAccount()) options.onPersistenceError(outcome.error);
}
