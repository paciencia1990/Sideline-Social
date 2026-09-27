import type { FriendChatMessage } from "@/services/chatService";

type CopyCandidate = Pick<FriendChatMessage, "messageType" | "status" | "isModerated" | "text" | "senderUserId" | "image" | "voiceMemo" | "messageId">;

export function friendChatSingleMessageEligibility(
  selectedIds: string[],
  selectedMessages: CopyCandidate[],
  currentUserId: string | undefined,
  unavailableImageIds: string[] = [],
) {
  const message = selectedIds.length === 1 && selectedMessages.length === 1 ? selectedMessages[0] : null;
  const active = Boolean(message && message.status === "active" && !message.isModerated && (
    (message.messageType === "text" && message.text.length > 0) ||
    (message.messageType === "image" && message.image && !unavailableImageIds.includes(message.messageId)) ||
    (message.messageType === "voice" && message.voiceMemo)
  ));
  return {
    reply: active,
    copy: active && isFriendChatCopyEligible(message),
    report: Boolean(active && currentUserId && message?.senderUserId && message.senderUserId !== currentUserId),
  };
}

export function isFriendChatCopyEligible(message: CopyCandidate | null | undefined): message is CopyCandidate {
  return Boolean(message && message.status === "active" && !message.isModerated && message.messageType === "text" && message.text.length > 0);
}

export async function copySelectedFriendChatText(
  selectedIds: string[],
  selectedMessages: CopyCandidate[],
  writeText: (text: string) => Promise<boolean>,
): Promise<"copied" | "failed" | "ineligible"> {
  if (selectedIds.length !== 1 || selectedMessages.length !== 1 || !isFriendChatCopyEligible(selectedMessages[0])) return "ineligible";
  try {
    return await writeText(selectedMessages[0].text) ? "copied" : "failed";
  } catch {
    // Clipboard errors may contain private text. The caller shows a fixed localized message.
    return "failed";
  }
}
