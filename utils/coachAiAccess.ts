export type CoachAiEntitlementSource = "development-testing" | "paid" | null;

export type CoachAiAccess = Readonly<{
  buildAvailable: boolean;
  entitlementSource: CoachAiEntitlementSource;
  canView: boolean;
  canRequest: boolean;
}>;

export function resolveCoachAiAccess({
  buildAvailable,
  developmentTestingEntitled,
  paidEntitled,
  signedIn,
  adultEligible,
  activeMode,
  accountStanding,
}: {
  buildAvailable: boolean;
  developmentTestingEntitled: boolean;
  paidEntitled: boolean;
  signedIn: boolean;
  adultEligible: boolean;
  activeMode: "parent" | "coach" | null;
  accountStanding: "active" | "messagingRestricted" | "suspended" | "banned" | null;
}): CoachAiAccess {
  const entitlementSource: CoachAiEntitlementSource = paidEntitled
    ? "paid"
    : developmentTestingEntitled
      ? "development-testing"
      : null;
  const authorizedContext = signedIn && adultEligible && activeMode === "coach" && accountStanding === "active";
  const canUse = buildAvailable && entitlementSource !== null && authorizedContext;

  return Object.freeze({
    buildAvailable,
    entitlementSource,
    canView: canUse,
    canRequest: canUse,
  });
}
