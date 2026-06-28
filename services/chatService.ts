import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";

import { auth, db } from "@/config/firebase";

export type ChatType = "direct" | "squad";

export interface ChatSummary {
  chatId: string;
  type: ChatType;
  participantIds: string[];
  participantNames: Record<string, string>;
  squadId: string | null;
  title: string | null;
  lastMessageText: string;
  lastMessageAt: Date | null;
  lastMessageSenderId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface ChatMessage {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  createdAt: Date | null;
  system: boolean;
}

type FirestoreDate = Date | number | Timestamp | { toDate?: () => Date; toMillis?: () => number } | null | undefined;

const CHATS_COLLECTION = "chats";
const USERS_COLLECTION = "users";
const MESSAGE_LIMIT = 100;

function requireCurrentUserId(): string {
  const userId = auth.currentUser?.uid;
  if (!userId) {
    throw new Error("You need to sign in to use chat.");
  }
  return userId;
}

function toDate(value: FirestoreDate): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.toMillis === "function") return new Date(value.toMillis());
  return null;
}

function directChatIdFor(userA: string, userB: string): string {
  return `direct_${[userA, userB].sort().join("_")}`;
}

function squadChatIdFor(squadId: string): string {
  return `squad_${squadId}`;
}

function fallbackName(data: DocumentData | undefined, fallbackId: string): string {
  const displayName = data?.displayName;
  if (typeof displayName === "string" && displayName.trim()) return displayName.trim();

  const firstName = typeof data?.firstName === "string" ? data.firstName : "";
  const lastName = typeof data?.lastName === "string" ? data.lastName : "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;

  const email = data?.email;
  if (typeof email === "string" && email.trim()) return email.trim();

  return `Sideline Parent ${fallbackId.slice(0, 4)}`;
}

async function getUserDisplayName(userId: string, providedName?: string): Promise<string> {
  if (providedName?.trim()) return providedName.trim();
  if (auth.currentUser?.uid === userId && auth.currentUser.displayName) return auth.currentUser.displayName;

  try {
    const userDoc = await getDoc(doc(db, USERS_COLLECTION, userId));
    return userDoc.exists() ? fallbackName(userDoc.data(), userId) : `Sideline Parent ${userId.slice(0, 4)}`;
  } catch (error) {
    console.warn("[ChatService] getUserDisplayName error:", error);
    return `Sideline Parent ${userId.slice(0, 4)}`;
  }
}

function docToChat(chatDoc: QueryDocumentSnapshot<DocumentData> | { id: string; data: () => DocumentData | undefined }): ChatSummary {
  const data = chatDoc.data() ?? {};
  const participantIds = Array.isArray(data.participantIds)
    ? data.participantIds.filter((id): id is string => typeof id === "string")
    : [];
  const participantNames = typeof data.participantNames === "object" && data.participantNames
    ? (data.participantNames as Record<string, string>)
    : {};

  return {
    chatId: chatDoc.id,
    type: data.type === "squad" ? "squad" : "direct",
    participantIds,
    participantNames,
    squadId: typeof data.squadId === "string" ? data.squadId : null,
    title: typeof data.title === "string" ? data.title : null,
    lastMessageText: typeof data.lastMessageText === "string" ? data.lastMessageText : "",
    lastMessageAt: toDate(data.lastMessageAt as FirestoreDate),
    lastMessageSenderId: typeof data.lastMessageSenderId === "string" ? data.lastMessageSenderId : null,
    createdAt: toDate(data.createdAt as FirestoreDate),
    updatedAt: toDate(data.updatedAt as FirestoreDate),
  };
}

function docToMessage(messageDoc: QueryDocumentSnapshot<DocumentData>): ChatMessage {
  const data = messageDoc.data();

  return {
    id: messageDoc.id,
    text: typeof data.text === "string" ? data.text : "",
    senderId: typeof data.senderId === "string" ? data.senderId : "",
    senderName: typeof data.senderName === "string" ? data.senderName : "Sideline Parent",
    createdAt: toDate(data.createdAt as FirestoreDate),
    system: data.system === true,
  };
}

export function getChatDisplayTitle(chat: ChatSummary, currentUserId: string): string {
  if (chat.title?.trim()) return chat.title.trim();
  if (chat.type === "squad") return "Squad Chat";

  const otherUserId = chat.participantIds.find((participantId) => participantId !== currentUserId);
  if (!otherUserId) return "Direct Message";

  return chat.participantNames[otherUserId] || `Sideline Parent ${otherUserId.slice(0, 4)}`;
}

