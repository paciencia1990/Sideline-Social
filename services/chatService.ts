import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  Timestamp,
  where,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytesResumable, type UploadTask } from "firebase/storage";

import { auth, db, functions, storage } from "@/config/firebase";
import type { LocalFriendChatImageDraft } from "@/services/friendChatImageService";
import { getPublicUserProfiles, type PublicUserProfile } from "@/services/publicProfileService";
import { formatPublicUserName } from "@/utils/friendPrivacy";
import {
  cancelFriendChatImageUploadTasks,
  type FriendChatImageUploadCancelResult,
} from "@/utils/friendChatUploadCancellation";
import { normalizeVoicePlaybackUrlResponse } from "@/utils/voicePlaybackCore";
import type { LocalVoiceMemoDraft, StoredVoiceMemo } from "@/types/teamVoiceMessaging";
export { mapFriendChatError, type FriendChatUiError } from "@/utils/friendChatError";

export const MAX_CHAT_PARTICIPANTS = 10;
export const CHAT_MESSAGE_LIMIT = 500;
export const CHAT_INITIAL_MESSAGE_LIMIT = 50;
export const CHAT_EARLIER_PAGE_SIZE = 25;
export const CHAT_LIST_LIMIT = 25;
export const CHAT_LIST_MAX = 100;
export const FRIEND_CHAT_VOICE_LIMIT_MS = 120_000;
export const FRIEND_CHAT_VOICE_SIZE_LIMIT_BYTES = 3 * 1024 * 1024;
export const FRIEND_CHAT_QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;
export const FRIEND_CHAT_REACTIONS = [
  ...FRIEND_CHAT_QUICK_REACTIONS,
  "🔥", "🎉", "👏", "💪", "🙌", "😄",
  "😍", "😎", "🤔", "😬", "😤", "🤯",
  "🥳", "💯", "✅", "⭐", "🏆", "⚾",
  "🏀", "⚽", "🏈",
] as const;
export const FRIEND_CHAT_FORWARD_MAX_DESTINATIONS = 3;

export type FriendConversationType = "direct" | "group";
export type FriendConversationMemberStatus = "invited" | "active" | "declined" | "left" | "removed";
export type FriendConversationMemberRole = "owner" | "admin" | "member";

export type FriendConversationMember = {
  userId: string;
  status: FriendConversationMemberStatus;
  role: FriendConversationMemberRole;
  displayNameSnapshot: string;
  profileState?: PublicUserProfile["profileState"];
  invitedBy: string | null;
  invitationId: string | null;
  invitedAt: Date | null;
  joinedAt: Date | null;
  lastReadAt: Date | null;
  muted: boolean;
};

export type FriendConversation = {
  conversationId: string;
  conversationType: FriendConversationType;
  groupName: string | null;
  ownerUserId: string | null;
  adminUserIds: string[];
  activeParticipantIds: string[];
  invitedParticipantIds: string[];
  participantNameSnapshots: Record<string, string>;
  participantProfileStates: Record<string, PublicUserProfile["profileState"]>;
  activeParticipantCount: number;
  invitedParticipantCount: number;
  createdBy: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  lastMessageAt: Date | null;
  lastMessageId: string | null;
  lastMessageType: FriendChatMessageType | "deleted" | null;
  lastMessagePreview: string | null;
  lastMessageRemoved: boolean;
  lastSenderId: string | null;
  pinnedMessage: FriendChatPinnedMessage | null;
  status: "active" | "archived";
};

export type FriendChatMessageType = "image" | "system" | "text" | "voice";
export type FriendChatReactionEmoji = typeof FRIEND_CHAT_REACTIONS[number];

export type FriendChatReactionSummary = {
  count: number;
  emoji: FriendChatReactionEmoji;
  reactedBySelf: boolean;
};

export type FriendChatReplyContext = {
  createdAt: Date | null;
  messageId: string;
  messageType: FriendChatMessageType;
  senderDisplayName: string | null;
  senderUserId: string | null;
  textExcerpt: string | null;
};

export type StoredFriendChatImage = {
  fullPath: string;
  height: number;
  mimeType: "image/jpeg" | "image/webp";
  sizeBytes: number;
  sourceMimeType: string | null;
  sourceSizeBytes: number;
  thumbnailHeight: number;
  thumbnailMimeType: "image/jpeg" | "image/webp";
  thumbnailPath: string;
  thumbnailSizeBytes: number;
  thumbnailWidth: number;
  width: number;
};

export type FriendConversationListItem = FriendConversation & {
  ownMember: FriendConversationMember;
  unread: boolean;
};

export type FriendChatMessage = {
  messageId: string;
  conversationId: string;
  messageType: FriendChatMessageType;
  senderUserId: string | null;
  senderDisplayName: string | null;
  senderProfileState?: PublicUserProfile["profileState"];
  text: string;
  caption: string | null;
  createdAt: Date | null;
  createdAtTimestamp: Timestamp | null;
  status: "active" | "removed";
  isModerated: boolean;
  image: StoredFriendChatImage | null;
  clientMessageId: string | null;
  forwarded: boolean;
  reactions: FriendChatReactionSummary[];
  replyTo: FriendChatReplyContext | null;
  starredBySelf: boolean;
  voiceMemo: StoredVoiceMemo | null;
};

export type FriendChatPinnedMessage = FriendChatReplyContext & {
  expiresAt: Date | null;
  pinnedByUserId: string | null;
};

export type FriendChatVoiceUploadReservation = {
  expiresAtMillis: number;
  reservationId: string;
  storagePath: string;
  targetId: string;
};

