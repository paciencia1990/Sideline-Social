export type FriendChatUiError =
  | "network"
  | "permission"
  | "friendshipEnded"
  | "invited"
  | "removed"
  | "blocked"
  | "rateLimited"
  | "missingIndex"
  | "unknown";

export function mapFriendChatError(error: unknown): FriendChatUiError {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (code.includes("permission-denied")) return message.includes("block") || message.includes("messaging is unavailable") ? "blocked" : "permission";
  if (code.includes("resource-exhausted")) return "rateLimited";
  if (code.includes("failed-precondition") && message.includes("no longer friends")) return "friendshipEnded";
  if (code.includes("failed-precondition") && message.includes("invitation")) return "invited";
  // A callable endpoint, reservation, or message can be missing even while the
  // user is still a member. Only the screen's verified membership state should
  // display the membership-ended banner; a generic 404 is not that evidence.
  if (code.includes("not-found")) return "unknown";
  if (code.includes("failed-precondition") && message.includes("index")) return "missingIndex";
  if (code.includes("unavailable") || code.includes("deadline-exceeded") || code.includes("network")) return "network";
  return "unknown";
}
