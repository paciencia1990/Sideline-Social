export type AuthSessionProfileResult<TProfile> = {
  exists: boolean;
  profile: TProfile | undefined;
  unavailable: boolean;
};

type LoadAuthSessionProfileOptions<TProfile> = {
  allowUnavailable: boolean;
  classifyError: (error: unknown) => string;
  onUnavailable: (code: string) => void;
  read: () => Promise<{ exists: boolean; profile: TProfile | undefined }>;
};

type InitializeFederatedProfileOptions<TStanding extends { status: string }> = {
  classifyError: (error: unknown) => string;
  initializeProfile: () => Promise<unknown>;
  readStanding: () => Promise<TStanding>;
  requireSecurityReady: () => Promise<void>;
};

const RESTRICTED_STANDING_STATUSES = new Set([
  "messagingRestricted",
  "suspended",
  "banned",
]);

/**
 * Loads the ordinary account profile after Firebase Authentication succeeds.
 *
 * Suspended and banned accounts are intentionally denied access to their
 * ordinary /users document. Their authenticated session must survive that
 * denial so the separate, server-owned standing and appeal surface can load.
 * Callers that require the ordinary profile (for example profile editing)
 * keep strict behavior by passing allowUnavailable: false.
 */
export async function loadAuthSessionProfile<TProfile>(
  options: LoadAuthSessionProfileOptions<TProfile>,
): Promise<AuthSessionProfileResult<TProfile>> {
  try {
    const result = await options.read();
    return { ...result, unavailable: false };
  } catch (error) {
    if (!options.allowUnavailable) throw error;
    options.onUnavailable(options.classifyError(error));
    return { exists: true, profile: undefined, unavailable: true };
  }
}

/**
 * Preserves an existing Google or Apple session only when the server-owned
 * standing confirms that Firestore denied profile access because the account
 * is restricted. Missing profiles and unrelated failures remain on the strict
 * initialization path and are never inferred from a permission denial.
 */
export async function initializeFederatedProfileForSession<
  TStanding extends { status: string },
>(options: InitializeFederatedProfileOptions<TStanding>) {
  try {
    await options.initializeProfile();
    return { restrictedSession: false as const };
  } catch (profileError) {
    if (!isPermissionDenied(options.classifyError(profileError))) throw profileError;
    await options.requireSecurityReady();
    const standing = await options.readStanding();
    if (!RESTRICTED_STANDING_STATUSES.has(standing.status)) throw profileError;
    return { restrictedSession: true as const };
  }
}

function isPermissionDenied(code: string) {
  return code === "permission-denied" || code.endsWith("/permission-denied");
}
