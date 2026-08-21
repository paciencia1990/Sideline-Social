import { createHash } from 'node:crypto';

import {
  BOMB_RIDDLE_CONCEPTS,
  BOMB_WORD_CONCEPTS,
  bombControlLabel,
  bombText,
  type BombRiddleConcept,
  type BombWordConcept,
} from './bombDefusalContent';
import {
  BOMB_GENERATION_MAX_ATTEMPTS,
  BOMB_RECENT_FINGERPRINT_LIMIT,
  BOMB_REASONING_CATEGORIES,
  type BombChallengeOption,
  type BombGeneratedRound,
  type BombLocalizedText,
  type BombMarker,
  type BombMathOperation,
  type BombMathValidation,
  type BombPrivateCommand,
  type BombReasoningCategory,
} from './bombDefusalTypes';
import {
  createBombChallengeFingerprint,
  encodeBombCaesar,
  evaluateBombMath,
  validateBombChallengeSequence,
} from './bombDefusalValidation';

type SemanticOption = {
  conceptId: string;
  label: BombLocalizedText;
  color?: BombChallengeOption['color'];
};

type MaterializedOptions = {
  options: BombChallengeOption[];
  optionIdByConcept: Map<string, string>;
  conceptByOptionId: Map<string, string>;
};

const MARKERS: readonly BombMarker[] = ['solid', 'striped', 'dashed', 'dotted', 'circle', 'square', 'triangle', 'diamond'];
const MARKER_TEXT: Record<BombMarker, BombLocalizedText> = {
  solid: bombText('solid pattern', 'patrón sólido'),
  striped: bombText('striped pattern', 'patrón de rayas'),
  dashed: bombText('dashed pattern', 'patrón de guiones'),
  dotted: bombText('dotted pattern', 'patrón de puntos'),
  circle: bombText('circle marker', 'marca circular'),
  square: bombText('square marker', 'marca cuadrada'),
  triangle: bombText('triangle marker', 'marca triangular'),
  diamond: bombText('diamond marker', 'marca de rombo'),
};
const SHAPE_OPTIONS: readonly SemanticOption[] = [
  { conceptId: 'shape-circle', label: bombText('Circle', 'Círculo') },
  { conceptId: 'shape-square', label: bombText('Square', 'Cuadrado') },
  { conceptId: 'shape-triangle', label: bombText('Triangle', 'Triángulo') },
  { conceptId: 'shape-diamond', label: bombText('Diamond', 'Rombo') },
];
const WIRE_OPTIONS: readonly SemanticOption[] = [
  { conceptId: 'wire-red-solid', label: bombText('Red wire with a solid pattern', 'Cable rojo con patrón sólido'), color: 'red' },
  { conceptId: 'wire-blue-striped', label: bombText('Blue wire with a striped pattern', 'Cable azul con patrón de rayas'), color: 'blue' },
  { conceptId: 'wire-yellow-dashed', label: bombText('Yellow wire with a dashed pattern', 'Cable amarillo con patrón de guiones'), color: 'yellow' },
  { conceptId: 'wire-green-dotted', label: bombText('Green wire with a dotted pattern', 'Cable verde con patrón de puntos'), color: 'green' },
];
const PATTERN_OPTIONS: readonly SemanticOption[] = [
  { conceptId: 'panel-solid', label: bombText('Solid panel', 'Panel sólido') },
  { conceptId: 'panel-striped', label: bombText('Striped panel', 'Panel de rayas') },
  { conceptId: 'panel-dashed', label: bombText('Dashed panel', 'Panel de guiones') },
  { conceptId: 'panel-dotted', label: bombText('Dotted panel', 'Panel de puntos') },
];

