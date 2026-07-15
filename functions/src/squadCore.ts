export const SQUAD_SPORT_IDS = [
  'baseball', 'softball', 'basketball', 'soccer', 'football', 'volleyball',
  'swimming', 'lacrosse', 'hockey', 'tennis', 'track-field', 'cheer',
  'gymnastics', 'dance', 'other',
] as const;

export type SquadSportId = typeof SQUAD_SPORT_IDS[number];

const SPORT_DISPLAY_NAMES: Record<SquadSportId, string> = {
  baseball: 'Baseball',
  softball: 'Softball',
  basketball: 'Basketball',
  soccer: 'Soccer',
  football: 'Football',
  volleyball: 'Volleyball',
  swimming: 'Swimming',
  lacrosse: 'Lacrosse',
  hockey: 'Hockey',
  tennis: 'Tennis',
  'track-field': 'Track & Field',
  cheer: 'Cheer',
  gymnastics: 'Gymnastics',
  dance: 'Dance',
  other: 'Other',
};

const SPORT_ALIASES: Record<string, SquadSportId> = {
  baseball: 'baseball', softball: 'softball', basketball: 'basketball', soccer: 'soccer',
  football: 'football', volleyball: 'volleyball', swimming: 'swimming', lacrosse: 'lacrosse',
  hockey: 'hockey', tennis: 'tennis', trackandfield: 'track-field', trackfield: 'track-field',
  'track-field': 'track-field', cheer: 'cheer', cheerleading: 'cheer', gymnastics: 'gymnastics',
  dance: 'dance', other: 'other',
};

export function normalizeVenueName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bdr\.?\b/g, 'doctor')
    .replace(/\bll\b/g, 'little league')
    .replace(/\by\.?m\.?c\.?a\.?\b/g, 'ymca')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeSportId(value: unknown): SquadSportId | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLocaleLowerCase().replace(/[_\s&]+/g, '');
  return SPORT_ALIASES[normalized] ?? SPORT_ALIASES[value.trim().toLocaleLowerCase()] ?? null;
}

export function getSportDisplayName(sportId: SquadSportId): string {
  return SPORT_DISPLAY_NAMES[sportId];
}

export function assertValidCoordinates(latitude: unknown, longitude: unknown): asserts latitude is number {
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error('INVALID_LATITUDE');
  }
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('INVALID_LONGITUDE');
  }
}

export function canonicalVenueId(venueName: string, latitude: number, longitude: number): string {
  const normalizedVenueName = normalizeVenueName(venueName);
  if (normalizedVenueName.length < 2 || normalizedVenueName.length > 120) throw new Error('INVALID_VENUE');
  assertValidCoordinates(latitude, longitude);
  const identity = `${normalizedVenueName}|${latitude.toFixed(5)}|${longitude.toFixed(5)}`;
  return `venue_${stableHash(identity).toString(36)}`;
}

export function validateVenueId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9_-]{3,160}$/.test(normalized) ? normalized : null;
}

export function venueSportKeyFor(venueId: string, sportId: SquadSportId): string {
  const canonicalVenue = validateVenueId(venueId);
  if (!canonicalVenue) throw new Error('INVALID_VENUE_ID');
  if (!SQUAD_SPORT_IDS.includes(sportId)) throw new Error('INVALID_SPORT');
  return `${canonicalVenue}__${sportId}`;
}

export function deterministicSquadId(venueSportKey: string): string {
  if (!/^[A-Za-z0-9_-]+__[a-z-]+$/.test(venueSportKey)) throw new Error('INVALID_VENUE_SPORT_KEY');
  return venueSportKey;
}

export function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function resolveJoinProjection(memberIds: unknown, userId: string, hasActiveMembership: boolean) {
  const normalizedIds = Array.isArray(memberIds)
    ? Array.from(new Set(memberIds.filter((value): value is string => typeof value === 'string' && value.length > 0)))
    : [];
  const alreadyMember = normalizedIds.includes(userId) || hasActiveMembership;
  return {
    alreadyMember,
    memberIds: normalizedIds.includes(userId) ? normalizedIds : [...normalizedIds, userId],
  };
}

export function resolveSelectionAfterLeave(squadIds: unknown, selectedSquadId: unknown, leavingSquadId: string) {
  const remainingSquadIds = Array.isArray(squadIds)
    ? Array.from(new Set(squadIds.filter((value): value is string => typeof value === 'string' && value !== leavingSquadId)))
    : [];
  const selected = typeof selectedSquadId === 'string' && remainingSquadIds.includes(selectedSquadId)
    ? selectedSquadId
    : remainingSquadIds[0] ?? null;
  return { squadIds: remainingSquadIds, selectedSquadId: selected };
}
