export type FirebaseAppCheckStatus = "initializing" | "ready" | "failed";

export type FirebaseAppIdentity = {
  appId?: string | null;
  projectId?: string | null;
};

export const APP_CHECK_BRIDGE_CACHE_MILLIS = 25 * 60 * 1000;

export const STORE_APP_CHECK_PROVIDERS = Object.freeze({
  android: "playIntegrity" as const,
  apple: "appAttestWithDeviceCheckFallback" as const,
});

export function assertMatchingFirebaseAppIdentity(
  expected: FirebaseAppIdentity,
  native: FirebaseAppIdentity,
) {
  if (
    !expected.appId
    || !expected.projectId
    || native.appId !== expected.appId
    || native.projectId !== expected.projectId
  ) {
    throw new Error("app-check/native-firebase-mismatch");
  }
}

export function resolveModerationReportReadiness(input: {
  appCheckStatus: FirebaseAppCheckStatus;
  authResolved: boolean;
  signedIn: boolean;
}) {
  if (!input.authResolved || input.appCheckStatus === "initializing") return "checking" as const;
  if (!input.signedIn) return "signedOut" as const;
  return input.appCheckStatus === "ready" ? "ready" as const : "unavailable" as const;
}