export function createBombGeneratedRound(seed: string, recentHistory: string[] = []): BombGeneratedRound {
  if (typeof seed !== 'string' || seed.length < 16 || seed.length > 256) throw new Error('bomb_seed_invalid');
  const history = normalizeBombRecentHistory(recentHistory);
  const immediatePrevious = history.slice(-6);
  let best: { commands: BombPrivateCommand[]; fingerprints: string[]; score: number } | null = null;

  for (let attempt = 0; attempt < BOMB_GENERATION_MAX_ATTEMPTS; attempt += 1) {
    const random = new BombSeededRandom(`${seed}:${attempt}`);
    const commands = generateSequence(random, `${seed}:${attempt}`);
    if (!validateBombChallengeSequence(commands)) continue;
    const fingerprints = commands.map(createBombChallengeFingerprint);
    // Prefer unseen concepts. If the bounded attempts cannot avoid history,
    // prefer the concepts that have gone unused for the greatest number of
    // more-recent challenges, with an extra guard against the prior round.
    const score = fingerprints.reduce((total, fingerprint) => {
      const previousIndex = history.lastIndexOf(fingerprint);
      const recencyScore = previousIndex < 0
        ? BOMB_RECENT_FINGERPRINT_LIMIT + history.length + 1
        : history.length - previousIndex;
      return total + recencyScore + (immediatePrevious.includes(fingerprint) ? 0 : 1);
    }, 0);
    if (!best || score > best.score) best = { commands, fingerprints, score };
    if (fingerprints.every((fingerprint) => !history.includes(fingerprint))) break;
  }
  if (!best) throw new Error('bomb_generation_failed');
  return {
    commands: best.commands,
    challengeFingerprints: best.fingerprints,
    recentChallengeFingerprints: normalizeBombRecentHistory([...history, ...best.fingerprints]),
  };
}

export function normalizeBombRecentHistory(values: unknown) {
  if (!Array.isArray(values)) return [];
  const uniqueNewest: string[] = [];
  const seen = new Set<string>();
  for (let index = values.length - 1; index >= 0 && uniqueNewest.length < BOMB_RECENT_FINGERPRINT_LIMIT; index -= 1) {
    const value = values[index];
    if (typeof value !== 'string' || !/^[a-f0-9]{24}$/.test(value) || seen.has(value)) continue;
    seen.add(value);
    uniqueNewest.push(value);
  }
  return uniqueNewest.reverse();
}

function generateSequence(random: BombSeededRandom, context: string): BombPrivateCommand[] {
  const categories = random.shuffle([...BOMB_REASONING_CATEGORIES]).slice(0, 3) as BombReasoningCategory[];
  return [
    generateDirect(random, `${context}:0`),
    generatePosition(random, `${context}:1`),
    ...categories.map((category, index) => generateReasoning(category, random, `${context}:${index + 2}`)),
    generateCombined(random, `${context}:5`),
  ];
}

function generateDirect(random: BombSeededRandom, context: string): BombPrivateCommand {
  const template = random.pick(['wire', 'symbol', 'number', 'object', 'pattern'] as const);
  const semantic = template === 'wire'
    ? [...WIRE_OPTIONS]
    : template === 'symbol'
      ? [...SHAPE_OPTIONS]
      : template === 'pattern'
        ? [...PATTERN_OPTIONS]
        : template === 'number'
          ? randomDistinctNumbers(random, 4, 1, 40).map((value) => ({ conceptId: `value-${value}`, label: bombText(String(value), String(value)) }))
          : random.shuffle(BOMB_WORD_CONCEPTS).slice(0, 4).map(wordSemantic);
  const target = random.pick(semantic);
  const materialized = materializeOptions(semantic, random, context);
  const correctOptionId = requiredOptionId(materialized, target.conceptId);
  const correct = requiredOption(materialized.options, correctOptionId);
  const marker = MARKER_TEXT[correct.marker];
  return command({
    context,
    stage: 'direct',
    category: 'direct',
    controlKind: template === 'wire' ? 'wire' : template === 'symbol' || template === 'pattern' ? 'symbol' : template === 'number' ? 'number' : 'word',
    prompt: bombText(
      `Select option ${correct.number}: ${correct.label.en}, identified by the ${marker.en}.`,
      `Selecciona la opción ${correct.number}: ${correct.label.es}, identificada por ${marker.es}.`,
    ),
    explanation: bombText(
      `The direct command names option ${correct.number}, ${correct.label.en}, and its ${marker.en}.`,
      `El comando directo nombra la opción ${correct.number}, ${correct.label.es}, y ${marker.es}.`,
    ),
    options: materialized.options,
    correctOptionId,
    validation: { kind: 'direct', template, targetOptionId: correctOptionId, targetConceptId: target.conceptId, usesNonColorIdentifier: true },
  });
}

