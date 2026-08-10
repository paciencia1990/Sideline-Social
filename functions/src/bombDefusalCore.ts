export const BOMB_ROLE_SCHEMA_VERSION = 3;
export const BOMB_COMMAND_COUNT = 6;
export const BOMB_MAX_STRIKES = 1;

export const BOMB_REASONING_CATEGORIES = ['math', 'word', 'riddle', 'cipher'] as const;

export type BombLocale = 'en' | 'es';
export type BombPlayerRole = 'defuser' | 'expert' | 'support';
export type BombChallengeStage = 'direct' | 'interpretation' | 'reasoning' | 'combined';
export type BombReasoningCategory = (typeof BOMB_REASONING_CATEGORIES)[number];
export type BombChallengeCategory = 'direct' | 'position' | BombReasoningCategory | 'combined';
export type BombControlKind = 'wire' | 'symbol' | 'number' | 'word' | 'mixed';

export type BombLocalizedText = {
  en: string;
  es: string;
};

export type BombChallengeOption = {
  id: string;
  number: number;
  marker: string;
  label: BombLocalizedText;
  color?: 'red' | 'blue' | 'yellow' | 'green';
};

type BombChallengeValidation =
  | { kind: 'direct' | 'position' | 'riddle' }
  | { kind: 'math'; answer: number }
  | { kind: 'word'; answer: BombLocalizedText; scramble: BombLocalizedText }
  | { kind: 'cipher'; decoded: BombLocalizedText; encoded: BombLocalizedText; shift: number }
  | { kind: 'combined'; mechanics: readonly [string, string] };

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

export type BombPublicOption = {
  id: string;
  number: number;
  marker: string;
  label: BombLocalizedText;
  color?: BombChallengeOption['color'];
};

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

export type BombSolution = {
  correctOptionId: string;
  correctOptionLabel: string;
  explanation: string;
};

export type BombOrderedPlayer = {
  uid: string;
  joinOrder: number;
};

export type BombRoleAssignment = {
  defuserUserId: string;
  expertUserId: string;
};

const text = (en: string, es: string): BombLocalizedText => ({ en, es });

const wireOptions: BombChallengeOption[] = [
  { id: 'wire-red', number: 1, marker: 'solid', color: 'red', label: text('Red solid wire', 'Cable rojo liso') },
  { id: 'wire-blue', number: 2, marker: 'striped', color: 'blue', label: text('Blue striped wire', 'Cable azul a rayas') },
  { id: 'wire-yellow', number: 3, marker: 'dashed', color: 'yellow', label: text('Yellow dashed wire', 'Cable amarillo con guiones') },
  { id: 'wire-green', number: 4, marker: 'dotted', color: 'green', label: text('Green dotted wire', 'Cable verde con puntos') },
];

const symbolOptions: BombChallengeOption[] = [
  { id: 'symbol-circle', number: 1, marker: 'circle', label: text('Circle', 'C\u00edrculo') },
  { id: 'symbol-square', number: 2, marker: 'square', label: text('Square', 'Cuadrado') },
  { id: 'symbol-triangle', number: 3, marker: 'triangle', label: text('Triangle', 'Tri\u00e1ngulo') },
  { id: 'symbol-diamond', number: 4, marker: 'diamond', label: text('Diamond', 'Rombo') },
];

const objectOptions: BombChallengeOption[] = [
  { id: 'object-clock', number: 1, marker: 'circle', label: text('Clock', 'Reloj') },
  { id: 'object-ball', number: 2, marker: 'striped', label: text('Ball', 'Pelota') },
  { id: 'object-shoe', number: 3, marker: 'dashed', label: text('Shoe', 'Zapato') },
  { id: 'object-piano', number: 4, marker: 'dotted', label: text('Piano', 'Piano') },
];

const extraObjectOptions: BombChallengeOption[] = [
  { id: 'object-towel', number: 1, marker: 'striped', label: text('Towel', 'Toalla') },
  { id: 'object-whistle', number: 2, marker: 'circle', label: text('Whistle', 'Silbato') },
  { id: 'object-star', number: 3, marker: 'dashed', label: text('Star', 'Estrella') },
  { id: 'object-moon', number: 4, marker: 'dotted', label: text('Moon', 'Luna') },
];

const numberOptions = (values: number[]): BombChallengeOption[] => values.map((value, index) => ({
  id: `number-${value}`,
  number: index + 1,
  marker: ['circle', 'square', 'triangle', 'diamond'][index],
  label: text(String(value), String(value)),
}));

