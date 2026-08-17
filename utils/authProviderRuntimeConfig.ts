export const GOOGLE_WEB_CLIENT_ID_AUTO_DETECT = "autoDetect" as const;

export type NormalizedAuthProviderRuntimeConfig = {
  appleEnabled: boolean;
  googleEnabled: boolean;
  googleIosClientId: string | null;
  googleWebClientId: string;
};

const DEFAULT_AUTH_PROVIDER_CONFIG: NormalizedAuthProviderRuntimeConfig = {
  appleEnabled: false,
  googleEnabled: false,
  googleIosClientId: null,
  googleWebClientId: GOOGLE_WEB_CLIENT_ID_AUTO_DETECT,
};

export function normalizeAuthProviderRuntimeConfig(
  value: unknown,
): NormalizedAuthProviderRuntimeConfig {
  if (!isPlainObject(value)) return { ...DEFAULT_AUTH_PROVIDER_CONFIG };

  const appleEnabled = readOwnValue(value, "appleEnabled");
  const googleEnabled = readOwnValue(value, "googleEnabled");
  const googleIosClientId = readOwnValue(value, "googleIosClientId");
  const googleWebClientId = readOwnValue(value, "googleWebClientId");

  return {
    appleEnabled: appleEnabled === true,
    googleEnabled: googleEnabled === true,
    googleIosClientId: normalizeOptionalString(googleIosClientId),
    googleWebClientId:
      normalizeOptionalString(googleWebClientId) ?? GOOGLE_WEB_CLIENT_ID_AUTO_DETECT,
  };
}

export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function readOwnValue(value: Record<string, unknown>, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}
