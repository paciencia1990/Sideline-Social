import { createHash } from 'node:crypto';

import { bombControlLabel } from './bombDefusalContent';
import {
  BOMB_COMMAND_COUNT,
  BOMB_REASONING_CATEGORIES,
  type BombChallengeOption,
  type BombChallengeValidation,
  type BombLocalizedText,
  type BombMathOperation,
  type BombMathValidation,
  type BombPrivateCommand,
} from './bombDefusalTypes';

export const BOMB_CIPHER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MAX_PROMPT_LENGTH = 360;
const MAX_EXPLANATION_LENGTH = 500;
const MAX_KEY_LENGTH = 180;
const MAX_LABEL_LENGTH = 80;
const ID_PATTERN = /^[a-z0-9-]{4,80}$/;

export function validateBombChallengeSequence(commands: BombPrivateCommand[]) {
  if (commands.length !== BOMB_COMMAND_COUNT || commands.some((command) => !validateBombChallenge(command))) return false;
  if (commands[0].stage !== 'direct' || commands[1].stage !== 'interpretation' || commands[5].stage !== 'combined') return false;
  const reasoning = commands.slice(2, 5);
  return reasoning.every((command) => command.stage === 'reasoning') &&
    new Set(reasoning.map((command) => command.category)).size === 3;
}

export function validateBombChallenge(command: BombPrivateCommand) {
  if (
    !command ||
    typeof command !== 'object' ||
    !(['direct', 'interpretation', 'reasoning', 'combined'] as const).includes(command.stage) ||
    !(['direct', 'position', 'math', 'word', 'riddle', 'cipher', 'combined'] as const).includes(command.category) ||
    !(['wire', 'symbol', 'number', 'word', 'mixed'] as const).includes(command.controlKind) ||
    !ID_PATTERN.test(command.challengeId) ||
    !ID_PATTERN.test(command.correctOptionId) ||
    !isLocalizedText(command.prompt, MAX_PROMPT_LENGTH) ||
    !isLocalizedText(command.explanation, MAX_EXPLANATION_LENGTH) ||
    (command.key !== undefined && !isLocalizedText(command.key, MAX_KEY_LENGTH)) ||
    !Array.isArray(command.options) ||
    command.options.length !== 4 ||
    !validateOptions(command.options, command.correctOptionId)
  ) return false;

  if (
    (command.stage === 'direct' && command.category !== 'direct') ||
    (command.stage === 'interpretation' && command.category !== 'position') ||
    (command.stage === 'reasoning' && !BOMB_REASONING_CATEGORIES.includes(command.category as never)) ||
    (command.stage === 'combined' && command.category !== 'combined')
  ) return false;

  const validation = command.validation;
  if (!validation || typeof validation !== 'object' || Array.isArray(validation)) return false;
  const expectedKind = command.stage === 'direct'
    ? 'direct'
    : command.stage === 'interpretation'
      ? 'position'
      : command.stage === 'combined'
        ? 'combined'
        : command.category;
  if (validation.kind !== expectedKind) return false;

  const correct = command.options.find((option) => option.id === command.correctOptionId);
  if (!correct) return false;
  switch (validation.kind) {
    case 'direct':
      return validation.targetOptionId === command.correctOptionId &&
        validation.usesNonColorIdentifier === true &&
        (['en', 'es'] as const).every((locale) =>
          command.prompt[locale].includes(String(correct.number)) &&
          normalizeForComparison(command.prompt[locale]).includes(normalizeForComparison(correct.label[locale])));
    case 'position':
      return validatePosition(validation, command.options, correct);
    case 'math':
      return validateMath(validation, correct);
    case 'word':
      return validateWord(validation, correct);
    case 'riddle': {
      const expected = typeof validation.answerConceptId === 'string'
        ? bombControlLabel(validation.answerConceptId)
        : null;
      return Boolean(expected) && (['en', 'es'] as const).every((locale) =>
        normalizeForComparison(correct.label[locale]) === normalizeForComparison(expected![locale]));
    }
    case 'cipher':
      return validateCipher(validation, correct) && Boolean(command.key);
    case 'combined':
      return validateCombined(validation, command.options, correct);
  }
}

export function evaluateBombMath(operation: BombMathOperation, operands: number[]): number | null {
  if (!Array.isArray(operands) || operands.some((value) => !Number.isInteger(value) || value < 0 || value > 60)) return null;
  let result: number | null = null;
  if (operation === 'addition' && operands.length === 2) result = operands[0] + operands[1];
  if (operation === 'subtraction' && operands.length === 2) result = operands[0] - operands[1];
  if (operation === 'multiply-add' && operands.length === 3) result = operands[0] * operands[1] + operands[2];
  if (operation === 'multiply-subtract' && operands.length === 3) result = operands[0] * operands[1] - operands[2];
  if (operation === 'divide-add' && operands.length === 3 && operands[1] > 0 && operands[0] % operands[1] === 0) result = operands[0] / operands[1] + operands[2];
  if (operation === 'divide-subtract' && operands.length === 3 && operands[1] > 0 && operands[0] % operands[1] === 0) result = operands[0] / operands[1] - operands[2];
  if (operation === 'missing-addend' && operands.length === 2) result = operands[0] - operands[1];
  if (operation === 'larger-total' && operands.length === 4) result = Math.max(operands[0] + operands[1], operands[2] + operands[3]);
  return result !== null && Number.isInteger(result) && result >= 0 && result <= 120 ? result : null;
}

