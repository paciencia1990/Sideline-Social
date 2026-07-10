import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { auth, db } from "@/config/firebase";

export type TeamRole = "parent" | "coach" | "assistantCoach" | "teamParent";
export type TeamMemberStatus = "active" | "pending";
export type AppMode = "parent" | "coach";

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
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type TeamMembership = {
  id: string;
  teamId: string;
  userId: string;
  displayName: string;
  role: TeamRole;
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

export async function getCurrentUserTeamMemberships(): Promise<TeamMembership[]> {
  const user = auth.currentUser;
  if (!user) return [];

  try {
    const userSnapshot = await getDoc(doc(db, "users", user.uid));
    if (!userSnapshot.exists()) {
      return [];
    }

    const teamIds = readIndexedTeamIds(userSnapshot.data());
    const memberships = await Promise.all(teamIds.map((teamId) => getIndexedMembership(teamId, user.uid)));

    return memberships.filter((membership): membership is TeamMembership => Boolean(membership));
  } catch (error) {
    logMembershipLookupIssue(error);
    return [];
  }
}

async function getIndexedMembership(teamId: string, userId: string): Promise<TeamMembership | null> {
  try {
    const [teamSnapshot, memberSnapshot] = await Promise.all([
      getDoc(doc(db, "teams", teamId)),
      getDoc(doc(db, "teams", teamId, "members", userId)),
    ]);

    if (!teamSnapshot.exists() || !memberSnapshot.exists()) {
      return null;
    }

    const membership = normalizeMembership(memberSnapshot.id, { ...memberSnapshot.data(), teamId });
    if (membership.status !== "active") {
      return null;
    }

    return {
      ...membership,
      team: normalizeTeam(teamSnapshot.id, teamSnapshot.data()),
    };
  } catch (error) {
    logMembershipLookupIssue(error, teamId);
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
  return memberships.filter((membership) => isCoachRole(membership.role));
}

export async function getParentTeams(): Promise<TeamMembership[]> {
  const memberships = await getCurrentUserTeamMemberships();
  return memberships.filter((membership) => membership.role === "parent");
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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, "teams", teamRef.id, "members", user.uid), {
    userId: user.uid,
    teamId: teamRef.id,
    displayName,
    role: "coach",
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

export async function joinTeamByInviteCode(inviteCode: string): Promise<Team> {
  const user = requireUser();
  const normalizedCode = inviteCode.trim().toUpperCase();
  const teamsQuery = query(collection(db, "teams"), where("inviteCode", "==", normalizedCode), limit(1));
  const snapshot = await getDocs(teamsQuery);
  const teamDoc = snapshot.docs[0];

  if (!teamDoc) {
    throw new Error("Team invite code was not found.");
  }

  const displayName = resolveDisplayName();
  const batch = writeBatch(db);
  batch.set(
    doc(db, "teams", teamDoc.id, "members", user.uid),
    {
      userId: user.uid,
      teamId: teamDoc.id,
      displayName,
      role: "parent",
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  batch.update(doc(db, "teams", teamDoc.id), {
    parentIds: arrayUnion(user.uid),
    updatedAt: serverTimestamp(),
  });
  batch.set(
    doc(db, "users", user.uid),
    {
      activeTeamId: teamDoc.id,
      parentTeamIds: arrayUnion(teamDoc.id),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  await batch.commit();

  return normalizeTeam(teamDoc.id, teamDoc.data());
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
  return user?.displayName?.trim() || user?.email?.split("@")[0]?.trim() || "Sideline Parent";
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
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function normalizeMembership(id: string, data: Record<string, unknown>): TeamMembership {
  return {
    id,
    teamId: readString(data.teamId),
    userId: readString(data.userId, id),
    displayName: readString(data.displayName, "Sideline Parent"),
    role: readRole(data.role),
    status: data.status === "pending" ? "pending" : "active",
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function readRole(value: unknown): TeamRole {
  if (value === "coach" || value === "assistantCoach" || value === "teamParent" || value === "parent") {
    return value;
  }
  return "parent";
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
