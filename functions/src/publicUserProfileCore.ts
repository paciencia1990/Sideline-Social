export type CanonicalPublicUserProfile = {
  userId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  photoURL: string | null;
};

const PLACEHOLDER_NAMES = new Set([
  'sideline parent',
  'a sideline parent',
  'padre o madre de sideline',
  'public name unavailable',
  'nombre público no disponible',
]);

function normalizeNamePart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (!normalized || normalized.length > 80) return null;
  if (PLACEHOLDER_NAMES.has(normalized.toLocaleLowerCase())) return null;
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
  const lastName = segments.slice(1).join(' ');
  if ((lastName.match(/\p{L}/gu) ?? []).length < 2) return null;
  return { firstName: segments[0], lastName };
}

export function resolveCanonicalPublicName(profile?: Record<string, unknown>) {
  const firstName = readFirstValid(profile, ['firstName', 'FirstName']);
  const lastName = readFirstValid(profile, ['lastName', 'LastName']);
  if (firstName && lastName && (lastName.match(/\p{L}/gu) ?? []).length >= 2) {
    return { firstName, lastName, displayName: `${firstName} ${lastName}` };
  }

  const fullName = splitFullName(profile?.displayName) ?? splitFullName(profile?.name);
  if (!fullName) return null;
  return { ...fullName, displayName: `${fullName.firstName} ${fullName.lastName}` };
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

export function isCanonicalPublicProfile(value: unknown, userId?: string) {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (userId && record.userId !== userId) return false;
  const resolved = resolveCanonicalPublicProfile(
    typeof record.userId === 'string' ? record.userId : '',
    record,
  );
  return Boolean(
    resolved &&
    record.firstName === resolved.firstName &&
    record.lastName === resolved.lastName &&
    record.displayName === resolved.displayName &&
    (record.photoURL === resolved.photoURL || (record.photoURL == null && resolved.photoURL === null)),
  );
}
