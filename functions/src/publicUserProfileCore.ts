export type CanonicalPublicUserProfile = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  photoURL: string | null;
};

export type MinimalPublicUserProfile = CanonicalPublicUserProfile;

export type SearchablePublicUserProfileProjection = CanonicalPublicUserProfile & {
  displayNameLower: string;
  firstNameLower: string | null;
  lastNameLower: string | null;
};

const PLACEHOLDER_NAMES = new Set([
  'sideline parent',
  'a sideline parent',
  'padre o madre de sideline',
  'sideline social member',
  'miembro de sideline social',
  'former member',
  'miembro anterior',
  'public name unavailable',
  'nombre público no disponible',
  'team parent',
  'suggested parent',
  'parent',
  'member',
  'user',
  'unknown',
]);

function normalizeNamePart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (!normalized || normalized.length > 80) return null;
  if (PLACEHOLDER_NAMES.has(normalized.toLocaleLowerCase())) return null;
  if (/(?:^|\s)\p{L}\.(?:\s|$)/u.test(normalized)) return null;
  if (/@/u.test(normalized) || /\d/u.test(normalized) || !/\p{L}/u.test(normalized)) return null;
  return normalized;
}

function readFirstValid(profile: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = normalizeNamePart(profile?.[key]);
    if (value) return value;
  }
  return null;
}

function splitFullName(value: unknown): { firstName: string; lastName: string } | null {
  const normalized = normalizeNamePart(value);
  if (!normalized) return null;
  const segments = normalized.split(/\s+/u).filter(Boolean);
  if (segments.length < 2) return null;
  return { firstName: segments[0], lastName: segments.slice(1).join(' ') };
}

export function resolveCanonicalPublicName(profile?: Record<string, unknown>) {
  const firstName = readFirstValid(profile, ['firstName', 'FirstName']);
  const lastName = readFirstValid(profile, ['lastName', 'LastName']);
  const preferredDisplayName = readFirstValid(profile, ['displayName', 'name']);
  const displayParts = splitFullName(preferredDisplayName);
  const displayName = preferredDisplayName ?? [firstName, lastName].filter(Boolean).join(' ');
  if (!displayName) return null;
  return {
    firstName: firstName ?? displayParts?.firstName ?? null,
    lastName: lastName ?? displayParts?.lastName ?? null,
    displayName,
  };
}

export function resolveCanonicalPublicProfile(
  userId: string,
  profile?: Record<string, unknown>,
  authDisplayName?: string | null,
): CanonicalPublicUserProfile | null {
  const name = resolveCanonicalPublicName(profile)
    ?? resolveCanonicalPublicName({ displayName: authDisplayName });
  if (!name) return null;
  const photoURL = typeof profile?.photoURL === 'string' && profile.photoURL.trim()
    ? profile.photoURL.trim()
    : typeof profile?.photoUrl === 'string' && profile.photoUrl.trim()
      ? profile.photoUrl.trim()
      : null;
  return { userId, ...name, photoURL };
}

export function toMinimalPublicUserProfile(
  profile: CanonicalPublicUserProfile,
): MinimalPublicUserProfile {
  return { ...profile };
}

export function normalizePublicProfileSearchText(value: string) {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

export function toSearchablePublicUserProfileProjection(
  profile: CanonicalPublicUserProfile,
): SearchablePublicUserProfileProjection {
  return {
    ...profile,
    displayNameLower: normalizePublicProfileSearchText(profile.displayName),
    firstNameLower: profile.firstName ? normalizePublicProfileSearchText(profile.firstName) : null,
    lastNameLower: profile.lastName ? normalizePublicProfileSearchText(profile.lastName) : null,
  };
}

export function isCanonicalPublicProfile(value: unknown, userId?: string) {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (userId && record.userId !== userId) return false;
  const firstName = normalizeNamePart(record.firstName);
  const lastName = normalizeNamePart(record.lastName);
  const displayName = normalizeNamePart(record.displayName);
  const photoURL = typeof record.photoURL === 'string' && record.photoURL.trim() ? record.photoURL.trim() : null;
  const legacyInitialProjection = Boolean(
    firstName && lastName && /^\p{L}\.$/u.test(lastName) && displayName === `${firstName} ${lastName}`,
  );
  const canonicalName = resolveCanonicalPublicName(record);
  return Boolean(
    typeof record.userId === 'string' && record.userId &&
    displayName && !legacyInitialProjection &&
    (record.firstName === firstName || (record.firstName == null && firstName === null)) &&
    (record.lastName === lastName || (record.lastName == null && lastName === null)) &&
    record.displayName === displayName && canonicalName?.displayName === displayName &&
    (record.photoURL === photoURL || (record.photoURL == null && photoURL === null)),
  );
}

export function isSearchablePublicProfileProjection(value: unknown, userId?: string) {
  if (!isCanonicalPublicProfile(value, userId) || !value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const canonical = resolveCanonicalPublicProfile(String(record.userId), record);
  if (!canonical) return false;
  const expected = toSearchablePublicUserProfileProjection(canonical);
  return record.displayNameLower === expected.displayNameLower &&
    record.firstNameLower === expected.firstNameLower &&
    record.lastNameLower === expected.lastNameLower;
}
