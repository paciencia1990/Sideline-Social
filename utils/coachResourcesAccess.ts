export type CoachResourcesAccessLoadState = "error" | "loaded" | "loading";
export type CoachResourcesAccessStatus = "allowed" | "denied" | "error" | "loading";

export type CoachResourcesAccessRequest = {
  contextKey: string;
  revision: number;
};

export type CoachResourcesAccessMembership = {
  status: "active" | "inactive" | "pending" | "removed";
  userId: string;
  roles: {
    coach: boolean;
    parent: boolean;
    staff: boolean;
  };
  team?: {
    createdBy: string;
    status: "active" | "archived";
  } | null;
};

export function isQualifyingCoachResourcesMembership(
  membership: CoachResourcesAccessMembership,
  authenticatedUserId: string,
) {
  const userId = authenticatedUserId.trim();
  return Boolean(
    userId &&
    membership.userId === userId &&
    membership.status === "active" &&
    membership.roles.coach === true &&
    membership.team?.status === "active" &&
    membership.team.createdBy === userId,
  );
}

export function resolveCoachResourcesAccess(input: {
  activeMode: "coach" | "parent" | null;
  authenticatedUserId: string | null | undefined;
  loadState: CoachResourcesAccessLoadState;
  memberships: CoachResourcesAccessMembership[];
}): CoachResourcesAccessStatus {
  const authenticatedUserId = input.authenticatedUserId?.trim() ?? "";
  if (!authenticatedUserId || input.activeMode !== "coach") return "denied";
  if (input.loadState === "loading") return "loading";
  if (input.loadState === "error") return "error";

  return input.memberships.some((membership) =>
    isQualifyingCoachResourcesMembership(membership, authenticatedUserId))
    ? "allowed"
    : "denied";
}

export function createCoachResourcesAccessRequestGuard() {
  let revision = 0;
  return {
    begin(contextKey: string): CoachResourcesAccessRequest {
      revision += 1;
      return { contextKey, revision };
    },
    invalidate() {
      revision += 1;
    },
    isCurrent(request: CoachResourcesAccessRequest, contextKey: string) {
      return request.revision === revision && request.contextKey === contextKey;
    },
  };
}
