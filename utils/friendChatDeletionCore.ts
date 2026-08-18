export type FriendChatDeletionMode = "forEveryone" | "forMe";

export type FriendChatDeletionTarget<Message> = {
  message: Message;
  mode: FriendChatDeletionMode;
  operationId: string;
};

type IdentifiedMessage = {
  messageId: string;
  status: "active" | "removed";
};

export function createFriendChatRemovedMessage<Message extends IdentifiedMessage>(message: Message): Message {
  return {
    ...message,
    caption: null,
    image: null,
    reactions: [],
    replyTo: null,
    starredBySelf: false,
    status: "removed",
    text: "",
    voiceMemo: null,
  } as Message;
}

export function reconcileFriendChatDeletionState<Message extends IdentifiedMessage>(
  serverMessages: readonly Message[],
  pendingDeletions: ReadonlyMap<string, FriendChatDeletionTarget<Message>>,
) {
  return serverMessages.flatMap((message) => {
    const pending = pendingDeletions.get(message.messageId);
    if (!pending) return [message];
    if (pending.mode === "forMe") return [];
    return [message.status === "removed" ? message : createFriendChatRemovedMessage(message)];
  });
}

export function deletionOperationKey(mode: FriendChatDeletionMode, messageIds: readonly string[]) {
  return `${mode}:${Array.from(new Set(messageIds)).sort().join(",")}`;
}