export async function getOrCreateDirectChat(otherUserId: string, otherUserName?: string): Promise<string> {
  const currentUserId = requireCurrentUserId();
  if (currentUserId === otherUserId) {
    throw new Error("You cannot start a chat with yourself.");
  }

  const chatId = directChatIdFor(currentUserId, otherUserId);
  const chatRef = doc(db, CHATS_COLLECTION, chatId);
  const existingChat = await getDoc(chatRef);
  if (existingChat.exists()) return chatId;

  const [currentUserName, resolvedOtherName] = await Promise.all([
    getUserDisplayName(currentUserId),
    getUserDisplayName(otherUserId, otherUserName),
  ]);

  await setDoc(chatRef, {
    type: "direct",
    participantIds: [currentUserId, otherUserId].sort(),
    participantNames: {
      [currentUserId]: currentUserName,
      [otherUserId]: resolvedOtherName,
    },
    squadId: null,
    title: null,
    lastMessageText: "",
    lastMessageAt: null,
    lastMessageSenderId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return chatId;
}

export async function getOrCreateSquadChat(
  squadId: string,
  squadName?: string,
  participantIds: string[] = []
): Promise<string> {
  const currentUserId = requireCurrentUserId();
  const chatId = squadChatIdFor(squadId);
  const chatRef = doc(db, CHATS_COLLECTION, chatId);
  const existingChat = await getDoc(chatRef);
  if (existingChat.exists()) return chatId;

  const uniqueParticipantIds = Array.from(new Set([currentUserId, ...participantIds].filter(Boolean)));
  const currentUserName = await getUserDisplayName(currentUserId);

  await setDoc(chatRef, {
    type: "squad",
    participantIds: uniqueParticipantIds,
    participantNames: { [currentUserId]: currentUserName },
    squadId,
    title: squadName?.trim() ? `${squadName.trim()} Chat` : "Squad Chat",
    lastMessageText: "",
    lastMessageAt: null,
    lastMessageSenderId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return chatId;
}

export function listenToUserChats(
  userId: string,
  callback: (chats: ChatSummary[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const chatsQuery = query(collection(db, CHATS_COLLECTION), where("participantIds", "array-contains", userId));

  return onSnapshot(
    chatsQuery,
    (snapshot) => {
      const chats = snapshot.docs
        .map(docToChat)
        .sort((a, b) => (b.lastMessageAt?.getTime() ?? b.updatedAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? a.updatedAt?.getTime() ?? 0));
      callback(chats);
    },
    (error) => {
      console.warn("[ChatService] listenToUserChats error:", error);
      onError?.(error);
    }
  );
}

export function listenToChatMessages(
  chatId: string,
  callback: (messages: ChatMessage[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const messagesQuery = query(
    collection(db, CHATS_COLLECTION, chatId, "messages"),
    orderBy("createdAt", "asc"),
    limit(MESSAGE_LIMIT)
  );

  return onSnapshot(
    messagesQuery,
    (snapshot) => callback(snapshot.docs.map(docToMessage)),
    (error) => {
      console.warn("[ChatService] listenToChatMessages error:", error);
      onError?.(error);
    }
  );
}

export async function getChatById(chatId: string): Promise<ChatSummary | null> {
  try {
    const chatDoc = await getDoc(doc(db, CHATS_COLLECTION, chatId));
    if (!chatDoc.exists()) return null;
    return docToChat({ id: chatDoc.id, data: () => chatDoc.data() });
  } catch (error) {
    console.warn("[ChatService] getChatById error:", error);
    return null;
  }
}

export async function sendMessage(chatId: string, text: string): Promise<void> {
  const senderId = requireCurrentUserId();
  const trimmedText = text.trim();
  if (!trimmedText) return;

  const chatRef = doc(db, CHATS_COLLECTION, chatId);
  const chatDoc = await getDoc(chatRef);
  if (!chatDoc.exists()) {
    throw new Error("This chat is no longer available.");
  }

  const chat = docToChat({ id: chatDoc.id, data: () => chatDoc.data() });
  if (!chat.participantIds.includes(senderId)) {
    throw new Error("You do not have access to this chat.");
  }

  const senderName = chat.participantNames[senderId] || await getUserDisplayName(senderId);
  const messageRef = doc(collection(db, CHATS_COLLECTION, chatId, "messages"));
  const batch = writeBatch(db);

  batch.set(messageRef, {
    text: trimmedText,
    senderId,
    senderName,
    createdAt: serverTimestamp(),
    system: false,
  });
  batch.set(chatRef, {
    lastMessageText: trimmedText,
    lastMessageAt: serverTimestamp(),
    lastMessageSenderId: senderId,
    updatedAt: serverTimestamp(),
    participantNames: {
      ...chat.participantNames,
      [senderId]: senderName,
    },
  }, { merge: true });

  await batch.commit();
}

export async function markChatRead(chatId: string): Promise<void> {
  const userId = auth.currentUser?.uid;
  if (!userId) return;

  await setDoc(doc(db, CHATS_COLLECTION, chatId, "reads", userId), {
    userId,
    readAt: serverTimestamp(),
  }, { merge: true });
}
