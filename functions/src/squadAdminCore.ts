export const SQUAD_ADMIN_INVITATION_DAYS = 7;
export const SQUAD_ADMIN_INVITATION_MS = SQUAD_ADMIN_INVITATION_DAYS * 24 * 60 * 60 * 1000;

export type SquadAdminInvitationStatus = 'pending' | 'accepted' | 'declined' | 'canceled' | 'expired';
export type SquadMembershipRole = 'admin' | 'member';

export type SquadAuthorizationData = {
  createdBy?: unknown;
  creatorId?: unknown;
};

export type SquadMembershipAuthorizationData = {
  userId?: unknown;
  squadId?: unknown;
  membershipStatus?: unknown;
  squadRole?: unknown;
};

export function recordedSquadCreatorId(squad: SquadAuthorizationData | null | undefined): string | null {
  if (typeof squad?.createdBy === 'string' && squad.createdBy) return squad.createdBy;
  if (typeof squad?.creatorId === 'string' && squad.creatorId) return squad.creatorId;
  return null;
}

export function isDurablyActiveSquadMembership(input: {
  membership: SquadMembershipAuthorizationData | null | undefined;
  squadId: string;
  userId: string;
}): boolean {
  const membership = input.membership;
  return Boolean(
    membership &&
    membership.membershipStatus === 'active' &&
    membership.squadId === input.squadId &&
    membership.userId === input.userId,
  );
}

export function usesLegacyCreatorAdminFallback(input: {
  squad: SquadAuthorizationData | null | undefined;
  membership: SquadMembershipAuthorizationData | null | undefined;
  squadId: string;
  userId: string;
}): boolean {
  if (!isDurablyActiveSquadMembership(input)) return false;
  if (input.membership?.squadRole === 'admin' || input.membership?.squadRole === 'member') return false;
  return recordedSquadCreatorId(input.squad) === input.userId;
}

export function isActiveSquadAdmin(input: {
  squad: SquadAuthorizationData | null | undefined;
  membership: SquadMembershipAuthorizationData | null | undefined;
  squadId: string;
  userId: string;
}): boolean {
  if (!isDurablyActiveSquadMembership(input)) return false;
  return input.membership?.squadRole === 'admin' || usesLegacyCreatorAdminFallback(input);
}

export function activeSquadAdminIds(input: {
  squad: SquadAuthorizationData | null | undefined;
  squadId: string;
  memberships: SquadMembershipAuthorizationData[];
}): string[] {
  return Array.from(new Set(input.memberships.flatMap((membership) => {
    const userId = typeof membership.userId === 'string' ? membership.userId : '';
    return userId && isActiveSquadAdmin({
      squad: input.squad,
      membership,
      squadId: input.squadId,
      userId,
    }) ? [userId] : [];
  })));
}

export function squadAdminInvitationId(squadId: string, targetUserId: string): string {
  return `${squadId}__${targetUserId}`;
}

export function squadAdminAccessRequestId(squadId: string, requesterUserId: string): string {
  return `${squadId}__${requesterUserId}`;
}

export function squadAdminInvitationNotificationId(invitationId: string, attempt: number): string {
  return `squad_admin_invitation_${invitationId}_${Math.max(1, Math.floor(attempt))}`;
}

export function squadAdminInvitationAcceptedNotificationId(invitationId: string, attempt: number): string {
  return `squad_admin_accepted_${invitationId}_${Math.max(1, Math.floor(attempt))}`;
}

export function squadAdminRecoveryNotificationId(requestId: string): string {
  return `squad_admin_recovery_${requestId}`;
}

export function isPendingSquadAdminInvitation(input: {
  status: unknown;
  expiresAtMillis: number;
  nowMillis: number;
}): boolean {
  return input.status === 'pending' && input.expiresAtMillis > input.nowMillis;
}
