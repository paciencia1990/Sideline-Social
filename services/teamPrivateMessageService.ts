import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  Timestamp,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytesResumable, type UploadTask } from "firebase/storage";

import { auth, db, functions, storage } from "@/config/firebase";
import { TEAM_HISTORY_PAGE_SIZES, type TeamHistoryCursor } from "@/constants/teamHistoryPagination";
import { getPublicUserProfiles } from "@/services/publicProfileService";
import { isCanonicalTeamVoiceStoragePath, normalizeVoiceMessageFields } from "@/utils/voiceMessageNormalizer";
import { normalizeVoicePlaybackUrlResponse } from "@/utils/voicePlaybackCore";
import type {
  LocalVoiceMemoDraft,
  TeamPrivateConversation,
  TeamPrivateMessage,
  VoiceUploadReservation,
} from "@/types/teamVoiceMessaging";

export type EligiblePrivateTeamParent = {
  userId: string;
  displayName: string;
};

export type PrivateTeamMessagePage = {
  messages: TeamPrivateMessage[];
  hasMore: boolean;
  nextCursor: TeamHistoryCursor | null;
};

export async function getEligiblePrivateTeamParents(teamId: string) {
  requireUser();
  const call = httpsCallable<
    { teamId: string },
    { teamId: string; teamName: string; parents: EligiblePrivateTeamParent[] }
  >(functions, "getEligiblePrivateTeamParents");
  const response = (await call({ teamId })).data;
  return {
    teamId: response.teamId,
    teamName: response.teamName,
    parents: Array.isArray(response.parents)
      ? response.parents
        .filter((parent) => parent && typeof parent.userId === "string" && typeof parent.displayName === "string")
        .map((parent) => ({
          userId: parent.userId.trim(),
          displayName: parent.displayName.trim() || "Sideline Social member",
        }))
        .filter((parent) => Boolean(parent.userId))
      : [],
  };
}

export async function getOrCreatePrivateTeamConversation(teamId: string, parentUserId: string) {
  requireUser();
  const call = httpsCallable<
    { teamId: string; parentUserId: string },
    TeamPrivateConversation
  >(functions, "getOrCreatePrivateTeamConversation");
  return (await call({ teamId, parentUserId })).data;
}

export async function getTeamPrivateMessageInboxPage(
  role: "coach" | "parent",
  teamId?: string,
  cursor: TeamHistoryCursor | null = null,
  pageSize = 25,
) {
  requireUser();
  const call = httpsCallable<
    { role: "coach" | "parent"; teamId?: string; cursor: TeamHistoryCursor | null; pageSize: number },
    { conversations: TeamPrivateConversation[]; hasMore: boolean; nextCursor: TeamHistoryCursor | null; nextOffset?: number }
  >(functions, "getTeamPrivateMessageInbox");
  const page = (await call({ role, ...(teamId ? { teamId } : {}), cursor, pageSize })).data;
  return {
    ...page,
    conversations: await hydrateConversationNames(page.conversations).catch(() => page.conversations),
  };
}

export async function getTeamPrivateMessageInbox(role: "coach" | "parent", teamId?: string) {
  return (await getTeamPrivateMessageInboxPage(role, teamId, null, 50)).conversations;
}

export async function sendPrivateTeamTextMessage(conversationId: string, text: string, clientMessageId: string) {
  requireUser();
  const call = httpsCallable<
    { conversationId: string; text: string; clientMessageId: string },
    { messageId: string; status: "sent" | "alreadySent" }
  >(functions, "sendPrivateTeamTextMessage");
  return (await call({ conversationId, text: text.trim(), clientMessageId })).data;
}

