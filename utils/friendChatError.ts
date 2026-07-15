export type FriendChatUiError =
  | "network"
  | "permission"
  | "friendshipEnded"
  | "invited"
  | "removed"
  | "blocked"
  | "missingIndex"
  | "unknown";

export function mapFriendChatError(error: unknown): FriendChatUiError {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (code.includes("permission-denied")) return message.includes("block") || message.includes("messaging is unavailable") ? "blocked" : "permission";
  if (code.includes("failed-precondition") && message.includes("no longer friends")) return "friendshipEnded";
  if (code.includes("failed-precondition") && message.includes("invitation")) return "invited";
  if (code.includes("not-found")) return "removed";
  if (code.includes("failed-precondition") && message.includes("index")) return "missingIndex";
  if (code.includes("unavailable") || code.includes("deadline-exceeded") || code.includes("network")) return "network";
  return "unknown";
}