export type FriendChatImageUploadReservation = {
  expiresAtMillis: number;
  fullPath: string;
  reservationId: string;
  targetId: string;
  thumbnailPath: string;
};

export type ConversationAccess = {
  conversation: FriendConversation;
  member: FriendConversationMember;
  blockedUserIds: string[];
  directFriendshipActive: boolean;
};

type FirestoreDate = Date | Timestamp | { toDate?: () => Date } | null | undefined;
let activeConversationId: string | null = null;

function currentUserId() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw createChatError("chat/unauthenticated");
  return uid;
}

function toDate(value: FirestoreDate) {
  if (value instanceof Date) return value;
  return typeof value?.toDate === "function" ? value.toDate() : null;
}

function ids(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function safeName(value: unknown) {
  return formatPublicUserName(typeof value === "string" ? value : null) ?? "";
}

function readFriendChatMessageType(value: unknown): FriendChatMessageType | "deleted" | null {
  if (value === "deleted") return "deleted";
  if (value === "image" || value === "system" || value === "text" || value === "voice") return value;
  return null;
}

function toConversation(document: { id: string; data: () => DocumentData | undefined }): FriendConversation {
  const data = document.data() ?? {};
  const names = typeof data.participantNameSnapshots === "object" && data.participantNameSnapshots
    ? Object.fromEntries(Object.entries(data.participantNameSnapshots as Record<string, unknown>)
      .map(([userId, name]) => [userId, safeName(name)]))
    : {};
  return {
    conversationId: document.id,
    conversationType: data.conversationType === "group" ? "group" : "direct",
    groupName: typeof data.groupName === "string" && data.groupName.trim() ? data.groupName.trim() : null,
    ownerUserId: typeof data.ownerUserId === "string" ? data.ownerUserId : null,
    adminUserIds: ids(data.adminUserIds),
    activeParticipantIds: ids(data.activeParticipantIds),
    invitedParticipantIds: ids(data.invitedParticipantIds),
    participantNameSnapshots: names,
    participantProfileStates: {},
    activeParticipantCount: Number.isFinite(data.activeParticipantCount) ? data.activeParticipantCount : ids(data.activeParticipantIds).length,
    invitedParticipantCount: Number.isFinite(data.invitedParticipantCount) ? data.invitedParticipantCount : ids(data.invitedParticipantIds).length,
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdAt: toDate(data.createdAt as FirestoreDate),
    updatedAt: toDate(data.updatedAt as FirestoreDate),
    lastMessageAt: toDate(data.lastMessageAt as FirestoreDate),
    lastMessageId: typeof data.lastMessageId === "string" ? data.lastMessageId : null,
    lastMessageType: readFriendChatMessageType(data.lastMessageType),
    lastMessagePreview: typeof data.lastMessagePreview === "string" ? data.lastMessagePreview : null,
    lastMessageRemoved: data.lastMessageRemoved === true,
    lastSenderId: typeof data.lastSenderId === "string" ? data.lastSenderId : null,
    pinnedMessage: normalizePinnedMessage(data.pinnedMessage),
    status: data.status === "archived" ? "archived" : "active",
  };
}

function normalizePinnedMessage(value: unknown): FriendChatPinnedMessage | null {
  const reply = normalizeReplyContext(value);
  if (!reply || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const expiresAt = toDate(data.expiresAt as FirestoreDate);
  if (expiresAt && expiresAt.getTime() <= Date.now()) return null;
  return {
    ...reply,
    expiresAt,
    pinnedByUserId: typeof data.pinnedByUserId === "string" ? data.pinnedByUserId : null,
  };
}

function toMember(document: { id: string; data: () => DocumentData | undefined }): FriendConversationMember {
  const data = document.data() ?? {};
  const statusValues: FriendConversationMemberStatus[] = ["invited", "active", "declined", "left", "removed"];
  const roleValues: FriendConversationMemberRole[] = ["owner", "admin", "member"];
  return {
    userId: document.id,
    status: statusValues.includes(data.status) ? data.status : "removed",
    role: roleValues.includes(data.role) ? data.role : "member",
    displayNameSnapshot: safeName(data.displayNameSnapshot),
    invitedBy: typeof data.invitedBy === "string" ? data.invitedBy : null,
    invitationId: typeof data.invitationId === "string" ? data.invitationId : null,
    invitedAt: toDate(data.invitedAt as FirestoreDate),
    joinedAt: toDate(data.joinedAt as FirestoreDate),
    lastReadAt: toDate(data.lastReadAt as FirestoreDate),
    muted: data.muted === true,
  };
}

function toMessage(document: { id: string; data: () => DocumentData }): FriendChatMessage {
  const data = document.data();
  const isModerated = data.moderationState === "hidden" ||
    data.moderationState === "removed";
  const status = isModerated || data.status === "removed" ? "removed" : "active";
  const rawMessageType = readFriendChatMessageType(data.messageType);
  const messageType: FriendChatMessageType = rawMessageType && rawMessageType !== "deleted" ? rawMessageType : "text";
  return {
    messageId: document.id,
    conversationId: typeof data.conversationId === "string" ? data.conversationId : "",
    messageType,
    senderUserId: typeof data.senderUserId === "string" ? data.senderUserId : null,
    senderDisplayName: safeName(data.senderDisplayName) || null,
    text: isModerated ? "" : typeof data.text === "string" ? data.text : "",
    caption: isModerated ? null : typeof data.caption === "string" && data.caption.trim() ? data.caption.trim() : null,
    createdAt: toDate(data.createdAt as FirestoreDate),
    createdAtTimestamp: data.createdAt && typeof data.createdAt.toDate === "function" ? data.createdAt as Timestamp : null,
    status,
    isModerated,
    image: status === "active" && messageType === "image" ? normalizeStoredFriendImage(data.image) : null,
    clientMessageId: typeof data.clientMessageId === "string" ? data.clientMessageId : null,
    forwarded: data.forwarded === true,
    reactions: status === "active" && messageType !== "system"
      ? normalizeReactionSummary(data.reactionCounts, null)
      : [],
    replyTo: status === "active" ? normalizeReplyContext(data.replyTo) : null,
    starredBySelf: false,
    voiceMemo: status === "active" && messageType === "voice" ? normalizeStoredFriendVoice(data.voiceMemo) : null,
  };
}

function normalizeReplyContext(value: unknown): FriendChatReplyContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const messageId = typeof data.messageId === "string" && data.messageId ? data.messageId : "";
  if (!messageId) return null;
  const messageType = readFriendChatMessageType(data.messageType);
  return {
    createdAt: toDate(data.createdAt as FirestoreDate),
    messageId,
    messageType: messageType && messageType !== "deleted" ? messageType : "text",
    senderDisplayName: safeName(data.senderDisplayName) || null,
    senderUserId: typeof data.senderUserId === "string" ? data.senderUserId : null,
    textExcerpt: typeof data.textExcerpt === "string" && data.textExcerpt.trim() ? data.textExcerpt.trim() : null,
  };
}

function normalizeStoredFriendVoice(value: unknown): StoredVoiceMemo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const storagePath = typeof data.storagePath === "string" ? data.storagePath.trim() : "";
  const durationMilliseconds = Number(data.durationMilliseconds);
  const sizeBytes = Number(data.sizeBytes);
  const mimeType = typeof data.mimeType === "string" ? data.mimeType.trim() : "audio/mp4";
  if (
    !/^friendChatMedia\/[^/]+\/message_[a-f0-9]{64}\/media_[a-f0-9]{64}\/voice\.m4a$/u.test(storagePath) ||
    !Number.isInteger(durationMilliseconds) ||
    durationMilliseconds < 1 ||
    durationMilliseconds > FRIEND_CHAT_VOICE_LIMIT_MS ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes < 1 ||
    sizeBytes > FRIEND_CHAT_VOICE_SIZE_LIMIT_BYTES ||
    !["audio/mp4", "audio/m4a", "audio/x-m4a"].includes(mimeType)
  ) return null;
  return { durationMilliseconds, mimeType: mimeType as StoredVoiceMemo["mimeType"], sizeBytes, storagePath };
}

