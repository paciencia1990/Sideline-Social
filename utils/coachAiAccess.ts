export type CoachAiEntitlementSource = "tester-claim" | "paid" | null;

export type CoachAiAccess = Readonly<{
  buildAvailable: boolean;
  entitlementSource: CoachAiEntitlementSource;
  canView: boolean;
  canCreate: boolean;
  canRequest: boolean;
}>;

export function resolveCoachAiAccess({
  buildAvailable,
  claimLoaded,
  testerClaimEntitled,
  paidEntitled,
  paidRemaining = 30,
  billingAvailable = false,
  signedIn,
  adultEligible,
  activeMode,
  accountStanding,
}: {
  buildAvailable: boolean;
  claimLoaded: boolean;
  testerClaimEntitled: boolean;
  paidEntitled: boolean;
  paidRemaining?: number;
  billingAvailable?: boolean;
  signedIn: boolean;
  adultEligible: boolean;
  activeMode: "parent" | "coach" | null;
  accountStanding: "active" | "messagingRestricted" | "suspended" | "banned" | null;
}): CoachAiAccess {
  const entitlementSource: CoachAiEntitlementSource = buildAvailable && claimLoaded && testerClaimEntitled
    ? "tester-claim" : paidEntitled ? "paid" : null;
  const authorizedContext = signedIn && adultEligible && activeMode === "coach" && accountStanding === "active";
  const available = buildAvailable || billingAvailable;
  const canUse = available && entitlementSource !== null && authorizedContext;

  return Object.freeze({
    buildAvailable: available,
    entitlementSource,
    canView: canUse || billingAvailable && authorizedContext,
    canCreate: canUse,
    canRequest: canUse && (entitlementSource !== 'paid' || paidRemaining > 0),
  });
}
