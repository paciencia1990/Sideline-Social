export type FriendChatSendMediaType = "image" | "voice";
export type FriendChatSendPhase = "finalizing" | "uploading";

export type FriendChatSendStatus = {
  mediaType: FriendChatSendMediaType;
  phase: FriendChatSendPhase;
};

export function friendChatSendStatusTranslationKey(status: FriendChatSendStatus) {
  if (status.mediaType === "image") {
    return status.phase === "uploading" ? "chat.uploadingPhoto" : "chat.finalizingPhoto";
  }
  return status.phase === "uploading" ? "voiceMemo.uploading" : "voiceMemo.finalizing";
}