function normalizeStoredFriendImage(value: unknown): StoredFriendChatImage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const fullPath = typeof data.fullPath === "string" ? data.fullPath.trim() : "";
  const thumbnailPath = typeof data.thumbnailPath === "string" ? data.thumbnailPath.trim() : "";
  const width = Number(data.width);
  const height = Number(data.height);
  const thumbnailWidth = Number(data.thumbnailWidth);
  const thumbnailHeight = Number(data.thumbnailHeight);
  const sizeBytes = Number(data.sizeBytes);
  const thumbnailSizeBytes = Number(data.thumbnailSizeBytes);
  const mimeType = typeof data.mimeType === "string" ? data.mimeType.trim() : "image/jpeg";
  const thumbnailMimeType = typeof data.thumbnailMimeType === "string" ? data.thumbnailMimeType.trim() : "image/jpeg";
  if (
    !/^friendChatMedia\/[^/]+\/message_[a-f0-9]{64}\/media_[a-f0-9]{64}\/image\.jpg$/u.test(fullPath) ||
    !/^friendChatMedia\/[^/]+\/message_[a-f0-9]{64}\/media_[a-f0-9]{64}\/thumbnail\.jpg$/u.test(thumbnailPath) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    !Number.isInteger(thumbnailWidth) ||
    !Number.isInteger(thumbnailHeight) ||
    !Number.isInteger(sizeBytes) ||
    !Number.isInteger(thumbnailSizeBytes) ||
    !["image/jpeg", "image/webp"].includes(mimeType) ||
    !["image/jpeg", "image/webp"].includes(thumbnailMimeType)
  ) return null;
  return {
    fullPath,
    height,
    mimeType: mimeType as StoredFriendChatImage["mimeType"],
    sizeBytes,
    sourceMimeType: typeof data.sourceMimeType === "string" ? data.sourceMimeType : null,
    sourceSizeBytes: Number.isInteger(Number(data.sourceSizeBytes)) ? Number(data.sourceSizeBytes) : 0,
    thumbnailHeight,
    thumbnailMimeType: thumbnailMimeType as StoredFriendChatImage["thumbnailMimeType"],
    thumbnailPath,
    thumbnailSizeBytes,
    thumbnailWidth,
    width,
  };
}

function normalizeReactionSummary(value: unknown, ownReaction: FriendChatReactionEmoji | null): FriendChatReactionSummary[] {
  const data = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return FRIEND_CHAT_REACTIONS.flatMap((emoji) => {
    const count = Number(data[emoji]);
    return Number.isInteger(count) && count > 0
      ? [{ count, emoji, reactedBySelf: ownReaction === emoji }]
      : [];
  });
}

function readReactionEmoji(value: unknown): FriendChatReactionEmoji | null {
  return FRIEND_CHAT_REACTIONS.includes(value as FriendChatReactionEmoji)
    ? value as FriendChatReactionEmoji
    : null;
}

