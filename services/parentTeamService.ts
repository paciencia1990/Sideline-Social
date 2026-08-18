import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "@/config/firebase";
import {
  groupTeamsByChild,
  summarizeTeamUpdates,
  type StableChildIdentity,
} from "@/utils/parentTeamCore";
import {
  createChildProfile,
  getCurrentUserChildren,
  setParentTeamChildLinks,
  type ParentChildProfile,
} from "@/services/childService";
import { type TeamAnnouncement } from "@/services/teamMessageService";
import {
  getArchivedParentTeamCount,
  getArchivedParentTeamMembershipsPage,
  getParentTeams,
  removeArchivedParentTeamFromAccount,
  type Team,
  type TeamMembership,
} from "@/services/teamService";
import { formatPublicUserName } from "@/utils/friendPrivacy";
import { getTeamPrivateMessageInbox } from "@/services/teamPrivateMessageService";
import { getPublicUserProfiles } from "@/services/publicProfileService";
import type { TeamPrivateConversation } from "@/types/teamVoiceMessaging";
import { normalizeVoiceMessageFields } from "@/utils/voiceMessageNormalizer";

export type ParentTeamAnnouncement = TeamAnnouncement & {
  createdAtDate: Date | null;
  isRead: boolean;
  authorProfileState?: "available" | "unnamed" | "deleted";
};

export type ParentTeamSummary = {
  teamId: string;
  team: Team;
  membership: TeamMembership;
  children: StableChildIdentity[];
  childId: string | null;
  childName: string | null;
  legacyChildName: string | null;
  needsChildMigration: boolean;
  coachName: string | null;
  coachProfileState?: "available" | "unnamed" | "deleted";
  announcements: ParentTeamAnnouncement[];
  unreadCount: number;
  latestAnnouncement: ParentTeamAnnouncement | null;
  privateConversations: TeamPrivateConversation[];
  privateUnreadCount: number;
};

export type ParentTeamsOverview = {
  teams: ParentTeamSummary[];
  totalTeams: number;
  unreadCount: number;
  latestTeam: ParentTeamSummary | null;
  latestAnnouncement: ParentTeamAnnouncement | null;
  privateUnreadCount: number;
};

export type ArchivedParentTeamSummary = {
  teamId: string;
  name: string;
  sport: string;
  season: string;
  division: string;
  ageRange: string;
  archivedAtDate: Date | null;
};

export type ArchivedParentTeamsPage = {
  teams: ArchivedParentTeamSummary[];
  totalCount: number;
  hasMore: boolean;
  nextOffset: number;
};

export type ChildTeamGroup = {
  key: string;
  childId: string | null;
  childName: string | null;
  teams: ParentTeamSummary[];
  legacy: boolean;
};

export async function getParentTeamsOverview(): Promise<ParentTeamsOverview> {
  const [memberships, childProfiles, privateConversations] = await Promise.all([
    getParentTeams({ throwOnError: true }),
    getCurrentUserChildren(),
    getTeamPrivateMessageInbox("parent"),
  ]);
  const childLinksByTeam = await loadChildLinksByTeam(childProfiles);
  const summaries = await Promise.all(
    memberships
      .filter((membership) => membership.team)
      .map((membership) => loadParentTeamSummary(
        membership,
        resolveMembershipChildren(membership, childProfiles, childLinksByTeam),
        privateConversations.filter((conversation) => conversation.teamId === membership.teamId),
      )),
  );
  const teams = summaries.sort(compareTeamSummaries);
  const { latestTeam, totalTeams, unreadCount } = summarizeTeamUpdates(teams);

  return {
    teams,
    totalTeams,
    unreadCount,
    latestTeam,
    latestAnnouncement: latestTeam?.latestAnnouncement ?? null,
    privateUnreadCount: teams.reduce((total, team) => total + team.privateUnreadCount, 0),
  };
}

export async function getParentTeamSummary(teamId: string): Promise<ParentTeamSummary> {
  const overview = await getParentTeamsOverview();
  const summary = overview.teams.find((item) => item.teamId === teamId);
  if (!summary) {
    const error = new Error("Parent team membership is missing or inactive.");
    (error as { code?: string }).code = "membership-missing";
    throw error;
  }
  return summary;
}

export async function getParentPastTeamCount(): Promise<number> {
  return getArchivedParentTeamCount();
}

