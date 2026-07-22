export type PublicFriendProfileRecord = {
  userId: string;
  displayName: string | null;
  firstName?: string | null;
  lastName?: string | null;
  photoURL?: string | null;
  profileState: "available" | "unnamed" | "deleted";
};

export type PublicProfileInspectionCounts = {
  returnedProfileCount: number;
  returnedWithUserIdCount: number;
  returnedWithNullDisplayNameCount: number;
  returnedWithNonEmptyDisplayNameCount: number;
  profilesMissingUserIdCount: number;
  profilesWithEmptyUserIdCount: number;
  profilesWithInvalidUserIdCount: number;
  profilesWithInvalidDisplayNameCount: number;
};

type IncomingRequestIdentity = { fromUserId?: unknown; fromDisplayName?: unknown; fromPhotoURL?: unknown };
type OutgoingRequestIdentity = { toUserId?: unknown; toDisplayName?: unknown; toPhotoURL?: unknown };

const FIREBASE_UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

export function getIncomingRequestSenderId(request: IncomingRequestIdentity): string | null {
  return getVerifiedFriendUserId(request.fromUserId);
}

export function getOutgoingRequestRecipientId(request: OutgoingRequestIdentity): string | null {
  return getVerifiedFriendUserId(request.toUserId);
}

export function getVerifiedFriendUserId(value: unknown): string | null {
  if (typeof value !== "string" || !FIREBASE_UID_PATTERN.test(value)) return null;
  return value;
}

export function deduplicateFriendUserIds(values: (string | null)[]): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export function inspectPublicUserProfiles(value: unknown): {
  profiles: PublicFriendProfileRecord[];
  profilesByUserId: Map<string, PublicFriendProfileRecord>;
  counts: PublicProfileInspectionCounts;
} {
  const records = Array.isArray(value) ? value : [];
  const profiles: PublicFriendProfileRecord[] = [];
  const counts: PublicProfileInspectionCounts = {
    returnedProfileCount: records.length,
    returnedWithUserIdCount: 0,
    returnedWithNullDisplayNameCount: 0,
    returnedWithNonEmptyDisplayNameCount: 0,
    profilesMissingUserIdCount: 0,
    profilesWithEmptyUserIdCount: 0,
    profilesWithInvalidUserIdCount: 0,
    profilesWithInvalidDisplayNameCount: 0,
  };

  records.forEach((record) => {
    if (!record || typeof record !== "object" || !("userId" in record)) {
      counts.profilesMissingUserIdCount += 1;
      return;
    }

    const userId = record.userId;
    if (typeof userId !== "string") {
      counts.profilesMissingUserIdCount += 1;
      return;
    }
    if (!userId) {
      counts.profilesWithEmptyUserIdCount += 1;
      return;
    }
    if (!FIREBASE_UID_PATTERN.test(userId)) {
      counts.profilesWithInvalidUserIdCount += 1;
      return;
    }
    counts.returnedWithUserIdCount += 1;

    if (!("displayName" in record) || (record.displayName !== null && typeof record.displayName !== "string")) {
      counts.profilesWithInvalidDisplayNameCount += 1;
      return;
    }

    if (record.displayName === null || !record.displayName.trim()) {
      counts.returnedWithNullDisplayNameCount += 1;
    } else {
      counts.returnedWithNonEmptyDisplayNameCount += 1;
    }

    profiles.push({
      userId,
      displayName: record.displayName,
      firstName: typeof record.firstName === "string" ? record.firstName : null,
      lastName: typeof record.lastName === "string" ? record.lastName : null,
      photoURL: typeof record.photoURL === "string" ? record.photoURL : null,
      profileState: record.profileState === "deleted" || record.profileState === "unnamed"
        ? record.profileState
        : "available",
    });
  });

  return {
    profiles,
    profilesByUserId: new Map(profiles.map((profile) => [profile.userId, profile])),
    counts,
  };
}

export function hydrateFriendRequestProfiles<
  TIncoming extends IncomingRequestIdentity,
  TOutgoing extends OutgoingRequestIdentity,
>(
  incoming: TIncoming[],
  outgoing: TOutgoing[],
  profilesByUserId: ReadonlyMap<string, PublicFriendProfileRecord>,
  formatPublicName: (value: string | null) => string | null,
) {
  return {
    incoming: incoming.map((request) => {
      const senderId = getIncomingRequestSenderId(request);
      const profile = senderId ? profilesByUserId.get(senderId) : undefined;
      const currentName = profile && profile.profileState !== "deleted" && profile.profileState !== "unnamed"
        ? formatPublicName(profile.displayName)
        : null;
      const snapshotName = !profile || profile.profileState === "available"
        ? formatPublicName(typeof request.fromDisplayName === "string" ? request.fromDisplayName : null)
        : null;
      const senderDisplayName = currentName ?? snapshotName;
      return {
        ...request,
        senderDisplayName,
        senderPhotoURL: profile ? profile.photoURL ?? null : (typeof request.fromPhotoURL === "string" ? request.fromPhotoURL : null),
        senderNameResolved: Boolean(senderDisplayName),
        senderNameSource: currentName ? "publicProfile" : snapshotName ? "requestSnapshot" : profile?.profileState === "deleted" ? "deleted" : "unavailable",
      };
    }),
    outgoing: outgoing.map((request) => {
      const recipientId = getOutgoingRequestRecipientId(request);
      const profile = recipientId ? profilesByUserId.get(recipientId) : undefined;
      const currentName = profile && profile.profileState !== "deleted" && profile.profileState !== "unnamed"
        ? formatPublicName(profile.displayName)
        : null;
      const snapshotName = !profile || profile.profileState === "available"
        ? formatPublicName(typeof request.toDisplayName === "string" ? request.toDisplayName : null)
        : null;
      const recipientDisplayName = currentName ?? snapshotName;
      return {
        ...request,
        recipientDisplayName,
        recipientPhotoURL: profile ? profile.photoURL ?? null : (typeof request.toPhotoURL === "string" ? request.toPhotoURL : null),
        recipientNameResolved: Boolean(recipientDisplayName),
        recipientNameSource: currentName ? "publicProfile" : snapshotName ? "requestSnapshot" : profile?.profileState === "deleted" ? "deleted" : "unavailable",
      };
    }),
  };
}
