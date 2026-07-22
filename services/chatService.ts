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
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { auth, db, functions } from "@/config/firebase";
import { getPublicUserProfiles, type PublicUserProfile } from "@/services/publicProfileService";
import { formatPublicUserName } from "@/utils/friendPrivacy";
export { mapFriendChatError, type FriendChatUiError } from "@/utils/friendChatError";

export const MAX_CHAT_PARTICIPANTS = 10;
export const CHAT_MESSAGE_LIMIT = 500;
export const CHAT_INITIAL_MESSAGE_LIMIT = 50;
export const CHAT_EARLIER_PAGE_SIZE = 25;
export const CHAT_LIST_LIMIT = 25;
export const CHAT_LIST_MAX = 100;

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
  lastMessagePreview: string | null;
  lastMessageRemoved: boolean;
  lastSenderId: string | null;
  status: "active" | "archived";
};

export type FriendConversationListItem = FriendConversation & {
  ownMember: FriendConversationMember;
  unread: boolean;
};

export type FriendChatMessage = {
  messageId: string;
  conversationId: string;
  messageType: "text" | "system";
  senderUserId: string | null;
  senderDisplayName: string | null;
  senderProfileState?: PublicUserProfile["profileState"];
  text: string;
  createdAt: Date | null;
  createdAtTimestamp: Timestamp | null;
  status: "active" | "removed";
  clientMessageId: string | null;
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
    lastMessagePreview: typeof data.lastMessagePreview === "string" ? data.lastMessagePreview : null,
    lastMessageRemoved: data.lastMessageRemoved === true,
    lastSenderId: typeof data.lastSenderId === "string" ? data.lastSenderId : null,
    status: data.status === "archived" ? "archived" : "active",
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

function toMessage(document: QueryDocumentSnapshot<DocumentData>): FriendChatMessage {
  const data = document.data();
  return {
    messageId: document.id,
    conversationId: typeof data.conversationId === "string" ? data.conversationId : "",
    messageType: data.messageType === "system" ? "system" : "text",
    senderUserId: typeof data.senderUserId === "string" ? data.senderUserId : null,
    senderDisplayName: safeName(data.senderDisplayName) || null,
    text: typeof data.text === "string" ? data.text : "",
    createdAt: toDate(data.createdAt as FirestoreDate),
    createdAtTimestamp: data.createdAt && typeof data.createdAt.toDate === "function" ? data.createdAt as Timestamp : null,
    status: data.status === "removed" ? "removed" : "active",
    clientMessageId: typeof data.clientMessageId === "string" ? data.clientMessageId : null,
  };
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
    conversation.lastMessageAt && conversation.lastSenderId !== uid &&
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
        const [members, profiles] = await Promise.all([
          Promise.all(conversations.map((item) => loadOwnMember(item.conversationId, uid))),
          loadCurrentChatProfiles(conversations.flatMap((item) => [...item.activeParticipantIds, ...item.invitedParticipantIds])),
        ]);
        if (currentGeneration !== generation) return;
        onNext(conversations.map((conversation) => hydrateConversationNames(conversation, profiles)).flatMap((conversation, index) => {
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
  return onSnapshot(
    query(
      collection(db, "friendConversations", conversationId, "messages"),
      where("visibleToUserIds", "array-contains", uid),
      orderBy("createdAt", "desc"),
      limit(CHAT_INITIAL_MESSAGE_LIMIT),
    ),
    (snapshot) => {
      const messages = snapshot.docs.map(toMessage).filter((message) => !message.senderUserId || !blocked.has(message.senderUserId)).reverse();
      void hydrateChatMessages(messages).then(onNext).catch(onError);
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
    messages: await hydrateChatMessages(snapshot.docs.map(toMessage).filter((message) => !message.senderUserId || !blocked.has(message.senderUserId)).reverse()),
    hasMore: snapshot.size === CHAT_EARLIER_PAGE_SIZE,
  };
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

async function hydrateChatMessages(messages: FriendChatMessage[]) {
  const profiles = await loadCurrentChatProfiles(messages.flatMap((message) => message.senderUserId ? [message.senderUserId] : []));
  return messages.map((message) => {
    if (!message.senderUserId) return message;
    const profile = profiles.get(message.senderUserId);
    return {
      ...message,
      senderDisplayName: profile?.displayName ?? (profile ? null : message.senderDisplayName),
      senderProfileState: profile?.profileState,
    };
  });
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

export async function sendFriendChatMessage(conversationId: string, text: string, clientMessageId: string) {
  return call<
    { conversationId: string; text: string; clientMessageId: string },
    { messageId: string; status: "sent" | "alreadySent"; createdAt: string }
  >("sendFriendChatMessage", { conversationId, text, clientMessageId });
}

export async function removeOwnFriendChatMessage(conversationId: string, messageId: string) {
  return call("removeOwnFriendChatMessage", { conversationId, messageId });
}

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

export async function reportFriendChatMessage(conversationId: string, messageId: string) {
  return call("reportFriendChatMessage", { conversationId, messageId });
}

export async function unblockFriendChatUser(blockedUserId: string) {
  return call("unblockFriendChatUser", { blockedUserId });
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
