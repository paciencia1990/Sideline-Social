export type PrivateInboxLoadState = "loading" | "loaded" | "error";

export function shouldShowPrivateMessagesCard(input: {
  hasActiveTeam: boolean;
  conversationCount: number;
  loadState: PrivateInboxLoadState;
  unreadCount: number;
}) {
  return input.hasActiveTeam;
}

export type RosterActionContext = {
  authenticatedUserId: string;
  callerCanManageTeam: boolean;
  callerHasCoachAccess: boolean;
  coachOwnerUserId: string;
  memberRoles: {
    coach: boolean;
    parent: boolean;
    staff: boolean;
  };
  membershipId: string;
  membershipStatus: "active" | "pending" | "inactive" | "removed";
  memberUserId: string;
  teamActive: boolean;
};

export type RosterActionAvailability = {
  showMakeStaff: boolean;
  showMenu: boolean;
  showRemoveStaffAccess: boolean;
  showSendPrivateMessage: boolean;
};

export type CoachTeamAuthorityContext = {
  authenticatedUserId: string;
  callerMembershipId: string;
  callerMembershipStatus: "active" | "pending" | "inactive" | "removed";
  callerMemberUserId: string;
  callerRoles: {
    coach: boolean;
    parent: boolean;
    staff: boolean;
  };
  coachOwnerUserId: string;
  teamActive: boolean;
};

export type CoachTeamAuthority = {
  canManageStaff: boolean;
  canManageTeamLifecycle: boolean;
  hasCoachAccess: boolean;
  isCoachOwner: boolean;
  showCoachHeader: boolean;
};

export function resolveCoachTeamAuthority(
  input: CoachTeamAuthorityContext,
): CoachTeamAuthority {
  const authenticatedUserId = input.authenticatedUserId.trim();
  const callerMembershipId = input.callerMembershipId.trim();
  const callerMemberUserId = input.callerMemberUserId.trim();
  const coachOwnerUserId = input.coachOwnerUserId.trim();
  const membershipMatchesCaller = Boolean(authenticatedUserId) &&
    callerMembershipId === authenticatedUserId &&
    callerMemberUserId === authenticatedUserId;
  const hasActiveMembership = membershipMatchesCaller && input.callerMembershipStatus === "active";
  const isCoachOwner = Boolean(authenticatedUserId) && authenticatedUserId === coachOwnerUserId;
  const hasCoachRoleAccess = input.callerRoles.coach || input.callerRoles.staff;
  const hasCoachAccess = hasActiveMembership && (hasCoachRoleAccess || isCoachOwner);
  const canManageTeamLifecycle = hasActiveMembership && (input.callerRoles.coach || isCoachOwner);
  const canManageStaff = input.teamActive && canManageTeamLifecycle;

  return {
    canManageStaff,
    canManageTeamLifecycle,
    hasCoachAccess,
    isCoachOwner,
    showCoachHeader: canManageTeamLifecycle,
  };
}

export function resolveRosterActionTarget(input: {
  membershipId: string;
  memberUserId: string;
}) {
  const membershipId = input.membershipId.trim();
  const memberUserId = input.memberUserId.trim();
  if (!membershipId || membershipId !== memberUserId) return null;
  return { membershipId, targetUserId: memberUserId };
}

export function getCoachRosterActionAvailability(
  input: RosterActionContext,
): RosterActionAvailability {
  const authenticatedUserId = input.authenticatedUserId.trim();
  const coachOwnerUserId = input.coachOwnerUserId.trim();
  const membershipId = input.membershipId.trim();
  const memberUserId = input.memberUserId.trim();
  const hasStableIdentity = Boolean(authenticatedUserId && membershipId && memberUserId) &&
    membershipId === memberUserId;
  const isAcceptedParent = input.membershipStatus === "active" &&
    input.memberRoles.parent &&
    !input.memberRoles.coach;
  const isAuthenticatedUser = memberUserId === authenticatedUserId;
  const isCoachOwner = Boolean(coachOwnerUserId) && memberUserId === coachOwnerUserId;
  const canInteractWithMember = hasStableIdentity &&
    input.teamActive &&
    input.callerHasCoachAccess &&
    isAcceptedParent &&
    !isAuthenticatedUser;
  const canChangeStaffRole = canInteractWithMember &&
    input.callerCanManageTeam &&
    !isCoachOwner;
  const showMakeStaff = canChangeStaffRole && !input.memberRoles.staff;
  const showRemoveStaffAccess = canChangeStaffRole && input.memberRoles.staff;
  const showSendPrivateMessage = canInteractWithMember;

  return {
    showMakeStaff,
    showMenu: showMakeStaff || showRemoveStaffAccess || showSendPrivateMessage,
    showRemoveStaffAccess,
    showSendPrivateMessage,
  };
}
