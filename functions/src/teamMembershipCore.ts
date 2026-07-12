export type TeamRoleFlags = {
  parent: boolean;
  coach: boolean;
  staff: boolean;
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

export function hasCoachAccess(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const roles = resolveTeamRoleFlags(data.roles, data.role);
  return roles.coach || roles.staff;
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
