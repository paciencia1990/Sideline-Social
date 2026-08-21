export const BOMB_ROLE_SCHEMA_VERSION = 3;
export const BOMB_COMMAND_COUNT = 6;
export const BOMB_MAX_STRIKES = 1;
export const BOMB_GENERATOR_VERSION = 1;
export const BOMB_RECENT_FINGERPRINT_LIMIT = 30;
export const BOMB_GENERATION_MAX_ATTEMPTS = 12;

export const BOMB_REASONING_CATEGORIES = ['math', 'word', 'riddle', 'cipher'] as const;

export type BombLocale = 'en' | 'es';
export type BombPlayerRole = 'defuser' | 'expert' | 'support';
export type BombChallengeStage = 'direct' | 'interpretation' | 'reasoning' | 'combined';
export type BombReasoningCategory = (typeof BOMB_REASONING_CATEGORIES)[number];
export type BombChallengeCategory = 'direct' | 'position' | BombReasoningCategory | 'combined';
export type BombControlKind = 'wire' | 'symbol' | 'number' | 'word' | 'mixed';
export type BombMarker = 'solid' | 'striped' | 'dashed' | 'dotted' | 'circle' | 'square' | 'triangle' | 'diamond';
export type BombMathOperation =
  | 'addition'
  | 'subtraction'
  | 'multiply-add'
  | 'multiply-subtract'
  | 'divide-add'
  | 'divide-subtract'
  | 'missing-addend'
  | 'larger-total';

export type BombLocalizedText = { en: string; es: string };

export type BombChallengeOption = {
  id: string;
  number: number;
  marker: BombMarker;
  label: BombLocalizedText;
  color?: 'red' | 'blue' | 'yellow' | 'green';
};

export type BombMathValidation = {
  kind: 'math';
  operation: BombMathOperation;
  operands: number[];
  answer: number;
};

export type BombWordValidation = {
  kind: 'word';
  conceptId: string;
  answer: BombLocalizedText;
  scramble: BombLocalizedText;
};

export type BombCipherValidation = {
  kind: 'cipher';
  conceptId: string;
  decoded: BombLocalizedText;
  encoded: BombLocalizedText;
  shift: number;
};

export type BombChallengeValidation =
  | { kind: 'direct'; template: string; targetOptionId: string; targetConceptId: string; usesNonColorIdentifier: true }
  | {
    kind: 'position';
    template: 'offset' | 'between' | 'ordinal';
    // Realtime Database omits empty arrays, so ordinal commands legitimately
    // round-trip without these optional anchor collections.
    anchorOptionIds?: string[];
    anchorConceptIds?: string[];
    offset?: number;
    ordinal?: number;
  }
  | BombMathValidation
  | BombWordValidation
  | { kind: 'riddle'; conceptId: string; answerConceptId: string }
  | BombCipherValidation
  | {
    kind: 'combined';
    recipe: 'math-marker' | 'math-symbol' | 'cipher-position' | 'word-marker' | 'riddle-position' | 'position-pattern';
    mechanics: readonly [string, string];
    anchorOptionId?: string;
    anchorConceptId?: string;
    offset?: number;
    targetMarker?: BombMarker;
    math?: Omit<BombMathValidation, 'kind'>;
    word?: Omit<BombWordValidation, 'kind'>;
    cipher?: Omit<BombCipherValidation, 'kind'>;
    riddleConceptId?: string;
  };

export type BombPrivateCommand = {
  challengeId: string;
  stage: BombChallengeStage;
  category: BombChallengeCategory;
  controlKind: BombControlKind;
  prompt: BombLocalizedText;
  explanation: BombLocalizedText;
  key?: BombLocalizedText;
  options: BombChallengeOption[];
  correctOptionId: string;
  validation: BombChallengeValidation;
};

export type BombPublicOption = Omit<BombChallengeOption, 'label'> & { label: BombLocalizedText };
export type BombPublicCommand = {
  commandId: string;
  commandIndex: number;
  stage: BombChallengeStage;
  category: BombChallengeCategory;
  controlKind: BombControlKind;
  options: BombPublicOption[];
};
export type BombLocalizedPublicCommand = Omit<BombPublicCommand, 'options'> & {
  options: Array<Omit<BombPublicOption, 'label'> & { label: string }>;
};
export type BombExpertInstruction = {
  stage: BombChallengeStage;
  category: BombChallengeCategory;
  prompt: string;
  key: string | null;
};
export type BombSolution = { correctOptionId: string; correctOptionLabel: string; explanation: string };
export type BombOrderedPlayer = { uid: string; joinOrder: number };
export type BombRoleAssignment = { defuserUserId: string; expertUserId: string };
export type BombGeneratedRound = {
  commands: BombPrivateCommand[];
  challengeFingerprints: string[];
  recentChallengeFingerprints: string[];
};
