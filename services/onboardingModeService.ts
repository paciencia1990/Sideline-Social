import { doc, serverTimestamp, setDoc } from "firebase/firestore";

import { auth, db } from "@/config/firebase";
import type { AppMode } from "@/utils/onboardingMode";

export async function completeModeOnboarding(mode: AppMode) {
  const user = auth.currentUser;
  if (!user) {
    const error = new Error("Authentication is required.");
    (error as { code?: string }).code = "unauthenticated";
    throw error;
  }

  await setDoc(
    doc(db, "users", user.uid),
    {
      onboardingPath: mode,
      defaultMode: mode,
      activeMode: mode,
      modeOnboardingCompleted: true,
      modeOnboardingCompletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}