export function listenToPrivateTeamConversation(
  conversationId: string,
  onValue: (conversation: TeamPrivateConversation | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  let generation = 0;
  return onSnapshot(doc(db, "teamPrivateConversations", conversationId), (snapshot) => {
    const currentGeneration = ++generation;
    if (!snapshot.exists()) {
      onValue(null);
      return;
    }
    const conversation = normalizeConversation(snapshot.id, snapshot.data());
    void hydrateConversationNames([conversation]).then(([hydrated]) => {
      if (currentGeneration === generation) onValue(hydrated ?? conversation);
    }).catch(() => {
      if (currentGeneration === generation) onValue(conversation);
    });
  }, (error) => onError?.(error));
}

export function listenToPrivateTeamMessages(
  conversationId: string,
  onValue: (messages: TeamPrivateMessage[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return listenToNewestPrivateTeamMessagesPage(conversationId, (page) => onValue(page.messages), onError);
}

export function listenToNewestPrivateTeamMessagesPage(
  conversationId: string,
  onValue: (page: PrivateTeamMessagePage) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const userId = auth.currentUser?.uid;
  if (!userId) {
    onError?.(new Error("private_team_message_auth_required"));
    return () => {};
  }
  const pageSize = TEAM_HISTORY_PAGE_SIZES.privateMessages;
  let canonicalMessages: TeamPrivateMessage[] = [];
  let hasMore = false;
  let hiddenUnsubscribes: Unsubscribe[] = [];
  let hiddenIdsByChunk = new Map<number, Set<string>>();
  let receivedHiddenChunks = new Set<number>();
  let failed = false;
  const publishVisibleMessages = () => {
    if (receivedHiddenChunks.size !== hiddenIdsByChunk.size) return;
    const hiddenMessageIds = new Set(Array.from(hiddenIdsByChunk.values()).flatMap((ids) => Array.from(ids)));
    const messages = canonicalMessages.filter((message) => !hiddenMessageIds.has(message.id));
    onValue({ messages, hasMore, nextCursor: cursorForMessage(canonicalMessages[0]) });
  };
  const reportError = (error: Error) => {
    if (failed) return;
    failed = true;
    onError?.(error);
  };
  const unsubscribeMessages = onSnapshot(
    query(
      collection(db, "teamPrivateConversations", conversationId, "messages"),
      orderBy("createdAt", "desc"),
      orderBy(documentId(), "desc"),
      limit(pageSize + 1),
    ),
    (snapshot) => {
      hiddenUnsubscribes.forEach((unsubscribe) => unsubscribe());
      hiddenUnsubscribes = [];
      hiddenIdsByChunk = new Map();
      receivedHiddenChunks = new Set();
      hasMore = snapshot.size > pageSize;
      canonicalMessages = snapshot.docs.slice(0, pageSize)
        .map((message) => normalizeMessage(message.id, message.data()))
        .reverse();
      const chunks = chunkIds(canonicalMessages.map((message) => message.id));
      if (chunks.length === 0) {
        publishVisibleMessages();
        return;
      }
      chunks.forEach((ids, chunkIndex) => {
        hiddenIdsByChunk.set(chunkIndex, new Set());
        hiddenUnsubscribes.push(onSnapshot(
          query(
            collection(db, "teamPrivateConversations", conversationId, "members", userId, "hiddenMessages"),
            where(documentId(), "in", ids),
          ),
          (hiddenSnapshot) => {
            hiddenIdsByChunk.set(chunkIndex, new Set(hiddenSnapshot.docs.map((item) => item.id)));
            receivedHiddenChunks.add(chunkIndex);
            publishVisibleMessages();
          },
          reportError,
        ));
      });
    },
    reportError,
  );
  return () => {
    unsubscribeMessages();
    hiddenUnsubscribes.forEach((unsubscribe) => unsubscribe());
  };
}

export async function getOlderPrivateTeamMessagesPage(
  conversationId: string,
  cursor: TeamHistoryCursor,
): Promise<PrivateTeamMessagePage> {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error("private_team_message_auth_required");
  const pageSize = TEAM_HISTORY_PAGE_SIZES.privateMessages;
  const snapshot = await getDocs(query(
    collection(db, "teamPrivateConversations", conversationId, "messages"),
    orderBy("createdAt", "desc"),
    orderBy(documentId(), "desc"),
    startAfter(Timestamp.fromMillis(cursor.timestampMillis), cursor.id),
    limit(pageSize + 1),
  ));
  const canonicalMessages = snapshot.docs.slice(0, pageSize)
    .map((message) => normalizeMessage(message.id, message.data()))
    .reverse();
  const hiddenMessageIds = await getHiddenMessageIds(conversationId, userId, canonicalMessages.map((message) => message.id));
  return {
    messages: canonicalMessages.filter((message) => !hiddenMessageIds.has(message.id)),
    hasMore: snapshot.size > pageSize,
    nextCursor: cursorForMessage(canonicalMessages[0]),
  };
}

export async function getPrivateTeamMessage(conversationId: string, messageId: string) {
  requireUser();
  const snapshot = await getDoc(doc(db, "teamPrivateConversations", conversationId, "messages", messageId));
  if (!snapshot.exists()) return null;
  const hiddenSnapshot = await getDoc(doc(
    db,
    "teamPrivateConversations",
    conversationId,
    "members",
    auth.currentUser!.uid,
    "hiddenMessages",
    messageId,
  ));
  return hiddenSnapshot.exists() ? null : normalizeMessage(snapshot.id, snapshot.data());
}

export async function markPrivateTeamConversationRead(conversationId: string) {
  requireUser();
  const call = httpsCallable<{ conversationId: string }, { status: "read" }>(
    functions,
    "markPrivateTeamConversationRead",
  );
  return (await call({ conversationId })).data;
}

export async function reserveVoiceUpload(input: {
  teamId: string;
  kind: "announcement" | "privateMessage";
  voiceMemo: LocalVoiceMemoDraft;
  title?: string;
  summary?: string;
  audience?: "parents" | "staff" | "all";
  allowReplies?: boolean;
  conversationId?: string;
  clientMessageId?: string;
  caption?: string;
}) {
  requireUser();
  const call = httpsCallable<Record<string, unknown>, VoiceUploadReservation>(functions, "createTeamVoiceMemoUpload");
  const { uri: _uri, previewed: _previewed, ...voiceMemo } = input.voiceMemo;
  return (await call({ ...input, voiceMemo })).data;
}

export async function uploadReservedVoiceMemo(
  reservation: VoiceUploadReservation,
  draft: LocalVoiceMemoDraft,
  onProgress?: (progress: number) => void,
): Promise<{ task: UploadTask; completion: Promise<void> }> {
  if (!draft.previewed) throw new Error("voice_preview_required");
  if (!/^(?:file|content|cache):/iu.test(draft.uri)) throw new Error("invalid_local_voice_uri");
  if (!isCanonicalTeamVoiceStoragePath(reservation.storagePath)) throw new Error("invalid_voice_storage_path");
  const blob = await (await fetch(draft.uri)).blob();
  if (blob.size < 1 || blob.size !== draft.sizeBytes) {
    const closable = blob as unknown as { close?: () => void };
    if (typeof closable.close === "function") closable.close();
    throw new Error("voice_upload_size_mismatch");
  }
  const task = uploadBytesResumable(ref(storage, reservation.storagePath), blob, {
    contentType: draft.mimeType,
  });
  const completion = new Promise<void>((resolve, reject) => {
    task.on("state_changed", (snapshot) => {
      onProgress?.(snapshot.totalBytes ? snapshot.bytesTransferred / snapshot.totalBytes : 0);
    }, reject, () => {
      const snapshot = task.snapshot;
      if (
        snapshot.bytesTransferred !== draft.sizeBytes ||
        snapshot.totalBytes !== draft.sizeBytes ||
        snapshot.metadata.contentType !== draft.mimeType
      ) {
        reject(new Error("voice_upload_verification_failed"));
        return;
      }
      if (__DEV__) {
        console.info("[VoiceMemoUpload] upload completed", {
          contentTypeMatched: true,
          hasStoragePath: true,
          localFileSizeValidated: true,
          uploadedBytesMatched: true,
        });
      }
      resolve();
    });
  }).finally(() => {
    const closable = blob as unknown as { close?: () => void };
    if (typeof closable.close === "function") closable.close();
  });
  return { task, completion };
}

export async function finalizeVoiceAnnouncement(reservationId: string) {
  const call = httpsCallable<{ reservationId: string }, { announcementId: string; status: string }>(
    functions,
    "finalizeTeamVoiceAnnouncement",
  );
  return (await call({ reservationId })).data;
}

export async function finalizePrivateVoiceMessage(reservationId: string) {
  const call = httpsCallable<{ reservationId: string }, { messageId: string; status: string }>(
    functions,
    "finalizePrivateTeamVoiceMessage",
  );
  return (await call({ reservationId })).data;
}

export async function deletePrivateTeamMessage(conversationId: string, messageId: string) {
  const call = httpsCallable<
    { conversationId: string; messageId: string },
    { status: "deleted" | "alreadyDeleted"; storageCleanup: "deleted" | "cleanupPending" | "notRequired" }
  >(functions, "deletePrivateTeamMessage");
  return (await call({ conversationId, messageId })).data;
}

export async function hidePrivateTeamMessageForCurrentUser(conversationId: string, messageId: string) {
  requireUser();
  const call = httpsCallable<
    { conversationId: string; messageId: string },
    { status: "hidden" | "alreadyHidden" }
  >(functions, "hidePrivateTeamMessageForCurrentUser");
  return (await call({ conversationId, messageId })).data;
}

export async function getVoiceMemoDownloadUrl(input: {
  messageId: string;
  messageKind: "announcement" | "privateMessage";
  storagePath: string;
}) {
  const call = httpsCallable<typeof input, { url: string; expiresAtMillis: number }>(
    functions,
    "getTeamVoiceMemoDownloadUrl",
  );
  const result = await call(input);
  return normalizeVoicePlaybackUrlResponse(result.data, { allowLocalHttp: __DEV__ });
}

export function createClientMessageId() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function normalizeConversation(id: string, data: Record<string, unknown>): TeamPrivateConversation {
  return {
    conversationId: id,
    teamId: readString(data.teamId),
    coachUserId: readString(data.coachUserId),
    parentUserId: readString(data.parentUserId),
    teamName: readString(data.teamName),
    coachDisplayName: readString(data.coachDisplayName),
    parentDisplayName: readString(data.parentDisplayName),
    status: data.status === "readOnly" ? "readOnly" : "active",
    lastMessageAtMillis: readMillis(data.lastMessageAt),
    lastMessageType: data.lastMessageType === "voice"
      ? "voice"
      : data.lastMessageType === "text"
        ? "text"
        : data.lastMessageType === "deleted"
          ? "deleted"
          : null,
    lastMessagePreview: typeof data.lastMessagePreview === "string" ? data.lastMessagePreview : null,
    lastSenderUserId: typeof data.lastSenderUserId === "string" ? data.lastSenderUserId : null,
    unreadCount: 0,
  };
}

async function hydrateConversationNames(conversations: TeamPrivateConversation[]) {
  const userIds = Array.from(new Set(conversations.flatMap((conversation) => [
    conversation.coachUserId,
    conversation.parentUserId,
  ]).filter(Boolean)));
  if (userIds.length === 0) return conversations;
  const profiles = new Map((await getPublicUserProfiles(userIds)).map((profile) => [profile.userId, profile]));
  return conversations.map((conversation) => {
    const coach = profiles.get(conversation.coachUserId);
    const parent = profiles.get(conversation.parentUserId);
    return {
      ...conversation,
      coachDisplayName: coach?.displayName ?? (coach ? "" : conversation.coachDisplayName),
      parentDisplayName: parent?.displayName ?? (parent ? "" : conversation.parentDisplayName),
      coachProfileState: coach?.profileState,
      parentProfileState: parent?.profileState,
    };
  });
}

function normalizeMessage(id: string, data: Record<string, unknown>): TeamPrivateMessage {
  const voice = normalizeVoiceMessageFields(data);
  const isModerated = data.moderationState === "hidden" ||
    data.moderationState === "removed";
  return {
    id,
    conversationId: readString(data.conversationId),
    teamId: readString(data.teamId),
    senderUserId: voice.senderUserId,
    senderRole: data.senderRole === "coach" ? "coach" : "parent",
    contentType: voice.contentType,
    text: isModerated ? null : typeof data.text === "string" ? data.text : null,
    caption: isModerated ? null : voice.caption,
    voiceMemo: isModerated ? null : voice.voiceMemo,
    isDeleted: data.isDeleted === true || isModerated,
    isModerated,
    deletedBy: typeof data.deletedBy === "string" ? data.deletedBy : null,
    deletedAt: data.deletedAt,
    createdAt: data.createdAt,
  };
}

function requireUser() {
  if (!auth.currentUser) throw new Error("Sign in to use Private Messages.");
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readMillis(value: unknown) {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") return value.toMillis();
  return 0;
}

function cursorForMessage(message: TeamPrivateMessage | undefined): TeamHistoryCursor | null {
  if (!message) return null;
  const timestampMillis = readMillis(message.createdAt);
  return timestampMillis > 0 ? { id: message.id, timestampMillis } : null;
}

function chunkIds(ids: string[]) {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += 30) chunks.push(ids.slice(index, index + 30));
  return chunks;
}

async function getHiddenMessageIds(conversationId: string, userId: string, messageIds: string[]) {
  const snapshots = await Promise.all(chunkIds(messageIds).map((ids) => getDocs(query(
    collection(db, "teamPrivateConversations", conversationId, "members", userId, "hiddenMessages"),
    where(documentId(), "in", ids),
  ))));
  return new Set(snapshots.flatMap((snapshot) => snapshot.docs.map((item) => item.id)));
}