function generatePosition(random: BombSeededRandom, context: string): BombPrivateCommand {
  const semantic = random.shuffle(BOMB_WORD_CONCEPTS).slice(0, 4).map(wordSemantic);
  const materialized = materializeOptions(semantic, random, context);
  const template = random.pick(['offset', 'between', 'ordinal'] as const);
  let correct: BombChallengeOption;
  let prompt: BombLocalizedText;
  let explanation: BombLocalizedText;
  let validation: Extract<BombPrivateCommand['validation'], { kind: 'position' }>;

  if (template === 'ordinal') {
    const ordinal = random.nextInt(4) + 1;
    correct = materialized.options[ordinal - 1];
    prompt = bombText(`Select the control in numbered position ${ordinal}.`, `Selecciona el control en la posición numerada ${ordinal}.`);
    explanation = bombText(`The requested ordinal is option ${ordinal}, ${correct.label.en}.`, `El ordinal solicitado es la opción ${ordinal}, ${correct.label.es}.`);
    validation = { kind: 'position', template, anchorOptionIds: [], anchorConceptIds: [], ordinal };
  } else if (template === 'between') {
    const correctNumber = random.pick([2, 3]);
    correct = materialized.options[correctNumber - 1];
    const anchors = [materialized.options[correctNumber - 2], materialized.options[correctNumber]];
    prompt = bombText(
      `Select the control between ${anchors[0].label.en} (option ${anchors[0].number}) and ${anchors[1].label.en} (option ${anchors[1].number}).`,
      `Selecciona el control entre ${anchors[0].label.es} (opción ${anchors[0].number}) y ${anchors[1].label.es} (opción ${anchors[1].number}).`,
    );
    explanation = bombText(`Option ${correct.number}, ${correct.label.en}, is the only control between them.`, `La opción ${correct.number}, ${correct.label.es}, es el único control entre ambos.`);
    validation = {
      kind: 'position', template, anchorOptionIds: anchors.map((option) => option.id),
      anchorConceptIds: anchors.map((option) => requiredConcept(materialized, option.id)),
    };
  } else {
    const pairs = materialized.options.flatMap((correctOption) => [-2, -1, 1, 2]
      .map((offset) => ({ correctOption, offset, anchorNumber: correctOption.number - offset }))
      .filter((entry) => entry.anchorNumber >= 1 && entry.anchorNumber <= 4));
    const selected = random.pick(pairs);
    correct = selected.correctOption;
    const anchor = materialized.options[selected.anchorNumber - 1];
    const distance = Math.abs(selected.offset);
    const directionEn = selected.offset > 0 ? 'after' : 'before';
    const directionEs = selected.offset > 0 ? 'después de' : 'antes de';
    prompt = bombText(
      `Select the control ${distance === 1 ? 'immediately' : `${distance} numbered positions`} ${directionEn} ${anchor.label.en} (option ${anchor.number}).`,
      `Selecciona el control ${distance === 1 ? 'inmediatamente' : `${distance} posiciones numeradas`} ${directionEs} ${anchor.label.es} (opción ${anchor.number}).`,
    );
    explanation = bombText(`Moving ${distance} position${distance === 1 ? '' : 's'} ${directionEn} option ${anchor.number} reaches option ${correct.number}, ${correct.label.en}.`, `Al avanzar ${distance} posición${distance === 1 ? '' : 'es'} ${directionEs} la opción ${anchor.number}, se llega a la opción ${correct.number}, ${correct.label.es}.`);
    validation = {
      kind: 'position', template, anchorOptionIds: [anchor.id], anchorConceptIds: [requiredConcept(materialized, anchor.id)], offset: selected.offset,
    };
  }
  return command({ context, stage: 'interpretation', category: 'position', controlKind: 'mixed', prompt, explanation, options: materialized.options, correctOptionId: correct.id, validation });
}

