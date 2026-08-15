export type AuthProviderVisibilityInput = {
  appleAvailable: boolean;
  appleEnabled: boolean;
  googleEnabled: boolean;
  platform: string;
};

export function resolveAuthProviderVisibility({
  appleAvailable,
  appleEnabled,
  googleEnabled,
  platform,
}: AuthProviderVisibilityInput) {
  return {
    showApple: platform === "ios" && appleEnabled && appleAvailable,
    showGoogle: googleEnabled,
  } as const;
}
