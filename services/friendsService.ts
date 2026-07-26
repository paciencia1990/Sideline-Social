import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  Timestamp,
  where,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { auth, db, functions } from "@/config/firebase";
import {
  getPublicUserProfiles,
  getSuggestedConnections,
  searchPublicUserProfiles,
  type PublicUserSearchRelationship,
  type SuggestedConnection,
} from "@/services/publicProfileService";
import {
  deduplicateFriendUserIds,
  getIncomingRequestSenderId,
  getOutgoingRequestRecipientId,
  hydrateFriendRequestProfiles,
  inspectPublicUserProfiles,
  type PublicFriendProfileRecord,
  type PublicProfileInspectionCounts,
} from "@/utils/friendRequestMapping";
import { formatFullPublicName, formatPublicUserName, getSafeProfileName } from "@/utils/friendPrivacy";
import { getPersistedDisplayName } from "@/utils/profileName";

export type FriendRequestStatus = "pending" | "accepted" | "declined" | "canceled" | "expired";
export type SendFriendRequestStatus = "pending" | "alreadyPending" | "reversePending" | "alreadyFriends";
export type RequestProfileState = "loading" | "resolved" | "unresolved" | "deleted";

export type SendFriendRequestResult = {
  requestId: string;
  status: SendFriendRequestStatus;
};

export interface FriendProfile {
  id: string;
  displayName: string;
  photoURL: string | null;
  hasValidPublicIdentity?: boolean;
  profileState?: PublicFriendProfileRecord["profileState"];
}

export type SuggestedFriendProfile = FriendProfile & Pick<
  SuggestedConnection,
  "sharedSquadName" | "sharedActivity" | "mutualConnectionCount"
>;

export type FriendSearchResult = FriendProfile & {
  firstName: string | null;
  lastName: string | null;
  relationship: PublicUserSearchRelationship;
};

type PrivateFriendProfile = FriendProfile & { friendIds: string[] };

export interface FriendRequest {
  id: string;
  fromUserId: string;
  fromDisplayName: string;
  fromPhotoURL: string | null;
  senderDisplayName: string | null;
  senderPhotoURL: string | null;
  senderNameResolved: boolean;
  senderProfileState: RequestProfileState;
  toUserId: string;
  toDisplayName: string;
  toPhotoURL: string | null;
  recipientDisplayName: string | null;
  recipientPhotoURL: string | null;
  recipientNameResolved: boolean;
  recipientProfileState: RequestProfileState;
  status: FriendRequestStatus;
  createdAt: Date;
  expiresAt: Date;
}

export type HydratedIncomingFriendRequest = FriendRequest & {
  senderDisplayName: string | null;
  senderNameResolved: boolean;
};

export type IncomingProfileMappingDiagnostics = PublicProfileInspectionCounts & {
  incomingRequestCount: number;
  incomingWithFromUserIdCount: number;
  requestedIdCount: number;
  returnedWithValidDisplayNameCount: number;
  incomingIdMatchedProfileCount: number;
  incomingIdMatchedNullNameCount: number;
  incomingIdNotMatchedCount: number;
  hydratedSenderNameCount: number;
  renderedSenderNameCount: number;
};

export type FriendRequestGroups = {
  incoming: HydratedIncomingFriendRequest[];
  outgoing: FriendRequest[];
  mappingDiagnostics: IncomingProfileMappingDiagnostics;
};

const USERS_COLLECTION = "users";
const REQUESTS_COLLECTION = "friendRequests";

function requireCurrentUserId(): string {
  const userId = auth.currentUser?.uid;
  if (!userId) {
    throw new Error("You need to sign in to manage friends.");
  }
  return userId;
}

function fallbackName(data: DocumentData | undefined): string {
  return getSafeProfileName(getPersistedDisplayName(data), "Sideline Social member");
}

function docToPrivateProfile(userDoc: { id: string; data: () => DocumentData | undefined }): PrivateFriendProfile {
  const data = userDoc.data();
  const friendIds = Array.isArray(data?.friendIds)
    ? data.friendIds.filter((id): id is string => typeof id === "string")
    : [];

  return {
    id: userDoc.id,
    displayName: fallbackName(data),
    photoURL: typeof data?.photoURL === "string" ? data.photoURL : null,
    hasValidPublicIdentity: Boolean(formatFullPublicName(getPersistedDisplayName(data))),
    friendIds,
  };
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function"
    ? value.toDate()
    : new Date(0);
}