function generateReasoning(category: BombReasoningCategory, random: BombSeededRandom, context: string) {
  if (category === 'math') return generateMath(random, context);
  if (category === 'word') return generateWord(random, context);
  if (category === 'riddle') return generateRiddle(random, context);
  return generateCipher(random, context);
}

function generateMath(random: BombSeededRandom, context: string): BombPrivateCommand {
  const validation = generateMathValidation(random);
  const materialized = materializeNumberOptions(validation.answer, random, context);
  const correctOptionId = materialized.options.find((option) => Number(option.label.en) === validation.answer)!.id;
  const copy = mathCopy(validation);
  return command({ context, stage: 'reasoning', category: 'math', controlKind: 'number', prompt: copy.prompt, explanation: copy.explanation, options: materialized.options, correctOptionId, validation });
}

function generateWord(random: BombSeededRandom, context: string): BombPrivateCommand {
  const concept = random.pick(BOMB_WORD_CONCEPTS);
  const materialized = materializeConceptOptions(concept, random, context);
  const correctOptionId = requiredOptionId(materialized, concept.id);
  return command({
    context, stage: 'reasoning', category: 'word', controlKind: 'word',
    prompt: bombText(`Unscramble ${concept.scramble.en}, then select the matching object.`, `Ordena las letras ${concept.scramble.es} y selecciona el objeto correspondiente.`),
    explanation: bombText(`${concept.scramble.en} unscrambles to ${concept.answer.en}.`, `${concept.scramble.es} forma ${concept.answer.es}.`),
    options: materialized.options, correctOptionId,
    validation: { kind: 'word', conceptId: concept.id, answer: concept.answer, scramble: concept.scramble },
  });
}

function generateRiddle(random: BombSeededRandom, context: string): BombPrivateCommand {
  const riddle = random.pick(BOMB_RIDDLE_CONCEPTS);
  const semantic = [riddle.answerConceptId, ...riddle.distractorConceptIds].map(controlSemantic);
  const materialized = materializeOptions(semantic, random, context);
  return command({
    context, stage: 'reasoning', category: 'riddle', controlKind: 'word', prompt: riddle.prompt, explanation: riddle.explanation,
    options: materialized.options, correctOptionId: requiredOptionId(materialized, riddle.answerConceptId),
    validation: { kind: 'riddle', conceptId: riddle.id, answerConceptId: riddle.answerConceptId },
  });
}

function generateCipher(random: BombSeededRandom, context: string): BombPrivateCommand {
  const concepts = BOMB_WORD_CONCEPTS.filter((concept) => concept.cipherApproved);
  const concept = random.pick(concepts);
  const shift = random.nextInt(5) + 1;
  const encoded = bombText(requiredEncoded(concept.answer.en, shift), requiredEncoded(concept.answer.es, shift));
  const materialized = materializeConceptOptions(concept, random, context);
  return command({
    context, stage: 'reasoning', category: 'cipher', controlKind: 'word',
    prompt: bombText(`Decode ${encoded.en}, then select the matching object.`, `Descifra ${encoded.es} y selecciona el objeto correspondiente.`),
    key: bombText(`Caesar key: move each letter back ${shift}; the alphabet wraps from A to Z.`, `Clave César: retrocede ${shift} letra${shift === 1 ? '' : 's'}; el alfabeto continúa de A a Z.`),
    explanation: bombText(`Moving each letter back ${shift} decodes ${encoded.en} as ${concept.answer.en}.`, `Al retroceder ${shift} letra${shift === 1 ? '' : 's'}, ${encoded.es} se descifra como ${concept.answer.es}.`),
    options: materialized.options, correctOptionId: requiredOptionId(materialized, concept.id),
    validation: { kind: 'cipher', conceptId: concept.id, decoded: concept.answer, encoded, shift },
  });
}

