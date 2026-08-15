import * as AppleAuthentication from "expo-apple-authentication";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { AUTH_PROVIDER_CONFIG } from "@/config/authProviders";
import { resolveAuthProviderVisibility } from "@/utils/authProviderAvailability";

export function useAuthProviderAvailability() {
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    if (Platform.OS !== "ios" || !AUTH_PROVIDER_CONFIG.appleEnabled) return undefined;

    void AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (active) setAppleAvailable(available);
      })
      .catch(() => {
        if (active) setAppleAvailable(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return resolveAuthProviderVisibility({
    appleAvailable,
    appleEnabled: AUTH_PROVIDER_CONFIG.appleEnabled,
    googleEnabled: AUTH_PROVIDER_CONFIG.googleEnabled,
    platform: Platform.OS,
  });
}
