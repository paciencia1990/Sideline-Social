import { auth, firebaseAppCheckReady } from "@/config/firebase";

const SAFE_CODES = new Set([
  "unavailable", "deadline-exceeded", "cancelled", "resource-exhausted",
  "permission-denied", "unauthenticated", "failed-precondition",
  "team-read/session-unconfirmed", "team-read/security-unavailable", "team-read/security-timeout",
]);

export function getSafeTeamReadErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const value = error as { code?: unknown; safeCode?: unknown };
  for (const candidate of [value.safeCode, value.code]) {
    if (typeof candidate !== "string") continue;
    const code = candidate.replace(/^(firestore|functions)\//u, "");
    if (SAFE_CODES.has(code)) return code;
  }
  return "unknown";
}

export function isTransientTeamReadError(error: unknown): boolean {
  return ["unavailable", "deadline-exceeded", "cancelled", "resource-exhausted",
    "team-read/security-timeout"].includes(getSafeTeamReadErrorCode(error));
}

// Await the existing attestation operation once. This does not refresh tokens,
// retry a read or restart App Check. No dependent read runs after a timeout.
export async function requireTeamReadReady(expectedUserId: string) {
  const session = auth.currentUser;
  const assertSession = () => {
    if (!expectedUserId || !session || session.uid !== expectedUserId || auth.currentUser !== session) {
      throw Object.assign(new Error("Team read session is not current"), { code: "team-read/session-unconfirmed" });
    }
  };
  assertSession();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("Team security readiness timed out"), {
        code: "team-read/security-timeout",
      })), 10_000);
      firebaseAppCheckReady.then(() => resolve(), () => reject(Object.assign(new Error("Team security is unavailable"), {
        code: "team-read/security-unavailable",
      })));
    });
    assertSession();
    return session!;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
