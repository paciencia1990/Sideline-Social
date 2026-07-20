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
import { resolveAnnouncementContentType } from "@/utils/teamAnnouncementCore";
import type { StoredVoiceMemo } from "@/types/teamVoiceMessaging";

export type AnnouncementAudience = "parents" | "staff" | "all";
export type ReplyType = "team" | "privateToCoach";

export type TeamAnnouncement = {
  id: string;
  title: string;
  body: string;
  createdBy: string;
  createdByName: string;
  audience: AnnouncementAudience;
  allowReplies: boolean;
  contentType: "text" | "voice";
  voiceMemo: StoredVoiceMemo | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type AnnouncementReply = {
  id: string;
  userId: string;
  displayName: string;
  body: string;
  replyType: ReplyType;
  createdAt?: unknown;
};

export type AnnouncementInput = {
  title: string;
  body: string;
  audience: AnnouncementAudience;
  allowReplies: boolean;
};

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
  return onSnapshot(
    announcementsQuery,
    (snapshot) => {
      callback(snapshot.docs.map((announcementDoc) => normalizeAnnouncement(announcementDoc.id, announcementDoc.data())));
    },
    (error) => {
      console.warn("[TeamMessageService] listen announcements error:", error);
      callback([]);
      onError?.(error);
    },
  );
}

export async function getTeamAnnouncement(
  teamId: string,
  announcementId: string,
  options: { throwOnError?: boolean } = {},
): Promise<TeamAnnouncement | null> {
  if (!teamId || !announcementId) return null;

  try {
    const snapshot = await getDoc(doc(db, "teams", teamId, "announcements", announcementId));
    return snapshot.exists() ? normalizeAnnouncement(snapshot.id, snapshot.data()) : null;
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

  return onSnapshot(
    doc(db, "teams", teamId, "announcements", announcementId),
    (snapshot) => callback(snapshot.exists() ? normalizeAnnouncement(snapshot.id, snapshot.data()) : null),
    (error) => {
      logMessageServiceIssue("listenAnnouncement", error);
      callback(null);
      onError?.(error);
    },
  );
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
    { status: "deleted" | "alreadyDeleted" }
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
  const voice = data.voiceMemo && typeof data.voiceMemo === "object" ? data.voiceMemo as Record<string, unknown> : null;
  const contentType = resolveAnnouncementContentType(data.contentType, voice);
  return {
    id,
    title: readString(data.title),
    body: readString(data.body),
    createdBy: readString(data.createdBy),
    createdByName: formatPublicUserName(readString(data.createdByName)) ?? "Coach",
    audience: readAudience(data.audience),
    allowReplies: data.allowReplies !== false,
    contentType,
    voiceMemo: contentType === "voice" && voice ? {
      storagePath: readString(voice.storagePath),
      durationMilliseconds: Number(voice.durationMilliseconds ?? 0),
      sizeBytes: Number(voice.sizeBytes ?? 0),
      mimeType: voice.mimeType === "audio/m4a" || voice.mimeType === "audio/x-m4a" ? voice.mimeType : "audio/mp4",
    } : null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function normalizeReply(id: string, data: Record<string, unknown>): AnnouncementReply {
  return {
    id,
    userId: readString(data.userId),
    displayName: formatPublicUserName(readString(data.displayName)) ?? "",
    body: readString(data.body),
    replyType: data.replyType === "privateToCoach" ? "privateToCoach" : "team",
    createdAt: data.createdAt,
  };
}

async function resolveReplyDisplayNames(replies: AnnouncementReply[]) {
  if (replies.length === 0) return replies;
  try {
    const profiles = await getTeamRosterProfiles(replies.map((reply) => reply.userId));
    return replies.map((reply) => ({
      ...reply,
      displayName: resolveSafeDisplayName(profiles[reply.userId], reply.displayName, ""),
    }));
  } catch (error) {
    logMessageServiceIssue("resolveReplyNames", error);
    return replies.map((reply) => ({
      ...reply,
      displayName: resolveSafeDisplayName(reply.displayName, ""),
    }));
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