function dataToRequest(value: unknown): FriendRequest | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const id = typeof data.id === "string" ? data.id : "";
  const fromUserId = typeof data.fromUserId === "string" ? data.fromUserId : "";
  const toUserId = typeof data.toUserId === "string" ? data.toUserId : "";
  if (!id || !fromUserId || !toUserId) return null;
  const status: FriendRequestStatus = ["accepted", "declined", "canceled", "expired"].includes(String(data.status))
    ? data.status as FriendRequestStatus
    : "pending";

  return {
    id,
    fromUserId,
    fromDisplayName: formatPublicUserName(
      typeof data.fromDisplayName === "string" ? data.fromDisplayName : null,
    ) ?? "",
    fromPhotoURL: typeof data.fromPhotoURL === "string" ? data.fromPhotoURL : null,
    senderDisplayName: null,
    senderPhotoURL: null,
    senderNameResolved: false,
    senderProfileState: "loading",
    toUserId,
    toDisplayName: formatPublicUserName(
      typeof data.toDisplayName === "string" ? data.toDisplayName : null,
    ) ?? "",
    toPhotoURL: typeof data.toPhotoURL === "string" ? data.toPhotoURL : null,
    recipientDisplayName: null,
    recipientPhotoURL: null,
    recipientNameResolved: false,
    recipientProfileState: "loading",
    status,
    createdAt: toDate(data.createdAt),
    expiresAt: toDate(data.expiresAt),
  };
}

async function getPrivateUserProfile(userId: string): Promise<PrivateFriendProfile | null> {
  const userDoc = await getDoc(doc(db, USERS_COLLECTION, userId));
  if (!userDoc.exists()) return null;
  return docToPrivateProfile({ id: userDoc.id, data: () => userDoc.data() });
}

export async function getCurrentUserProfile(): Promise<FriendProfile | null> {
  const userId = auth.currentUser?.uid;
  if (!userId) return null;
  const profile = await getPrivateUserProfile(userId);
  if (!profile) return null;
  return { id: profile.id, displayName: profile.displayName, photoURL: profile.photoURL };
}

export async function searchUsers(queryText: string): Promise<SuggestedFriendProfile[]> {
  if (!auth.currentUser?.uid) return [];
  try {
    const suggestions = await getSuggestedConnections(queryText);
    return suggestions.map((profile) => ({
      id: profile.userId,
      displayName: formatPublicUserName(profile.displayName) ?? "",
      photoURL: profile.photoURL,
      profileState: profile.profileState,
      sharedSquadName: profile.sharedSquadName,
      sharedActivity: profile.sharedActivity,
      mutualConnectionCount: profile.mutualConnectionCount,
    }));
  } catch (error) {
    logFriendsIssue("searchUsers", error);
    throw error;
  }
}

export async function searchParentsByName(queryText: string): Promise<FriendSearchResult[]> {
  if (!auth.currentUser?.uid) return [];
  const results = await searchPublicUserProfiles(queryText);
  return results.map((profile) => ({
    id: profile.userId,
    firstName: profile.firstName ?? null,
    lastName: profile.lastName ?? null,
    displayName: formatPublicUserName(profile.displayName) ?? "",
    photoURL: profile.photoURL ?? null,
    profileState: profile.profileState,
    relationship: profile.relationship,
  }));
}

export async function getFriends(userId: string): Promise<FriendProfile[]> {
  try {
    if (auth.currentUser?.uid !== userId) return [];
    const profile = await getPrivateUserProfile(userId);
    const friendIds = profile?.friendIds ?? [];
    if (friendIds.length === 0) return [];
    const publicProfiles = await getPublicUserProfiles(friendIds);
    return publicProfiles.map((friendProfile) => ({
      id: friendProfile.userId,
      displayName: formatPublicUserName(friendProfile.displayName) ?? "",
      photoURL: friendProfile.photoURL ?? null,
      profileState: friendProfile.profileState,
    }));
  } catch (error) {
    logFriendsIssue("getFriends", error);
    return [];
  }
}