export async function getParentPastTeamsPage(offset = 0, pageSize = 8): Promise<ArchivedParentTeamsPage> {
  const page = await getArchivedParentTeamMembershipsPage(offset, pageSize, { throwOnError: true });
  return {
    teams: page.memberships
      .filter((membership) => membership.team)
      .map((membership) => toArchivedParentSummary(membership.team!)),
    totalCount: page.totalCount,
    hasMore: page.hasMore,
    nextOffset: page.nextOffset,
  };
}

export async function removeParentPastTeam(teamId: string) {
  return removeArchivedParentTeamFromAccount(teamId);
}

export function groupParentTeamsByChild(teams: ParentTeamSummary[]): ChildTeamGroup[] {
  return groupTeamsByChild(teams);
}
export function getTeamChildNames(summary: ParentTeamSummary) {
  const names = summary.children.map((child) => child.displayName).filter(Boolean);
  if (names.length > 0) return names;
  return summary.legacyChildName ? [summary.legacyChildName] : [];
}

export async function updateParentTeamChildName(teamId: string, childName: string): Promise<void> {
  const child = await createChildProfile(childName);
  await setParentTeamChildLinks(teamId, [child.id]);
}
export async function markTeamAnnouncementRead(teamId: string, announcementId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to read team updates.");
  await setDoc(
    doc(db, "teams", teamId, "announcements", announcementId, "reads", user.uid),
    {
      userId: user.uid,
      readAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export function getCoachUpdateRoute(teamId: string, announcementId: string, ..._legacyContext: unknown[]) {
  return {
    pathname: "/teams/[teamId]/announcements/[announcementId]",
    params: {
      teamId,
      announcementId,
    },
  } as const;
}

async function loadParentTeamSummary(
  membership: TeamMembership,
  childResolution: ResolvedMembershipChildren,
  privateConversations: TeamPrivateConversation[],
): Promise<ParentTeamSummary> {
  const user = auth.currentUser;
  if (!user || !membership.team) throw new Error("Parent team membership is unavailable.");
  const team = membership.team;
  const announcementSnapshot = await getDocs(
    query(
      collection(db, "teams", team.id, "announcements"),
      where("audience", "in", ["parents", "all", "everyone"]),
      orderBy("createdAt", "desc"),
    ),
  );
  const visibleAnnouncements = announcementSnapshot.docs
    .map((announcementDoc) => normalizeAnnouncement(announcementDoc.id, announcementDoc.data()))
    .filter((announcement) => announcement.audience !== "staff");

  const [profileResults, readStates, coachIdentity] = await Promise.all([
    getPublicUserProfiles(
      visibleAnnouncements.map((announcement) => announcement.createdBy).filter(Boolean),
    ).catch(() => []),
    Promise.all(
      visibleAnnouncements.map((announcement) =>
        getDoc(doc(db, "teams", team.id, "announcements", announcement.id, "reads", user.uid)),
      ),
    ),
    resolveCoachName(team),
  ]);
  const authorProfiles = new Map(profileResults.map((profile) => [profile.userId, profile]));
  const announcements = visibleAnnouncements.map((announcement, index) => ({
    ...announcement,
    createdByName: authorProfiles.get(announcement.createdBy)?.displayName
      ?? (authorProfiles.get(announcement.createdBy)?.profileState === "deleted" ? "" : announcement.createdByName),
    authorProfileState: authorProfiles.get(announcement.createdBy)?.profileState,
    isRead: readStates[index]?.exists() ?? false,
  }));
  return {
    teamId: team.id,
    team,
    membership,
    children: childResolution.children,
    childId: childResolution.children[0]?.id ?? null,
    childName: childResolution.children[0]?.displayName ?? childResolution.legacyChildName,
    legacyChildName: childResolution.legacyChildName,
    needsChildMigration: childResolution.needsMigration,
    coachName: coachIdentity?.displayName ?? null,
    coachProfileState: coachIdentity?.profileState,
    announcements,
    unreadCount: announcements.filter((announcement) => !announcement.isRead).length,
    latestAnnouncement: announcements[0] ?? null,
    privateConversations,
    privateUnreadCount: privateConversations.reduce((total, conversation) => total + conversation.unreadCount, 0),
  };
}

type ResolvedMembershipChildren = {
  children: StableChildIdentity[];
  legacyChildName: string | null;
  needsMigration: boolean;
};

async function loadChildLinksByTeam(childProfiles: ParentChildProfile[]) {
  const user = auth.currentUser;
  const linkedChildren = new Map<string, StableChildIdentity[]>();
  if (!user) return linkedChildren;
  const profilesById = new Map(childProfiles.map((child) => [child.id, child]));
  const linkSnapshot = await getDocs(collection(db, "users", user.uid, "teamChildLinks"));
  linkSnapshot.docs.forEach((linkDocument) => {
    const data = linkDocument.data();
    if (data.status !== "active") return;
    const teamId = readString(data.teamId) ?? linkDocument.id;
    const childIds = Array.isArray(data.childIds) ? data.childIds : [];
    const identities = childIds.flatMap((value) => {
      const child = typeof value === "string" ? profilesById.get(value) : undefined;
      return child ? [{ id: child.id, displayName: child.displayName, legacy: false }] : [];
    });
    if (teamId && identities.length > 0) linkedChildren.set(teamId, identities);
  });
  return linkedChildren;
}

function resolveMembershipChildren(
  membership: TeamMembership,
  childProfiles: ParentChildProfile[],
  linkedChildrenByTeam: Map<string, StableChildIdentity[]>,
): ResolvedMembershipChildren {
  const linkedChildren = linkedChildrenByTeam.get(membership.teamId) ?? [];
  const legacyProfile = membership.childId
    ? childProfiles.find((child) => child.id === membership.childId)
    : null;
  const children = [...linkedChildren];
  if (legacyProfile && !children.some((child) => child.id === legacyProfile.id)) {
    children.push({
      id: legacyProfile.id,
      displayName: legacyProfile.displayName,
      legacy: false,
    });
  }

  const legacyChildName = legacyProfile ? null : membership.childName.trim() || null;
  const needsMigration = Boolean(membership.childId || membership.childName.trim());
  return {
    children,
    legacyChildName,
    needsMigration,
  };
}
async function resolveCoachName(team: Team): Promise<{
  displayName: string | null;
  profileState?: "available" | "unnamed" | "deleted";
} | null> {
  const profiles = new Map((await getPublicUserProfiles(team.coachIds).catch(() => []))
    .map((profile) => [profile.userId, profile]));
  for (const coachId of team.coachIds) {
    const profile = profiles.get(coachId);
    if (profile) return { displayName: profile.displayName, profileState: profile.profileState };
    const memberSnapshot = await getDoc(doc(db, "teams", team.id, "members", coachId));
    if (!memberSnapshot.exists()) continue;
    const displayName = formatPublicUserName(readString(memberSnapshot.data().displayName));
    if (displayName) return { displayName };
  }
  return null;
}

function normalizeAnnouncement(id: string, data: Record<string, unknown>): ParentTeamAnnouncement {
  const voice = normalizeVoiceMessageFields(data);
  const isModerated = data.moderationState === "hidden" ||
    data.moderationState === "removed";
  return {
    id,
    title: isModerated ? "" : readString(data.title) ?? "",
    body: isModerated ? "" : readString(data.body) ?? "",
    createdBy: readString(data.createdBy) ?? "",
    createdByName: formatPublicUserName(readString(data.createdByName)) ?? "",
    audience: data.audience === "staff"
      ? "staff"
      : data.audience === "all" || data.audience === "everyone"
        ? "all"
        : "parents",
    allowReplies: data.allowReplies !== false,
    contentType: voice.contentType,
    voiceMemo: isModerated ? null : voice.voiceMemo,
    isDeleted: isModerated || data.isDeleted === true,
    isModerated,
    deletedBy: readString(data.deletedBy),
    deletedAt: data.deletedAt,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    createdAtDate: readDate(data.createdAt),
    isRead: false,
  };
}

function compareTeamSummaries(first: ParentTeamSummary, second: ParentTeamSummary) {
  const firstChild = first.children[0]?.displayName ?? first.legacyChildName ?? "";
  const secondChild = second.children[0]?.displayName ?? second.legacyChildName ?? "";
  const childComparison = firstChild.localeCompare(secondChild);
  return childComparison || first.team.name.localeCompare(second.team.name);
}

function toArchivedParentSummary(team: Team): ArchivedParentTeamSummary {
  return {
    teamId: team.id,
    name: team.name,
    sport: team.sport,
    season: team.season,
    division: team.division,
    ageRange: team.ageRange,
    archivedAtDate: readDate(team.archivedAt),
  };
}

function readDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate();
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