const directChallenges: BombPrivateCommand[] = [
  challenge({
    challengeId: 'direct-blue-wire',
    stage: 'direct',
    category: 'direct',
    controlKind: 'wire',
    prompt: text(
      'Select option 2: the blue striped wire.',
      'Selecciona la opci\u00f3n 2: el cable azul a rayas.',
    ),
    explanation: text(
      'The command directly named option 2, the blue striped wire.',
      'El comando nombr\u00f3 directamente la opci\u00f3n 2, el cable azul a rayas.',
    ),
    options: wireOptions,
    correctOptionId: 'wire-blue',
    validation: { kind: 'direct' },
  }),
  challenge({
    challengeId: 'direct-diamond',
    stage: 'direct',
    category: 'direct',
    controlKind: 'symbol',
    prompt: text(
      'Select option 4: the diamond symbol.',
      'Selecciona la opci\u00f3n 4: el s\u00edmbolo de rombo.',
    ),
    explanation: text(
      'The command directly named option 4, the diamond.',
      'El comando nombr\u00f3 directamente la opci\u00f3n 4, el rombo.',
    ),
    options: symbolOptions,
    correctOptionId: 'symbol-diamond',
    validation: { kind: 'direct' },
  }),
];

const interpretationChallenges: BombPrivateCommand[] = [
  challenge({
    challengeId: 'position-after-circle',
    stage: 'interpretation',
    category: 'position',
    controlKind: 'symbol',
    prompt: text(
      'Select the control one numbered position after the circle.',
      'Selecciona el control que est\u00e1 una posici\u00f3n numerada despu\u00e9s del c\u00edrculo.',
    ),
    explanation: text(
      'The circle is option 1, so one position after it is option 2, the square.',
      'El c\u00edrculo es la opci\u00f3n 1; una posici\u00f3n despu\u00e9s est\u00e1 la opci\u00f3n 2, el cuadrado.',
    ),
    options: symbolOptions,
    correctOptionId: 'symbol-square',
    validation: { kind: 'position' },
  }),
  challenge({
    challengeId: 'position-before-diamond',
    stage: 'interpretation',
    category: 'position',
    controlKind: 'symbol',
    prompt: text(
      'Select the symbol one numbered position before the diamond.',
      'Selecciona el s\u00edmbolo que est\u00e1 una posici\u00f3n numerada antes del rombo.',
    ),
    explanation: text(
      'The diamond is option 4, so the option before it is option 3, the triangle.',
      'El rombo es la opci\u00f3n 4; la opci\u00f3n anterior es la 3, el tri\u00e1ngulo.',
    ),
    options: symbolOptions,
    correctOptionId: 'symbol-triangle',
    validation: { kind: 'position' },
  }),
];

