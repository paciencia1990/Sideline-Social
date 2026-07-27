import { normalizePublicHttpsUrl, SUPPORT_EMAIL } from "@/config/legalConfig";

// Owner-supplied web endpoints. The support email is bundled so users always
// have a direct contact even when no support website is configured.
export const PRIVACY_POLICY_URL = normalizePublicHttpsUrl(process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL);
export const TERMS_OF_USE_URL = normalizePublicHttpsUrl(process.env.EXPO_PUBLIC_TERMS_OF_USE_URL);
export const SUPPORT_URL = normalizePublicHttpsUrl(process.env.EXPO_PUBLIC_SUPPORT_URL);
export { SUPPORT_EMAIL };
