function publicHttpsUrl(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed?.startsWith("https://") ? trimmed : null;
}

function supportEmail(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(trimmed) ? trimmed : null;
}

// Owner-supplied values. The bundled legal area remains available without
// these, but App Store submission must wait until all public endpoints exist.
export const PRIVACY_POLICY_URL = publicHttpsUrl(process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL);
export const TERMS_OF_USE_URL = publicHttpsUrl(process.env.EXPO_PUBLIC_TERMS_OF_USE_URL);
export const SUPPORT_URL = publicHttpsUrl(process.env.EXPO_PUBLIC_SUPPORT_URL);
export const SUPPORT_EMAIL = supportEmail(process.env.EXPO_PUBLIC_SUPPORT_EMAIL);
