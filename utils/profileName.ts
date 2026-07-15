type UserProfileNameFields = {
  displayName?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  FirstName?: unknown;
  LastName?: unknown;
  name?: unknown;
};

function cleanNamePart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function getPersistedDisplayName(profile?: UserProfileNameFields | null): string | null {
  const displayName = cleanNamePart(profile?.displayName) ?? cleanNamePart(profile?.name);
  if (displayName) return displayName;

  const fullName = [
    cleanNamePart(profile?.firstName) ?? cleanNamePart(profile?.FirstName),
    cleanNamePart(profile?.lastName) ?? cleanNamePart(profile?.LastName),
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");

  return fullName || null;
}

export function resolveDisplayName(
  profile: UserProfileNameFields | null | undefined,
  firebaseDisplayName?: string | null,
): string | null {
  return getPersistedDisplayName(profile) ?? cleanNamePart(firebaseDisplayName);
}

export function getFirstName(displayName?: string | null): string | null {
  const trimmed = cleanNamePart(displayName);
  return trimmed ? trimmed.split(/\s+/u)[0] : null;
}
