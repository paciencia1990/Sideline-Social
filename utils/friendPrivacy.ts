export function looksLikeEmailAddress(value?: string | null) {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim()));
}

export function getSafeProfileName(value?: string | null, fallback = "Sideline Parent") {
  const normalized = value?.trim() ?? "";
  return normalized && !looksLikeEmailAddress(normalized) ? normalized : fallback;
}

const FRIEND_REQUEST_NEUTRAL_NAMES = new Set([
  "sideline parent",
  "a sideline parent",
  "padre o madre de sideline",
]);

const MULTI_PART_LAST_NAME_STARTS = new Set(["van", "von"]);

export function formatPublicUserName(value?: string | null): string | null {
  const safeName = getSafeProfileName(value, "");
  if (!safeName) return null;
  const comparisonName = safeName.replace(/\s+/gu, " ").toLocaleLowerCase();
  if (FRIEND_REQUEST_NEUTRAL_NAMES.has(comparisonName)) return null;

  const segments = safeName.split(/\s+/u).filter(Boolean);
  if (segments.length <= 1) return segments[0] ?? null;

  const firstName = segments[0];
  const multiPartLastNameStart = segments.slice(1, -1).find((segment) => (
    MULTI_PART_LAST_NAME_STARTS.has(segment.toLocaleLowerCase())
  ));
  const lastNameStart = multiPartLastNameStart ?? segments[segments.length - 1];
  const lastInitial = Array.from(lastNameStart)[0];
  return lastInitial ? `${firstName} ${lastInitial}.` : firstName;
}

export function formatFullPublicName(value?: string | null): string | null {
  const safeName = getSafeProfileName(value, "");
  if (!safeName) return null;
  const normalized = safeName.replace(/\s+/gu, " ").trim();
  if (FRIEND_REQUEST_NEUTRAL_NAMES.has(normalized.toLocaleLowerCase())) return null;
  return normalized;
}

export function formatSuggestedConnectionName(
  value?: string | null,
  fallback = "Sideline Parent",
) {
  return formatPublicUserName(value) ?? fallback;
}

export function formatFriendRequestSenderName(
  value?: string | null,
  fallback = "Sideline Parent",
) {
  const normalized = value?.trim() ?? "";
  const comparisonName = normalized.replace(/\s+/gu, " ").toLocaleLowerCase();
  if (!normalized || FRIEND_REQUEST_NEUTRAL_NAMES.has(comparisonName)) {
    return fallback;
  }
  return formatSuggestedConnectionName(normalized, fallback);
}

export function getFriendNameInitials(name: string) {
  const initials = name
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toLocaleUpperCase() ?? "")
    .join("");
  return initials || "SS";
}
