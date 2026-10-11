export type FriendChatImageCacheVariant = "display" | "thumbnail";

export type FriendChatImageCacheIdentityInput = {
  conversationId: string;
  mediaProfileVersion: 1 | 2;
  messageId: string;
  uid: string;
  variant: FriendChatImageCacheVariant;
};

export type FriendChatImageCacheEntry = {
  accountHash: string;
  lastAccessedAt: number;
  mediaKey: string;
  messageHash: string;
  sizeBytes: number;
};

export function friendChatImageCacheIdentity(input: FriendChatImageCacheIdentityInput) {
  return JSON.stringify([
    "friend-chat-image",
    input.uid,
    input.conversationId,
    input.messageId,
    input.mediaProfileVersion,
    input.variant,
  ]);
}

export function selectFriendChatImageCacheEvictions(
  entries: readonly FriendChatImageCacheEntry[],
  limits: { maxBytes: number; maxEntries: number },
) {
  // Entries are appended on insertion. Preserve the newest insertion when
  // several completions share the same millisecond timestamp.
  const newestFirst = entries.map((entry, index) => ({ entry, index }))
    .sort((first, second) => second.entry.lastAccessedAt - first.entry.lastAccessedAt || second.index - first.index)
    .map(({ entry }) => entry);
  let retainedBytes = 0;
  let retainedEntries = 0;
  const evicted = new Set<string>();
  for (const entry of newestFirst) {
    const fits = retainedEntries < limits.maxEntries && retainedBytes + entry.sizeBytes <= limits.maxBytes;
    if (!fits) {
      evicted.add(entry.mediaKey);
      continue;
    }
    retainedEntries += 1;
    retainedBytes += entry.sizeBytes;
  }
  return evicted;
}
