export type FeatureFlags = Readonly<{
  coachAiEnabled: boolean;
}>;

/** Production-safe feature availability. Do not derive secret-backed features from client environment values. */
export const FEATURE_FLAGS: FeatureFlags = Object.freeze({
  coachAiEnabled: false,
});
