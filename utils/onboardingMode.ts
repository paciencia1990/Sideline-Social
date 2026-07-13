export type AppMode = "parent" | "coach";

export type ModeProfileFields = {
  activeMode?: unknown;
  defaultMode?: unknown;
  onboardingPath?: unknown;
  modeOnboardingCompleted?: unknown;
};

export type ModeOnboardingState = {
  activeMode: AppMode | null;
  preferredMode: AppMode | null;
  onboardingPath: AppMode | null;
  onboardingCompleted: boolean;
};

export function readAppMode(value: unknown): AppMode | null {
  return value === "parent" || value === "coach" ? value : null;
}

export function readModeOnboardingState(profile?: ModeProfileFields | null): ModeOnboardingState {
  return {
    activeMode: readAppMode(profile?.activeMode),
    preferredMode: readAppMode(profile?.defaultMode),
    onboardingPath: readAppMode(profile?.onboardingPath),
    // Compatibility behavior: only an explicit false marks a new account as
    // incomplete. Existing users have no marker and must not be interrupted.
    onboardingCompleted: profile?.modeOnboardingCompleted !== false,
  };
}

export function resolveInitialMode(
  profile?: ModeProfileFields | null,
  locallyStoredMode?: unknown,
): AppMode {
  const state = readModeOnboardingState(profile);
  return state.activeMode ?? state.preferredMode ?? readAppMode(locallyStoredMode) ?? "parent";
}