export function encodeBombCaesar(value: string, shift: number) {
  const normalized = value.toUpperCase();
  if (!Number.isInteger(shift) || shift < 1 || shift > 5 || !/^[A-Z]+$/.test(normalized)) return null;
  return [...normalized].map((letter) => {
    const index = BOMB_CIPHER_ALPHABET.indexOf(letter);
    return BOMB_CIPHER_ALPHABET[(index + shift) % BOMB_CIPHER_ALPHABET.length];
  }).join('');
}

export function decodeBombCaesar(value: string, shift: number) {
  const normalized = value.toUpperCase();
  if (!Number.isInteger(shift) || shift < 1 || shift > 5 || !/^[A-Z]+$/.test(normalized)) return null;
  return [...normalized].map((letter) => {
    const index = BOMB_CIPHER_ALPHABET.indexOf(letter);
    return BOMB_CIPHER_ALPHABET[(index - shift + BOMB_CIPHER_ALPHABET.length) % BOMB_CIPHER_ALPHABET.length];
  }).join('');
}

export function createBombChallengeFingerprint(command: BombPrivateCommand) {
  const payload = fingerprintValidation(command.validation, command);
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
}

export function cloneBombChallenge(command: BombPrivateCommand): BombPrivateCommand {
  return {
    ...command,
    prompt: { ...command.prompt },
    explanation: { ...command.explanation },
    ...(command.key ? { key: { ...command.key } } : {}),
    options: command.options.map((option) => ({ ...option, label: { ...option.label } })),
    validation: JSON.parse(JSON.stringify(command.validation)) as BombChallengeValidation,
  };
}

export function normalizeBombWord(value: string) {
  return value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '');
}

function validateOptions(options: BombChallengeOption[], correctOptionId: string) {
  const ids = options.map((option) => option.id);
  const numbers = options.map((option) => option.number);
  const markers = options.map((option) => option.marker);
  if (
    options.some((option) => !option || !ID_PATTERN.test(option.id) || !Number.isInteger(option.number) ||
      !(['solid', 'striped', 'dashed', 'dotted', 'circle', 'square', 'triangle', 'diamond'] as const).includes(option.marker) ||
      !isLocalizedText(option.label, MAX_LABEL_LENGTH) ||
      (option.color !== undefined && !(['red', 'blue', 'yellow', 'green'] as const).includes(option.color))) ||
    new Set(ids).size !== 4 ||
    new Set(numbers).size !== 4 ||
    new Set(markers).size !== 4 ||
    numbers.slice().sort((a, b) => a - b).some((number, index) => number !== index + 1) ||
    options.filter((option) => option.id === correctOptionId).length !== 1
  ) return false;
  return (['en', 'es'] as const).every((locale) => {
    const labels = options.map((option) => normalizeForComparison(option.label[locale]));
    return labels.every(Boolean) && new Set(labels).size === 4;
  });
}

function validatePosition(
  validation: Extract<BombChallengeValidation, { kind: 'position' }>,
  options: BombChallengeOption[],
  correct: BombChallengeOption,
) {
  const anchorOptionIds = Array.isArray(validation.anchorOptionIds) && validation.anchorOptionIds.every((id) => typeof id === 'string')
    ? validation.anchorOptionIds
    : [];
  if (anchorOptionIds.some((id) => !options.some((option) => option.id === id))) return false;
  if (validation.template === 'ordinal') return anchorOptionIds.length === 0 && validation.ordinal === correct.number;
  if (validation.template === 'offset') {
    const anchor = options.find((option) => option.id === anchorOptionIds[0]);
    return anchorOptionIds.length === 1 && Boolean(anchor) &&
      Number.isInteger(validation.offset) && validation.offset !== 0 && anchor!.number + Number(validation.offset) === correct.number;
  }
  if (validation.template === 'between') {
    const anchors = anchorOptionIds.map((id) => options.find((option) => option.id === id));
    return anchors.length === 2 && anchors.every(Boolean) &&
      Math.abs(anchors[0]!.number - anchors[1]!.number) === 2 &&
      (anchors[0]!.number + anchors[1]!.number) / 2 === correct.number;
  }
  return false;
}

function validateMath(validation: BombMathValidation, correct: BombChallengeOption) {
  const computed = evaluateBombMath(validation.operation, validation.operands);
  return computed !== null && computed === validation.answer && Number(correct.label.en) === computed && Number(correct.label.es) === computed;
}

