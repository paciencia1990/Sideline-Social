import Constants from "expo-constants";

import { normalizeAuthProviderRuntimeConfig } from "@/utils/authProviderRuntimeConfig";

export const AUTH_PROVIDER_CONFIG = normalizeAuthProviderRuntimeConfig(
  Constants.expoConfig?.extra?.authProviders,
);