function generateCombined(random: BombSeededRandom, context: string): BombPrivateCommand {
  const recipe = random.pick(['math-marker', 'math-symbol', 'cipher-position', 'word-marker', 'riddle-position', 'position-pattern'] as const);
  if (recipe === 'math-marker' || recipe === 'math-symbol') return generateCombinedMath(recipe, random, context);
  if (recipe === 'word-marker') return generateCombinedWord(random, context);
  if (recipe === 'cipher-position') return generateCombinedCipherPosition(random, context);
  if (recipe === 'riddle-position') return generateCombinedRiddlePosition(random, context);
  return generateCombinedPositionPattern(random, context);
}

function generateCombinedMath(recipe: 'math-marker' | 'math-symbol', random: BombSeededRandom, context: string) {
  const semantic = random.shuffle([...SHAPE_OPTIONS]);
  const materialized = materializeOptions(semantic, random, context);
  const answer = random.nextInt(4) + 1;
  const left = random.nextInt(answer) + 1;
  const right = answer - left;
  const math = { operation: 'addition' as const, operands: [left, right], answer };
  const correct = materialized.options[answer - 1];
  const marker = MARKER_TEXT[correct.marker];
  const markerClauseEn = recipe === 'math-marker' ? ` Confirm it has the ${marker.en}.` : ` Confirm the symbol is ${correct.label.en}.`;
  const markerClauseEs = recipe === 'math-marker' ? ` Confirma que tenga ${marker.es}.` : ` Confirma que el símbolo sea ${correct.label.es}.`;
  return command({
    context, stage: 'combined', category: 'combined', controlKind: 'symbol',
    prompt: bombText(`Add ${left} and ${right}. Use the result as the option number.${markerClauseEn}`, `Suma ${left} y ${right}. Usa el resultado como número de opción.${markerClauseEs}`),
    explanation: bombText(`${left} + ${right} = ${answer}. Option ${answer} is ${correct.label.en} with the ${marker.en}.`, `${left} + ${right} = ${answer}. La opción ${answer} es ${correct.label.es} con ${marker.es}.`),
    options: materialized.options, correctOptionId: correct.id,
    validation: { kind: 'combined', recipe, mechanics: ['math', recipe === 'math-marker' ? 'marker' : 'symbol'], math, ...(recipe === 'math-marker' ? { targetMarker: correct.marker } : {}) },
  });
}

function generateCombinedWord(random: BombSeededRandom, context: string) {
  const concept = random.pick(BOMB_WORD_CONCEPTS);
  const materialized = materializeConceptOptions(concept, random, context);
  const correct = requiredOption(materialized.options, requiredOptionId(materialized, concept.id));
  const marker = MARKER_TEXT[correct.marker];
  return command({
    context, stage: 'combined', category: 'combined', controlKind: 'mixed',
    prompt: bombText(`Unscramble ${concept.scramble.en}, then select that object with the ${marker.en}.`, `Ordena las letras ${concept.scramble.es} y selecciona ese objeto con ${marker.es}.`),
    explanation: bombText(`${concept.scramble.en} forms ${concept.answer.en}; it is option ${correct.number} with the ${marker.en}.`, `${concept.scramble.es} forma ${concept.answer.es}; es la opción ${correct.number} con ${marker.es}.`),
    options: materialized.options, correctOptionId: correct.id,
    validation: { kind: 'combined', recipe: 'word-marker', mechanics: ['word', 'marker'], targetMarker: correct.marker, word: { conceptId: concept.id, answer: concept.answer, scramble: concept.scramble } },
  });
}

