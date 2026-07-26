import {
  normalizePublicProfileSearchText,
  type CanonicalPublicUserProfile,
} from './publicUserProfileCore';

export type PublicUserSearchRelationship =
  | 'none'
  | 'outgoing-request'
  | 'incoming-request'
  | 'friends';

export type RankedPublicUserSearchProfile = CanonicalPublicUserProfile & {
  relationship: PublicUserSearchRelationship;
};

export function legacyPublicProfilePrefixVariants(rawQuery: string) {
  const collapsedQuery = rawQuery.trim().replace(/\s+/gu, ' ');
  const normalizedQuery = normalizePublicProfileSearchText(collapsedQuery);
  const titleCaseQuery = normalizedQuery.replace(
    /(^|[\s'-])\p{L}/gu,
    (match) => match.toLocaleUpperCase(),
  );
  return Array.from(new Set([collapsedQuery, normalizedQuery, titleCaseQuery].filter(Boolean)));
}

export function publicUserProfileMatchesPrefix(
  profile: CanonicalPublicUserProfile,
  normalizedQuery: string,
) {
  return [
    profile.displayName,
    profile.firstName,
    profile.lastName,
  ].some((value) => (
    typeof value === 'string' &&
    normalizePublicProfileSearchText(value).startsWith(normalizedQuery)
  ));
}

export function rankPublicUserProfileMatch(
  profile: CanonicalPublicUserProfile,
  normalizedQuery: string,
) {
  const displayName = normalizePublicProfileSearchText(profile.displayName);
  const firstName = profile.firstName
    ? normalizePublicProfileSearchText(profile.firstName)
    : '';
  const lastName = profile.lastName
    ? normalizePublicProfileSearchText(profile.lastName)
    : '';
  if (displayName === normalizedQuery) return 0;
  if (firstName === normalizedQuery || lastName === normalizedQuery) return 1;
  if (displayName.startsWith(normalizedQuery)) return 2;
  if (firstName.startsWith(normalizedQuery)) return 3;
  if (lastName.startsWith(normalizedQuery)) return 4;
  return Number.MAX_SAFE_INTEGER;
}

export function rankAndLimitPublicUserSearchResults<T extends CanonicalPublicUserProfile>(
  profiles: T[],
  normalizedQuery: string,
  limit: number,
) {
  return Array.from(new Map(profiles.map((profile) => [profile.userId, profile])).values())
    .filter((profile) => publicUserProfileMatchesPrefix(profile, normalizedQuery))
    .sort((left, right) => (
      rankPublicUserProfileMatch(left, normalizedQuery) -
        rankPublicUserProfileMatch(right, normalizedQuery) ||
      left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' }) ||
      left.userId.localeCompare(right.userId)
    ))
    .slice(0, limit);
}

export function resolvePublicUserSearchRelationship(input: {
  candidateUserId: string;
  friendUserIds: ReadonlySet<string>;
  outgoingPendingUserIds: ReadonlySet<string>;
  incomingPendingUserIds: ReadonlySet<string>;
}): PublicUserSearchRelationship {
  if (input.friendUserIds.has(input.candidateUserId)) return 'friends';
  if (input.outgoingPendingUserIds.has(input.candidateUserId)) return 'outgoing-request';
  if (input.incomingPendingUserIds.has(input.candidateUserId)) return 'incoming-request';
  return 'none';
}