export function getConversationDisplayTitle(
  conversation: FriendConversation,
  currentUid: string,
  fallback: string,
  formerMemberFallback = fallback,
  memberFallback = fallback,
) {
  if (conversation.groupName) return conversation.groupName;
  const participantIds = conversation.conversationType === "direct"
    ? conversation.activeParticipantIds.filter((id) => id !== currentUid)
    : conversation.activeParticipantIds;
  const names = participantIds.map((id) => conversation.participantNameSnapshots[id]
    || (conversation.participantProfileStates[id] === "deleted" ? formerMemberFallback : memberFallback));
  return names.slice(0, 3).join(", ") || fallback;
}

export function isConversationUnread(conversation: FriendConversation, member: FriendConversationMember, uid: string) {
  return Boolean(
    !conversation.lastMessageRemoved && conversation.lastMessageAt && conversation.lastSenderId !== uid &&
    (!member.lastReadAt || conversation.lastMessageAt.getTime() > member.lastReadAt.getTime()),
  );
}

async function loadOwnMember(conversationId: string, uid: string) {
  const snapshot = await getDoc(doc(db, "friendConversations", conversationId, "members", uid));
  return snapshot.exists() ? toMember({ id: snapshot.id, data: () => snapshot.data() }) : null;
}

export function subscribeToFriendConversations(
  uid: string,
  onNext: (items: FriendConversationListItem[]) => void,
  onError: (error: unknown) => void,
  resultLimit = CHAT_LIST_LIMIT,
): Unsubscribe {
  let generation = 0;
  return onSnapshot(
    query(
      collection(db, "friendConversations"),
      where("activeParticipantIds", "array-contains", uid),
      orderBy("lastMessageAt", "desc"),
      limit(Math.min(CHAT_LIST_MAX, Math.max(CHAT_LIST_LIMIT, resultLimit))),
    ),
    async (snapshot) => {
      const currentGeneration = ++generation;
      try {
        const conversations = snapshot.docs.map((item) => toConversation({ id: item.id, data: () => item.data() }));
        const [members, profiles, lastMessageStates] = await Promise.all([
          Promise.all(conversations.map((item) => loadOwnMember(item.conversationId, uid))),
          loadCurrentChatProfiles(conversations.flatMap((item) => [...item.activeParticipantIds, ...item.invitedParticipantIds])),
          Promise.all(conversations.map((item) => loadOwnConversationLastMessageState(item, uid))),
        ]);
        if (currentGeneration !== generation) return;
        onNext(conversations.map((conversation, index) => lastMessageStates[index]?.hiddenForMe
          ? { ...conversation, lastMessagePreview: null, lastMessageRemoved: true, lastMessageType: "deleted" as const }
          : conversation).map((conversation) => hydrateConversationNames(conversation, profiles)).flatMap((conversation, index) => {
          const ownMember = members[index];
          return ownMember?.status === "active"
            ? [{ ...conversation, ownMember, unread: isConversationUnread(conversation, ownMember, uid) }]
            : [];
        }));
      } catch (error) { onError(error); }
    },
    onError,
  );
}

export function subscribeToFriendChatInvitations(
  uid: string,
  onNext: (items: FriendConversation[]) => void,
  onError: (error: unknown) => void,
): Unsubscribe {
  let generation = 0;
  return onSnapshot(
    query(
      collection(db, "friendConversations"),
      where("invitedParticipantIds", "array-contains", uid),
      orderBy("updatedAt", "desc"),
      limit(CHAT_LIST_LIMIT),
    ),
    (snapshot) => {
      const currentGeneration = ++generation;
      const conversations = snapshot.docs.map((item) => toConversation({ id: item.id, data: () => item.data() }));
      void loadCurrentChatProfiles(conversations.flatMap((item) => [...item.activeParticipantIds, ...item.invitedParticipantIds]))
        .then((profiles) => {
          if (currentGeneration === generation) onNext(conversations.map((item) => hydrateConversationNames(item, profiles)));
        })
        .catch(onError);
    },
    onError,
  );
}

export function subscribeToUnreadFriendConversationCount(uid: string, onNext: (count: number) => void) {
  return subscribeToFriendConversations(uid, (items) => onNext(items.filter((item) => item.unread).length), () => onNext(0));
}

export async function getFriendConversationAccess(conversationId: string): Promise<ConversationAccess | null> {
  const uid = currentUserId();
  const [conversationSnapshot, memberSnapshot, blockedUserIds] = await Promise.all([
    getDoc(doc(db, "friendConversations", conversationId)),
    getDoc(doc(db, "friendConversations", conversationId, "members", uid)),
    getBlockedFriendChatUserIds(),
  ]);
  if (!conversationSnapshot.exists() || !memberSnapshot.exists()) return null;
  const rawConversation = toConversation({ id: conversationSnapshot.id, data: () => conversationSnapshot.data() });
  const profiles = await loadCurrentChatProfiles([...rawConversation.activeParticipantIds, ...rawConversation.invitedParticipantIds]);
  const conversation = hydrateConversationNames(rawConversation, profiles);
  const member = toMember({ id: memberSnapshot.id, data: () => memberSnapshot.data() });
  const directFriendId = conversation.conversationType === "direct"
    ? conversation.activeParticipantIds.find((id) => id !== uid)
    : null;
  let directFriendshipActive = true;
  if (directFriendId) {
    const userSnapshot = await getDoc(doc(db, "users", uid));
    directFriendshipActive = ids(userSnapshot.data()?.friendIds).includes(directFriendId) && !blockedUserIds.includes(directFriendId);
  }
  return { conversation, member, blockedUserIds, directFriendshipActive };
}

