import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { auth, db, functions } from "@/config/firebase";
import { getTeamRosterProfiles } from "@/services/teamRosterService";
import { formatPublicUserName } from "@/utils/friendPrivacy";
import { normalizeVoiceMessageFields } from "@/utils/voiceMessageNormalizer";
import type { StoredVoiceMemo } from "@/types/teamVoiceMessaging";

export type AnnouncementAudience = "parents" | "staff" | "all";
export type ReplyType = "team" | "privateToCoach";

export type TeamAnnouncement = {
  id: string;
  title: string;
  body: string;
  createdBy: string;
  createdByName: string;
  authorProfileState?: "available" | "unnamed" | "deleted";
  audience: AnnouncementAudience;
  allowReplies: boolean;
  contentType: "text" | "voice";
  voiceMemo: StoredVoiceMemo | null;
  isDeleted: boolean;
  isModerated: boolean;
  deletedBy: string | null;
  deletedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type AnnouncementReply = {
  id: string;
  userId: string;
  displayName: string;
  profileState?: "available" | "unnamed" | "deleted";
  body: string;
  replyType: ReplyType;
  isDeleted: boolean;
  isModerated: boolean;
  deletedBy: string | null;
  deletedAt?: unknown;
  createdAt?: unknown;
};

export type AnnouncementInput = {
  title: string;
  body: string;
  audience: AnnouncementAudience;
  allowReplies: boolean;
};

export type TeamAnnouncementRecipientCounts = {
  all: number;
  staff: number;
};

export async function getTeamAnnouncementRecipientCounts(teamId: string) {
  requireUser();
  const callable = httpsCallable<
    { teamId: string },
    { teamId: string; counts: TeamAnnouncementRecipientCounts }
  >(functions, "getTeamAnnouncementRecipientCounts");
  const response = await callable({ teamId });
  return {
    all: Math.max(0, Math.floor(Number(response.data.counts?.all ?? 0))),
    staff: Math.max(0, Math.floor(Number(response.data.counts?.staff ?? 0))),
  };
}

export async function createTeamAnnouncement(teamId: string, input: AnnouncementInput) {
  const callable = httpsCallable<
    { teamId: string } & AnnouncementInput,
    { announcementId: string; status: "created" }
  >(functions, "createTeamAnnouncement");
  await callable({ teamId, ...input });
}

export function listenToTeamAnnouncements(
  teamId: string,
  callback: (announcements: TeamAnnouncement[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!teamId) {
    callback([]);
    return () => {};
  }

  const announcementsQuery = query(collection(db, "teams", teamId, "announcements"), orderBy("createdAt", "desc"));
  let disposed = false;
  let resolutionVersion = 0;
  const unsubscribe = onSnapshot(
    announcementsQuery,
    (snapshot) => {
      const version = ++resolutionVersion;
      const announcements = snapshot.docs.map((announcementDoc) => normalizeAnnouncement(announcementDoc.id, announcementDoc.data()));
      void resolveAnnouncementDisplayNames(announcements).then((resolved) => {
        if (!disposed && version === resolutionVersion) callback(resolved);
      });
    },
    (error) => {
      console.warn("[TeamMessageService] listen announcements error:", error);
      callback([]);
      onError?.(error);
    },
  );
  return () => {
    disposed = true;
    unsubscribe();
  };
}

export async function getTeamAnnouncement(
  teamId: string,
  announcementId: string,
  options: { throwOnError?: boolean } = {},
): Promise<TeamAnnouncement | null> {
  if (!teamId || !announcementId) return null;

  try {
    const snapshot = await getDoc(doc(db, "teams", teamId, "announcements", announcementId));
    if (!snapshot.exists()) return null;
    return (await resolveAnnouncementDisplayNames([normalizeAnnouncement(snapshot.id, snapshot.data())]))[0] ?? null;
  } catch (error) {
    console.warn("[TeamMessageService] get announcement error:", error);
    if (options.throwOnError) throw error;
    return null;
  }
}

export function listenToTeamAnnouncement(
  teamId: string,
  announcementId: string,
  callback: (announcement: TeamAnnouncement | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!teamId || !announcementId) {
    callback(null);
    return () => {};
  }

  let disposed = false;
  let resolutionVersion = 0;
  const unsubscribe = onSnapshot(
    doc(db, "teams", teamId, "announcements", announcementId),
    (snapshot) => {
      const version = ++resolutionVersion;
      if (!snapshot.exists()) {
        callback(null);
        return;
      }
      void resolveAnnouncementDisplayNames([normalizeAnnouncement(snapshot.id, snapshot.data())]).then(([resolved]) => {
        if (!disposed && version === resolutionVersion) callback(resolved ?? null);
      });
    },
    (error) => {
      logMessageServiceIssue("listenAnnouncement", error);
      callback(null);
      onError?.(error);
    },
  );
  return () => {
    disposed = true;
    unsubscribe();
  };
}

export function listenToAnnouncementReplies(
  teamId: string,
  announcementId: string,
  callback: (replies: AnnouncementReply[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!teamId || !announcementId) {
    callback([]);
    return () => {};
  }

  const repliesQuery = query(
    collection(db, "teams", teamId, "announcements", announcementId, "replies"),
    orderBy("createdAt", "asc"),
  );
  let disposed = false;
  let resolutionVersion = 0;
  const unsubscribe = onSnapshot(
    repliesQuery,
    (snapshot) => {
      const version = ++resolutionVersion;
      const nextReplies = snapshot.docs.map((replyDoc) => normalizeReply(replyDoc.id, replyDoc.data()));
      void resolveReplyDisplayNames(nextReplies).then((resolvedReplies) => {
        if (!disposed && version === resolutionVersion) callback(resolvedReplies);
      });
    },
    (error) => {
      logMessageServiceIssue("listenReplies", error);
      callback([]);
      onError?.(error);
    },
  );
  return () => {
    disposed = true;
    unsubscribe();
  };
}

export function listenToParentAnnouncementReplies(
  teamId: string,
  announcementId: string,
  callback: (replies: AnnouncementReply[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!teamId || !announcementId) {
    callback([]);
    return () => {};
  }

  const repliesQuery = query(
    collection(db, "teams", teamId, "announcements", announcementId, "replies"),
    where("replyType", "==", "team"),
  );
  let disposed = false;
  let resolutionVersion = 0;
  const unsubscribe = onSnapshot(
    repliesQuery,
    (snapshot) => {
      const version = ++resolutionVersion;
      const nextReplies = snapshot.docs
        .map((replyDoc) => normalizeReply(replyDoc.id, replyDoc.data()))
        .sort((first, second) => readMillis(first.createdAt) - readMillis(second.createdAt));
      void resolveReplyDisplayNames(nextReplies).then((resolvedReplies) => {
        if (!disposed && version === resolutionVersion) callback(resolvedReplies);
      });
    },
    (error) => {
      logMessageServiceIssue("listenParentReplies", error);
      callback([]);
      onError?.(error);
    },
  );
  return () => {
    disposed = true;
    unsubscribe();
  };
}
export async function replyToAnnouncement(
  teamId: string,
  announcementId: string,
  body: string,
  replyType: ReplyType = "team",
) {
  requireUser();
  const submitReply = httpsCallable<
    { teamId: string; announcementId: string; body: string; replyType: ReplyType },
    { reply: { id: string; userId: string; displayName: string; body: string; replyType: ReplyType; createdAtMillis: number } }
  >(functions, "createTeamAnnouncementReply");
  const response = await submitReply({ teamId, announcementId, body: body.trim(), replyType });
  return {
    ...response.data.reply,
    createdAt: new Date(response.data.reply.createdAtMillis),
    deletedBy: null,
    isDeleted: false,
    isModerated: false,
  } satisfies AnnouncementReply;
}

export async function deleteAnnouncementReply(
  teamId: string,
  announcementId: string,
  replyId: string,
) {
  requireUser();
  const deleteReply = httpsCallable<
    { teamId: string; announcementId: string; replyId: string },
    { deleted: boolean }
  >(functions, "deleteTeamAnnouncementReply");
  const response = await deleteReply({ teamId, announcementId, replyId });
  return response.data.deleted;
}

export async function deleteTeamAnnouncement(teamId: string, announcementId: string) {
  requireUser();
  const deleteAnnouncement = httpsCallable<
    { teamId: string; announcementId: string },
    {
      status: "deleted" | "alreadyDeleted";
      storageCleanup: "deleted" | "cleanupPending" | "notRequired";
    }
  >(functions, "deleteTeamAnnouncement");
  const response = await deleteAnnouncement({ teamId, announcementId });
  return response.data.status;
}

function requireUser() {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Please sign in to use team messages.");
  }
  return user;
}

function normalizeAnnouncement(id: string, data: Record<string, unknown>): TeamAnnouncement {
  const voice = normalizeVoiceMessageFields(data);
  const isModerated = contentIsModerated(data);
  return {
    id,
    title: isModerated ? "" : readString(data.title),
    body: isModerated ? "" : readString(data.body),
    createdBy: readString(data.createdBy),
    createdByName: formatPublicUserName(readString(data.createdByName)) ?? "",
    audience: readAudience(data.audience),
    allowReplies: data.allowReplies !== false,
    contentType: voice.contentType,
    voiceMemo: isModerated ? null : voice.voiceMemo,
    isDeleted: data.isDeleted === true || isModerated,
    isModerated,
    deletedBy: readNullableString(data.deletedBy),
    deletedAt: data.deletedAt,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function normalizeReply(id: string, data: Record<string, unknown>): AnnouncementReply {
  const isModerated = contentIsModerated(data);
  return {
    id,
    userId: readString(data.userId),
    displayName: formatPublicUserName(readString(data.displayName)) ?? "",
    body: isModerated ? "" : readString(data.body),
    replyType: data.replyType === "privateToCoach" ? "privateToCoach" : "team",
    isDeleted: data.isDeleted === true || isModerated,
    isModerated,
    deletedBy: readNullableString(data.deletedBy),
    deletedAt: data.deletedAt,
    createdAt: data.createdAt,
  };
}

async function resolveReplyDisplayNames(replies: AnnouncementReply[]) {
  if (replies.length === 0) return replies;
  try {
    const profiles = await getTeamRosterProfiles(replies.map((reply) => reply.userId));
    return replies.map((reply) => {
      const profile = profiles[reply.userId];
      return {
        ...reply,
        displayName: profile?.displayName ?? (profile ? "" : resolveSafeDisplayName(reply.displayName, "")),
        profileState: profile?.profileState,
      };
    });
  } catch (error) {
    logMessageServiceIssue("resolveReplyNames", error);
    return replies.map((reply) => ({
      ...reply,
      displayName: resolveSafeDisplayName(reply.displayName, ""),
    }));
  }
}

function contentIsModerated(data: Record<string, unknown>) {
  return data.moderationState === "hidden" || data.moderationState === "removed";
}

async function resolveAnnouncementDisplayNames(announcements: TeamAnnouncement[]) {
  if (announcements.length === 0) return announcements;
  try {
    const profiles = await getTeamRosterProfiles(announcements.map((announcement) => announcement.createdBy));
    return announcements.map((announcement) => {
      const profile = profiles[announcement.createdBy];
      return {
        ...announcement,
        createdByName: profile?.displayName ?? (profile ? "" : resolveSafeDisplayName(announcement.createdByName, "")),
        authorProfileState: profile?.profileState,
      };
    });
  } catch (error) {
    logMessageServiceIssue("resolveAnnouncementNames", error);
    return announcements;
  }
}

function resolveSafeDisplayName(...candidates: (string | null | undefined)[]) {
  for (const candidate of candidates) {
    const publicName = formatPublicUserName(candidate);
    if (publicName) return publicName;
  }
  return "";
}

function readErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

function logMessageServiceIssue(operation: string, error: unknown) {
  if (!__DEV__) return;
  console.info("[TeamMessageService] operation failed", { operation, code: readErrorCode(error) });
}


function readAudience(value: unknown): AnnouncementAudience {
  if (value === "staff" || value === "all" || value === "parents") {
    return value;
  }
  if (value === "everyone") return "all";
  return "parents";
}

function readMillis(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    return value.toMillis();
  }
  return 0;
}
function readString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
