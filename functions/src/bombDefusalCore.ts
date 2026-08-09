export const BOMB_ROLE_SCHEMA_VERSION = 2;
export const BOMB_COMMAND_COUNT = 5;
export const BOMB_MAX_STRIKES = 3;

export const BOMB_COMMAND_TYPES = [
  'cut_wire',
  'press_button',
  'rotate_dial',
  'enter_code',
] as const;

export type BombCommandType = (typeof BOMB_COMMAND_TYPES)[number];
export type BombPlayerRole = 'defuser' | 'expert' | 'support';

export type BombPrivateCommand =
  | { type: 'cut_wire'; color: 'red' | 'blue' | 'yellow' | 'green' }
  | { type: 'press_button'; label: 'A' | 'B' | 'C' | 'D' }
  | { type: 'rotate_dial'; target: number }
  | { type: 'enter_code'; code: number };

export type BombPublicOption = {
  id: string;
  value: string | number;
  number: number;
  marker: string;
};

export type BombPublicCommand = {
  commandId: string;
  commandIndex: number;
  type: BombCommandType;
  options: BombPublicOption[];
};

export type BombOrderedPlayer = {
  uid: string;
  joinOrder: number;
};

export type BombRoleAssignment = {
  defuserUserId: string;
  expertUserId: string;
};

const WIRE_OPTIONS: BombPublicOption[] = [
  { id: 'wire-red', value: 'red', number: 1, marker: 'solid' },
  { id: 'wire-blue', value: 'blue', number: 2, marker: 'striped' },
  { id: 'wire-yellow', value: 'yellow', number: 3, marker: 'dashed' },
  { id: 'wire-green', value: 'green', number: 4, marker: 'dotted' },
];

const BUTTON_OPTIONS: BombPublicOption[] = [
  { id: 'button-a', value: 'A', number: 1, marker: 'circle' },
  { id: 'button-b', value: 'B', number: 2, marker: 'square' },
  { id: 'button-c', value: 'C', number: 3, marker: 'triangle' },
  { id: 'button-d', value: 'D', number: 4, marker: 'diamond' },
];

export function sortBombPlayers(players: BombOrderedPlayer[]) {
  return [...players]
    .filter((player) => player.uid && Number.isInteger(player.joinOrder) && player.joinOrder > 0)
    .sort((left, right) => left.joinOrder - right.joinOrder || left.uid.localeCompare(right.uid));
}

export function assignBombRoles(
  players: BombOrderedPlayer[],
  commandIndex: number,
): BombRoleAssignment | null {
  const ordered = sortBombPlayers(players);
  if (ordered.length < 2 || !Number.isInteger(commandIndex) || commandIndex < 0) return null;
  const defuserIndex = commandIndex % ordered.length;
  const expertIndex = (defuserIndex + 1) % ordered.length;
  return {
    defuserUserId: ordered[defuserIndex].uid,
    expertUserId: ordered[expertIndex].uid,
  };
}

export function roleForBombPlayer(
  uid: string,
  assignment: BombRoleAssignment,
): BombPlayerRole {
  if (uid === assignment.defuserUserId) return 'defuser';
  if (uid === assignment.expertUserId) return 'expert';
  return 'support';
}

export function createBombPublicCommand(
  command: BombPrivateCommand,
  commandIndex: number,
): BombPublicCommand {
  return {
    commandId: `command-${commandIndex + 1}`,
    commandIndex,
    type: command.type,
    options: publicOptionsForCommand(command.type),
  };
}

export function isBombPrivateCommand(value: unknown): value is BombPrivateCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const command = value as Record<string, unknown>;
  if (command.type === 'cut_wire') {
    return typeof command.color === 'string' && ['red', 'blue', 'yellow', 'green'].includes(command.color);
  }
  if (command.type === 'press_button') {
    return typeof command.label === 'string' && ['A', 'B', 'C', 'D'].includes(command.label);
  }
  if (command.type === 'rotate_dial') {
    return Number.isInteger(command.target) && Number(command.target) >= 1 && Number(command.target) <= 10;
  }
  if (command.type === 'enter_code') {
    return Number.isInteger(command.code) && Number(command.code) >= 100 && Number(command.code) <= 999;
  }
  return false;
}

export function bombCommandMatches(
  command: BombPrivateCommand,
  action: Record<string, string | number>,
) {
  if (command.type === 'cut_wire') return action.color === command.color;
  if (command.type === 'press_button') return action.label === command.label;
  if (command.type === 'rotate_dial') return action.target === command.target;
  return action.code === command.code;
}

function publicOptionsForCommand(type: BombCommandType): BombPublicOption[] {
  if (type === 'cut_wire') return WIRE_OPTIONS.map((option) => ({ ...option }));
  if (type === 'press_button') return BUTTON_OPTIONS.map((option) => ({ ...option }));
  if (type === 'rotate_dial') {
    return Array.from({ length: 10 }, (_, index) => ({
      id: `dial-${index + 1}`,
      value: index + 1,
      number: index + 1,
      marker: 'numbered',
    }));
  }
  return Array.from({ length: 10 }, (_, index) => ({
    id: `digit-${index}`,
    value: index,
    number: index,
    marker: 'keypad',
  }));
}
