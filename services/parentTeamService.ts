import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  Timestamp,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { auth, db, functions } from "@/config/firebase";
import { TEAM_HISTORY_PAGE_SIZES, type TeamHistoryCursor } from "@/constants/teamHistoryPagination";
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
  getCurrentUserTeamMembershipById,
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
  announcementsCursor: TeamHistoryCursor | null;
  hasOlderAnnouncements: boolean;
  unreadCount: number;
  unreadCountKnown: boolean;
  latestAnnouncement: ParentTeamAnnouncement | null;
  privateConversations: TeamPrivateConversation[];
  privateUnreadCount: number;
};

export type ParentTeamsOverview = {
  teams: ParentTeamSummary[];
  totalTeams: number;
  unreadCount: number;
  unreadCountKnown: boolean;
  latestTeam: ParentTeamSummary | null;
  latestAnnouncement: ParentTeamAnnouncement | null;
  privateUnreadCount: number;
};

export type ParentTeamAnnouncementsPage = {
  announcements: ParentTeamAnnouncement[];
  hasMore: boolean;
  nextCursor: TeamHistoryCursor | null;
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
  const announcementSummaryStates = await getTeamAnnouncementSummaryStates(memberships.map((membership) => membership.teamId));
  const childLinksByTeam = await loadChildLinksByTeam(childProfiles);
  const summaries = await Promise.all(
    memberships
      .filter((membership) => membership.team)
      .map((membership) => loadParentTeamSummary(
        membership,
        resolveMembershipChildren(membership, childProfiles, childLinksByTeam),
        privateConversations.filter((conversation) => conversation.teamId === membership.teamId),
        announcementSummaryStates.get(membership.teamId),
        1,
      )),
  );
  const teams = summaries.sort(compareTeamSummaries);
  const { latestTeam, totalTeams, unreadCount } = summarizeTeamUpdates(teams);

  return {
    teams,
    totalTeams,
    unreadCount,
    unreadCountKnown: teams.every((team) => team.unreadCountKnown),
    latestTeam,
    latestAnnouncement: latestTeam?.latestAnnouncement ?? null,
    privateUnreadCount: teams.reduce((total, team) => total + team.privateUnreadCount, 0),
  };
}

export async function getParentTeamSummary(teamId: string): Promise<ParentTeamSummary> {
  const [memberships, childProfiles, privateConversations] = await Promise.all([
    getParentTeams({ throwOnError: true }),
    getCurrentUserChildren(),
    getTeamPrivateMessageInbox("parent", teamId),
  ]);
  const membership = memberships.find((item) => item.teamId === teamId && item.team)
    ?? await getCurrentUserTeamMembershipById(teamId);
  if (!membership || !membership.roles.parent) {
    const error = new Error("Parent team membership is missing or inactive.");
    (error as { code?: string }).code = "membership-missing";
    throw error;
  }
  const [childLinksByTeam, summaryStates] = await Promise.all([
    loadChildLinksByTeam(childProfiles),
    getTeamAnnouncementSummaryStates([teamId]),
  ]);
  return loadParentTeamSummary(
    membership,
    resolveMembershipChildren(membership, childProfiles, childLinksByTeam),
    privateConversations,
    summaryStates.get(teamId),
    TEAM_HISTORY_PAGE_SIZES.announcements,
  );
}

export async function getParentPastTeamCount(): Promise<number> {
  return getArchivedParentTeamCount();
}

export async function getParentPastTeamsPage(offset = 0, pageSize = TEAM_HISTORY_PAGE_SIZES.archivedTeams): Promise<ArchivedParentTeamsPage> {
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
  if (!auth.currentUser) throw new Error("Sign in to read team updates.");
  const callable = httpsCallable<
    { teamId: string; announcementId: string },
    { status: "read" }
  >(functions, "markTeamAnnouncementRead");
  await callable({ teamId, announcementId });
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
  announcementSummaryState?: AnnouncementSummaryState,
  announcementPageSize: number = TEAM_HISTORY_PAGE_SIZES.announcements,
): Promise<ParentTeamSummary> {
  const user = auth.currentUser;
  if (!user || !membership.team) throw new Error("Parent team membership is unavailable.");
  const team = membership.team;
  const [announcementPage, coachIdentity] = await Promise.all([
    loadParentAnnouncementsPage(
      team.id,
      null,
      user.uid,
      announcementPageSize,
      announcementSummaryState?.available ? new Set(announcementSummaryState.recentUnreadAnnouncementIds) : null,
    ),
    resolveCoachName(team),
  ]);
  const announcements = announcementPage.announcements;
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
    announcementsCursor: announcementPage.nextCursor,
    hasOlderAnnouncements: announcementPage.hasMore,
    unreadCount: announcementSummaryState?.available
      ? announcementSummaryState.unreadCount
      : announcements.filter((announcement) => !announcement.isRead).length,
    unreadCountKnown: announcementSummaryState?.available === true || (announcements.length === 0 && !announcementPage.hasMore),
    latestAnnouncement: announcements[0] ?? null,
    privateConversations,
    privateUnreadCount: privateConversations.reduce((total, conversation) => total + conversation.unreadCount, 0),
  };
}

