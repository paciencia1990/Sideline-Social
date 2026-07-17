import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytesResumable, type UploadTask } from "firebase/storage";

import { auth, db, functions, storage } from "@/config/firebase";
import type {
  LocalVoiceMemoDraft,
  StoredVoiceMemo,
  TeamPrivateConversation,
  TeamPrivateMessage,
  VoiceUploadReservation,
} from "@/types/teamVoiceMessaging";

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
  offset = 0,
  pageSize = 25,
) {
  requireUser();
  const call = httpsCallable<
    { role: "coach" | "parent"; teamId?: string; offset: number; pageSize: number },
    { conversations: TeamPrivateConversation[]; hasMore: boolean; nextOffset: number }
  >(functions, "getTeamPrivateMessageInbox");
  return (await call({ role, ...(teamId ? { teamId } : {}), offset, pageSize })).data;
}

export async function getTeamPrivateMessageInbox(role: "coach" | "parent", teamId?: string) {
  return (await getTeamPrivateMessageInboxPage(role, teamId, 0, 50)).conversations;
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
  return onSnapshot(doc(db, "teamPrivateConversations", conversationId), (snapshot) => {
    onValue(snapshot.exists() ? normalizeConversation(snapshot.id, snapshot.data()) : null);
  }, (error) => onError?.(error));
}

export function listenToPrivateTeamMessages(
  conversationId: string,
  onValue: (messages: TeamPrivateMessage[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, "teamPrivateConversations", conversationId, "messages"), orderBy("createdAt", "asc")),
    (snapshot) => onValue(snapshot.docs.map((message) => normalizeMessage(message.id, message.data()))),
    (error) => onError?.(error),
  );
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
  const blob = await (await fetch(draft.uri)).blob();
  const task = uploadBytesResumable(ref(storage, reservation.storagePath), blob, {
    contentType: draft.mimeType,
  });
  const completion = new Promise<void>((resolve, reject) => {
    task.on("state_changed", (snapshot) => {
      onProgress?.(snapshot.totalBytes ? snapshot.bytesTransferred / snapshot.totalBytes : 0);
    }, reject, resolve);
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

export async function getVoiceMemoDownloadUrl(storagePath: string) {
  const call = httpsCallable<{ storagePath: string }, { url: string; expiresAtMillis: number }>(
    functions,
    "getTeamVoiceMemoDownloadUrl",
  );
  return (await call({ storagePath })).data;
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
    coachDisplayName: readString(data.coachDisplayName, "Coach"),
    parentDisplayName: readString(data.parentDisplayName, "Team Parent"),
    status: data.status === "readOnly" ? "readOnly" : "active",
    lastMessageAtMillis: readMillis(data.lastMessageAt),
    lastMessageType: data.lastMessageType === "voice" ? "voice" : data.lastMessageType === "text" ? "text" : null,
    lastMessagePreview: typeof data.lastMessagePreview === "string" ? data.lastMessagePreview : null,
    lastSenderUserId: typeof data.lastSenderUserId === "string" ? data.lastSenderUserId : null,
    unreadCount: 0,
  };
}

function normalizeMessage(id: string, data: Record<string, unknown>): TeamPrivateMessage {
  const voice = data.voiceMemo && typeof data.voiceMemo === "object" ? data.voiceMemo as Record<string, unknown> : null;
  return {
    id,
    conversationId: readString(data.conversationId),
    teamId: readString(data.teamId),
    senderUserId: readString(data.senderUserId),
    senderRole: data.senderRole === "coach" ? "coach" : "parent",
    contentType: data.contentType === "voice" ? "voice" : "text",
    text: typeof data.text === "string" ? data.text : null,
    caption: typeof data.caption === "string" ? data.caption : null,
    voiceMemo: voice ? {
      storagePath: readString(voice.storagePath),
      durationMilliseconds: Number(voice.durationMilliseconds ?? 0),
      sizeBytes: Number(voice.sizeBytes ?? 0),
      mimeType: readMimeType(voice.mimeType),
    } satisfies StoredVoiceMemo : null,
    createdAt: data.createdAt,
  };
}

function requireUser() {
  if (!auth.currentUser) throw new Error("Sign in to use Team Messages.");
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readMillis(value: unknown) {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") return value.toMillis();
  return 0;
}

function readMimeType(value: unknown): StoredVoiceMemo["mimeType"] {
  return value === "audio/m4a" || value === "audio/x-m4a" ? value : "audio/mp4";
}