function generateCombinedCipherPosition(random: BombSeededRandom, context: string) {
  const concept = random.pick(BOMB_WORD_CONCEPTS.filter((entry) => entry.cipherApproved));
  const shift = random.nextInt(5) + 1;
  const encoded = bombText(requiredEncoded(concept.answer.en, shift), requiredEncoded(concept.answer.es, shift));
  const materialized = materializeConceptOptions(concept, random, context);
  const anchor = requiredOption(materialized.options, requiredOptionId(materialized, concept.id));
  const offset = chooseValidOffset(anchor.number, random);
  const correct = materialized.options[anchor.number + offset - 1];
  return command({
    context, stage: 'combined', category: 'combined', controlKind: 'mixed',
    prompt: bombText(`Move each letter in ${encoded.en} back ${shift}, then select the option immediately ${offset > 0 ? 'after' : 'before'} the decoded object.`, `Retrocede ${shift} letra${shift === 1 ? '' : 's'} en ${encoded.es} y selecciona la opción inmediatamente ${offset > 0 ? 'después' : 'antes'} del objeto descifrado.`),
    key: bombText(`Caesar key: move back ${shift}; A wraps to Z.`, `Clave César: retrocede ${shift}; A continúa en Z.`),
    explanation: bombText(`${encoded.en} decodes to ${concept.answer.en} at option ${anchor.number}; the requested neighbor is option ${correct.number}, ${correct.label.en}.`, `${encoded.es} se descifra como ${concept.answer.es} en la opción ${anchor.number}; la opción vecina solicitada es ${correct.number}, ${correct.label.es}.`),
    options: materialized.options, correctOptionId: correct.id,
    validation: { kind: 'combined', recipe: 'cipher-position', mechanics: ['cipher', 'position'], anchorOptionId: anchor.id, anchorConceptId: concept.id, offset, cipher: { conceptId: concept.id, decoded: concept.answer, encoded, shift } },
  });
}

function generateCombinedRiddlePosition(random: BombSeededRandom, context: string) {
  const riddle = random.pick(BOMB_RIDDLE_CONCEPTS);
  const materialized = materializeOptions([riddle.answerConceptId, ...riddle.distractorConceptIds].map(controlSemantic), random, context);
  const anchor = requiredOption(materialized.options, requiredOptionId(materialized, riddle.answerConceptId));
  const offset = chooseValidOffset(anchor.number, random);
  const correct = materialized.options[anchor.number + offset - 1];
  return command({
    context, stage: 'combined', category: 'combined', controlKind: 'mixed',
    prompt: bombText(`${riddle.prompt.en} Then select the option immediately ${offset > 0 ? 'after' : 'before'} that answer.`, `${riddle.prompt.es} Luego selecciona la opción inmediatamente ${offset > 0 ? 'después' : 'antes'} de esa respuesta.`),
    explanation: bombText(`${riddle.explanation.en} That answer is option ${anchor.number}; the requested neighbor is option ${correct.number}, ${correct.label.en}.`, `${riddle.explanation.es} Esa respuesta es la opción ${anchor.number}; la opción vecina solicitada es ${correct.number}, ${correct.label.es}.`),
    options: materialized.options, correctOptionId: correct.id,
    validation: { kind: 'combined', recipe: 'riddle-position', mechanics: ['riddle', 'position'], anchorOptionId: anchor.id, anchorConceptId: riddle.answerConceptId, offset, riddleConceptId: riddle.id },
  });
}

function generateCombinedPositionPattern(random: BombSeededRandom, context: string) {
  const materialized = materializeOptions(random.shuffle(BOMB_WORD_CONCEPTS).slice(0, 4).map(wordSemantic), random, context);
  const anchor = random.pick(materialized.options);
  const offset = chooseValidOffset(anchor.number, random);
  const correct = materialized.options[anchor.number + offset - 1];
  const marker = MARKER_TEXT[correct.marker];
  return command({
    context, stage: 'combined', category: 'combined', controlKind: 'mixed',
    prompt: bombText(`Select the option immediately ${offset > 0 ? 'after' : 'before'} ${anchor.label.en} (option ${anchor.number}), and confirm it has the ${marker.en}.`, `Selecciona la opción inmediatamente ${offset > 0 ? 'después' : 'antes'} de ${anchor.label.es} (opción ${anchor.number}) y confirma que tenga ${marker.es}.`),
    explanation: bombText(`The requested neighbor is option ${correct.number}, ${correct.label.en}, with the ${marker.en}.`, `La opción vecina solicitada es ${correct.number}, ${correct.label.es}, con ${marker.es}.`),
    options: materialized.options, correctOptionId: correct.id,
    validation: { kind: 'combined', recipe: 'position-pattern', mechanics: ['position', 'pattern'], anchorOptionId: anchor.id, anchorConceptId: requiredConcept(materialized, anchor.id), offset, targetMarker: correct.marker },
  });
}