export async function getFriendConversationMembers(conversationId: string) {
  const snapshot = await getDocs(query(
    collection(db, "friendConversations", conversationId, "memberProfiles"),
    where("status", "==", "active"),
    limit(MAX_CHAT_PARTICIPANTS),
  ));
  const members = snapshot.docs.map((item) => toMember({ id: item.id, data: () => item.data() }));
  const profiles = await loadCurrentChatProfiles(members.map((member) => member.userId));
  return members.map((member) => {
    const profile = profiles.get(member.userId);
    return {
      ...member,
      displayNameSnapshot: profile?.displayName ?? (profile ? "" : member.displayNameSnapshot),
      profileState: profile?.profileState,
    };
  });
}

export function listenToFriendChatMessages(
  conversationId: string,
  uid: string,
  blockedUserIds: string[],
  onNext: (messages: FriendChatMessage[]) => void,
  onError: (error: unknown) => void,
) {
  const blocked = new Set(blockedUserIds);
  let hydrationGeneration = 0;
  return onSnapshot(
    query(
      collection(db, "friendConversations", conversationId, "messages"),
      where("visibleToUserIds", "array-contains", uid),
      orderBy("createdAt", "desc"),
      limit(CHAT_INITIAL_MESSAGE_LIMIT),
    ),
    (snapshot) => {
      const currentGeneration = ++hydrationGeneration;
      const messages = snapshot.docs.map(toMessage).filter((message) => !message.senderUserId || !blocked.has(message.senderUserId)).reverse();
      void hydrateChatMessages(messages, uid)
        .then((hydrated) => {
          if (currentGeneration === hydrationGeneration) onNext(hydrated);
        })
        .catch((error) => {
          if (currentGeneration === hydrationGeneration) onError(error);
        });
    },
    onError,
  );
}

export async function loadEarlierFriendChatMessages(
  conversationId: string,
  uid: string,
  before: Timestamp,
  blockedUserIds: string[],
) {
  const snapshot = await getDocs(query(
    collection(db, "friendConversations", conversationId, "messages"),
    where("visibleToUserIds", "array-contains", uid),
    orderBy("createdAt", "desc"),
    startAfter(before),
    limit(CHAT_EARLIER_PAGE_SIZE),
  ));
  const blocked = new Set(blockedUserIds);
  return {
    messages: await hydrateChatMessages(snapshot.docs.map(toMessage).filter((message) => !message.senderUserId || !blocked.has(message.senderUserId)).reverse(), uid),
    hasMore: snapshot.size === CHAT_EARLIER_PAGE_SIZE,
  };
}

async function loadOwnConversationLastMessageState(conversation: FriendConversation, uid: string) {
  if (!conversation.lastMessageId) return null;
  const snapshot = await getDoc(doc(
    db,
    "friendConversations",
    conversation.conversationId,
    "userMessageStates",
    uid,
    "messages",
    conversation.lastMessageId,
  )).catch(() => null);
  if (!snapshot?.exists()) return null;
  return { hiddenForMe: snapshot.data().hiddenForMe === true };
}

export function subscribeToStarredFriendChatMessages(
  conversationId: string,
  uid: string,
  blockedUserIds: string[],
  onNext: (messages: FriendChatMessage[]) => void,
  onError: (error: unknown) => void,
): Unsubscribe {
  let generation = 0;
  const blocked = new Set(blockedUserIds);
  return onSnapshot(
    query(
      collection(db, "friendConversations", conversationId, "userMessageStates", uid, "messages"),
      where("starred", "==", true),
      limit(CHAT_LIST_MAX),
    ),
    (snapshot) => {
      const currentGeneration = ++generation;
      void (async () => {
        const states = snapshot.docs
          .map((stateSnapshot) => ({ data: stateSnapshot.data(), messageId: stateSnapshot.id }))
          .filter((state) => state.data.hiddenForMe !== true)
          .sort((a, b) => (toDate(b.data.updatedAt as FirestoreDate)?.getTime() ?? 0) - (toDate(a.data.updatedAt as FirestoreDate)?.getTime() ?? 0));
        const messageSnapshots = await Promise.all(states.map((state) =>
          state.data.hiddenForMe === true
            ? Promise.resolve(null)
            : getDoc(doc(db, "friendConversations", conversationId, "messages", state.messageId)).catch(() => null)));
        if (currentGeneration !== generation) return;
        const messages = messageSnapshots.flatMap((messageSnapshot) => {
          if (!messageSnapshot?.exists()) return [];
          const message = toMessage({ id: messageSnapshot.id, data: () => messageSnapshot.data() });
          if (message.status !== "active" || message.messageType === "system") return [];
          if (message.senderUserId && blocked.has(message.senderUserId)) return [];
          return [message];
        });
        const hydrated = await hydrateChatMessages(messages, uid);
        if (currentGeneration === generation) onNext(hydrated.filter((message) => message.starredBySelf));
      })().catch(onError);
    },
    onError,
  );
}

async function loadCurrentChatProfiles(userIds: string[]) {
  const idsToLoad = Array.from(new Set(userIds.filter(Boolean)));
  if (idsToLoad.length === 0) return new Map<string, PublicUserProfile>();
  try {
    return new Map((await getPublicUserProfiles(idsToLoad)).map((profile) => [profile.userId, profile]));
  } catch {
    return new Map<string, PublicUserProfile>();
  }
}

