export type StableChildIdentity = {
  id: string;
  displayName: string;
  legacy: boolean;
};

export type ChildAssociationTeam = {
  teamId: string;
  team: { name: string };
  children: StableChildIdentity[];
  legacyChildName: string | null;
};

export type ChildLinkedTeam = ChildAssociationTeam & {
  unreadCount: number;
  latestAnnouncement: { createdAtDate: Date | null } | null;
};

export type ParentHomeTeamRow = {
  key: string;
  teamId: string;
  teamName: string;
  childId: string | null;
  childName: string | null;
};

export type ChildLinkedTeamGroup<T extends ChildAssociationTeam> = {
  key: string;
  childId: string | null;
  childName: string | null;
  legacy: boolean;
  teams: T[];
};

export function groupTeamsByChild<T extends ChildAssociationTeam>(teams: T[]): ChildLinkedTeamGroup<T>[] {
  const groups = new Map<string, ChildLinkedTeamGroup<T>>();
  teams.forEach((team) => {
    resolveDisplayIdentities(team).forEach((identity) => {
      const existing = groups.get(identity.id);
      if (existing) {
        if (!existing.teams.some((existingTeam) => existingTeam.teamId === team.teamId)) {
          existing.teams.push(team);
        }
        return;
      }
      groups.set(identity.id, {
        key: identity.id,
        childId: identity.legacy ? null : identity.id,
        childName: identity.displayName || null,
        legacy: identity.legacy,
        teams: [team],
      });
    });
  });
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      teams: [...group.teams].sort((first, second) => first.team.name.localeCompare(second.team.name)),
    }))
    .sort((first, second) => {
      const nameComparison = (first.childName ?? "").localeCompare(second.childName ?? "");
      return nameComparison || first.key.localeCompare(second.key);
    });
}

export function buildParentHomeTeamRows<T extends ChildAssociationTeam>(teams: T[]): ParentHomeTeamRow[] {
  const uniqueTeams = Array.from(new Map(teams.map((team) => [team.teamId, team])).values());
  return uniqueTeams
    .flatMap((team) => resolveDisplayIdentities(team).map((identity) => ({
      key: JSON.stringify([identity.id, team.teamId]),
      teamId: team.teamId,
      teamName: team.team.name,
      childId: identity.legacy ? null : identity.id,
      childName: identity.displayName || null,
    })))
    .sort((first, second) => {
      const childComparison = (first.childName ?? "").localeCompare(second.childName ?? "");
      if (childComparison) return childComparison;
      const teamComparison = first.teamName.localeCompare(second.teamName);
      if (teamComparison) return teamComparison;
      return first.key.localeCompare(second.key);
    });
}

export function summarizeTeamUpdates<T extends ChildLinkedTeam>(teams: T[]) {
  const uniqueTeams = Array.from(new Map(teams.map((team) => [team.teamId, team])).values());
  const latestTeam = [...uniqueTeams]
    .filter((team) => team.latestAnnouncement)
    .sort((first, second) => getLatestMillis(second) - getLatestMillis(first))[0] ?? null;
  return {
    totalTeams: uniqueTeams.length,
    unreadCount: uniqueTeams.reduce((total, team) => total + team.unreadCount, 0),
    latestTeam,
  };
}

function resolveDisplayIdentities(team: ChildAssociationTeam): StableChildIdentity[] {
  const identities = [...team.children];
  if (team.legacyChildName) {
    identities.push({
      id: "legacy:" + team.teamId,
      displayName: team.legacyChildName,
      legacy: true,
    });
  }
  if (identities.length > 0) return identities;
  return [{
    id: "unassigned:" + team.teamId,
    displayName: "",
    legacy: true,
  }];
}

function getLatestMillis(team: ChildLinkedTeam) {
  return team.latestAnnouncement?.createdAtDate?.getTime() ?? 0;
}
