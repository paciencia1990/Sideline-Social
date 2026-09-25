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
import {
  buildAccountCompletionFields,
  buildCanonicalAccountProfile,
  buildFederatedAccountProfile,
  initializeAccountProfileIfMissing,
} from "@/utils/accountProfileCore";

export type PasswordAccountProfile = {
  adultEligibilityConfirmed: boolean;
  firstName: string;
  lastName: string;
  policiesAccepted: boolean;
  sports?: string[];
  zipCode?: string;
  phoneNumber?: string | null;
};

export async function ensureFederatedUserProfile(
  user: User,
  providerProfile: FederatedCredentialResult,
) {
  const userRef = doc(db, "users", user.uid);
  return runTransaction(db, async (transaction) => {
    return initializeAccountProfileIfMissing({
      createFields: () => {
        const timestamp = serverTimestamp();
        return buildFederatedAccountProfile({
          email: user.email ?? providerProfile.email ?? null,
          firstName: providerProfile.firstName ?? "",
          lastName: providerProfile.lastName ?? "",
          phoneNumber: user.phoneNumber ?? null,
          preferredLanguage: i18n.resolvedLanguage?.startsWith("es") ? "es" : "en",
          userId: user.uid,
        }, { createdAt: timestamp, updatedAt: timestamp });
      },
      readExists: async () => (await transaction.get(userRef)).exists(),
      write: (fields) => transaction.set(userRef, fields),
    });
  });
}

export async function createPasswordUserProfile(user: User, profile: PasswordAccountProfile) {
  const timestamp = serverTimestamp();
  const fields = buildCanonicalAccountProfile({
    ...profile,
    email: user.email,
    phoneNumber: profile.phoneNumber ?? user.phoneNumber,
    preferredLanguage: i18n.resolvedLanguage?.startsWith("es") ? "es" : "en",
    userId: user.uid,
  }, {
    createdAt: timestamp,
    updatedAt: timestamp,
  }, CURRENT_LEGAL_ASSENT_VERSION);
  await setDoc(doc(db, "users", user.uid), fields);
  return fields;
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

  const userRef = doc(db, "users", user.uid);
  await updateProfile(user, { displayName: `${firstName} ${lastName}` });
  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(userRef);
    const updatedAt = serverTimestamp();
    if (!existing.exists()) {
      transaction.set(userRef, buildCanonicalAccountProfile({
        adultEligibilityConfirmed: input.adultEligibilityConfirmed,
        email: user.email,
        firstName,
        lastName,
        phoneNumber: user.phoneNumber,
        policiesAccepted: input.policiesAccepted,
        preferredLanguage: i18n.resolvedLanguage?.startsWith("es") ? "es" : "en",
        userId: user.uid,
      }, {
        createdAt: updatedAt,
        updatedAt,
      }, CURRENT_LEGAL_ASSENT_VERSION));
      return;
    }
    transaction.set(userRef, buildAccountCompletionFields({
      adultEligibilityConfirmed: input.adultEligibilityConfirmed,
      firstName,
      lastName,
      policiesAccepted: input.policiesAccepted,
    }, updatedAt, CURRENT_LEGAL_ASSENT_VERSION), { merge: true });
  });
}

export async function userProfileExists(uid: string) {
  return (await getDoc(doc(db, "users", uid))).exists();
}
