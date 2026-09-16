export type CanonicalAccountProfileInput = {
  adultEligibilityConfirmed: boolean;
  email: string | null;
  firstName: string;
  lastName: string;
  phoneNumber?: string | null;
  policiesAccepted: boolean;
  preferredLanguage: "en" | "es";
  sports?: string[];
  userId: string;
  zipCode?: string;
};

export type AccountProfileTimestamps<T> = {
  createdAt: T;
  updatedAt: T;
};

export function normalizeAccountProfileInput(input: CanonicalAccountProfileInput) {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!input.userId || !firstName || !lastName || !input.policiesAccepted || !input.adultEligibilityConfirmed) {
    const error = new Error("Account onboarding is incomplete.");
    (error as { code?: string }).code = "auth/account-onboarding-incomplete";
    throw error;
  }
  return {
    ...input,
    email: input.email?.trim() || null,
    firstName,
    lastName,
    displayName: `${firstName} ${lastName}`,
    phoneNumber: input.phoneNumber ?? null,
    sports: normalizeSports(input.sports),
    zipCode: input.zipCode?.trim() ?? "",
  };
}

export function buildCanonicalAccountProfile<T>(
  input: CanonicalAccountProfileInput,
  timestamps: AccountProfileTimestamps<T>,
  legalAssentVersion: string,
) {
  const normalized = normalizeAccountProfileInput(input);
  return {
    userId: normalized.userId,
    firstName: normalized.firstName,
    lastName: normalized.lastName,
    displayName: normalized.displayName,
    email: normalized.email,
    zipCode: normalized.zipCode,
    sports: normalized.sports,
    phoneNumber: normalized.phoneNumber,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
    tier: "member",
    totalStars: 0,
    sidelineStars: 0,
    squadIds: [],
    friendIds: [],
    preferredLanguage: normalized.preferredLanguage,
    profileVisibility: "squad_only",
    accountOnboardingCompleted: true,
    accountOnboardingCompletedAt: timestamps.updatedAt,
    adultEligibilityConfirmed: true,
    legalAssentVersion,
    privacyPolicyAcceptedAt: timestamps.updatedAt,
    termsOfUseAcceptedAt: timestamps.updatedAt,
    communityGuidelinesAcceptedAt: timestamps.updatedAt,
    modeOnboardingCompleted: false,
  } as const;
}

export function buildAccountCompletionFields<T>(
  input: Pick<CanonicalAccountProfileInput, "adultEligibilityConfirmed" | "firstName" | "lastName" | "policiesAccepted">,
  updatedAt: T,
  legalAssentVersion: string,
) {
  const normalized = normalizeAccountProfileInput({
    ...input,
    email: null,
    preferredLanguage: "en",
    userId: "existing-user",
  });
  return {
    firstName: normalized.firstName,
    lastName: normalized.lastName,
    displayName: normalized.displayName,
    accountOnboardingCompleted: true,
    accountOnboardingCompletedAt: updatedAt,
    adultEligibilityConfirmed: true,
    legalAssentVersion,
    privacyPolicyAcceptedAt: updatedAt,
    termsOfUseAcceptedAt: updatedAt,
    communityGuidelinesAcceptedAt: updatedAt,
    updatedAt,
  } as const;
}

function normalizeSports(value: string[] | undefined) {
  return [...new Set((value ?? []).map((sport) => sport.trim()).filter(Boolean))];
}