type AnnouncementSummaryState = {
  available: boolean;
  recentUnreadAnnouncementIds: string[];
  unreadCount: number;
};

async function getTeamAnnouncementSummaryStates(teamIds: string[]) {
  if (teamIds.length === 0) return new Map<string, AnnouncementSummaryState>();
  const callable = httpsCallable<
    { teamIds: string[] },
    { summaries: { teamId: string; available: boolean; recentUnreadAnnouncementIds: string[]; unreadCount: number | null }[] }
  >(functions, "getTeamAnnouncementSummaries");
  try {
    const response = await callable({ teamIds: Array.from(new Set(teamIds)).slice(0, 50) });
    return new Map(response.data.summaries.map((summary) => [summary.teamId, {
      available: summary.available && summary.unreadCount != null,
      recentUnreadAnnouncementIds: Array.isArray(summary.recentUnreadAnnouncementIds)
        ? summary.recentUnreadAnnouncementIds.slice(0, TEAM_HISTORY_PAGE_SIZES.announcements)
        : [],
      unreadCount: Math.max(0, Number(summary.unreadCount ?? 0)),
    }]));
  } catch {
    return new Map<string, AnnouncementSummaryState>();
  }
}

export async function getOlderParentTeamAnnouncementsPage(
  teamId: string,
  cursor: TeamHistoryCursor,
): Promise<ParentTeamAnnouncementsPage> {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to read team updates.");
  return loadParentAnnouncementsPage(teamId, cursor, user.uid);
}

async function loadParentAnnouncementsPage(
  teamId: string,
  cursor: TeamHistoryCursor | null,
  userId: string,
  pageSize: number = TEAM_HISTORY_PAGE_SIZES.announcements,
  knownUnreadIds: Set<string> | null = null,
): Promise<ParentTeamAnnouncementsPage> {
  const snapshot = await getDocs(query(
    collection(db, "teams", teamId, "announcements"),
    where("audience", "in", ["parents", "all", "everyone"]),
    orderBy("createdAt", "desc"),
    orderBy(documentId(), "desc"),
    ...(cursor ? [startAfter(Timestamp.fromMillis(cursor.timestampMillis), cursor.id)] : []),
    limit(pageSize + 1),
  ));
  const visibleAnnouncements = snapshot.docs.slice(0, pageSize)
    .map((announcementDoc) => normalizeAnnouncement(announcementDoc.id, announcementDoc.data()))
    .filter((announcement) => announcement.audience !== "staff");
  const [profileResults, readStates] = await Promise.all([
    getPublicUserProfiles(visibleAnnouncements.map((announcement) => announcement.createdBy).filter(Boolean)).catch(() => []),
    knownUnreadIds ? Promise.resolve(null) : Promise.all(visibleAnnouncements.map((announcement) =>
      getDoc(doc(db, "teams", teamId, "announcements", announcement.id, "reads", userId)))),
  ]);
  const authorProfiles = new Map(profileResults.map((profile) => [profile.userId, profile]));
  const announcements = visibleAnnouncements.map((announcement, index) => ({
    ...announcement,
    createdByName: authorProfiles.get(announcement.createdBy)?.displayName
      ?? (authorProfiles.get(announcement.createdBy)?.profileState === "deleted" ? "" : announcement.createdByName),
    authorProfileState: authorProfiles.get(announcement.createdBy)?.profileState,
    isRead: knownUnreadIds ? !knownUnreadIds.has(announcement.id) : readStates?.[index]?.exists() ?? false,
  }));
  const oldest = announcements.at(-1);
  return {
    announcements,
    hasMore: snapshot.size > pageSize,
    nextCursor: oldest?.createdAtDate ? { id: oldest.id, timestampMillis: oldest.createdAtDate.getTime() } : null,
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
