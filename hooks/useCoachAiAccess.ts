import { FEATURE_FLAGS } from "@/config/featureFlags";
import { useAccountStanding } from "@/context/AccountStandingContext";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { resolveCoachAiAccess } from "@/utils/coachAiAccess";

export function useCoachAiAccess() {
  const { standing } = useAccountStanding();
  const { activeMode } = useApp();
  const { user } = useAuth();

  return resolveCoachAiAccess({
    buildAvailable: FEATURE_FLAGS.coachAiEnabled,
    developmentTestingEntitled: FEATURE_FLAGS.coachAiTestingPreview,
    // Reserved for a future server-validated StoreKit / Play entitlement.
    paidEntitled: false,
    signedIn: Boolean(user?.uid),
    adultEligible: user?.adultEligibilityConfirmed === true,
    activeMode,
    accountStanding: standing?.status ?? null,
  });
}
