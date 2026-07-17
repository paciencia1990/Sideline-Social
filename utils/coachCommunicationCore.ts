export type PrivateInboxLoadState = "loading" | "loaded" | "error";

export function shouldShowPrivateMessagesCard(input: {
  conversationCount: number;
  loadState: PrivateInboxLoadState;
  unreadCount: number;
}) {
  return input.loadState === "loaded" && (input.conversationCount > 0 || input.unreadCount > 0);
}
