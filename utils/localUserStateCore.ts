export const RETAINED_DEVICE_PREFERENCE_KEYS = [
  "onboardingComplete",
  "@sideline_squad_language",
] as const;

export type LocalUserStateCleanupDependencies = {
  clearInMemoryState: () => Promise<void> | void;
  clearNotificationResponse: () => Promise<void>;
  getAllStorageKeys: () => Promise<readonly string[]>;
  removeStorageKeys: (keys: readonly string[]) => Promise<void>;
};

export type LocalSignOutDependencies = {
  clearLocalUserState: () => Promise<void>;
  firebaseSignOut: () => Promise<void>;
  reportFailure: (
    stage: "firebase-sign-out" | "local-user-state",
    error: unknown,
  ) => void;
  resetLocalAuthContext: () => void;
};

export function getLocalUserStateKeysToRemove(keys: readonly string[]) {
  const retained = new Set<string>(RETAINED_DEVICE_PREFERENCE_KEYS);
  return Array.from(new Set(keys)).filter((key) => !retained.has(key));
}

export async function clearLocalUserStateWithDependencies(
  dependencies: LocalUserStateCleanupDependencies,
) {
  const storageCleanup = Promise.resolve()
    .then(() => dependencies.getAllStorageKeys())
    .then((keys) => getLocalUserStateKeysToRemove(keys))
    .then(async (keys) => {
      if (keys.length > 0) await dependencies.removeStorageKeys(keys);
    });

  const results = await Promise.allSettled([
    Promise.resolve().then(() => dependencies.clearInMemoryState()),
    Promise.resolve().then(() => dependencies.clearNotificationResponse()),
    storageCleanup,
  ]);

  if (results.some((result) => result.status === "rejected")) {
    throw new Error("local_user_state_cleanup_failed");
  }
}

export async function completeLocalSignOut(dependencies: LocalSignOutDependencies) {
  try {
    await dependencies.firebaseSignOut();
  } catch (error) {
    dependencies.reportFailure("firebase-sign-out", error);
  }

  try {
    await dependencies.clearLocalUserState();
  } catch (error) {
    dependencies.reportFailure("local-user-state", error);
  }

  dependencies.resetLocalAuthContext();
}
