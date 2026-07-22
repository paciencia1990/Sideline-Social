import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { auth, db, functions } from "@/config/firebase";
import { formatPublicUserName } from "@/utils/friendPrivacy";

export type TeamRole = "parent" | "coach" | "assistantCoach" | "teamParent";
export type TeamMemberStatus = "active" | "pending" | "inactive" | "removed";
export type TeamStatus = "active" | "archived";
export type TeamRoleFlags = {
  parent: boolean;
  coach: boolean;
  staff: boolean;
};
export type TeamRoleKey = keyof TeamRoleFlags;

export type AppMode = "parent" | "coach";

export type TeamLookupOptions = {
  throwOnError?: boolean;
};

export type TeamChildInput = {
  childIds?: string[];
};

export type Team = {
  id: string;
  name: string;
  sport: string;
  ageRange: string;
  division: string;
  season: string;
  leagueId?: string | null;
  squadId?: string | null;
  createdBy: string;
  inviteCode: string;
  coachIds: string[];
  parentIds: string[];
  status: TeamStatus;
  archivedAt?: unknown;
  archivedBy?: string | null;
  restoredAt?: unknown;
  restoredBy?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type TeamMembership = {
  id: string;
  teamId: string;
  userId: string;
  displayName: string;
  childId?: string | null;
  childName: string;
  role: TeamRole;
  roles: TeamRoleFlags;
  status: TeamMemberStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
  team?: Team | null;
};

export type TeamInput = {
  name: string;
  sport: string;
  ageRange?: string;
  division?: string;
  season?: string;
  leagueId?: string | null;
  squadId?: string | null;
};

const COACH_ROLES: TeamRole[] = ["coach", "assistantCoach", "teamParent"];
const INVITE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function isCoachRole(role?: string | null) {
  return COACH_ROLES.includes(role as TeamRole);
}

export function hasTeamRole(
  membership: Pick<TeamMembership, "roles"> | null | undefined,
  role: TeamRoleKey,
) {
  return membership?.roles[role] === true;
}

export function hasCoachAccess(membership: Pick<TeamMembership, "roles"> | null | undefined) {
  return hasTeamRole(membership, "coach") || hasTeamRole(membership, "staff");
}

export function isTeamActive(team: Pick<Team, "status"> | null | undefined) {
  return team?.status === "active";
}

export function canSendTeamMessages(membership: Pick<TeamMembership, "roles"> | null | undefined) {
  return hasCoachAccess(membership);
}

export function canManageTeamAnnouncements(
  membership: Pick<TeamMembership, "roles" | "status"> | null | undefined,
  team: Pick<Team, "status"> | null | undefined,
) {
  return membership?.status === "active" && isTeamActive(team) && hasCoachAccess(membership);
}

export function canManageTeamRoles(
  membership: Pick<TeamMembership, "roles" | "status" | "userId"> | null | undefined,
  team?: Pick<Team, "createdBy"> | null,
) {
  return Boolean(membership?.status === "active" &&
    (hasTeamRole(membership, "coach") || team?.createdBy === membership.userId));
}

export function isEligibleStaffRoleTarget(
  membership: Pick<TeamMembership, "roles" | "status"> | null | undefined,
) {
  return membership?.status === "active" &&
    hasTeamRole(membership, "parent") &&
    !hasTeamRole(membership, "coach");
}

export async function getCurrentUserTeamMemberships(options: TeamLookupOptions = {}): Promise<TeamMembership[]> {
  const user = auth.currentUser;
  if (!user) return [];

  try {
    const userSnapshot = await getDoc(doc(db, "users", user.uid));
    if (!userSnapshot.exists()) {
      return [];
    }

    const teamIds = readIndexedTeamIds(userSnapshot.data());
    const results = await Promise.allSettled(
      teamIds.map((teamId) => getIndexedMembership(teamId, user.uid, options)),
    );
    const memberships = results
      .filter((result): result is PromiseFulfilledResult<TeamMembership | null> => result.status === "fulfilled")
      .map((result) => result.value)
      .filter((membership): membership is TeamMembership => Boolean(membership));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (options.throwOnError && memberships.length === 0 && failed) throw failed.reason;

    return memberships;
  } catch (error) {
    logMembershipLookupIssue(error);
    if (options.throwOnError) throw error;
    return [];
  }
}

async function getIndexedMembership(teamId: string, userId: string, options: TeamLookupOptions): Promise<TeamMembership | null> {
  try {
    // Read the caller's membership first. A removed parent can still read their
    // own membership document, but no longer has permission to read the team.
    // Checking status before the team lookup lets stale user indexes resolve to
    // an inactive membership instead of surfacing a misleading permission error.
    const memberSnapshot = await getDoc(doc(db, "teams", teamId, "members", userId));
    if (!memberSnapshot.exists()) {
      return null;
    }

    const membership = normalizeMembership(memberSnapshot.id, { ...memberSnapshot.data(), teamId });
    if (membership.status !== "active") {
      return null;
    }

    const teamSnapshot = await getDoc(doc(db, "teams", teamId));
    if (!teamSnapshot.exists()) {
      return null;
    }

    return {
      ...membership,
      team: normalizeTeam(teamSnapshot.id, teamSnapshot.data()),
    };
  } catch (error) {
    logMembershipLookupIssue(error, teamId);
    if (options.throwOnError) throw error;
    return null;
  }
}

function readIndexedTeamIds(data: Record<string, unknown>) {
  return uniqueStrings([
    ...readStringArray(data.coachTeamIds),
    ...readStringArray(data.parentTeamIds),
    readNullableString(data.activeTeamId) ?? "",
  ]);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim())));
}

