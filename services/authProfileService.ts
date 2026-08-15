import { updateProfile, type User } from "firebase/auth";
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { auth, db } from "@/config/firebase";
import { CURRENT_LEGAL_ASSENT_VERSION } from "@/constants/legalAssent";
import i18n from "@/i18n";
import type { FederatedCredentialResult } from "@/services/federatedAuthService";

export async function ensureFederatedUserProfile(
  user: User,
  providerProfile: FederatedCredentialResult,
) {
  const userRef = doc(db, "users", user.uid);
  return runTransaction(db, async (transaction) => {
    const existing = await transaction.get(userRef);
    if (existing.exists()) return { created: false } as const;

    const firstName = providerProfile.firstName?.trim() || "";
    const lastName = providerProfile.lastName?.trim() || "";
    const suggestedDisplayName = [firstName, lastName].filter(Boolean).join(" ");
    transaction.set(userRef, {
      userId: user.uid,
      firstName,
      lastName,
      displayName: suggestedDisplayName || null,
      email: user.email ?? providerProfile.email ?? null,
      zipCode: "",
      sports: [],
      phoneNumber: user.phoneNumber ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      tier: "member",
      totalStars: 0,
      sidelineStars: 0,
      squadIds: [],
      friendIds: [],
      preferredLanguage: i18n.resolvedLanguage?.startsWith("es") ? "es" : "en",
      profileVisibility: "squad_only",
      accountOnboardingCompleted: false,
      modeOnboardingCompleted: false,
    });
    return { created: true } as const;
  });
}

export async function completeAccountOnboarding(input: {
  adultEligibilityConfirmed: boolean;
  firstName: string;
  lastName: string;
  policiesAccepted: boolean;
}) {
  const user = auth.currentUser;
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!user || !firstName || !lastName || !input.policiesAccepted || !input.adultEligibilityConfirmed) {
    const error = new Error("Account onboarding is incomplete.");
    (error as { code?: string }).code = "auth/account-onboarding-incomplete";
    throw error;
  }

  await updateProfile(user, { displayName: `${firstName} ${lastName}` });
  await setDoc(doc(db, "users", user.uid), {
    firstName,
    lastName,
    displayName: `${firstName} ${lastName}`,
    accountOnboardingCompleted: true,
    accountOnboardingCompletedAt: serverTimestamp(),
    adultEligibilityConfirmed: true,
    legalAssentVersion: CURRENT_LEGAL_ASSENT_VERSION,
    privacyPolicyAcceptedAt: serverTimestamp(),
    termsOfUseAcceptedAt: serverTimestamp(),
    communityGuidelinesAcceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function userProfileExists(uid: string) {
  return (await getDoc(doc(db, "users", uid))).exists();
}
