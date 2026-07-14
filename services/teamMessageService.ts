import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  type Unsubscribe,
} from "firebase/firestore";

import { auth, db } from "@/config/firebase";
import { canSendTeamMessages, getTeamById, isTeamActive, resolveTeamRoles, type TeamRoleFlags } from "@/services/teamService";

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
  const user = requireUser();
  const [membership, team] = await Promise.all([
    getCurrentMembership(teamId, user.uid),
    getTeamById(teamId),
  ]);
  if (!team || !isTeamActive(team)) {
    const error = new Error("This team is no longer active.");
    (error as { code?: string }).code = "team-archived";
    throw error;
  }
  if (!canSendTeamMessages(membership)) {
    throw new Error("Only team staff can send announcements.");
  }

  await addDoc(collection(db, "teams", teamId, "announcements"), {
    title: input.title.trim(),
    body: input.body.trim(),
    audience: input.audience,
    allowReplies: input.allowReplies,
    createdBy: user.uid,
    createdByName: membership?.displayName || resolveDisplayName(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
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
  return onSnapshot(
    repliesQuery,
    (snapshot) => {
      callback(snapshot.docs.map((replyDoc) => normalizeReply(replyDoc.id, replyDoc.data())));
    },
    (error) => {
      console.warn("[TeamMessageService] listen replies error:", error);
      callback([]);
      onError?.(error);
    },
  );
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
  return onSnapshot(
    repliesQuery,
    (snapshot) => {
      callback(
        snapshot.docs
          .map((replyDoc) => normalizeReply(replyDoc.id, replyDoc.data()))
          .sort((first, second) => readMillis(first.createdAt) - readMillis(second.createdAt)),
      );
    },
    (error) => {
      console.warn("[TeamMessageService] listen parent replies error:", error);
      callback([]);
      onError?.(error);
    },
  );
}
export async function replyToAnnouncement(
  teamId: string,
  announcementId: string,
  body: string,
  replyType: ReplyType = "team",
) {
  const user = requireUser();
  const [membership, announcement] = await Promise.all([
    getCurrentMembership(teamId, user.uid),
    getTeamAnnouncement(teamId, announcementId),
  ]);

  if (!membership) {
    throw new Error("Join this team before replying.");
  }
  if (!announcement) {
    throw new Error("Announcement could not be found.");
  }
  if (!announcement.allowReplies) {
    throw new Error("Replies are closed for this announcement.");
  }

  await addDoc(collection(db, "teams", teamId, "announcements", announcementId, "replies"), {
    userId: user.uid,
    displayName: membership.displayName || resolveDisplayName(),
    body: body.trim(),
    replyType,
    createdAt: serverTimestamp(),
  });
}

async function getCurrentMembership(teamId: string, userId: string): Promise<{ roles: TeamRoleFlags; displayName: string } | null> {
  try {
    const snapshot = await getDoc(doc(db, "teams", teamId, "members", userId));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    if (data.status !== "active") return null;
    return {
      roles: resolveTeamRoles(data.roles, data.role),
      displayName: typeof data.displayName === "string" ? data.displayName : "",
    };
  } catch (error) {
    console.warn("[TeamMessageService] get membership error:", error);
    return null;
  }
}

function requireUser() {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Please sign in to use team messages.");
  }
  return user;
}

function resolveDisplayName() {
  const user = auth.currentUser;
  return user?.displayName?.trim() || user?.email?.split("@")[0]?.trim() || "Sideline Parent";
}

function normalizeAnnouncement(id: string, data: Record<string, unknown>): TeamAnnouncement {
  return {
    id,
    title: readString(data.title),
    body: readString(data.body),
    createdBy: readString(data.createdBy),
    createdByName: readString(data.createdByName, "Coach"),
    audience: readAudience(data.audience),
    allowReplies: data.allowReplies !== false,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function normalizeReply(id: string, data: Record<string, unknown>): AnnouncementReply {
  return {
    id,
    userId: readString(data.userId),
    displayName: readString(data.displayName, "Sideline Parent"),
    body: readString(data.body),
    replyType: data.replyType === "privateToCoach" ? "privateToCoach" : "team",
    createdAt: data.createdAt,
  };
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
