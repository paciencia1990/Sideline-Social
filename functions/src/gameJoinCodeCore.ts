import { randomInt } from 'node:crypto';

export const GAME_JOIN_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const GAME_JOIN_CODE_LENGTH = 4;
export const GAME_JOIN_CODE_RESERVATION_ATTEMPTS = 20;

export const GAME_JOIN_CODE_TYPES = [
  'bombDefusal',
  'triviaBlitz',
  'spotTheDifferences',
] as const;

export type GameJoinCodeType = (typeof GAME_JOIN_CODE_TYPES)[number];
export type GameJoinCodeStatus = 'lobby' | 'started' | 'ended' | 'canceled' | 'expired';

export function normalizeGameJoinCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase().replace(/[\s-]/g, '');
  if (normalized.length !== GAME_JOIN_CODE_LENGTH) return null;
  return [...normalized].every((character) => GAME_JOIN_CODE_ALPHABET.includes(character))
    ? normalized
    : null;
}

export function readGameJoinCodeType(value: unknown): GameJoinCodeType | null {
  return GAME_JOIN_CODE_TYPES.includes(value as GameJoinCodeType)
    ? value as GameJoinCodeType
    : null;
}

export function generateSecureGameJoinCode(
  secureIndex: (maximum: number) => number = (maximum) => randomInt(maximum),
): string {
  let code = '';
  for (let index = 0; index < GAME_JOIN_CODE_LENGTH; index += 1) {
    code += GAME_JOIN_CODE_ALPHABET[secureIndex(GAME_JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

export async function retryGameJoinCodeReservation<T>(
  reserve: (candidate: string, attempt: number) => Promise<T | null>,
  options: {
    attempts?: number;
    generate?: () => string;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? GAME_JOIN_CODE_RESERVATION_ATTEMPTS;
  const generate = options.generate ?? generateSecureGameJoinCode;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const reserved = await reserve(generate(), attempt);
    if (reserved !== null) return reserved;
  }
  throw new GameJoinCodeReservationError();
}

export class GameJoinCodeReservationError extends Error {
  constructor() {
    super('The game code space could not be reserved safely.');
    this.name = 'GameJoinCodeReservationError';
  }
}

export function legacyRealtimeGameType(gameType: GameJoinCodeType) {
  if (gameType === 'bombDefusal') return 'bomb_defusal';
  if (gameType === 'spotTheDifferences') return 'spot_difference';
  return 'trivia_blitz';
}
