import Constants from "expo-constants";

type AuthProviderExtra = {
  appleEnabled?: boolean;
  googleEnabled?: boolean;
  googleIosClientId?: string | null;
  googleWebClientId?: string;
};

const providerConfig = (Constants.expoConfig?.extra?.authProviders ?? {}) as AuthProviderExtra;

export const AUTH_PROVIDER_CONFIG = {
  appleEnabled: providerConfig.appleEnabled === true,
  googleEnabled: providerConfig.googleEnabled === true,
  googleIosClientId: providerConfig.googleIosClientId?.trim() || null,
  googleWebClientId: providerConfig.googleWebClientId?.trim() || "autoDetect",
} as const;
