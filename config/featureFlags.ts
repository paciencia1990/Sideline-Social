export type FeatureFlags = Readonly<{
  coachAiEnabled: boolean;
  coachAiTestingPreview: boolean;
}>;

export function resolveFeatureFlags({
  isDevelopment,
  coachAiTestingValue,
  coachAiBetaBuildValue,
}: {
  isDevelopment: boolean;
  coachAiTestingValue?: string;
  coachAiBetaBuildValue?: string;
}): FeatureFlags {
  const coachAiTestingPreview = coachAiTestingValue === "true"
    && (isDevelopment || coachAiBetaBuildValue === "true");
  return Object.freeze({
    coachAiEnabled: coachAiTestingPreview,
    coachAiTestingPreview,
  });
}

/**
 * Development/beta build availability. The backend and ID-token claim
 * independently authorize every request; public values are never entitlement.
 */
export const FEATURE_FLAGS = resolveFeatureFlags({
  isDevelopment: __DEV__,
  coachAiTestingValue: process.env.EXPO_PUBLIC_AI_COACH_TESTING_ENABLED,
  coachAiBetaBuildValue: process.env.EXPO_PUBLIC_AI_COACH_BETA_BUILD,
});