export async function getFriendRequestGroups(userId: string): Promise<FriendRequestGroups> {
  try {
    if (auth.currentUser?.uid !== userId) return emptyFriendRequestGroups();
    const loadRequests = httpsCallable<Record<string, never>, { incoming: unknown; outgoing: unknown }>(
      functions,
      "getActiveFriendRequests",
    );
    const response = await loadRequests({});
    const incoming = (Array.isArray(response.data.incoming) ? response.data.incoming : [])
      .map(dataToRequest)
      .filter((request): request is FriendRequest => Boolean(request));
    const outgoing = (Array.isArray(response.data.outgoing) ? response.data.outgoing : [])
      .map(dataToRequest)
      .filter((request): request is FriendRequest => Boolean(request));
    const senderUserIds = incoming.map(getIncomingRequestSenderId);
    const requestProfileUserIds = deduplicateFriendUserIds([
      ...senderUserIds,
      ...outgoing.map(getOutgoingRequestRecipientId),
    ]);

    logIncomingProfileHydration("start", {
      requestCount: incoming.length,
      senderCount: senderUserIds.filter(Boolean).length,
      returnedCount: 0,
      unresolvedCount: incoming.length,
      hydrationCompleted: false,
    });

    try {
      const publicProfiles = requestProfileUserIds.length > 0
        ? await loadPublicProfilesWithRetry(requestProfileUserIds)
        : [];
      const inspectedProfiles = inspectPublicUserProfiles(publicProfiles);
      const hydrated = hydrateFriendRequestGroups(
        incoming,
        outgoing,
        inspectedProfiles.profilesByUserId,
      );
      const mappingDiagnostics = buildIncomingProfileMappingDiagnostics({
        incoming,
        requestedProfileUserIds: requestProfileUserIds,
        inspectedProfiles,
        hydratedIncoming: hydrated.incoming,
      });
      const unresolvedCount = hydrated.incoming.filter(
        (request) => request.senderProfileState === "unresolved",
      ).length;
      logIncomingProfileHydration("success", {
        requestCount: incoming.length,
        senderCount: senderUserIds.filter(Boolean).length,
        returnedCount: inspectedProfiles.counts.returnedProfileCount,
        unresolvedCount,
        hydrationCompleted: true,
      });
      return { ...hydrated, mappingDiagnostics };
    } catch (error) {
      const inspectedProfiles = inspectPublicUserProfiles([]);
      const hydrated = hydrateFriendRequestGroups(incoming, outgoing, inspectedProfiles.profilesByUserId);
      const mappingDiagnostics = buildIncomingProfileMappingDiagnostics({
        incoming,
        requestedProfileUserIds: requestProfileUserIds,
        inspectedProfiles,
        hydratedIncoming: hydrated.incoming,
      });
      logIncomingProfileHydration("failure", {
        requestCount: incoming.length,
        senderCount: senderUserIds.filter(Boolean).length,
        returnedCount: 0,
        unresolvedCount: hydrated.incoming.filter(
          (request) => request.senderProfileState === "unresolved",
        ).length,
        hydrationCompleted: false,
        errorCode: getErrorCode(error),
      });
      return { ...hydrated, mappingDiagnostics };
    }
  } catch (error) {
    logFriendsIssue("getFriendRequestGroups", error);
    throw error;
  }
}

export async function getIncomingFriendRequests(userId: string): Promise<FriendRequest[]> {
  return (await getFriendRequestGroups(userId)).incoming;
}

export async function getOutgoingFriendRequests(userId: string): Promise<FriendRequest[]> {
  return (await getFriendRequestGroups(userId)).outgoing;
}