function validateWord(validation: Extract<BombChallengeValidation, { kind: 'word' }>, correct: BombChallengeOption) {
  if (!isLocalizedText(validation.answer, MAX_LABEL_LENGTH) || !isLocalizedText(validation.scramble, MAX_LABEL_LENGTH)) return false;
  return (['en', 'es'] as const).every((locale) =>
    sortedLetters(validation.answer[locale]) === sortedLetters(validation.scramble[locale]) &&
    normalizeBombWord(validation.answer[locale]) !== normalizeBombWord(validation.scramble[locale]) &&
    normalizeForComparison(correct.label[locale]) === normalizeForComparison(validation.answer[locale]));
}

function validateCipher(validation: Extract<BombChallengeValidation, { kind: 'cipher' }>, correct: BombChallengeOption) {
  if (
    !isLocalizedText(validation.decoded, MAX_LABEL_LENGTH) ||
    !isLocalizedText(validation.encoded, MAX_LABEL_LENGTH) ||
    !Number.isInteger(validation.shift) ||
    validation.shift < 1 ||
    validation.shift > 5
  ) return false;
  return (['en', 'es'] as const).every((locale) =>
    encodeBombCaesar(validation.decoded[locale], validation.shift) === validation.encoded[locale] &&
    decodeBombCaesar(validation.encoded[locale], validation.shift) === validation.decoded[locale] &&
    normalizeForComparison(correct.label[locale]) === normalizeForComparison(validation.decoded[locale]));
}

function validateCombined(
  validation: Extract<BombChallengeValidation, { kind: 'combined' }>,
  options: BombChallengeOption[],
  correct: BombChallengeOption,
) {
  if (
    !Array.isArray(validation.mechanics) ||
    validation.mechanics.length !== 2 ||
    validation.mechanics.some((mechanic) => typeof mechanic !== 'string' || !mechanic.trim()) ||
    new Set(validation.mechanics).size !== 2
  ) return false;
  if (validation.targetMarker && validation.targetMarker !== correct.marker) return false;
  if (validation.recipe === 'math-marker' || validation.recipe === 'math-symbol') {
    if (!validation.math) return false;
    return evaluateBombMath(validation.math.operation, validation.math.operands) === validation.math.answer && validation.math.answer === correct.number;
  }
  if (validation.recipe === 'word-marker') {
    return Boolean(validation.word) && validateWord({ kind: 'word', ...validation.word! }, correct);
  }
  const anchor = options.find((option) => option.id === validation.anchorOptionId);
  if (!anchor || !Number.isInteger(validation.offset) || validation.offset === 0 || anchor.number + Number(validation.offset) !== correct.number) return false;
  if (validation.recipe === 'cipher-position') {
    return Boolean(validation.cipher) && validateCipher({ kind: 'cipher', ...validation.cipher! }, anchor);
  }
  if (validation.recipe === 'riddle-position') {
    const expected = validation.anchorConceptId ? bombControlLabel(validation.anchorConceptId) : null;
    return Boolean(validation.riddleConceptId && expected) && (['en', 'es'] as const).every((locale) =>
      normalizeForComparison(anchor.label[locale]) === normalizeForComparison(expected![locale]));
  }
  return validation.recipe === 'position-pattern';
}

function fingerprintValidation(validation: BombChallengeValidation, command: BombPrivateCommand) {
  switch (validation.kind) {
    case 'direct': return { kind: validation.kind, template: validation.template, target: validation.targetConceptId };
    case 'position': return { kind: validation.kind, template: validation.template, anchors: validation.anchorConceptIds ?? [], offset: validation.offset, ordinal: validation.ordinal };
    case 'math': return validation;
    case 'word': return { kind: validation.kind, conceptId: validation.conceptId };
    case 'riddle': return { kind: validation.kind, conceptId: validation.conceptId };
    case 'cipher': return { kind: validation.kind, conceptId: validation.conceptId, shift: validation.shift };
    case 'combined': return {
      kind: validation.kind,
      recipe: validation.recipe,
      anchor: validation.anchorConceptId,
      offset: validation.offset,
      math: validation.math,
      word: validation.word?.conceptId,
      cipher: validation.cipher ? [validation.cipher.conceptId, validation.cipher.shift] : undefined,
      riddle: validation.riddleConceptId,
      marker: validation.targetMarker,
      correct: command.options.find((option) => option.id === command.correctOptionId)?.label.en,
    };
  }
}

function isLocalizedText(value: unknown, maxLength: number): value is BombLocalizedText {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const localized = value as Record<string, unknown>;
  return (['en', 'es'] as const).every((locale) =>
    typeof localized[locale] === 'string' && localized[locale].trim().length > 0 && localized[locale].trim().length <= maxLength);
}

function sortedLetters(value: string) {
  return [...normalizeBombWord(value)].sort().join('');
}

function normalizeForComparison(value: string) {
  return normalizeBombWord(value);
}
