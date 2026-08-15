export const AUTH_PROVIDER_IDS = {
  password: "password",
  google: "google.com",
  apple: "apple.com",
} as const;

export type FederatedAuthProvider = "google" | "apple";
export type SignInMethod = "password" | FederatedAuthProvider;

export type ProviderDataLike = {
  providerId?: string | null;
};

export type AccountOnboardingProfile = {
  accountOnboardingCompleted?: unknown;
};

export type AuthOperationGuard = {
  begin: () => number;
  isCurrent: (operationId: number) => boolean;
};

export function providerIdFor(provider: FederatedAuthProvider) {
  return AUTH_PROVIDER_IDS[provider];
}

export function readSignInMethods(providerData: readonly ProviderDataLike[]): SignInMethod[] {
  const methods = new Set<SignInMethod>();
  for (const provider of providerData) {
    if (provider.providerId === AUTH_PROVIDER_IDS.password) methods.add("password");
    if (provider.providerId === AUTH_PROVIDER_IDS.google) methods.add("google");
    if (provider.providerId === AUTH_PROVIDER_IDS.apple) methods.add("apple");
  }
  return [...methods];
}

export function canUnlinkSignInMethod(
  providerData: readonly ProviderDataLike[],
  method: SignInMethod,
) {
  const methods = readSignInMethods(providerData);
  return methods.includes(method) && methods.length > 1;
}

export function readAccountOnboardingCompleted(
  profileExists: boolean,
  profile?: AccountOnboardingProfile | null,
) {
  if (!profileExists) return false;
  // Only new accounts explicitly marked false enter this gate. This preserves
  // every account created before provider onboarding was introduced.
  return profile?.accountOnboardingCompleted !== false;
}

export function isApplePrivateRelayEmail(email: string | null | undefined) {
  const domain = email?.trim().toLowerCase().split("@").at(-1);
  return domain === "privaterelay.appleid.com" || Boolean(domain?.endsWith(".privaterelay.appleid.com"));
}

export function normalizeAuthEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() || null;
}

export function emailsMatch(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeAuthEmail(left);
  const normalizedRight = normalizeAuthEmail(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function createAuthOperationGuard(): AuthOperationGuard {
  let currentOperation = 0;
  return {
    begin: () => {
      currentOperation += 1;
      return currentOperation;
    },
    isCurrent: (operationId) => currentOperation === operationId,
  };
}