function generateMathValidation(random: BombSeededRandom): BombMathValidation {
  const operation = random.pick(['addition', 'subtraction', 'multiply-add', 'multiply-subtract', 'divide-add', 'divide-subtract', 'missing-addend', 'larger-total'] as const);
  let operands: number[];
  if (operation === 'addition') operands = [random.nextInt(18) + 3, random.nextInt(15) + 2];
  else if (operation === 'subtraction') {
    const answer = random.nextInt(20) + 2;
    const subtrahend = random.nextInt(12) + 2;
    operands = [answer + subtrahend, subtrahend];
  } else if (operation === 'multiply-add') operands = [random.nextInt(8) + 2, random.nextInt(5) + 2, random.nextInt(9) + 1];
  else if (operation === 'multiply-subtract') {
    const left = random.nextInt(7) + 3;
    const right = random.nextInt(5) + 2;
    operands = [left, right, random.nextInt(Math.min(10, left * right - 1)) + 1];
  } else if (operation === 'divide-add' || operation === 'divide-subtract') {
    const divisor = random.nextInt(5) + 2;
    const quotient = random.nextInt(8) + 3;
    const adjustment = operation === 'divide-add' ? random.nextInt(9) + 1 : random.nextInt(quotient - 1) + 1;
    operands = [divisor * quotient, divisor, adjustment];
  } else if (operation === 'missing-addend') {
    const total = random.nextInt(23) + 8;
    operands = [total, random.nextInt(total - 3) + 2];
  } else {
    const a = random.nextInt(10) + 2;
    const b = random.nextInt(10) + 2;
    const larger = a + b + random.nextInt(5) + 1;
    const c = random.nextInt(larger - 3) + 2;
    operands = random.nextBoolean() ? [a, b, c, larger - c] : [c, larger - c, a, b];
  }
  const answer = evaluateBombMath(operation, operands);
  if (answer === null) throw new Error('bomb_generation_failed');
  return { kind: 'math', operation, operands, answer };
}

function mathCopy(validation: BombMathValidation) {
  const [a, b, c, d] = validation.operands;
  const expression = validation.operation === 'addition' ? `${a} + ${b}`
    : validation.operation === 'subtraction' ? `${a} - ${b}`
      : validation.operation === 'multiply-add' ? `(${a} × ${b}) + ${c}`
        : validation.operation === 'multiply-subtract' ? `(${a} × ${b}) - ${c}`
          : validation.operation === 'divide-add' ? `(${a} ÷ ${b}) + ${c}`
            : validation.operation === 'divide-subtract' ? `(${a} ÷ ${b}) - ${c}`
              : validation.operation === 'missing-addend' ? `${b} + ? = ${a}`
                : `the larger total: ${a} + ${b} or ${c} + ${d}`;
  const esExpression = validation.operation === 'larger-total' ? `el total mayor: ${a} + ${b} o ${c} + ${d}` : expression;
  return {
    prompt: bombText(`Solve ${expression}. Select the matching whole number.`, `Resuelve ${esExpression}. Selecciona el número entero correspondiente.`),
    explanation: bombText(`${expression} = ${validation.answer}.`, `${esExpression} = ${validation.answer}.`),
  };
}

function materializeConceptOptions(answer: BombWordConcept, random: BombSeededRandom, context: string) {
  const distractors = random.shuffle(BOMB_WORD_CONCEPTS.filter((entry) => entry.id !== answer.id)).slice(0, 3);
  return materializeOptions([answer, ...distractors].map(wordSemantic), random, context);
}