const reasoningChallenges: Record<BombReasoningCategory, BombPrivateCommand[]> = {
  math: [
    mathChallenge('math-7x3-minus-5', 16, [12, 16, 18, 24], text(
      'Multiply 7 by 3, then subtract 5. Select the matching number.',
      'Multiplica 7 por 3 y luego resta 5. Selecciona el n\u00famero correspondiente.',
    ), text('Seven times three is 21; 21 minus 5 is 16.', 'Siete por tres es 21; 21 menos 5 es 16.')),
    mathChallenge('math-18-divide-3-plus-7', 13, [11, 12, 13, 15], text(
      'Divide 18 by 3, then add 7. Select the matching number.',
      'Divide 18 entre 3 y luego suma 7. Selecciona el n\u00famero correspondiente.',
    ), text('Eighteen divided by three is 6; 6 plus 7 is 13.', 'Dieciocho entre tres es 6; 6 m\u00e1s 7 es 13.')),
    mathChallenge('math-6x4-minus-9', 15, [12, 14, 15, 18], text(
      'Multiply 6 by 4, then subtract 9. Select the matching number.',
      'Multiplica 6 por 4 y luego resta 9. Selecciona el n\u00famero correspondiente.',
    ), text('Six times four is 24; 24 minus 9 is 15.', 'Seis por cuatro es 24; 24 menos 9 es 15.')),
  ],
  word: [
    wordChallenge('word-clock', text('KCOLC', 'JROLE'), text('CLOCK', 'RELOJ'), 'object-clock', objectOptions),
    wordChallenge('word-ball', text('LLAB', 'TALPEO'), text('BALL', 'PELOTA'), 'object-ball', objectOptions),
    wordChallenge('word-shoe', text('OEHS', 'TOAZPA'), text('SHOE', 'ZAPATO'), 'object-shoe', objectOptions),
  ],
  riddle: [
    riddleChallenge(
      'riddle-clock-hands',
      text('I have hands but cannot clap. What am I?', 'Tengo manecillas, pero no puedo aplaudir. \u00bfQu\u00e9 soy?'),
      text('A clock has hands that show the time, but it cannot clap.', 'Un reloj tiene manecillas que muestran la hora, pero no puede aplaudir.'),
      'object-clock',
      objectOptions,
    ),
    riddleChallenge(
      'riddle-piano-keys',
      text('I have many keys but open no locks. What am I?', 'Tengo muchas teclas, pero no abro cerraduras. \u00bfQu\u00e9 soy?'),
      text('A piano has keys used to play music, not to open locks.', 'Un piano tiene teclas para tocar m\u00fasica, no para abrir cerraduras.'),
      'object-piano',
      objectOptions,
    ),
    riddleChallenge(
      'riddle-towel-dry',
      text('I get wetter while I dry things. What am I?', 'Me mojo m\u00e1s mientras seco cosas. \u00bfQu\u00e9 soy?'),
      text('A towel absorbs water while it dries something else.', 'Una toalla absorbe agua mientras seca otra cosa.'),
      'object-towel',
      extraObjectOptions,
    ),
  ],
  cipher: [
    cipherChallenge('cipher-clock', text('DMPDL', 'SFMPK'), text('CLOCK', 'RELOJ'), 'object-clock', objectOptions),
    cipherChallenge('cipher-ball', text('CBMM', 'QFMPUB'), text('BALL', 'PELOTA'), 'object-ball', objectOptions),
    cipherChallenge('cipher-star', text('TUBS', 'FTUSFMMB'), text('STAR', 'ESTRELLA'), 'object-star', extraObjectOptions),
  ],
};

const combinedChallenges: BombPrivateCommand[] = [
  challenge({
    challengeId: 'combined-word-marker-star',
    stage: 'combined',
    category: 'combined',
    controlKind: 'mixed',
    prompt: text(
      'Unscramble RATS, then select that object with the dashed marker.',
      'Ordena las letras LLAERETS y selecciona ese objeto con la marca de guiones.',
    ),
    explanation: text(
      'RATS unscrambles to STAR. The star with the dashed marker is option 3.',
      'LLAERETS forma ESTRELLA. La estrella con la marca de guiones es la opci\u00f3n 3.',
    ),
    options: extraObjectOptions,
    correctOptionId: 'object-star',
    validation: { kind: 'combined', mechanics: ['word', 'marker'] },
  }),
  challenge({
    challengeId: 'combined-math-diamond',
    stage: 'combined',
    category: 'combined',
    controlKind: 'symbol',
    prompt: text(
      'Add 2 and 2. Use the result as the option number, then confirm it has the diamond marker.',
      'Suma 2 y 2. Usa el resultado como n\u00famero de opci\u00f3n y confirma que tenga la marca de rombo.',
    ),
    explanation: text(
      'Two plus two is 4. Option 4 is the diamond.',
      'Dos m\u00e1s dos es 4. La opci\u00f3n 4 es el rombo.',
    ),
    options: symbolOptions,
    correctOptionId: 'symbol-diamond',
    validation: { kind: 'combined', mechanics: ['math', 'marker'] },
  }),
  challenge({
    challengeId: 'combined-cipher-position',
    stage: 'combined',
    category: 'combined',
    controlKind: 'mixed',
    prompt: text(
      'Move each letter in TUBS back one to decode a word, then select the option immediately after that object.',
      'Retrocede una letra en cada letra de FTUSFMMB para descifrar una palabra y luego selecciona la opci\u00f3n inmediatamente posterior a ese objeto.',
    ),
    key: text('Caesar key: move each letter back 1; A wraps to Z.', 'Clave C\u00e9sar: retrocede 1 letra; A vuelve a Z.'),
    explanation: text(
      'TUBS shifted back one spells STAR at option 3. The option after it is option 4, the moon.',
      'FTUSFMMB al retroceder una letra forma ESTRELLA en la opci\u00f3n 3. La opci\u00f3n siguiente es la 4, la luna.',
    ),
    options: extraObjectOptions,
    correctOptionId: 'object-moon',
    validation: { kind: 'combined', mechanics: ['cipher', 'position'] },
  }),
];

