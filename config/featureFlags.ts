export type FeatureFlags = Readonly<{
  coachAiEnabled: boolean;
  coachAiTestingPreview: boolean;
}>;

export function resolveFeatureFlags({
  isDevelopment,
  coachAiTestingValue,
  coachAiBetaBuildValue,
  coachAiProductionBetaBuildValue,
}: {
  isDevelopment: boolean;
  coachAiTestingValue?: string;
  coachAiBetaBuildValue?: string;
  coachAiProductionBetaBuildValue?: string;
}): FeatureFlags {
  const stagingBetaBuild = coachAiBetaBuildValue === "true";
  const productionBetaBuild = coachAiProductionBetaBuildValue === "true";
  if (stagingBetaBuild && productionBetaBuild) {
    throw new Error("Coach AI staging-beta and production-beta build markers cannot both be enabled.");
  }

  const developmentTesting = isDevelopment && !stagingBetaBuild && !productionBetaBuild;
  const stagingBetaTesting = stagingBetaBuild;
  const productionBetaTesting = !isDevelopment && productionBetaBuild;
  const coachAiTestingPreview = coachAiTestingValue === "true"
    && (developmentTesting || stagingBetaTesting || productionBetaTesting);
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
  coachAiProductionBetaBuildValue: process.env.EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD,
});