function materializeNumberOptions(answer: number, random: BombSeededRandom, context: string) {
  const candidates = random.shuffle([answer - 3, answer - 2, answer - 1, answer + 1, answer + 2, answer + 3, answer + 5]
    .filter((value) => value >= 0 && value <= 120 && value !== answer));
  const values = [answer, ...candidates.slice(0, 3)];
  const uniqueValues = [...new Set(values)];
  const boundedFallback = Array.from({ length: 121 }, (_, value) => value)
    .filter((value) => !uniqueValues.includes(value))
    .slice(0, 4 - uniqueValues.length);
  const optionValues = [...uniqueValues, ...boundedFallback];
  if (optionValues.length !== 4) throw new Error('bomb_generation_failed');
  return materializeOptions(optionValues.map((value) => ({ conceptId: `number-${value}`, label: bombText(String(value), String(value)) })), random, context);
}

function materializeOptions(semanticOptions: SemanticOption[], random: BombSeededRandom, context: string): MaterializedOptions {
  if (semanticOptions.length !== 4 || new Set(semanticOptions.map((option) => option.conceptId)).size !== 4) throw new Error('bomb_generation_failed');
  const shuffled = random.shuffle(semanticOptions);
  const markers = random.shuffle([...MARKERS]).slice(0, 4);
  const optionIdByConcept = new Map<string, string>();
  const conceptByOptionId = new Map<string, string>();
  const options = shuffled.map((semantic, index): BombChallengeOption => {
    const id = `control-${digest(`${context}:${semantic.conceptId}:${index}`).slice(0, 16)}`;
    optionIdByConcept.set(semantic.conceptId, id);
    conceptByOptionId.set(id, semantic.conceptId);
    return { id, number: index + 1, marker: markers[index], label: { ...semantic.label }, ...(semantic.color ? { color: semantic.color } : {}) };
  });
  return { options, optionIdByConcept, conceptByOptionId };
}

function command(input: Omit<BombPrivateCommand, 'challengeId'> & { context: string }): BombPrivateCommand {
  const { context, ...commandInput } = input;
  return { ...commandInput, challengeId: `${commandInput.category}-${digest(context).slice(0, 16)}` };
}

function wordSemantic(concept: BombWordConcept): SemanticOption {
  return { conceptId: concept.id, label: concept.controlLabel };
}

function controlSemantic(conceptId: string): SemanticOption {
  const label = bombControlLabel(conceptId);
  if (!label) throw new Error('bomb_content_invalid');
  return { conceptId, label };
}

function chooseValidOffset(anchorNumber: number, random: BombSeededRandom) {
  return random.pick([-1, 1].filter((offset) => anchorNumber + offset >= 1 && anchorNumber + offset <= 4));
}

function requiredEncoded(value: string, shift: number) {
  const encoded = encodeBombCaesar(value, shift);
  if (!encoded) throw new Error('bomb_content_invalid');
  return encoded;
}

function requiredOptionId(options: MaterializedOptions, conceptId: string) {
  const id = options.optionIdByConcept.get(conceptId);
  if (!id) throw new Error('bomb_generation_failed');
  return id;
}

function requiredConcept(options: MaterializedOptions, optionId: string) {
  const concept = options.conceptByOptionId.get(optionId);
  if (!concept) throw new Error('bomb_generation_failed');
  return concept;
}

function requiredOption(options: BombChallengeOption[], optionId: string) {
  const option = options.find((entry) => entry.id === optionId);
  if (!option) throw new Error('bomb_generation_failed');
  return option;
}

function randomDistinctNumbers(random: BombSeededRandom, count: number, min: number, max: number) {
  return random.shuffle(Array.from({ length: max - min + 1 }, (_, index) => min + index)).slice(0, count);
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

class BombSeededRandom {
  private counter = 0;

  constructor(private readonly seed: string) {}

  nextInt(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('bomb_generation_failed');
    const range = 0x1_0000_0000;
    const ceiling = Math.floor(range / limit) * limit;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const value = createHash('sha256').update(`${this.seed}:${this.counter++}`).digest().readUInt32BE(0);
      if (value < ceiling) return value % limit;
    }
    throw new Error('bomb_generation_failed');
  }

  nextBoolean() {
    return this.nextInt(2) === 1;
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new Error('bomb_generation_failed');
    return values[this.nextInt(values.length)];
  }

  shuffle<T>(values: readonly T[]) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = this.nextInt(index + 1);
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }
}
