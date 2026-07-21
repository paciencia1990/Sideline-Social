export const GAME_JOIN_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const GAME_JOIN_CODE_LENGTH = 4;

export function normalizeGameJoinCodeInput(value: string) {
  return value
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '')
    .slice(0, GAME_JOIN_CODE_LENGTH);
}

export function isCompleteGameJoinCode(value: string) {
  return value.length === GAME_JOIN_CODE_LENGTH &&
    [...value].every((character) => GAME_JOIN_CODE_ALPHABET.includes(character));
}

export function spokenGameJoinCode(value: string) {
  return [...value].join(' ');
}
