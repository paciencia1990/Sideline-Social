const PUBLIC_NAME_PLACEHOLDERS = new Set([
  'sideline parent',
  'a sideline parent',
  'padre o madre de sideline',
  'sideline social member',
  'miembro de sideline social',
  'former member',
  'miembro anterior',
  'team parent',
  'suggested parent',
  'parent',
  'member',
  'user',
  'unknown',
]);

export function isSafePublicName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 80 &&
    !PUBLIC_NAME_PLACEHOLDERS.has(normalized.replace(/\s+/gu, ' ').toLocaleLowerCase()) &&
    !/(?:^|\s)\p{L}\.(?:\s|$)/u.test(normalized) &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized);
}

export function resolvePublicProfileName(profile?: Record<string, unknown>): string | null {
  if (isSafePublicName(profile?.displayName)) return profile.displayName.trim();

  const firstName = isSafePublicName(profile?.firstName) ? profile.firstName.trim() : '';
  const lastName = isSafePublicName(profile?.lastName) ? profile.lastName.trim() : '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  return fullName || null;
}

export function formatPublicUserName(value: string | null): string | null {
  if (!isSafePublicName(value)) return null;
  return value.trim().replace(/\s+/gu, ' ');
}

export const formatSuggestedConnectionName = formatPublicUserName;

export function countMutualConnections(viewerFriendIds: unknown, candidateFriendIds: unknown) {
  const viewerFriends = new Set(readStringArray(viewerFriendIds));
  return readStringArray(candidateFriendIds).filter((userId) => viewerFriends.has(userId)).length;
}

export function findSharedActivity(viewerSports: unknown, candidateSports: unknown): string | null {
  const candidateByNormalizedName = new Map(
    readStringArray(candidateSports).map((sport) => [sport.toLocaleLowerCase(), sport]),
  );
  for (const sport of readStringArray(viewerSports)) {
    const shared = candidateByNormalizedName.get(sport.toLocaleLowerCase());
    if (shared) return sport;
  }
  return null;
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)))
    : [];
}
