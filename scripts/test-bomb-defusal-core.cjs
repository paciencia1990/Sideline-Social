const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const core = require('../functions/lib/bombDefusalCore.js');

const root = path.resolve(__dirname, '..');
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const loadTypeScript = (relativePath) => {
  const output = ts.transpileModule(source(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const localModule = { exports: {} };
  Function('require', 'module', 'exports', output)(require, localModule, localModule.exports);
  return localModule.exports;
};
const choiceText = loadTypeScript('src/game/bombDefusalChoiceText.ts');
const normalize = (value) => core.normalizeBombWord(value);
const sortedLetters = (value) => [...normalize(value)].sort().join('');
const seedFor = (locale, index) => createHash('sha256').update(`bomb-defusal:${locale}:${index}`).digest('hex');
const markerLabels = {
  en: {
    solid: 'solid pattern', striped: 'striped pattern', dashed: 'dashed pattern', dotted: 'dotted pattern',
    circle: 'circle marker', square: 'square marker', triangle: 'triangle marker', diamond: 'diamond marker',
  },
  es: {
    solid: 'patrón sólido', striped: 'patrón de rayas', dashed: 'patrón de guiones', dotted: 'patrón de puntos',
    circle: 'marca circular', square: 'marca cuadrada', triangle: 'marca triangular', diamond: 'marca de rombo',
  },
};

assert.equal(core.BOMB_ROLE_SCHEMA_VERSION, 3);
assert.equal(core.BOMB_COMMAND_COUNT, 6);
assert.equal(core.BOMB_MAX_STRIKES, 1);
assert.equal(core.BOMB_GENERATOR_VERSION, 2);
assert.equal(core.BOMB_RECENT_FINGERPRINT_LIMIT, 30);
assert.equal(core.BOMB_GENERATION_MAX_ATTEMPTS, 12);

assert.equal(choiceText.buildBombChoiceDescription({ label: 'Striped panel', locale: 'en', marker: 'striped', markerLabel: 'striped pattern' }), 'Striped panel');
assert.equal(choiceText.buildBombChoiceDescription({ label: 'Dotted panel', locale: 'en', marker: 'dotted', markerLabel: 'dotted pattern' }), 'Dotted panel');
assert.equal(choiceText.buildBombChoiceDescription({ label: 'Solid panel', locale: 'en', marker: 'triangle', markerLabel: 'triangle marker' }), 'Solid panel with triangle marker');
assert.equal(choiceText.buildBombChoiceDescription({ label: 'Dashed panel', locale: 'en', marker: 'circle', markerLabel: 'circle marker' }), 'Dashed panel with circle marker');
assert.equal(choiceText.buildBombChoiceDescription({ label: 'Panel de rayas', locale: 'es', marker: 'striped', markerLabel: 'patrón de rayas' }), 'Panel de rayas');
assert.equal(choiceText.buildBombChoiceDescription({ label: 'Panel sólido', locale: 'es', marker: 'triangle', markerLabel: 'marca triangular' }), 'Panel sólido con marca triangular');
assert.equal(choiceText.buildBombChoiceDescription({ label: 'Red wire with a solid pattern', locale: 'en', marker: 'dotted', markerLabel: 'dotted pattern' }), 'Red wire with a solid pattern and dotted pattern');
assert.equal(choiceText.buildBombChoiceDescription({ label: 'Cable rojo con patrón sólido', locale: 'es', marker: 'dotted', markerLabel: 'patrón de puntos' }), 'Cable rojo con patrón sólido y patrón de puntos');

assert.ok(core.BOMB_WORD_CONCEPTS.length >= 20, 'at least 20 bilingual word concepts are required');
assert.ok(core.BOMB_RIDDLE_CONCEPTS.length >= 20, 'at least 20 original bilingual riddles are required');
assert.equal(new Set(core.BOMB_WORD_CONCEPTS.map((entry) => entry.id)).size, core.BOMB_WORD_CONCEPTS.length);
assert.equal(new Set(core.BOMB_RIDDLE_CONCEPTS.map((entry) => entry.id)).size, core.BOMB_RIDDLE_CONCEPTS.length);

for (const concept of core.BOMB_WORD_CONCEPTS) {
  assert.equal(concept.validation.familiarObject, true);
  assert.deepEqual(concept.validation.independentlyReviewedLocales, ['en', 'es']);
  for (const locale of ['en', 'es']) {
    assert.ok(concept.answer[locale].trim());
    assert.ok(concept.controlLabel[locale].trim());
    assert.equal(sortedLetters(concept.answer[locale]), sortedLetters(concept.scramble[locale]), `${concept.id} must be a valid ${locale} scramble`);
    assert.notEqual(normalize(concept.answer[locale]), normalize(concept.scramble[locale]), `${concept.id} must actually be scrambled in ${locale}`);
  }
  if (concept.cipherApproved) {
    assert.match(concept.answer.en, /^[A-Z]+$/);
    assert.match(concept.answer.es, /^[A-Z]+$/);
    assert.doesNotMatch(concept.answer.es, /Ñ/);
  }
}

for (const riddle of core.BOMB_RIDDLE_CONCEPTS) {
  assert.equal(riddle.source, 'original-sideline-social');
  assert.ok(core.bombControlLabel(riddle.answerConceptId), `${riddle.id} needs a bilingual answer control`);
  assert.equal(new Set([riddle.answerConceptId, ...riddle.distractorConceptIds]).size, 4, `${riddle.id} needs three distinct distractors`);
  for (const locale of ['en', 'es']) {
    assert.ok(riddle.prompt[locale].trim());
    assert.ok(riddle.explanation[locale].trim());
    assert.ok(riddle.prompt[locale].length <= 180, `${riddle.id} must remain concise in ${locale}`);
  }
}
for (const locale of ['en', 'es']) {
  assert.equal(new Set(core.BOMB_RIDDLE_CONCEPTS.map((entry) => normalize(entry.prompt[locale]))).size, core.BOMB_RIDDLE_CONCEPTS.length);
}

const deterministicSeed = seedFor('deterministic', 1);
const deterministicHistory = Array.from({ length: 8 }, (_, index) => createHash('sha256').update(`history:${index}`).digest('hex').slice(0, 24));
const deterministicA = core.createBombGeneratedRound(deterministicSeed, deterministicHistory);
const deterministicB = core.createBombGeneratedRound(deterministicSeed, deterministicHistory);
assert.deepEqual(deterministicA, deterministicB, 'the same seed and history must reproduce the complete stored round');
assert.notDeepEqual(
  core.createBombGeneratedRound(seedFor('deterministic', 2), deterministicHistory).challengeFingerprints,
  deterministicA.challengeFingerprints,
  'different seeds should produce different rounds',
);

const fakeHistory = Array.from({ length: 40 }, (_, index) => index.toString(16).padStart(24, '0'));
assert.deepEqual(
  core.normalizeBombRecentHistory(['invalid', ...fakeHistory, fakeHistory[39]]),
  fakeHistory.slice(-30),
  'history must reject malformed entries, keep the newest duplicate, and stay bounded to five rounds',
);

const coverage = {
  directTemplates: new Set(),
  positionTemplates: new Set(),
  reasoningCategories: new Set(),
  mathOperations: new Set(),
  wordConcepts: new Set(),
  riddleConcepts: new Set(),
  cipherConcepts: new Set(),
  combinedRecipes: new Set(),
  sequenceSignatures: new Set(),
};

const generatedRoundCountPerLocale = 10_000;
const performanceStartedAt = Date.now();
for (const locale of ['en', 'es']) {
  let recentHistory = [];
  let previousFingerprints = [];
  for (let roundIndex = 0; roundIndex < generatedRoundCountPerLocale; roundIndex += 1) {
    const generated = core.createBombGeneratedRound(seedFor(locale, roundIndex), recentHistory);
    assert.equal(core.validateBombChallengeSequence(generated.commands), true, `${locale} round ${roundIndex} must validate`);
    assert.equal(generated.commands.length, 6);
    assert.deepEqual(generated.commands.map((command) => command.stage), ['direct', 'interpretation', 'reasoning', 'reasoning', 'reasoning', 'combined']);
    assert.equal(new Set(generated.commands.slice(2, 5).map((command) => command.category)).size, 3);
    assert.equal(generated.challengeFingerprints.length, 6);
    assert.equal(new Set(generated.challengeFingerprints).size, 6);
    coverage.sequenceSignatures.add(generated.challengeFingerprints.join(':'));
    assert.deepEqual(generated.challengeFingerprints, generated.commands.map(core.createBombChallengeFingerprint));
    assert.ok(generated.challengeFingerprints.every((fingerprint) => /^[a-f0-9]{24}$/.test(fingerprint)));
    assert.ok(generated.recentChallengeFingerprints.length <= core.BOMB_RECENT_FINGERPRINT_LIMIT);
    assert.deepEqual(
      generated.recentChallengeFingerprints,
      core.normalizeBombRecentHistory([...recentHistory, ...generated.challengeFingerprints]),
    );
    const immediateOverlap = generated.challengeFingerprints.filter((fingerprint) => previousFingerprints.includes(fingerprint)).length;
    assert.ok(immediateOverlap <= 2, `${locale} round ${roundIndex} must differ materially from the prior round`);

    for (let commandIndex = 0; commandIndex < generated.commands.length; commandIndex += 1) {
      const command = generated.commands[commandIndex];
      assert.equal(core.validateBombChallenge(command), true);
      assert.equal(core.isBombPrivateCommand(command), true);
      assert.equal(command.options.length, 4);
      assert.deepEqual([...command.options.map((option) => option.number)].sort((a, b) => a - b), [1, 2, 3, 4]);
      assert.equal(new Set(command.options.map((option) => option.id)).size, 4);
      assert.equal(new Set(command.options.map((option) => option.marker)).size, 4);
      assert.equal(new Set(command.options.map((option) => normalize(option.label[locale]))).size, 4);
      assert.ok(command.options.every((option) => /^control-[a-f0-9]{16}$/.test(option.id)), 'option IDs must be opaque');
      assert.ok(command.options.every((option) => !('preview' in option) && !('color' in option)), 'generated choices must be text-only');
      assert.equal(command.options.filter((option) => option.id === command.correctOptionId).length, 1);
      assert.ok(command.prompt[locale].trim());
      assert.ok(command.explanation[locale].trim());
      if (command.stage === 'reasoning' && (command.category === 'word' || command.category === 'cipher')) {
        assert.equal(command.responseMode, 'text');
      } else {
        assert.equal(command.responseMode, 'options');
      }

      const publicCommand = core.createBombPublicCommand(command, commandIndex);
      assert.deepEqual(Object.keys(publicCommand).sort(), ['category', 'commandId', 'commandIndex', 'controlKind', 'options', 'responseMode', 'stage']);
      assert.equal(JSON.stringify(publicCommand).includes('correctOptionId'), false);
      assert.equal(JSON.stringify(publicCommand).includes('prompt'), false);
      assert.equal(JSON.stringify(publicCommand).includes('explanation'), false);
      assert.equal(JSON.stringify(publicCommand).includes('validation'), false);
      assert.equal(JSON.stringify(publicCommand).includes('challengeId'), false);
      const localizedPublic = core.localizeBombPublicCommand(command, commandIndex, locale);
      assert.ok(localizedPublic.options.every((option) => typeof option.label === 'string' && option.label.trim()));
      assert.ok(localizedPublic.options.every((option) => !('preview' in option) && !('color' in option)), 'public choices must not expose visual-preview data');
      if (command.responseMode === 'text') {
        assert.deepEqual(publicCommand.options, [], 'typed commands must not expose answer choices');
        assert.equal(JSON.stringify(publicCommand).includes(command.validation.answer?.[locale] ?? command.validation.decoded?.[locale] ?? ''), false);
      } else {
        assert.equal(publicCommand.options.length, 4);
        const descriptions = localizedPublic.options.map((option) => choiceText.buildBombChoiceDescription({
          label: option.label,
          locale,
          marker: option.marker,
          markerLabel: markerLabels[locale][option.marker],
        }));
        assert.ok(descriptions.every((description) => description.trim() && !/[\r\n]/u.test(description)), 'each choice must have one concise text description');
        assert.equal(new Set(descriptions.map(normalize)).size, 4, 'text-only descriptions must keep every choice distinguishable');
      }

      const expertInstruction = core.createBombExpertInstruction(command, locale);
      assert.ok(expertInstruction.prompt.trim());
      assert.equal('challengeId' in expertInstruction, false);
      assert.equal('correctOptionId' in expertInstruction, false);
      const solution = core.createBombSolution(command, locale);
      assert.equal(solution.correctOptionId, command.correctOptionId);
      assert.ok(solution.correctOptionLabel.trim());
      assert.ok(solution.explanation.trim());
      if (command.responseMode === 'text') {
        const expected = command.validation.kind === 'word'
          ? command.validation.answer[locale]
          : command.validation.decoded[locale];
        assert.equal(core.bombCommandMatches(command, { value: `  ${expected.toLowerCase()}  ` }), true);
        assert.equal(core.bombCommandMatches(command, { value: 'definitely-wrong' }), false);
        assert.equal(core.bombCommandMatches(command, { value: '   ' }), false);
      } else {
        assert.equal(core.bombCommandMatches(command, { optionId: command.correctOptionId }), true);
        assert.equal(core.bombCommandMatches(command, { optionId: command.options.find((option) => option.id !== command.correctOptionId).id }), false);
      }

      const validation = command.validation;
      if (validation.kind === 'direct') coverage.directTemplates.add(validation.template);
      if (validation.kind === 'position') coverage.positionTemplates.add(validation.template);
      if (command.stage === 'reasoning') coverage.reasoningCategories.add(command.category);
      if (validation.kind === 'math') {
        coverage.mathOperations.add(validation.operation);
        assert.equal(core.evaluateBombMath(validation.operation, validation.operands), validation.answer);
      }
      if (validation.kind === 'word') {
        coverage.wordConcepts.add(validation.conceptId);
        assert.equal(sortedLetters(validation.answer[locale]), sortedLetters(validation.scramble[locale]));
      }
      if (validation.kind === 'riddle') coverage.riddleConcepts.add(validation.conceptId);
      if (validation.kind === 'cipher') {
        coverage.cipherConcepts.add(validation.conceptId);
        assert.equal(core.encodeBombCaesar(validation.decoded[locale], validation.shift), validation.encoded[locale]);
        assert.equal(core.decodeBombCaesar(validation.encoded[locale], validation.shift), validation.decoded[locale]);
      }
      if (validation.kind === 'combined') {
        coverage.combinedRecipes.add(validation.recipe);
        assert.equal(validation.mechanics.length, 2);
        assert.equal(new Set(validation.mechanics).size, 2);
      }
    }
    previousFingerprints = generated.challengeFingerprints;
    recentHistory = generated.recentChallengeFingerprints;
  }
}
const generationDurationMs = Date.now() - performanceStartedAt;
assert.ok(generationDurationMs < 60_000, `20,000 localized rounds took ${generationDurationMs}ms`);

assert.deepEqual([...coverage.directTemplates].sort(), ['number', 'object', 'pattern', 'symbol', 'wire']);
assert.deepEqual([...coverage.positionTemplates].sort(), ['between', 'offset', 'ordinal']);
assert.deepEqual([...coverage.reasoningCategories].sort(), ['cipher', 'math', 'riddle', 'word']);
assert.deepEqual([...coverage.mathOperations].sort(), ['addition', 'divide-add', 'divide-subtract', 'larger-total', 'missing-addend', 'multiply-add', 'multiply-subtract', 'subtraction']);
assert.deepEqual([...coverage.combinedRecipes].sort(), ['cipher-position', 'math-marker', 'math-symbol', 'position-pattern', 'riddle-position', 'word-marker']);
assert.equal(coverage.wordConcepts.size, core.BOMB_WORD_CONCEPTS.length);
assert.equal(coverage.riddleConcepts.size, core.BOMB_RIDDLE_CONCEPTS.length);
assert.equal(coverage.cipherConcepts.size, core.BOMB_WORD_CONCEPTS.filter((entry) => entry.cipherApproved).length);
assert.equal(coverage.sequenceSignatures.size, generatedRoundCountPerLocale * 2, 'the deterministic 20,000-round sample must contain no duplicate sequence');

for (let playerCount = 2; playerCount <= 6; playerCount += 1) {
  const players = Array.from({ length: playerCount }, (_, index) => ({ uid: `player-${index + 1}`, joinOrder: index + 1 }));
  const defuserTurns = new Map(players.map((player) => [player.uid, 0]));
  const expertTurns = new Map(players.map((player) => [player.uid, 0]));
  for (let commandIndex = 0; commandIndex < playerCount * 2; commandIndex += 1) {
    const assignment = core.assignBombRoles(players, commandIndex);
    assert.ok(assignment);
    assert.equal(assignment.defuserUserId, players[commandIndex % playerCount].uid);
    assert.equal(assignment.expertUserId, players[(commandIndex + 1) % playerCount].uid);
    defuserTurns.set(assignment.defuserUserId, defuserTurns.get(assignment.defuserUserId) + 1);
    expertTurns.set(assignment.expertUserId, expertTurns.get(assignment.expertUserId) + 1);
    for (const player of players) {
      const expectedRole = player.uid === assignment.defuserUserId ? 'defuser' : player.uid === assignment.expertUserId ? 'expert' : 'support';
      assert.equal(core.roleForBombPlayer(player.uid, assignment), expectedRole);
    }
  }
  assert.deepEqual([...defuserTurns.values()], Array(playerCount).fill(2));
  assert.deepEqual([...expertTurns.values()], Array(playerCount).fill(2));
}

const malformed = deterministicA.commands[0];
assert.equal(core.validateBombChallenge({ ...malformed, validation: undefined }), false, 'malformed stored commands fail closed');
assert.equal(core.validateBombChallenge({ ...malformed, options: malformed.options.slice(0, 3) }), false);
assert.equal(core.validateBombChallenge({ ...malformed, correctOptionId: 'control-ffffffffffffffff' }), false);
const legacyOptionsCommand = { ...malformed };
delete legacyOptionsCommand.responseMode;
assert.equal(core.validateBombChallenge(legacyOptionsCommand), true, 'stored option commands from generator v1 remain playable');
assert.equal(core.bombCommandMatches(legacyOptionsCommand, { optionId: malformed.correctOptionId }), true);
const legacyVisualCommand = {
  ...malformed,
  options: malformed.options.map((option, index) => index === 0
    ? { ...option, color: 'red', preview: { kind: 'wire', pattern: 'solid' } }
    : option),
};
assert.equal(core.validateBombChallenge(legacyVisualCommand), true, 'legacy command data with preview fields remains playable');
assert.ok(core.createBombPublicCommand(legacyVisualCommand, 0).options.every((option) => !('preview' in option) && !('color' in option)), 'legacy preview fields must not reach the client');
const ordinalCommand = Array.from({ length: 100 }, (_, index) => core.createBombGeneratedRound(seedFor('ordinal', index)).commands[1])
  .find((command) => command.validation.kind === 'position' && command.validation.template === 'ordinal');
assert.ok(ordinalCommand);
const realtimeRoundTrippedOrdinal = core.cloneBombChallenge(ordinalCommand);
delete realtimeRoundTrippedOrdinal.validation.anchorOptionIds;
delete realtimeRoundTrippedOrdinal.validation.anchorConceptIds;
assert.equal(core.validateBombChallenge(realtimeRoundTrippedOrdinal), true, 'ordinal validation survives Realtime Database omitting empty arrays');
assert.doesNotThrow(() => core.validateBombChallenge({ ...malformed, validation: { kind: 'combined' } }));
assert.throws(() => core.createBombGeneratedRound('short'), /bomb_seed_invalid/);

const functionSource = source('functions/src/gameJoinCodes.ts');
const generatorSource = source('functions/src/bombDefusalGenerator.ts');
const serviceSource = source('services/gameJoinCodeService.ts');
const screenSource = source('src/game/BombDefusalScreen.tsx');
const choiceTextSource = source('src/game/bombDefusalChoiceText.ts');
const translationSource = source('i18n/index.ts');
const rulesSource = source('database.rules.json');
const rewardSource = source('functions/src/sidelineStarsCore.ts');

assert.match(functionSource, /randomBytes\(32\)\.toString\('hex'\)/, 'round seeds must use server-side cryptographic randomness');
assert.match(functionSource, /generationSeed: bombSeed/);
assert.match(functionSource, /generatorVersion: BOMB_GENERATOR_VERSION/);
assert.match(functionSource, /recentChallengeFingerprints: bombRound\?\.recentChallengeFingerprints/);
assert.match(functionSource, /assignment\.defuserUserId !== uid/);
assert.match(functionSource, /role === 'expert'[\s\S]*createBombExpertInstruction/);
assert.match(functionSource, /solution:[\s\S]*=== 'playing'[\s\S]*createBombSolution/);
assert.match(functionSource, /const outcome = !correct[\s\S]*'exploded'/);
assert.match(functionSource, /const nextCommandIndex = correct \? currentCommandIndex \+ 1 : currentCommandIndex/);
assert.match(functionSource, /roleRevision:[\s\S]*\+ \(correct && outcome === 'playing' \? 1 : 0\)/);
assert.match(functionSource, /processedSubmissions/);
assert.match(functionSource, /validateBombChallengeSequence/);
assert.match(functionSource, /keys\[0\] === 'value'/, 'typed responses must cross the same validated callable boundary');
assert.match(functionSource, /rewardEligible: false/, 'abandoned rounds remain ineligible');
assert.match(functionSource, /completionReason: 'timeout'[\s\S]*strikeCount: BOMB_MAX_STRIKES/);
assert.doesNotMatch(generatorSource, /\bwhile\b/, 'generation must not contain an unbounded retry loop');
assert.match(generatorSource, /attempt < BOMB_GENERATION_MAX_ATTEMPTS/);
assert.match(generatorSource, /category: 'word'[\s\S]*responseMode: 'text'/);
assert.match(generatorSource, /category: 'cipher'[\s\S]*responseMode: 'text'/);
assert.doesNotMatch(generatorSource, /fetch\(|axios|openai|https?:\/\//i, 'generation must not call external services');
assert.doesNotMatch(serviceSource, /generationSeed|challengeFingerprints|recentChallengeFingerprints/, 'server generation metadata must not enter the client contract');
assert.doesNotMatch(serviceSource, /nextStep\??:/, 'submission responses never return a private next command');
assert.match(screenSource, /playerView\.role === "defuser"/);
assert.match(screenSource, /playerView\.role === "expert"/);
assert.match(screenSource, /interactive=\{playerView\.role === "defuser"\}/);
assert.match(screenSource, /KeyboardAvoidingView/);
assert.match(screenSource, /TextInput/);
assert.match(screenSource, /publicCommand\.responseMode !== "options"/);
assert.match(screenSource, /buildBombChoiceDescription/);
assert.doesNotMatch(screenSource, /OptionPreview|PatternPreview|ShapePreview|optionPreview|markerBadge|patternStripe|patternDash|patternDot/);
assert.doesNotMatch(generatorSource, /\bpreview\b|\bcolor\b/);
assert.doesNotMatch(serviceSource, /\bpreview\??:|\bcolor\??:/);
assert.match(choiceTextSource, /alreadyCompound[\s\S]*\? "y" : "con"[\s\S]*\? "and" : "with"/);
const optionControlSource = screenSource.slice(screenSource.indexOf('function OptionControl'), screenSource.indexOf('function TextEntryControl'));
assert.equal((optionControlSource.match(/<Text\b/gu) ?? []).length, 2, 'choice cards render only their number and one text description');
assert.doesNotMatch(translationSource, /selectableOption:[^\n]*\{\{marker\}\}|readOnlyOption:[^\n]*\{\{marker\}\}/u, 'choice accessibility copy must not repeat a second marker description');
assert.match(screenSource, /submitInFlightRef\.current \|\| !normalizedValue/);
assert.doesNotMatch(screenSource, /styles\.roleBody|styles\.assignmentText/);
assert.match(screenSource, /solution\.correctOptionLabel[\s\S]*solution\.explanation/);
assert.doesNotMatch(screenSource, /generateBombPattern|validateStep|currentStep/);
assert.match(rulesSource, /roleSchemaVersion'\)\.val\(\) == 3/);
assert.match(rulesSource, /"gameSessionSecrets"[\s\S]*?"\.read": false/);
assert.match(rewardSource, /completionStars: input\.outcome === 'defused' \? 5 : 0/);

console.log(`Bomb Defusal generated and validated ${generatedRoundCountPerLocale.toLocaleString()} rounds per locale (${(generatedRoundCountPerLocale * 2).toLocaleString()} total) in ${generationDurationMs}ms.`);
console.log(`Curated content: ${core.BOMB_WORD_CONCEPTS.length} bilingual word concepts and ${core.BOMB_RIDDLE_CONCEPTS.length} original bilingual riddles.`);
console.log('Determinism, bounded replay history, answer correctness, role isolation, privacy, detonation, and reward tests passed.');
