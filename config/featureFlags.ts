export type FeatureFlags = Readonly<{
  coachAiEnabled: boolean;
  coachAiTestingPreview: boolean;
}>;

export function resolveFeatureFlags({
  isDevelopment,
  coachAiTestingValue,
}: {
  isDevelopment: boolean;
  coachAiTestingValue?: string;
}): FeatureFlags {
  const coachAiTestingPreview = isDevelopment && coachAiTestingValue === "true";
  return Object.freeze({
    coachAiEnabled: coachAiTestingPreview,
    coachAiTestingPreview,
  });
}

/**
 * Development-only build availability. The backend independently authorizes
 * every request; this public value is never treated as a server entitlement.
 */
export const FEATURE_FLAGS = resolveFeatureFlags({
  isDevelopment: __DEV__,
  coachAiTestingValue: process.env.EXPO_PUBLIC_AI_COACH_TESTING_ENABLED,
});