export function subscribeToFriendRequestChanges(
  userId: string,
  onChange: () => void,
): Unsubscribe {
  if (auth.currentUser?.uid !== userId) return () => {};
  const createSnapshotHandler = () => {
    let initialized = false;
    return () => {
      if (!initialized) {
        initialized = true;
        return;
      }
      onChange();
    };
  };
  const handleError = (error: unknown) => logFriendsIssue("subscribeFriendRequests", error);
  const unsubscribeIncoming = onSnapshot(
    query(
      collection(db, REQUESTS_COLLECTION),
      where("toUserId", "==", userId),
      where("status", "==", "pending"),
      where("expiresAt", ">", Timestamp.now()),
      limit(100),
    ),
    createSnapshotHandler(),
    handleError,
  );
  const unsubscribeOutgoing = onSnapshot(
    query(
      collection(db, REQUESTS_COLLECTION),
      where("fromUserId", "==", userId),
      where("status", "==", "pending"),
      where("expiresAt", ">", Timestamp.now()),
      limit(100),
    ),
    createSnapshotHandler(),
    handleError,
  );
  const unsubscribeFriendship = onSnapshot(
    doc(db, USERS_COLLECTION, userId),
    createSnapshotHandler(),
    (error) => logFriendsIssue("subscribeFriendships", error),
  );
  return () => {
    unsubscribeIncoming();
    unsubscribeOutgoing();
    unsubscribeFriendship();
  };
}

function hydrateFriendRequestGroups(
  incoming: FriendRequest[],
  outgoing: FriendRequest[],
  profilesByUserId: ReadonlyMap<string, PublicFriendProfileRecord>,
): Pick<FriendRequestGroups, "incoming" | "outgoing"> {
  const hydrated = hydrateFriendRequestProfiles(
    incoming,
    outgoing,
    profilesByUserId,
    formatPublicFriendName,
  );
  return {
    incoming: hydrated.incoming.map((request) => ({
      ...request,
      senderProfileState: request.senderNameSource === "deleted"
        ? "deleted"
        : request.senderNameResolved ? "resolved" : "unresolved",
    })),
    outgoing: hydrated.outgoing.map((request) => ({
      ...request,
      recipientProfileState: request.recipientNameSource === "deleted"
        ? "deleted"
        : request.recipientNameResolved ? "resolved" : "unresolved",
    })),
  };
}

export function formatPublicFriendName(value?: string | null): string | null {
  return formatPublicUserName(value);
}

async function loadPublicProfilesWithRetry(userIds: string[]) {
  try {
    return await getPublicUserProfiles(userIds);
  } catch (firstError) {
    logFriendsIssue("getPublicUserProfilesRetry", firstError);
    return getPublicUserProfiles(userIds);
  }
}

function buildIncomingProfileMappingDiagnostics(input: {
  incoming: FriendRequest[];
  requestedProfileUserIds: string[];
  inspectedProfiles: ReturnType<typeof inspectPublicUserProfiles>;
  hydratedIncoming: FriendRequest[];
}): IncomingProfileMappingDiagnostics {
  const incomingSenderIds = input.incoming.map(getIncomingRequestSenderId);
  const incomingWithFromUserIdCount = incomingSenderIds.filter(Boolean).length;
  const incomingIdMatchedProfileCount = incomingSenderIds.filter((senderId) => (
    Boolean(senderId && input.inspectedProfiles.profilesByUserId.has(senderId))
  )).length;
  const incomingIdMatchedNullNameCount = incomingSenderIds.filter((senderId) => {
    if (!senderId) return false;
    const profile = input.inspectedProfiles.profilesByUserId.get(senderId);
    return Boolean(profile && !formatPublicFriendName(profile.displayName));
  }).length;

  return {
    ...input.inspectedProfiles.counts,
    incomingRequestCount: input.incoming.length,
    incomingWithFromUserIdCount,
    requestedIdCount: input.requestedProfileUserIds.length,
    returnedWithValidDisplayNameCount: input.inspectedProfiles.profiles.filter(
      (profile) => Boolean(formatPublicFriendName(profile.displayName)),
    ).length,
    incomingIdMatchedProfileCount,
    incomingIdMatchedNullNameCount,
    incomingIdNotMatchedCount: input.incoming.length - incomingIdMatchedProfileCount,
    hydratedSenderNameCount: input.hydratedIncoming.filter(
      (request) => request.senderNameResolved && Boolean(request.senderDisplayName),
    ).length,
    renderedSenderNameCount: 0,
  };
}

function emptyFriendRequestGroups(): FriendRequestGroups {
  const inspectedProfiles = inspectPublicUserProfiles([]);
  return {
    incoming: [],
    outgoing: [],
    mappingDiagnostics: {
      ...inspectedProfiles.counts,
      incomingRequestCount: 0,
      incomingWithFromUserIdCount: 0,
      requestedIdCount: 0,
      returnedWithValidDisplayNameCount: 0,
      incomingIdMatchedProfileCount: 0,
      incomingIdMatchedNullNameCount: 0,
      incomingIdNotMatchedCount: 0,
      hydratedSenderNameCount: 0,
      renderedSenderNameCount: 0,
    },
  };
}

