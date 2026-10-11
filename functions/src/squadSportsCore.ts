import { getSportDisplayName, normalizeSportId, SQUAD_SPORT_IDS, type SquadSportId } from './squadCore';

export function validateSquadSports(value: unknown): SquadSportId[] | null {
  if (!Array.isArray(value) || !value.length || value.length > SQUAD_SPORT_IDS.length
    || value.some((id) => typeof id !== 'string' || !SQUAD_SPORT_IDS.includes(id as SquadSportId))) return null;
  return SQUAD_SPORT_IDS.filter((id) => value.includes(id));
}

export function readSquadSports(squad: Record<string, unknown>): SquadSportId[] {
  return validateSquadSports(squad.sportIds)
    ?? [normalizeSportId(squad.sportId ?? squad.sportDisplayName ?? squad.sport) ?? 'other'];
}

export function squadSportsRevision(squad: Record<string, unknown>): number {
  return Number.isSafeInteger(squad.sportsRevision) && Number(squad.sportsRevision) >= 0 ? Number(squad.sportsRevision) : 0;
}

export function squadSportsFields(sportIds: SquadSportId[], previousPrimary?: unknown) {
  const previous = normalizeSportId(previousPrimary);
  const sportId = previous && sportIds.includes(previous) ? previous : sportIds[0];
  // Keep the primary field for already installed clients. Squad IDs never depend on edits.
  return { sportIds, sportId, sport: getSportDisplayName(sportId), sportDisplayName: getSportDisplayName(sportId) };
}
