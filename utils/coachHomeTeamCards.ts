export type CoachHomeTeamCard = {
  ageRange: string;
  division: string;
  inviteCode: string;
  name: string;
  sport: string;
  teamId: string;
};

type ActiveCoachMembership = {
  teamId: string;
  team?: {
    ageRange?: string | null;
    division?: string | null;
    id?: string | null;
    inviteCode?: string | null;
    name?: string | null;
    sport?: string | null;
  } | null;
};

export function createCoachHomeTeamCards(
  memberships: ActiveCoachMembership[],
): CoachHomeTeamCard[] {
  return memberships.flatMap((membership) => {
    if (!membership.team) return [];
    const teamId = cleanText(membership.team.id) || cleanText(membership.teamId);
    if (!teamId) return [];
    return [{
      ageRange: cleanText(membership.team.ageRange),
      division: cleanText(membership.team.division),
      inviteCode: cleanText(membership.team.inviteCode),
      name: cleanText(membership.team.name),
      sport: cleanText(membership.team.sport),
      teamId,
    }];
  });
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