export const BOMB_CHALLENGE_BANK = {
  direct: directChallenges,
  interpretation: interpretationChallenges,
  reasoning: reasoningChallenges,
  combined: combinedChallenges,
} as const;

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

export function createBombChallengeSequence(
  pickIndex: (limit: number) => number,
  previousChallengeIds: string[] = [],
): BombPrivateCommand[] {
  const categories = [...BOMB_REASONING_CATEGORIES];
  const selectedCategories: BombReasoningCategory[] = [];
  while (selectedCategories.length < 3) {
    const index = safePickIndex(pickIndex, categories.length);
    selectedCategories.push(categories.splice(index, 1)[0]);
  }

  const sequence = [
    pickValidChallenge(directChallenges, pickIndex),
    pickValidChallenge(interpretationChallenges, pickIndex),
    ...selectedCategories.map((category) => pickValidChallenge(reasoningChallenges[category], pickIndex)),
    pickValidChallenge(combinedChallenges, pickIndex),
  ];

  if (
    previousChallengeIds.length === sequence.length &&
    sequence.every((command, index) => command.challengeId === previousChallengeIds[index])
  ) {
    sequence[0] = nextValidChallenge(directChallenges, sequence[0].challengeId);
  }
  if (!validateBombChallengeSequence(sequence)) {
    throw new Error('bomb_challenge_bank_invalid');
  }
  return sequence.map(cloneChallenge);
}

export function validateBombChallengeSequence(commands: BombPrivateCommand[]) {
  if (commands.length !== BOMB_COMMAND_COUNT || commands.some((command) => !validateBombChallenge(command))) {
    return false;
  }
  if (commands[0].stage !== 'direct' || commands[1].stage !== 'interpretation' || commands[5].stage !== 'combined') {
    return false;
  }
  const reasoning = commands.slice(2, 5);
  return reasoning.every((command) => command.stage === 'reasoning') &&
    new Set(reasoning.map((command) => command.category)).size === reasoning.length;
}

