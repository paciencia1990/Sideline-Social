export const PARENT_PROFILE_ROUTE = "/(tabs)/profile";
export const COACH_MODE_ROUTE = "/coach";
export const SIGN_IN_ROUTE = "/(auth)/sign-in";
export const EMAIL_SIGN_IN_ROUTE = "/(auth)/email-login";
export const SIGN_UP_ROUTE = "/(auth)/sign-up";

const AUTHENTICATED_ROOT_SEGMENTS = new Set([
  "(tabs)",
  "(games)",
  "(social)",
  "coach",
  "games",
  "leaderboard",
  "teams",
]);

export function routeRequiresAuthentication(rootSegment?: string): boolean {
  return rootSegment ? AUTHENTICATED_ROOT_SEGMENTS.has(rootSegment) : false;
}