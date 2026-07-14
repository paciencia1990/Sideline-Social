const PUBLIC_NAME_PLACEHOLDERS = new Set([
  'sideline parent',
  'a sideline parent',
  'padre o madre de sideline',
]);

export function isSafePublicName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 80 &&
    !PUBLIC_NAME_PLACEHOLDERS.has(normalized.replace(/\s+/gu, ' ').toLocaleLowerCase()) &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized);
}

export function resolvePublicProfileName(profile?: Record<string, unknown>): string | null {
  if (isSafePublicName(profile?.displayName)) return profile.displayName.trim();

  const firstName = isSafePublicName(profile?.firstName) ? profile.firstName.trim() : '';
  const lastName = isSafePublicName(profile?.lastName) ? profile.lastName.trim() : '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  return fullName || null;
}

const MULTI_PART_LAST_NAME_STARTS = new Set(['van', 'von']);

export function formatPublicUserName(value: string | null): string | null {
  if (!isSafePublicName(value)) return null;
  const segments = value.trim().split(/\s+/u).filter(Boolean);
  if (segments.length <= 1) return segments[0] ?? null;

  const firstName = segments[0];
  const multiPartLastNameStart = segments.slice(1, -1).find((segment) => (
    MULTI_PART_LAST_NAME_STARTS.has(segment.toLocaleLowerCase())
  ));
  const lastNameStart = multiPartLastNameStart ?? segments[segments.length - 1];
  const lastInitial = Array.from(lastNameStart)[0];
  return lastInitial ? `${firstName} ${lastInitial}.` : firstName;
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