export function validateBombChallenge(command: BombPrivateCommand) {
  if (
    !command ||
    typeof command !== 'object' ||
    !(['direct', 'interpretation', 'reasoning', 'combined'] as const).includes(command.stage) ||
    !(['direct', 'position', 'math', 'word', 'riddle', 'cipher', 'combined'] as const).includes(command.category) ||
    !(['wire', 'symbol', 'number', 'word', 'mixed'] as const).includes(command.controlKind) ||
    !/^[a-z0-9-]{4,80}$/.test(command.challengeId) ||
    typeof command.correctOptionId !== 'string' ||
    !/^[a-z0-9-]{4,80}$/.test(command.correctOptionId) ||
    !isLocalizedText(command.prompt) ||
    !isLocalizedText(command.explanation) ||
    !Array.isArray(command.options) ||
    command.options.length !== 4 ||
    command.options.some((option) => (
      !option ||
      typeof option !== 'object' ||
      typeof option.id !== 'string' ||
      !/^[a-z0-9-]{4,80}$/.test(option.id) ||
      typeof option.number !== 'number' ||
      !Number.isInteger(option.number) ||
      typeof option.marker !== 'string' ||
      !option.marker.trim() ||
      (option.color !== undefined && !(['red', 'blue', 'yellow', 'green'] as const).includes(option.color))
    ))
  ) return false;
  const optionIds = command.options.map((option) => option.id);
  const optionNumbers = command.options.map((option) => option.number);
  if (
    new Set(optionIds).size !== optionIds.length ||
    new Set(optionNumbers).size !== optionNumbers.length ||
    optionNumbers.slice().sort((left, right) => left - right).some((number, index) => number !== index + 1) ||
    command.options.filter((option) => option.id === command.correctOptionId).length !== 1 ||
    command.options.some((option) => !option.marker || !isLocalizedText(option.label) || option.number < 1)
  ) return false;
  for (const locale of ['en', 'es'] as const) {
    const labels = command.options.map((option) => normalizeWord(option.label[locale]));
    if (labels.some((label) => !label) || new Set(labels).size !== labels.length) return false;
  }
  if (command.key && !isLocalizedText(command.key)) return false;
  if (
    (command.stage === 'direct' && command.category !== 'direct') ||
    (command.stage === 'interpretation' && command.category !== 'position') ||
    (command.stage === 'reasoning' && !BOMB_REASONING_CATEGORIES.includes(command.category as BombReasoningCategory)) ||
    (command.stage === 'combined' && command.category !== 'combined')
  ) return false;
  if (!command.validation || typeof command.validation !== 'object' || Array.isArray(command.validation)) return false;
  const validation = command.validation as unknown as Record<string, unknown>;
  const validationKind = validation.kind;
  const expectedValidationKind = command.stage === 'direct'
    ? 'direct'
    : command.stage === 'interpretation'
      ? 'position'
      : command.stage === 'combined'
        ? 'combined'
        : command.category;
  if (validationKind !== expectedValidationKind) return false;
  if (validationKind === 'math') {
    const answer = validation.answer;
    if (typeof answer !== 'number' || !Number.isInteger(answer)) return false;
    const matches = command.options.filter((option) => Number(option.label.en) === answer);
    if (matches.length !== 1 || matches[0].id !== command.correctOptionId) return false;
  }
  if (validationKind === 'word') {
    if (!isLocalizedText(validation.answer) || !isLocalizedText(validation.scramble)) return false;
    const correctOption = command.options.find((option) => option.id === command.correctOptionId);
    if (!correctOption) return false;
    for (const locale of ['en', 'es'] as const) {
      if (sortedLetters(validation.answer[locale]) !== sortedLetters(validation.scramble[locale])) return false;
      if (normalizeWord(validation.answer[locale]) === normalizeWord(validation.scramble[locale])) return false;
      if (normalizeWord(correctOption.label[locale]) !== normalizeWord(validation.answer[locale])) return false;
    }
  }
  if (validationKind === 'cipher') {
    if (
      !isLocalizedText(validation.decoded) ||
      !isLocalizedText(validation.encoded) ||
      typeof validation.shift !== 'number' ||
      !Number.isInteger(validation.shift) ||
      validation.shift === 0 ||
      validation.shift < -25 ||
      validation.shift > 25
    ) return false;
    const correctOption = command.options.find((option) => option.id === command.correctOptionId);
    if (!correctOption) return false;
    for (const locale of ['en', 'es'] as const) {
      if (decodeCaesar(validation.encoded[locale], validation.shift) !== normalizeWord(validation.decoded[locale])) return false;
      if (normalizeWord(correctOption.label[locale]) !== normalizeWord(validation.decoded[locale])) return false;
    }
    if (!command.key) return false;
  }
  if (
    validationKind === 'combined' &&
    (!Array.isArray(validation.mechanics) ||
      validation.mechanics.length !== 2 ||
      validation.mechanics.some((mechanic) => typeof mechanic !== 'string' || !mechanic.trim()) ||
      new Set(validation.mechanics).size !== 2)
  ) return false;
  return true;
}

