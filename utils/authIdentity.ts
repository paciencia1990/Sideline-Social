import type { User } from "firebase/auth";

export type FirebaseIdentityKind = "unauthenticated" | "anonymous" | "permanent";

type FirebaseIdentity = Pick<User, "isAnonymous" | "uid"> | null | undefined;

export function resolveFirebaseIdentityKind(user: FirebaseIdentity): FirebaseIdentityKind {
  if (!user) {
    return "unauthenticated";
  }

  return user.isAnonymous ? "anonymous" : "permanent";
}

export function isPermanentFirebaseUser(
  user: FirebaseIdentity,
): user is Pick<User, "isAnonymous" | "uid"> {
  return resolveFirebaseIdentityKind(user) === "permanent";
}

export function resolveClientGameAuthority({
  hostUserId,
  participantUserIds,
  user,
}: {
  hostUserId?: string | null;
  participantUserIds?: readonly string[] | null;
  user: FirebaseIdentity;
}) {
  const identityKind = resolveFirebaseIdentityKind(user);
  const userId = identityKind === "permanent" ? user?.uid ?? null : null;
  const isHost = Boolean(userId && hostUserId === userId);
  const isParticipant = Boolean(
    userId &&
      (isHost || participantUserIds?.includes(userId)),
  );

  return {
    identityKind,
    isHost,
    isParticipant,
    isPermanentAccount: identityKind === "permanent",
  };
}
