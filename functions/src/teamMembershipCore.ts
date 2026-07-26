export type TeamRoleFlags = {
  parent: boolean;
  coach: boolean;
  staff: boolean;
};

export type ParentLeaveResult = {
  roles: TeamRoleFlags & Record<string, unknown>;
  role: 'coach' | 'teamParent' | 'inactive';
  status: 'active' | 'inactive';
};

export function resolveTeamRoleFlags(value: unknown, legacyRole?: unknown): TeamRoleFlags {
  const roles = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    parent: roles.parent === true || legacyRole === 'parent',
    coach: roles.coach === true || legacyRole === 'coach',
    staff: roles.staff === true || legacyRole === 'assistantCoach' || legacyRole === 'teamParent',
  };
}

export function mergeParentRole(value: unknown, legacyRole?: unknown): TeamRoleFlags {
  return { ...resolveTeamRoleFlags(value, legacyRole), parent: true };
}

export function hasParentRole(data: Record<string, unknown> | undefined): boolean {
  return Boolean(data && resolveTeamRoleFlags(data.roles, data.role).parent);
}

export function hasActiveTeamChildRelationship(
  member: Record<string, unknown> | undefined,
  link: Record<string, unknown> | undefined,
): boolean {
  if (!member || member.status !== 'active' || !hasParentRole(member)) return false;
  const linkedChildIds = Array.isArray(link?.childIds)
    ? link.childIds.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    : [];
  const hasCurrentLink = link?.status === 'active' && linkedChildIds.length > 0;
  const hasLegacyLink = typeof member.childId === 'string' && Boolean(member.childId.trim());
  return hasCurrentLink || hasLegacyLink;
}

export function isTeamActive(data: Record<string, unknown> | undefined): boolean {
  return Boolean(data && (data.status === undefined || data.status === 'active'));
}

export function removeParentRole(value: unknown, legacyRole?: unknown): ParentLeaveResult {
  const existingRoles = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const currentRoles = resolveTeamRoleFlags(value, legacyRole);
  const roles = {
    ...existingRoles,
    parent: false,
    coach: currentRoles.coach,
    staff: currentRoles.staff,
  };
  if (currentRoles.coach) return { roles, role: 'coach', status: 'active' };
  if (currentRoles.staff) return { roles, role: 'teamParent', status: 'active' };
  return { roles, role: 'inactive', status: 'inactive' };
}

export function hasCoachAccess(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const roles = resolveTeamRoleFlags(data.roles, data.role);
  return roles.coach || roles.staff;
}

export function canAccessTeamAnnouncement(
  data: Record<string, unknown> | undefined,
  audience: unknown,
): boolean {
  if (!data || data.status !== 'active') return false;
  if (hasCoachAccess(data)) return true;
  return hasParentRole(data) && (audience === 'parents' || audience === 'all' || audience === 'everyone');
}

export function canDeleteTeamAnnouncementReply(
  uid: string,
  member: Record<string, unknown> | undefined,
  reply: Record<string, unknown> | undefined,
): boolean {
  if (!uid || !member || member.status !== 'active' || !reply) return false;
  return reply.userId === uid || hasCoachAccess(member);
}

export function canManageTeamAnnouncements(data: Record<string, unknown> | undefined): boolean {
  return Boolean(data && data.status === 'active' && hasCoachAccess(data));
}

const ACCOUNT_NAME_PLACEHOLDERS = new Set([
  'team parent', 'sideline parent', 'sideline social member', 'miembro de sideline social',
  'parent', 'coach', 'member', 'former member', 'miembro anterior',
]);

export function isSafeAccountDisplayName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  const placeholder = ACCOUNT_NAME_PLACEHOLDERS.has(normalized.replace(/\s+/gu, ' ').toLocaleLowerCase());
  return normalized.length > 0 && normalized.length <= 80 &&
    !placeholder && !/(?:^|\s)\p{L}\.(?:\s|$)/u.test(normalized) &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized);
}

function isSafeAccountNamePart(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 80 &&
    !/(?:^|\s)\p{L}\.(?:\s|$)/u.test(normalized) &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized);
}

export function resolveReplyAuthorName(
  profile: Record<string, unknown> | undefined,
  member: Record<string, unknown> | undefined,
  authName: unknown,
): string {
  const firstAndLastName = [profile?.firstName, profile?.lastName]
    .filter(isSafeAccountNamePart)
    .join(' ')
    .trim();
  const candidates = [profile?.displayName, firstAndLastName, member?.displayName, authName];
  return candidates.find(isSafeAccountDisplayName)?.trim() || 'Sideline Social member';
}

export function canManageTeamRoles(
  data: Record<string, unknown> | undefined,
  isTeamOwner = false,
): boolean {
  if (!data || data.status !== 'active') return false;
  return resolveTeamRoleFlags(data.roles, data.role).coach || isTeamOwner;
}

export function isEligibleStaffRoleTarget(data: Record<string, unknown> | undefined): boolean {
  if (!data || data.status !== 'active') return false;
  const roles = resolveTeamRoleFlags(data.roles, data.role);
  return roles.parent && !roles.coach;
}

export function setStaffRole(
  value: unknown,
  legacyRole: unknown,
  isStaff: boolean,
): TeamRoleFlags & Record<string, unknown> {
  const existingRoles = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const currentRoles = resolveTeamRoleFlags(value, legacyRole);
  return {
    ...existingRoles,
    parent: currentRoles.parent,
    coach: currentRoles.coach,
    staff: isStaff,
  };
}

export function normalizeChildIds(value: unknown, options: { allowEmpty?: boolean } = {}): string[] {
  if (!Array.isArray(value)) throw new Error('childIds must be an array.');
  const childIds = Array.from(new Set(value.map((item) => typeof item === 'string' ? item.trim() : '')));
  if (childIds.some((childId) => !/^[A-Za-z0-9_-]{1,128}$/.test(childId))) {
    throw new Error('childIds contains an invalid child profile identifier.');
  }
  if ((!options.allowEmpty && childIds.length === 0) || childIds.length > 10) {
    throw new Error(options.allowEmpty
      ? 'Select no more than 10 child profiles.'
      : 'Select between 1 and 10 child profiles.');
  }
  return childIds;
}

export function activeLinkReferencesChild(
  childId: string,
  links: Array<{ status?: unknown; childIds?: unknown }>,
): boolean {
  return links.some((link) =>
    link.status === 'active' && Array.isArray(link.childIds) && link.childIds.includes(childId),
  );
}

export function removeChildReference(childId: string, childIds: unknown): string[] {
  return Array.isArray(childIds)
    ? childIds.filter((value): value is string => typeof value === 'string' && value !== childId)
    : [];
}

export function allChildProfilesExist(childIds: string[], existence: boolean[]): boolean {
  return childIds.length === existence.length && existence.every(Boolean);
}

export function mergeChildIds(existing: unknown, incoming: string[]): string[] {
  const existingIds = Array.isArray(existing)
    ? existing.filter((value): value is string => typeof value === 'string')
    : [];
  return normalizeChildIds([...existingIds, ...incoming]);
}

export function legacyRoleForMergedMembership(
  legacyRole: unknown,
  roles: TeamRoleFlags,
): string {
  if (typeof legacyRole === 'string' && legacyRole) return legacyRole;
  if (roles.coach) return 'coach';
  if (roles.staff) return 'teamParent';
  return 'parent';
}