function hydrateConversationNames(conversation: FriendConversation, profiles: ReadonlyMap<string, PublicUserProfile>) {
  const participantNameSnapshots = { ...conversation.participantNameSnapshots };
  const participantProfileStates = { ...conversation.participantProfileStates };
  [...conversation.activeParticipantIds, ...conversation.invitedParticipantIds].forEach((userId) => {
    const profile = profiles.get(userId);
    if (!profile) return;
    participantProfileStates[userId] = profile.profileState;
    if (profile.displayName) participantNameSnapshots[userId] = profile.displayName;
    else participantNameSnapshots[userId] = "";
  });
  return { ...conversation, participantNameSnapshots, participantProfileStates };
}

async function hydrateChatMessages(messages: FriendChatMessage[], uid: string) {
  const profiles = await loadCurrentChatProfiles(messages.flatMap((message) => message.senderUserId ? [message.senderUserId] : []));
  const [ownReactions, ownStates] = await Promise.all([
    loadOwnMessageReactions(messages, uid),
    loadOwnMessageStates(messages, uid),
  ]);
  return messages.flatMap((message) => {
    const state = ownStates.get(message.messageId);
    if (state?.hiddenForMe) return [];
    if (!message.senderUserId) return message;
    const profile = profiles.get(message.senderUserId);
    return {
      ...message,
      senderDisplayName: profile?.displayName ?? (profile ? null : message.senderDisplayName),
      senderProfileState: profile?.profileState,
      reactions: normalizeReactionSummary(
        Object.fromEntries(message.reactions.map((reaction) => [reaction.emoji, reaction.count])),
        ownReactions.get(message.messageId) ?? null,
      ),
      starredBySelf: state?.starred === true,
    };
  });
}

async function loadOwnMessageReactions(messages: FriendChatMessage[], uid: string) {
  const activeMessages = messages.filter((message) => message.status === "active" && message.messageType !== "system");
  if (activeMessages.length === 0) return new Map<string, FriendChatReactionEmoji>();
  const snapshots = await Promise.all(activeMessages.map((message) =>
    getDoc(doc(db, "friendConversations", message.conversationId, "messages", message.messageId, "reactions", uid))
      .catch(() => null)));
  return new Map(snapshots.flatMap((snapshot, index) => {
    const emoji = snapshot?.exists() ? readReactionEmoji(snapshot.data().emoji) : null;
    return emoji ? [[activeMessages[index].messageId, emoji] as const] : [];
  }));
}

async function loadOwnMessageStates(messages: FriendChatMessage[], uid: string) {
  const activeMessages = messages.filter((message) => message.status === "active" && message.messageType !== "system");
  if (activeMessages.length === 0) return new Map<string, { hiddenForMe: boolean; starred: boolean }>();
  const snapshots = await Promise.all(activeMessages.map((message) =>
    getDoc(doc(db, "friendConversations", message.conversationId, "userMessageStates", uid, "messages", message.messageId))
      .catch(() => null)));
  return new Map(snapshots.flatMap((snapshot, index) => {
    if (!snapshot?.exists()) return [];
    const data = snapshot.data();
    return [[activeMessages[index].messageId, {
      hiddenForMe: data.hiddenForMe === true,
      starred: data.starred === true,
    }] as const];
  }));
}

export function setActiveFriendConversation(conversationId: string | null) {
  activeConversationId = conversationId;
}

export function isViewingFriendConversation(data: unknown) {
  const conversationId = data && typeof data === "object" && "conversationId" in data && typeof data.conversationId === "string"
    ? data.conversationId
    : null;
  return Boolean(conversationId && activeConversationId === conversationId);
}

export async function createOrOpenDirectConversation(friendUserId: string) {
  return call<{ friendUserId: string }, { conversationId: string; status: "created" | "existing" }>(
    "createOrOpenDirectConversation", { friendUserId },
  );
}

export async function createFriendGroupConversation(friendUserIds: string[], groupName: string | null) {
  return call<{ friendUserIds: string[]; groupName: string | null }, { conversationId: string; invitedCount: number }>(
    "createFriendGroupConversation", { friendUserIds, groupName },
  );
}

export async function respondToFriendGroupInvitation(conversationId: string, response: "accept" | "decline") {
  return call("respondToFriendGroupInvitation", { conversationId, response });
}

export async function inviteFriendsToGroupConversation(conversationId: string, friendUserIds: string[]) {
  return call("inviteFriendsToGroupConversation", { conversationId, friendUserIds });
}

export async function renameFriendGroupConversation(conversationId: string, groupName: string | null) {
  return call("renameFriendGroupConversation", { conversationId, groupName });
}

export async function setFriendGroupAdminRole(conversationId: string, memberUserId: string, makeAdmin: boolean) {
  return call("setFriendGroupAdminRole", { conversationId, memberUserId, makeAdmin });
}

export async function transferFriendGroupOwnership(conversationId: string, memberUserId: string) {
  return call("transferFriendGroupOwnership", { conversationId, memberUserId });
}

export async function removeFriendGroupMember(conversationId: string, memberUserId: string) {
  return call("removeFriendGroupMember", { conversationId, memberUserId });
}

export async function leaveFriendConversation(conversationId: string) {
  return call("leaveFriendConversation", { conversationId });
}

export async function setFriendConversationMuted(conversationId: string, muted: boolean) {
  return call<{ conversationId: string; muted: boolean }, { muted: boolean }>("setFriendConversationMuted", { conversationId, muted });
}

export async function markFriendConversationRead(conversationId: string) {
  return call("markFriendConversationRead", { conversationId });
}

