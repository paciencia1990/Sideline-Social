import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { getIdTokenResult, onIdTokenChanged, type User } from "firebase/auth";

import { auth } from "@/config/firebase";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { useAccountStanding } from "@/context/AccountStandingContext";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { resolveCoachAiAccess } from "@/utils/coachAiAccess";

export function useCoachAiAccess() {
  const { standing } = useAccountStanding();
  const { activeMode } = useApp();
  const { firebaseUser, user } = useAuth();
  const [claimState, setClaimState] = useState({ loaded: false, entitled: false, uid: null as string | null });

  const loadClaim = useCallback(async (candidate: User | null, forceRefresh: boolean) => {
    if (!candidate) {
      setClaimState({ loaded: true, entitled: false, uid: null });
      return;
    }
    const uid = candidate.uid;
    try {
      const result = await getIdTokenResult(candidate, forceRefresh);
      if (auth.currentUser?.uid !== uid) return;
      setClaimState({ loaded: true, entitled: result.claims.aiCoachTester === true, uid });
    } catch {
      if (auth.currentUser?.uid !== uid) return;
      setClaimState({ loaded: true, entitled: false, uid });
    }
  }, []);

  useEffect(() => {
    setClaimState({ loaded: false, entitled: false, uid: firebaseUser?.uid ?? null });
    void loadClaim(firebaseUser, true);
    const unsubscribeToken = onIdTokenChanged(auth, (nextUser) => void loadClaim(nextUser, false));
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void loadClaim(auth.currentUser, true);
    });
    return () => {
      unsubscribeToken();
      appStateSubscription.remove();
    };
  }, [firebaseUser, loadClaim]);

  return resolveCoachAiAccess({
    buildAvailable: FEATURE_FLAGS.coachAiEnabled,
    claimLoaded: claimState.loaded && claimState.uid === (firebaseUser?.uid ?? null),
    testerClaimEntitled: claimState.entitled,
    // Reserved for a future server-validated StoreKit / Play entitlement.
    paidEntitled: false,
    signedIn: Boolean(user?.uid),
    adultEligible: user?.adultEligibilityConfirmed === true,
    activeMode,
    accountStanding: standing?.status ?? null,
  });
}
