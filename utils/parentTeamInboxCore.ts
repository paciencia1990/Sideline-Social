export type SupplementaryInboxLoad<T> = {
  available: boolean;
  items: T[];
};

const AUTHORIZATION_CODES = new Set([
  "auth/user-disabled",
  "functions/permission-denied",
  "functions/unauthenticated",
  "membership-missing",
  "permission-denied",
  "unauthenticated",
]);

export async function loadSupplementaryTeamInbox<T>(
  loader: () => Promise<T[]>,
  authenticated: boolean,
): Promise<SupplementaryInboxLoad<T>> {
  if (!authenticated) {
    const error = new Error("Sign in to load team messages.");
    (error as Error & { code?: string }).code = "unauthenticated";
    throw error;
  }

  try {
    return { available: true, items: await loader() };
  } catch (error) {
    if (isAuthorizationFailure(error)) throw error;
    return { available: false, items: [] };
  }
}

export function isAuthorizationFailure(error: unknown) {
  const code = readErrorCode(error);
  return AUTHORIZATION_CODES.has(code) || code.startsWith("auth/");
}

export function readErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return "unknown";
  return String(error.code).trim().toLowerCase();
}