export async function sendFriendChatMessage(
  conversationId: string,
  text: string,
  clientMessageId: string,
  replyToMessageId?: string | null,
) {
  return call<
    { conversationId: string; text: string; clientMessageId: string; replyToMessageId?: string | null },
    { messageId: string; status: "sent" | "alreadySent"; createdAt: string }
  >("sendFriendChatMessage", { conversationId, text, clientMessageId, replyToMessageId: replyToMessageId ?? null });
}

export async function reserveFriendChatVoiceUpload(input: {
  caption?: string | null;
  clientMessageId: string;
  conversationId: string;
  replyToMessageId?: string | null;
  voiceMemo: LocalVoiceMemoDraft;
}) {
  const { uri: _uri, previewed: _previewed, ...voiceMemo } = input.voiceMemo;
  return call<
    { caption?: string | null; clientMessageId: string; conversationId: string; replyToMessageId?: string | null; voiceMemo: Omit<LocalVoiceMemoDraft, "previewed" | "uri"> },
    FriendChatVoiceUploadReservation
  >("createFriendChatVoiceUpload", {
    caption: input.caption ?? null,
    clientMessageId: input.clientMessageId,
    conversationId: input.conversationId,
    replyToMessageId: input.replyToMessageId ?? null,
    voiceMemo,
  });
}

export async function uploadReservedFriendChatVoiceMemo(
  reservation: FriendChatVoiceUploadReservation,
  draft: LocalVoiceMemoDraft,
  onProgress?: (progress: number) => void,
): Promise<{ completion: Promise<void>; task: UploadTask }> {
  if (!draft.previewed) throw new Error("voice_preview_required");
  if (!/^friendChatMedia\/[^/]+\/message_[a-f0-9]{64}\/media_[a-f0-9]{64}\/voice\.m4a$/u.test(reservation.storagePath)) {
    throw new Error("invalid_voice_storage_path");
  }
  return uploadBlobToReservedPath(reservation.storagePath, draft.uri, draft.sizeBytes, draft.mimeType, onProgress);
}

export async function finalizeFriendChatVoiceMessage(reservationId: string) {
  return call<{ reservationId: string }, { messageId: string; status: "alreadyFinalized" | "sent" }>(
    "finalizeFriendChatVoiceMessage",
    { reservationId },
  );
}

export async function reserveFriendChatImageUpload(input: {
  caption?: string | null;
  clientMessageId: string;
  conversationId: string;
  image: LocalFriendChatImageDraft;
  replyToMessageId?: string | null;
}) {
  return call<
    {
      caption?: string | null;
      clientMessageId: string;
      conversationId: string;
      image: {
        main: Omit<LocalFriendChatImageDraft["full"], "uri">;
        sourceMimeType: string | null;
        sourceSizeBytes: number;
        thumbnail: Omit<LocalFriendChatImageDraft["thumbnail"], "uri">;
      };
      replyToMessageId?: string | null;
    },
    FriendChatImageUploadReservation
  >("createFriendChatImageUpload", {
    caption: input.caption ?? null,
    clientMessageId: input.clientMessageId,
    conversationId: input.conversationId,
    image: {
      main: stripImageDraftUri(input.image.full),
      sourceMimeType: input.image.sourceMimeType,
      sourceSizeBytes: input.image.sourceSizeBytes,
      thumbnail: stripImageDraftUri(input.image.thumbnail),
    },
    replyToMessageId: input.replyToMessageId ?? null,
  });
}

export async function uploadReservedFriendChatImage(
  reservation: FriendChatImageUploadReservation,
  draft: LocalFriendChatImageDraft,
  onProgress?: (progress: number) => void,
): Promise<{ cancel: () => FriendChatImageUploadCancelResult; completion: Promise<void> }> {
  if (!/^friendChatMedia\/[^/]+\/message_[a-f0-9]{64}\/media_[a-f0-9]{64}\/image\.jpg$/u.test(reservation.fullPath) ||
    !/^friendChatMedia\/[^/]+\/message_[a-f0-9]{64}\/media_[a-f0-9]{64}\/thumbnail\.jpg$/u.test(reservation.thumbnailPath)) {
    throw new Error("invalid_image_storage_path");
  }
  const progressState = { full: 0, thumbnail: 0 };
  let canceled = false;
  const full = await uploadBlobToReservedPath(reservation.fullPath, draft.full.uri, draft.full.sizeBytes, draft.full.mimeType, (progress) => {
    progressState.full = progress;
    onProgress?.((progressState.full * 0.8) + (progressState.thumbnail * 0.2));
  });
  let thumbnail: Awaited<ReturnType<typeof uploadBlobToReservedPath>>;
  try {
    thumbnail = await uploadBlobToReservedPath(
      reservation.thumbnailPath,
      draft.thumbnail.uri,
      draft.thumbnail.sizeBytes,
      draft.thumbnail.mimeType,
      (progress) => {
        progressState.thumbnail = progress;
        onProgress?.((progressState.full * 0.8) + (progressState.thumbnail * 0.2));
      },
    );
  } catch (error) {
    cancelFriendChatImageUploadTasks(full.task, null);
    void full.completion.catch(() => undefined);
    throw error;
  }
  return {
    cancel: () => {
      canceled = true;
      return cancelFriendChatImageUploadTasks(full.task, thumbnail.task);
    },
    completion: Promise.all([full.completion, thumbnail.completion])
      .then(() => {
        if (canceled) throw new Error("media_upload_canceled");
      })
      .catch((error) => {
        if (canceled) throw new Error("media_upload_canceled");
        throw error;
      }),
  };
}

