import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { auth, db } from "@/config/firebase";

export type FriendRequestStatus = "pending" | "accepted" | "declined";

export interface FriendProfile {
  id: string;
  displayName: string;
  email: string | null;
  photoURL: string | null;
  friendIds: string[];
}

export interface FriendRequest {
  id: string;
  fromUserId: string;
  fromDisplayName: string;
  toUserId: string;
  toDisplayName: string;
  status: FriendRequestStatus;
}

const USERS_COLLECTION = "users";
const REQUESTS_COLLECTION = "friendRequests";
const SEARCH_LIMIT = 20;

function requireCurrentUserId(): string {
  const userId = auth.currentUser?.uid;
  if (!userId) {
    throw new Error("You need to sign in to manage friends.");
  }
  return userId;
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

function docToProfile(userDoc: QueryDocumentSnapshot<DocumentData> | { id: string; data: () => DocumentData | undefined }): FriendProfile {
  const data = userDoc.data();
  const friendIds = Array.isArray(data?.friendIds)
    ? data.friendIds.filter((id): id is string => typeof id === "string")
    : [];

  return {
    id: userDoc.id,
    displayName: fallbackName(data, userDoc.id),
    email: typeof data?.email === "string" ? data.email : null,
    photoURL: typeof data?.photoURL === "string" ? data.photoURL : null,
    friendIds,
  };
}

function docToRequest(requestDoc: QueryDocumentSnapshot<DocumentData>): FriendRequest {
  const data = requestDoc.data();

  return {
    id: requestDoc.id,
    fromUserId: typeof data.fromUserId === "string" ? data.fromUserId : "",
    fromDisplayName: typeof data.fromDisplayName === "string" ? data.fromDisplayName : "Sideline Parent",
    toUserId: typeof data.toUserId === "string" ? data.toUserId : "",
    toDisplayName: typeof data.toDisplayName === "string" ? data.toDisplayName : "Sideline Parent",
    status: data.status === "accepted" || data.status === "declined" ? data.status : "pending",
  };
}

function requestIdFor(fromUserId: string, toUserId: string): string {
  return `${fromUserId}__${toUserId}`;
}

function filterSearchResults(
  profiles: FriendProfile[],
  currentUserId: string,
  currentFriendIds: Set<string>,
  normalized: string
): FriendProfile[] {
  return profiles
    .filter((profile) => profile.id !== currentUserId)
    .filter((profile) => !currentFriendIds.has(profile.id))
    .filter((profile) => {
      if (!normalized) return true;
      return `${profile.displayName} ${profile.email ?? ""}`.toLowerCase().includes(normalized);
    });
}

async function getUserProfile(userId: string): Promise<FriendProfile | null> {
  const userDoc = await getDoc(doc(db, USERS_COLLECTION, userId));
  if (!userDoc.exists()) return null;
  return docToProfile({ id: userDoc.id, data: () => userDoc.data() });
}

async function getPendingRequestBetween(userA: string, userB: string): Promise<FriendRequest | null> {
  const outgoingId = requestIdFor(userA, userB);
  const incomingId = requestIdFor(userB, userA);
  const [outgoingDoc, incomingDoc] = await Promise.all([
    getDoc(doc(db, REQUESTS_COLLECTION, outgoingId)),
    getDoc(doc(db, REQUESTS_COLLECTION, incomingId)),
  ]);

  const outgoingData = outgoingDoc.data();
  if (outgoingDoc.exists() && outgoingData?.status === "pending") {
    return {
      id: outgoingDoc.id,
      fromUserId: (outgoingData.fromUserId as string) ?? userA,
      fromDisplayName: (outgoingData.fromDisplayName as string) ?? "Sideline Parent",
      toUserId: (outgoingData.toUserId as string) ?? userB,
      toDisplayName: (outgoingData.toDisplayName as string) ?? "Sideline Parent",
      status: "pending",
    };
  }

  const incomingData = incomingDoc.data();
  if (incomingDoc.exists() && incomingData?.status === "pending") {
    return {
      id: incomingDoc.id,
      fromUserId: (incomingData.fromUserId as string) ?? userB,
      fromDisplayName: (incomingData.fromDisplayName as string) ?? "Sideline Parent",
      toUserId: (incomingData.toUserId as string) ?? userA,
      toDisplayName: (incomingData.toDisplayName as string) ?? "Sideline Parent",
      status: "pending",
    };
  }

  return null;
}

export async function getCurrentUserProfile(): Promise<FriendProfile | null> {
  const userId = auth.currentUser?.uid;
  if (!userId) return null;
  return getUserProfile(userId);
}

export async function searchUsers(queryText: string): Promise<FriendProfile[]> {
  const currentUserId = auth.currentUser?.uid;
  if (!currentUserId) return [];

  const normalized = queryText.trim().toLowerCase();
  const currentUser = await getUserProfile(currentUserId);
  const currentFriendIds = new Set(currentUser?.friendIds ?? []);

  try {
    const usersRef = collection(db, USERS_COLLECTION);
    const usersQuery = normalized
      ? query(
          usersRef,
          where("searchName", ">=", normalized),
          where("searchName", "<=", `${normalized}\uf8ff`),
          limit(SEARCH_LIMIT)
        )
      : query(usersRef, orderBy("createdAt", "desc"), limit(SEARCH_LIMIT));

    const snapshot = await getDocs(usersQuery);
    const primaryResults = filterSearchResults(
      snapshot.docs.map(docToProfile),
      currentUserId,
      currentFriendIds,
      normalized
    );

    if (primaryResults.length > 0 || !normalized) {
      return primaryResults;
    }
  } catch (error) {
    console.warn("[FriendsService] searchUsers primary query error:", error);
  }

  try {
    const snapshot = await getDocs(query(collection(db, USERS_COLLECTION), limit(SEARCH_LIMIT)));
    return filterSearchResults(
      snapshot.docs.map(docToProfile),
      currentUserId,
      currentFriendIds,
      normalized
    );
  } catch (fallbackError) {
    console.warn("[FriendsService] searchUsers fallback query error:", fallbackError);
    return [];
  }
}

export async function getFriends(userId: string): Promise<FriendProfile[]> {
  try {
    const profile = await getUserProfile(userId);
    const friendIds = profile?.friendIds ?? [];
    if (friendIds.length === 0) return [];

    const friendDocs = await Promise.all(friendIds.map((friendId) => getDoc(doc(db, USERS_COLLECTION, friendId))));

    return friendDocs.flatMap((friendDoc) => {
      if (!friendDoc.exists()) return [];
      return [docToProfile({ id: friendDoc.id, data: () => friendDoc.data() })];
    });
  } catch (error) {
    console.warn("[FriendsService] getFriends error:", error);
    return [];
  }
}

export async function getIncomingFriendRequests(userId: string): Promise<FriendRequest[]> {
  try {
    const snapshot = await getDocs(
      query(
        collection(db, REQUESTS_COLLECTION),
        where("toUserId", "==", userId),
        where("status", "==", "pending")
      )
    );

    return snapshot.docs.map(docToRequest).filter((request) => request.fromUserId && request.toUserId);
  } catch (error) {
    console.warn("[FriendsService] getIncomingFriendRequests error:", error);
    return [];
  }
}

export async function getOutgoingFriendRequests(userId: string): Promise<FriendRequest[]> {
  try {
    const snapshot = await getDocs(
      query(
        collection(db, REQUESTS_COLLECTION),
        where("fromUserId", "==", userId),
        where("status", "==", "pending")
      )
    );

    return snapshot.docs.map(docToRequest).filter((request) => request.fromUserId && request.toUserId);
  } catch (error) {
    console.warn("[FriendsService] getOutgoingFriendRequests error:", error);
    return [];
  }
}

export async function sendFriendRequest(toUserId: string): Promise<void> {
  const fromUserId = requireCurrentUserId();
  if (fromUserId === toUserId) {
    throw new Error("You cannot send a friend request to yourself.");
  }

  const [fromProfile, toProfile] = await Promise.all([
    getUserProfile(fromUserId),
    getUserProfile(toUserId),
  ]);

  if (!toProfile) {
    throw new Error("That user could not be found.");
  }

  if (fromProfile?.friendIds.includes(toUserId) || toProfile.friendIds.includes(fromUserId)) {
    throw new Error("You are already friends.");
  }

  const existingRequest = await getPendingRequestBetween(fromUserId, toUserId);
  if (existingRequest) {
    throw new Error("A friend request is already pending.");
  }

  await setDoc(doc(db, REQUESTS_COLLECTION, requestIdFor(fromUserId, toUserId)), {
    fromUserId,
    fromDisplayName: fromProfile?.displayName ?? auth.currentUser?.displayName ?? "Sideline Parent",
    toUserId,
    toDisplayName: toProfile.displayName,
    status: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function acceptFriendRequest(requestId: string): Promise<void> {
  const currentUserId = requireCurrentUserId();
  const requestRef = doc(db, REQUESTS_COLLECTION, requestId);
  const requestDoc = await getDoc(requestRef);

  if (!requestDoc.exists()) {
    throw new Error("This request is no longer available.");
  }

  const request = requestDoc.data();
  if (request.toUserId !== currentUserId) {
    throw new Error("You can only accept requests sent to you.");
  }

  if (request.status !== "pending") {
    throw new Error("This request has already been handled.");
  }

  const fromUserId = request.fromUserId as string;
  const batch = writeBatch(db);
  batch.update(requestRef, {
    status: "accepted",
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, USERS_COLLECTION, currentUserId), { friendIds: arrayUnion(fromUserId) }, { merge: true });
  batch.set(doc(db, USERS_COLLECTION, fromUserId), { friendIds: arrayUnion(currentUserId) }, { merge: true });
  await batch.commit();
}

export async function declineFriendRequest(requestId: string): Promise<void> {
  const currentUserId = requireCurrentUserId();
  const requestRef = doc(db, REQUESTS_COLLECTION, requestId);
  const requestDoc = await getDoc(requestRef);
  const request = requestDoc.data();

  if (!requestDoc.exists() || request?.toUserId !== currentUserId || request.status !== "pending") {
    return;
  }

  await updateDoc(requestRef, {
    status: "declined",
    updatedAt: serverTimestamp(),
  });
}

export async function removeFriend(friendUserId: string): Promise<void> {
  const currentUserId = requireCurrentUserId();
  if (currentUserId === friendUserId) return;

  const batch = writeBatch(db);
  batch.set(doc(db, USERS_COLLECTION, currentUserId), { friendIds: arrayRemove(friendUserId) }, { merge: true });
  batch.set(doc(db, USERS_COLLECTION, friendUserId), { friendIds: arrayRemove(currentUserId) }, { merge: true });

  const outgoingRequestId = requestIdFor(currentUserId, friendUserId);
  const incomingRequestId = requestIdFor(friendUserId, currentUserId);
  batch.delete(doc(db, REQUESTS_COLLECTION, outgoingRequestId));
  batch.delete(doc(db, REQUESTS_COLLECTION, incomingRequestId));

  await batch.commit();
}

export async function deleteDeclinedFriendRequest(requestId: string): Promise<void> {
  await deleteDoc(doc(db, REQUESTS_COLLECTION, requestId));
}