export async function sendFriendRequest(targetUserId: string): Promise<SendFriendRequestResult> {
  const currentUserId = requireCurrentUserId();
  const normalizedTargetUserId = targetUserId.trim();
  if (!normalizedTargetUserId || currentUserId === normalizedTargetUserId) {
    throw createFriendRequestError("friend-request/invalid-target");
  }

  const callable = httpsCallable<
    { targetUserId: string },
    SendFriendRequestResult
  >(functions, "sendFriendRequest");
  try {
    const response = await callable({ targetUserId: normalizedTargetUserId });
    if (__DEV__) {
      console.info("[FriendRequestDebug] operation completed", {
        operation: "sendFriendRequest",
        callableName: "sendFriendRequest",
        functionsRegion: "us-central1",
        targetUserIdPresent: true,
        authenticated: true,
        alreadyFriend: response.data.status === "alreadyFriends",
        alreadyPending: response.data.status === "alreadyPending",
        reversePending: response.data.status === "reversePending",
      });
    }
    return response.data;
  } catch (error) {
    logFriendRequestIssue("sendFriendRequest", error, Boolean(normalizedTargetUserId));
    throw error;
  }
}

export async function acceptFriendRequest(requestId: string): Promise<void> {
  requireCurrentUserId();
  const callable = httpsCallable<
    { requestId: string; decision: "accepted" },
    { status: "accepted" | "expired" | "canceled" | "alreadyHandled" }
  >(functions, "respondToFriendRequest");
  const response = await callable({ requestId, decision: "accepted" });
  if (response.data.status === "expired" || response.data.status === "canceled") {
    throw createFriendRequestError("friend-request/no-longer-available");
  }
}

export async function declineFriendRequest(requestId: string): Promise<void> {
  requireCurrentUserId();
  const callable = httpsCallable<
    { requestId: string; decision: "declined" },
    { status: "declined" | "expired" | "alreadyHandled" }
  >(functions, "respondToFriendRequest");
  const response = await callable({ requestId, decision: "declined" });
  if (response.data.status === "expired") throw createFriendRequestError("friend-request/no-longer-available");
}

export async function cancelFriendRequest(requestId: string): Promise<void> {
  requireCurrentUserId();
  const callable = httpsCallable<
    { requestId: string },
    { status: "canceled" | "expired" | "alreadyHandled" | "notFound" }
  >(functions, "cancelFriendRequest");
  const response = await callable({ requestId });
  if (response.data.status === "expired" || response.data.status === "notFound") {
    throw createFriendRequestError("friend-request/no-longer-available");
  }
}

export async function removeFriend(friendUserId: string): Promise<void> {
  requireCurrentUserId();
  const callable = httpsCallable<
    { friendUserId: string },
    { removed: boolean }
  >(functions, "removeFriendConnection");
  await callable({ friendUserId });
}

function logFriendsIssue(operation: string, error: unknown) {
  if (!__DEV__) return;
  console.info("[FriendsService] operation failed", { operation, code: getErrorCode(error) });
}

function logIncomingProfileHydration(
  phase: "start" | "success" | "failure",
  details: {
    requestCount: number;
    senderCount: number;
    returnedCount: number;
    unresolvedCount: number;
    hydrationCompleted: boolean;
    errorCode?: string;
  },
) {
  if (!__DEV__) return;
  console.info(`[friends] incoming-profile-${phase}`, {
    operation: "incoming-profile-hydration",
    ...details,
  });
}

function logFriendRequestIssue(operation: string, error: unknown, targetUserIdPresent: boolean) {
  if (!__DEV__) return;
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  console.info("[FriendRequestDebug] operation failed", {
    operation,
    code,
    callableName: "sendFriendRequest",
    functionsRegion: "us-central1",
    targetUserIdPresent,
    authenticated: Boolean(auth.currentUser),
  });
}

function createFriendRequestError(code: string) {
  const error = new Error("Friend request is unavailable.") as Error & { code: string };
  error.code = code;
  return error;
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}