export async function finalizeFriendChatImageMessage(reservationId: string) {
  return call<{ reservationId: string }, { messageId: string; status: "alreadyFinalized" | "sent" }>(
    "finalizeFriendChatImageMessage",
    { reservationId },
  );
}

export async function toggleFriendChatReaction(
  conversationId: string,
  messageId: string,
  emoji: FriendChatReactionEmoji,
) {
  return call("toggleFriendChatReaction", { conversationId, messageId, emoji });
}

export async function setFriendChatMessagesStarred(
  conversationId: string,
  messageIds: string[],
  starred: boolean,
) {
  return call<{ conversationId: string; messageIds: string[]; starred: boolean }, { updated: number }>(
    "setFriendChatMessagesStarred",
    { conversationId, messageIds, starred },
  );
}

export async function deleteFriendChatMessagesForMe(conversationId: string, messageIds: string[]) {
  return call<{ conversationId: string; messageIds: string[] }, { hidden: number }>(
    "deleteFriendChatMessagesForMe",
    { conversationId, messageIds },
  );
}

export async function forwardFriendChatMessages(
  conversationId: string,
  messageIds: string[],
  destinationConversationIds: string[],
  clientForwardId: string,
) {
  return call<
    { clientForwardId: string; conversationId: string; destinationConversationIds: string[]; messageIds: string[] },
    { forwarded: number; unsupportedMediaMessageIds: string[] }
  >("forwardFriendChatMessages", { clientForwardId, conversationId, destinationConversationIds, messageIds });
}

export async function pinFriendChatMessage(
  conversationId: string,
  messageId: string,
  duration: "24h" | "7d" | "30d",
) {
  return call<{ conversationId: string; duration: "24h" | "7d" | "30d"; messageId: string }, { pinned: boolean }>(
    "pinFriendChatMessage",
    { conversationId, duration, messageId },
  );
}

export async function unpinFriendChatMessage(conversationId: string, messageId: string) {
  return call<{ conversationId: string; messageId: string }, { unpinned: boolean }>(
    "unpinFriendChatMessage",
    { conversationId, messageId },
  );
}

export async function getFriendChatMediaDownloadUrl(input: {
  messageId: string;
  storagePath: string;
}) {
  const result = await call<typeof input, { expiresAtMillis: number; url: string }>(
    "getFriendChatMediaDownloadUrl",
    input,
  );
  return normalizeVoicePlaybackUrlResponse(result, { allowLocalHttp: __DEV__ });
}

export async function deleteFriendChatMessageForEveryone(conversationId: string, messageId: string) {
  return call("removeOwnFriendChatMessage", { conversationId, messageId });
}

export const removeOwnFriendChatMessage = deleteFriendChatMessageForEveryone;

export async function blockFriendChatUser(blockedUserId: string) {
  return call("blockFriendChatUser", { blockedUserId });
}

export async function getBlockedFriendChatUserIds() {
  const result = await call<Record<string, never>, { blockedUserIds: string[] }>("getBlockedFriendChatUserIds", {});
  return ids(result.blockedUserIds);
}

export async function reportFriendChatUser(conversationId: string, reportedUserId: string) {
  return call("reportFriendChatUser", { conversationId, reportedUserId });
}

export async function reportFriendChatMessage(
  conversationId: string,
  messageId: string,
  reason: "privacy" | "harassment" | "offensive" | "other",
) {
  return call("reportFriendChatMessage", { conversationId, messageId, reason });
}

export async function unblockFriendChatUser(blockedUserId: string) {
  return call("unblockFriendChatUser", { blockedUserId });
}

async function uploadBlobToReservedPath(
  storagePath: string,
  uri: string,
  expectedSizeBytes: number,
  contentType: string,
  onProgress?: (progress: number) => void,
): Promise<{ completion: Promise<void>; task: UploadTask }> {
  if (!/^(?:file|content|cache):/iu.test(uri)) throw new Error("invalid_local_media_uri");
  const blob = await (await fetch(uri)).blob();
  if (blob.size < 1 || blob.size !== expectedSizeBytes) {
    const closable = blob as unknown as { close?: () => void };
    if (typeof closable.close === "function") closable.close();
    throw new Error("media_upload_size_mismatch");
  }
  const task = uploadBytesResumable(ref(storage, storagePath), blob, { contentType });
  const completion = new Promise<void>((resolve, reject) => {
    task.on("state_changed", (snapshot) => {
      onProgress?.(snapshot.totalBytes ? snapshot.bytesTransferred / snapshot.totalBytes : 0);
    }, reject, () => {
      const snapshot = task.snapshot;
      if (
        snapshot.bytesTransferred !== expectedSizeBytes ||
        snapshot.totalBytes !== expectedSizeBytes ||
        snapshot.metadata.contentType !== contentType
      ) {
        reject(new Error("media_upload_verification_failed"));
        return;
      }
      resolve();
    });
  }).finally(() => {
    const closable = blob as unknown as { close?: () => void };
    if (typeof closable.close === "function") closable.close();
  });
  return { completion, task };
}

function stripImageDraftUri<T extends { uri: string }>(draft: T): Omit<T, "uri"> {
  const { uri: _uri, ...metadata } = draft;
  return metadata;
}

export function createChatClientMessageId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

async function call<Input, Output = Record<string, unknown>>(name: string, input: Input) {
  currentUserId();
  const callable = httpsCallable<Input, Output>(functions, name);
  return (await callable(input)).data;
}

function createChatError(code: string) {
  const error = new Error("Chat requires authentication.") as Error & { code: string };
  error.code = code;
  return error;
}
