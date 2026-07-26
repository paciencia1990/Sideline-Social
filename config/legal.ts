function publicHttpsUrl(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed?.startsWith("https://") ? trimmed : null;
}

// Owner-supplied web endpoints. The support email is bundled so users always
// have a direct contact even when no support website is configured.
export const PRIVACY_POLICY_URL = publicHttpsUrl(process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL);
export const TERMS_OF_USE_URL = publicHttpsUrl(process.env.EXPO_PUBLIC_TERMS_OF_USE_URL);
export const SUPPORT_URL = publicHttpsUrl(process.env.EXPO_PUBLIC_SUPPORT_URL);
export const SUPPORT_EMAIL = "joann@joinsidelinesocial.com";