function logMembershipLookupIssue(error: unknown, teamId?: string) {
  if (!__DEV__) {
    return;
  }

  console.info("[TeamService] memberships unavailable", {
    code: getFirebaseErrorCode(error),
    teamId: teamId ?? "user-index",
  });
}

export async function getCoachTeams(): Promise<TeamMembership[]> {
  const memberships = await getCurrentUserTeamMemberships();
  return memberships.filter((membership) => hasCoachAccess(membership) && isTeamActive(membership.team));
}

export async function getParentTeams(options: TeamLookupOptions = {}): Promise<TeamMembership[]> {
  const memberships = await getCurrentUserTeamMemberships(options);
  return memberships.filter((membership) => hasTeamRole(membership, "parent") && isTeamActive(membership.team));
}

export async function createTeam(input: TeamInput): Promise<Team> {
  const user = requireUser();
  const inviteCode = generateInviteCode();
  const displayName = resolveDisplayName();
  const teamRef = doc(collection(db, "teams"));
  const memberPath = `teams/${teamRef.id}/members/${user.uid}`;
  const teamPath = `teams/${teamRef.id}`;
  const userPath = `users/${user.uid}`;
  const batch = writeBatch(db);

  batch.set(teamRef, {
    name: input.name.trim(),
    sport: input.sport.trim(),
    ageRange: input.ageRange?.trim() ?? "",
    division: input.division?.trim() ?? "",
    season: input.season?.trim() ?? "",
    leagueId: input.leagueId ?? null,
    squadId: input.squadId ?? null,
    createdBy: user.uid,
    inviteCode,
    coachIds: [user.uid],
    parentIds: [],
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, "teams", teamRef.id, "members", user.uid), {
    userId: user.uid,
    teamId: teamRef.id,
    displayName,
    role: "coach",
    roles: {
      parent: false,
      coach: true,
      staff: false,
    },
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(
    doc(db, "users", user.uid),
    {
      activeMode: "coach",
      defaultMode: "coach",
      activeTeamId: teamRef.id,
      coachTeamIds: arrayUnion(teamRef.id),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  logCreateTeamDiagnostics("commit-start", { memberPath, teamPath, userId: user.uid, userPath });

  try {
    await batch.commit();
  } catch (error) {
    logCreateTeamDiagnostics("commit-error", {
      code: getFirebaseErrorCode(error),
      memberPath,
      message: error instanceof Error ? error.message : String(error),
      teamPath,
      userId: user.uid,
      userPath,
    });
    throw error;
  }

  const created = await getTeamById(teamRef.id);
  if (!created) {
    throw new Error("Team was created but could not be loaded.");
  }

  return created;
}

export async function joinTeamByInviteCode(inviteCode: string, child: TeamChildInput = {}): Promise<Team> {
  const callable = httpsCallable<
    { inviteCode: string; childIds: string[] },
    { team: Record<string, unknown> & { id: string } }
  >(functions, "joinParentTeamByInviteCode");
  const response = await callable({
    inviteCode: inviteCode.trim().toUpperCase(),
    childIds: Array.from(new Set(child.childIds ?? [])),
  });
  return normalizeTeam(response.data.team.id, response.data.team);
}

export async function setTeamStaffRole(teamId: string, targetUserId: string, isStaff: boolean) {
  const callable = httpsCallable<
    { teamId: string; targetUserId: string; isStaff: boolean },
    { roles: TeamRoleFlags; role: TeamRole }
  >(functions, "setTeamStaffRole");
  const response = await callable({
    teamId: teamId.trim(),
    targetUserId: targetUserId.trim(),
    isStaff,
  });
  return {
    roles: resolveTeamRoles(response.data.roles, response.data.role),
    role: readRole(response.data.role),
  };
}

export async function leaveParentTeam(teamId: string) {
  const callable = httpsCallable<
    { teamId: string },
    { roles: TeamRoleFlags; status: TeamMemberStatus }
  >(functions, "leaveParentTeam");
  const response = await callable({ teamId: teamId.trim() });
  return {
    roles: resolveTeamRoles(response.data.roles, null),
    status: readMemberStatus(response.data.status),
  };
}

export async function setTeamArchived(teamId: string, archived: boolean) {
  const callable = httpsCallable<
    { teamId: string; archived: boolean },
    { status: TeamStatus; inviteCode: string | null }
  >(functions, "setTeamArchived");
  const response = await callable({ teamId: teamId.trim(), archived });
  return {
    status: readTeamStatus(response.data.status),
    inviteCode: readNullableString(response.data.inviteCode),
  };
}

export async function getTeamById(teamId: string): Promise<Team | null> {
  if (!teamId) return null;

  try {
    const snapshot = await getDoc(doc(db, "teams", teamId));
    return snapshot.exists() ? normalizeTeam(snapshot.id, snapshot.data()) : null;
  } catch (error) {
    console.warn("[TeamService] get team error:", error);
    return null;
  }
}

export async function getTeamMembers(teamId: string): Promise<TeamMembership[]> {
  if (!teamId) return [];

  try {
    const snapshot = await getDocs(collection(db, "teams", teamId, "members"));
    return snapshot.docs
      .map((memberDoc) => normalizeMembership(memberDoc.id, { ...memberDoc.data(), teamId }))
      .filter((member) => member.status === "active");
  } catch (error) {
    console.warn("[TeamService] get members error:", error);
    throw error;
  }
}

export async function switchActiveTeam(teamId: string) {
  const team = await getTeamById(teamId);
  if (!team) {
    throw new Error("Team could not be found.");
  }

  await updateUserMode({ activeTeamId: teamId });
  return team;
}

export async function switchActiveMode(activeMode: AppMode) {
  await updateUserMode({ activeMode });
}

export function getMembershipDisplayName(membership: TeamMembership) {
  return membership.team?.name ?? membership.displayName;
}

function requireUser() {
  const user = auth.currentUser;
  if (!user) {
    const error = new Error("Please sign in to use teams.");
    (error as { code?: string }).code = "unauthenticated";
    throw error;
  }
  return user;
}

function getFirebaseErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

function logCreateTeamDiagnostics(event: "commit-error" | "commit-start", details: Record<string, string>) {
  if (!__DEV__) {
    return;
  }

  console.info("[TeamService] createTeam", { event, ...details });
}

function resolveDisplayName() {
  const user = auth.currentUser;
  return formatPublicUserName(user?.displayName) ?? "Sideline Social member";
}

function generateInviteCode() {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += INVITE_CHARACTERS[Math.floor(Math.random() * INVITE_CHARACTERS.length)];
  }
  return code;
}

async function updateUserMode(values: { activeMode?: AppMode; defaultMode?: AppMode; activeTeamId?: string }) {
  const user = requireUser();
  await setDoc(
    doc(db, "users", user.uid),
    {
      ...values,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

function normalizeTeam(id: string, data: Record<string, unknown>): Team {
  return {
    id,
    name: readString(data.name, "Untitled Team"),
    sport: readString(data.sport, "Youth Sports"),
    ageRange: readString(data.ageRange),
    division: readString(data.division),
    season: readString(data.season),
    leagueId: readNullableString(data.leagueId),
    squadId: readNullableString(data.squadId),
    createdBy: readString(data.createdBy),
    inviteCode: readString(data.inviteCode),
    coachIds: readStringArray(data.coachIds),
    parentIds: readStringArray(data.parentIds),
    status: readTeamStatus(data.status),
    archivedAt: data.archivedAt,
    archivedBy: readNullableString(data.archivedBy),
    restoredAt: data.restoredAt,
    restoredBy: readNullableString(data.restoredBy),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function normalizeMembership(id: string, data: Record<string, unknown>): TeamMembership {
  return {
    id,
    teamId: readString(data.teamId),
    userId: readString(data.userId, id),
    displayName: readString(data.displayName, "Sideline Social member"),
    childId: readNullableString(data.childId),
    childName: readString(data.childName),
    role: readRole(data.role),
    roles: resolveTeamRoles(data.roles, data.role),
    status: readMemberStatus(data.status),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function readMemberStatus(value: unknown): TeamMemberStatus {
  if (value === "active" || value === "pending" || value === "inactive" || value === "removed") {
    return value;
  }
  return "inactive";
}
function readTeamStatus(value: unknown): TeamStatus {
  return value === "archived" ? "archived" : "active";
}
function readRole(value: unknown): TeamRole {
  if (value === "coach" || value === "assistantCoach" || value === "teamParent" || value === "parent") {
    return value;
  }
  return "parent";
}

export function resolveTeamRoles(value: unknown, legacyRole: unknown): TeamRoleFlags {
  const roles = isRecord(value) ? value : {};
  return {
    parent: roles.parent === true || legacyRole === "parent",
    coach: roles.coach === true || legacyRole === "coach",
    staff:
      roles.staff === true ||
      legacyRole === "assistantCoach" ||
      legacyRole === "teamParent",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
