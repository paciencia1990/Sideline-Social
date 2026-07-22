export function looksLikeEmailAddress(value?: string | null) {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim()));
}

export function getSafeProfileName(value?: string | null, fallback = "Sideline Social member") {
  const normalized = value?.trim() ?? "";
  return normalized && !looksLikeEmailAddress(normalized) ? normalized : fallback;
}

const FRIEND_REQUEST_NEUTRAL_NAMES = new Set([
  "sideline parent",
  "a sideline parent",
  "padre o madre de sideline",
  "sideline social member",
  "miembro de sideline social",
  "former member",
  "miembro anterior",
  "team parent",
  "suggested parent",
  "parent",
  "member",
  "user",
  "unknown",
]);

export function formatPublicUserName(value?: string | null): string | null {
  const safeName = getSafeProfileName(value, "");
  if (!safeName) return null;
  const comparisonName = safeName.replace(/\s+/gu, " ").toLocaleLowerCase();
  if (FRIEND_REQUEST_NEUTRAL_NAMES.has(comparisonName)) return null;
  if (/(?:^|\s)\p{L}\.(?:\s|$)/u.test(safeName)) return null;

  return safeName.replace(/\s+/gu, " ").trim();
}

export function formatFullPublicName(value?: string | null): string | null {
  const safeName = getSafeProfileName(value, "");
  if (!safeName) return null;
  const normalized = safeName.replace(/\s+/gu, " ").trim();
  if (FRIEND_REQUEST_NEUTRAL_NAMES.has(normalized.toLocaleLowerCase())) return null;
  if (/(?:^|\s)\p{L}\.(?:\s|$)/u.test(normalized)) return null;
  return normalized;
}

export function formatSuggestedConnectionName(
  value?: string | null,
  fallback = "Sideline Social member",
) {
  return formatPublicUserName(value) ?? fallback;
}

export function formatFriendRequestSenderName(
  value?: string | null,
  fallback = "Sideline Social member",
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
