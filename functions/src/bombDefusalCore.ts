import {
  type BombExpertInstruction,
  type BombLocale,
  type BombLocalizedPublicCommand,
  type BombOrderedPlayer,
  type BombPlayerRole,
  type BombPrivateCommand,
  type BombPublicCommand,
  type BombRoleAssignment,
  type BombSolution,
} from './bombDefusalTypes';
import { normalizeBombWord, validateBombChallenge } from './bombDefusalValidation';

export {
  BOMB_RIDDLE_CONCEPTS,
  BOMB_WORD_CONCEPTS,
  bombControlLabel,
  bombText,
} from './bombDefusalContent';
export {
  createBombGeneratedRound,
  normalizeBombRecentHistory,
} from './bombDefusalGenerator';
export {
  cloneBombChallenge,
  createBombChallengeFingerprint,
  decodeBombCaesar,
  encodeBombCaesar,
  evaluateBombMath,
  normalizeBombWord,
  validateBombChallenge,
  validateBombChallengeSequence,
} from './bombDefusalValidation';
export {
  BOMB_COMMAND_COUNT,
  BOMB_GENERATION_MAX_ATTEMPTS,
  BOMB_GENERATOR_VERSION,
  BOMB_MAX_STRIKES,
  BOMB_REASONING_CATEGORIES,
  BOMB_RECENT_FINGERPRINT_LIMIT,
  BOMB_ROLE_SCHEMA_VERSION,
} from './bombDefusalTypes';
export type {
  BombChallengeCategory,
  BombChallengeOption,
  BombChallengeStage,
  BombChallengeValidation,
  BombControlKind,
  BombExpertInstruction,
  BombGeneratedRound,
  BombLocale,
  BombLocalizedPublicCommand,
  BombLocalizedText,
  BombMarker,
  BombMathOperation,
  BombOrderedPlayer,
  BombPlayerRole,
  BombPrivateCommand,
  BombPublicCommand,
  BombPublicOption,
  BombReasoningCategory,
  BombResponseMode,
  BombRoleAssignment,
  BombSolution,
} from './bombDefusalTypes';

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

export function roleForBombPlayer(uid: string, assignment: BombRoleAssignment): BombPlayerRole {
  if (uid === assignment.defuserUserId) return 'defuser';
  if (uid === assignment.expertUserId) return 'expert';
  return 'support';
}

export function createBombPublicCommand(command: BombPrivateCommand, commandIndex: number): BombPublicCommand {
  const responseMode = command.responseMode ?? 'options';
  return {
    commandId: `command-${commandIndex + 1}`,
    commandIndex,
    stage: command.stage,
    category: command.category,
    controlKind: command.controlKind,
    responseMode,
    options: responseMode === 'options' ? command.options.map((option) => ({
      id: option.id,
      number: option.number,
      marker: option.marker,
      label: { ...option.label },
    })) : [],
  };
}

export function localizeBombPublicCommand(
  command: BombPrivateCommand,
  commandIndex: number,
  locale: BombLocale,
): BombLocalizedPublicCommand {
  const publicCommand = createBombPublicCommand(command, commandIndex);
  return {
    ...publicCommand,
    options: publicCommand.options.map((option) => ({ ...option, label: option.label[locale] })),
  };
}

export function createBombExpertInstruction(command: BombPrivateCommand, locale: BombLocale): BombExpertInstruction {
  return {
    stage: command.stage,
    category: command.category,
    prompt: command.prompt[locale],
    key: command.key?.[locale] ?? null,
  };
}

export function createBombSolution(command: BombPrivateCommand, locale: BombLocale): BombSolution {
  const correctOption = command.options.find((option) => option.id === command.correctOptionId);
  if (!correctOption) throw new Error('bomb_challenge_generation_invalid');
  return {
    correctOptionId: correctOption.id,
    correctOptionLabel: correctOption.label[locale],
    explanation: command.explanation[locale],
  };
}

export function isBombPrivateCommand(value: unknown): value is BombPrivateCommand {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && validateBombChallenge(value as BombPrivateCommand));
}

export function bombCommandMatches(command: BombPrivateCommand, action: Record<string, string | number>) {
  if ((command.responseMode ?? 'options') === 'options') return action.optionId === command.correctOptionId;
  if (typeof action.value !== 'string') return false;
  const normalized = normalizeBombWord(action.value);
  if (!normalized) return false;
  if (command.validation.kind === 'word') {
    return Object.values(command.validation.answer).some((answer) => normalizeBombWord(answer) === normalized);
  }
  if (command.validation.kind === 'cipher') {
    return Object.values(command.validation.decoded).some((answer) => normalizeBombWord(answer) === normalized);
  }
  return false;
}

export function normalizeBombLocale(value: unknown): BombLocale {
  return typeof value === 'string' && value.toLowerCase().startsWith('es') ? 'es' : 'en';
}