export function createBombPublicCommand(command: BombPrivateCommand, commandIndex: number): BombPublicCommand {
  return {
    commandId: `command-${commandIndex + 1}`,
    commandIndex,
    stage: command.stage,
    category: command.category,
    controlKind: command.controlKind,
    options: command.options.map((option) => ({
      id: option.id,
      number: option.number,
      marker: option.marker,
      label: { ...option.label },
      ...(option.color ? { color: option.color } : {}),
    })),
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
  if (!correctOption) throw new Error('bomb_challenge_bank_invalid');
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
  return action.optionId === command.correctOptionId;
}

export function normalizeBombLocale(value: unknown): BombLocale {
  return typeof value === 'string' && value.toLowerCase().startsWith('es') ? 'es' : 'en';
}

function challenge(input: BombPrivateCommand): BombPrivateCommand {
  return cloneChallenge(input);
}

function mathChallenge(
  challengeId: string,
  answer: number,
  values: number[],
  prompt: BombLocalizedText,
  explanation: BombLocalizedText,
) {
  return challenge({
    challengeId,
    stage: 'reasoning',
    category: 'math',
    controlKind: 'number',
    prompt,
    explanation,
    options: numberOptions(values),
    correctOptionId: `number-${answer}`,
    validation: { kind: 'math', answer },
  });
}

function wordChallenge(
  challengeId: string,
  scramble: BombLocalizedText,
  answer: BombLocalizedText,
  correctOptionId: string,
  options: BombChallengeOption[],
) {
  return challenge({
    challengeId,
    stage: 'reasoning',
    category: 'word',
    controlKind: 'word',
    prompt: text(
      `Unscramble ${scramble.en}, then select the matching object.`,
      `Ordena las letras ${scramble.es} y selecciona el objeto correspondiente.`,
    ),
    explanation: text(
      `${scramble.en} unscrambles to ${answer.en}.`,
      `${scramble.es} forma ${answer.es}.`,
    ),
    options,
    correctOptionId,
    validation: { kind: 'word', answer, scramble },
  });
}

function riddleChallenge(
  challengeId: string,
  prompt: BombLocalizedText,
  explanation: BombLocalizedText,
  correctOptionId: string,
  options: BombChallengeOption[],
) {
  return challenge({
    challengeId,
    stage: 'reasoning',
    category: 'riddle',
    controlKind: 'word',
    prompt,
    explanation,
    options,
    correctOptionId,
    validation: { kind: 'riddle' },
  });
}

function cipherChallenge(
  challengeId: string,
  encoded: BombLocalizedText,
  decoded: BombLocalizedText,
  correctOptionId: string,
  options: BombChallengeOption[],
) {
  return challenge({
    challengeId,
    stage: 'reasoning',
    category: 'cipher',
    controlKind: 'word',
    prompt: text(
      `Decode ${encoded.en}, then select the matching object.`,
      `Descifra ${encoded.es} y selecciona el objeto correspondiente.`,
    ),
    key: text('Caesar key: move each letter back 1; A wraps to Z.', 'Clave C\u00e9sar: retrocede 1 letra; A vuelve a Z.'),
    explanation: text(
      `Moving each letter in ${encoded.en} back one spells ${decoded.en}.`,
      `Al retroceder una letra en ${encoded.es}, se forma ${decoded.es}.`,
    ),
    options,
    correctOptionId,
    validation: { kind: 'cipher', decoded, encoded, shift: -1 },
  });
}

function pickValidChallenge(challenges: readonly BombPrivateCommand[], pickIndex: (limit: number) => number) {
  const valid = challenges.filter(validateBombChallenge);
  if (valid.length === 0) throw new Error('bomb_challenge_bank_invalid');
  return valid[safePickIndex(pickIndex, valid.length)];
}

function nextValidChallenge(challenges: readonly BombPrivateCommand[], currentId: string) {
  const valid = challenges.filter(validateBombChallenge);
  if (valid.length < 2) throw new Error('bomb_challenge_bank_invalid');
  const currentIndex = valid.findIndex((challenge) => challenge.challengeId === currentId);
  return valid[(Math.max(0, currentIndex) + 1) % valid.length];
}

function safePickIndex(pickIndex: (limit: number) => number, limit: number) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('bomb_challenge_bank_invalid');
  const picked = pickIndex(limit);
  return Number.isInteger(picked) && picked >= 0 && picked < limit ? picked : 0;
}

function cloneChallenge(command: BombPrivateCommand): BombPrivateCommand {
  return {
    ...command,
    prompt: { ...command.prompt },
    explanation: { ...command.explanation },
    ...(command.key ? { key: { ...command.key } } : {}),
    options: command.options.map((option) => ({ ...option, label: { ...option.label } })),
    validation: cloneValidation(command.validation),
  };
}

function cloneValidation(validation: BombChallengeValidation): BombChallengeValidation {
  if (validation.kind === 'word') {
    return { ...validation, answer: { ...validation.answer }, scramble: { ...validation.scramble } };
  }
  if (validation.kind === 'cipher') {
    return { ...validation, decoded: { ...validation.decoded }, encoded: { ...validation.encoded } };
  }
  if (validation.kind === 'combined') {
    return { ...validation, mechanics: [...validation.mechanics] as [string, string] };
  }
  return { ...validation };
}

function isLocalizedText(value: unknown): value is BombLocalizedText {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const localized = value as Record<string, unknown>;
  return typeof localized.en === 'string' && localized.en.trim().length > 0 &&
    typeof localized.es === 'string' && localized.es.trim().length > 0;
}

function sortedLetters(value: string) {
  return [...normalizeWord(value)].sort().join('');
}

function normalizeWord(value: string) {
  return value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '');
}

function decodeCaesar(value: string, shift: number) {
  return normalizeWord(value).replace(/[A-Z]/g, (letter) => {
    const code = letter.charCodeAt(0) - 65;
    return String.fromCharCode(((code + shift + 26) % 26) + 65);
  });
}
