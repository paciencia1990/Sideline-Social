// Focused, offline source check. TypeScript is evaluated in memory; no build
// files, Firebase connections, SDK calls or device actions are created.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const cache = new Map();
function loadSource(relativePath) {
  const filename = path.resolve(root, relativePath);
  if (cache.has(filename)) return cache.get(filename).exports;
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  });
  const errors = (result.diagnostics ?? []).filter((entry) => entry.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, '\n')).join('\n'));
  const module = { exports: {} };
  cache.set(filename, module);
  const localRequire = (name) => {
    if (name === 'node:crypto') return require(name);
    assert.ok(name.startsWith('.'), `Unexpected external dependency: ${name}`);
    return loadSource(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`)));
  };
  Function('require', 'module', 'exports', result.outputText)(localRequire, module, module.exports);
  return module.exports;
}

const core = loadSource('functions/src/bombDefusalCore.ts');
const { buildBombChoiceDescription } = loadSource('src/game/bombDefusalChoiceText.ts');
const markers = ['solid', 'striped', 'dashed', 'dotted', 'circle', 'square', 'triangle', 'diamond'];
const describe = (label, locale, marker = 'striped') => buildBombChoiceDescription({ label, locale, marker, markerLabel: 'extra decoration' });

for (const [locale, labels] of Object.entries({
  en: ['Diamond', 'Triangle', 'Square', 'Circle'],
  es: ['Rombo', 'Triángulo', 'Cuadrado', 'Círculo'],
})) {
  for (const marker of markers) {
    assert.deepEqual(labels.map((label) => describe(label, locale, marker)), labels);
  }
}
assert.equal(describe('Red wire with a solid pattern', 'en'), 'Red');
assert.equal(describe('Cable azul con patrón de rayas', 'es'), 'Azul');
assert.equal(describe('Solid panel', 'en'), 'Solid');
assert.equal(describe('Panel de puntos', 'es'), 'Puntos');
assert.equal(describe('Clock', 'en'), 'Clock');
assert.equal(describe('42', 'en'), '42');

const directTemplates = new Set();
const combinedRecipes = new Set();
const removedSecondaryDescriptor = /\b(?:marker|pattern|patrón|marca|background)\b/iu;
let commandsChecked = 0;
for (let index = 0; index < 400; index += 1) {
  const seed = createHash('sha256').update(`bomb-single-descriptor:${index}`).digest('hex');
  const round = core.createBombGeneratedRound(seed);
  for (const command of round.commands) {
    commandsChecked += 1;
    assert.equal(core.validateBombChallenge(command), true, 'simplified command must remain solvable');
    if (command.validation.kind === 'direct') directTemplates.add(command.validation.template);
    if (command.validation.kind === 'combined') combinedRecipes.add(command.validation.recipe);
    for (const locale of ['en', 'es']) {
      const instruction = core.createBombExpertInstruction(command, locale);
      const solution = core.createBombSolution(command, locale);
      assert.doesNotMatch(instruction.prompt, removedSecondaryDescriptor);
      assert.doesNotMatch(solution.explanation, removedSecondaryDescriptor);
      const choices = core.localizeBombPublicCommand(command, 0, locale).options;
      if (command.responseMode !== 'options') continue;
      const descriptions = choices.map((option) => describe(option.label, locale, option.marker));
      assert.equal(new Set(descriptions).size, 4, 'single descriptors must remain distinct');
      for (const description of descriptions) {
        assert.match(description, /^\S+$/u, 'each generated answer has one descriptor');
      }
      const matchingChoices = choices.filter((option) => describe(option.label, locale, option.marker) === solution.correctOptionLabel);
      assert.equal(matchingChoices.length, 1, 'solution must identify exactly one visible choice');
      assert.equal(matchingChoices[0].id, command.correctOptionId);
      assert.equal(core.bombCommandMatches(command, { optionId: matchingChoices[0].id }), true);
      for (const option of choices.filter((choice) => choice.id !== command.correctOptionId)) {
        assert.equal(core.bombCommandMatches(command, { optionId: option.id }), false);
      }
      if (command.validation.kind === 'direct') {
        assert.ok(instruction.prompt.includes(solution.correctOptionLabel));
      }
      if (command.validation.kind === 'combined' && ['math-marker', 'math-symbol'].includes(command.validation.recipe)) {
        assert.ok(instruction.prompt.includes(solution.correctOptionLabel), 'math confirmation names the same single shape');
      }
    }
  }
}
assert.deepEqual([...directTemplates].sort(), ['number', 'object', 'pattern', 'symbol', 'wire']);
assert.deepEqual([...combinedRecipes].sort(), ['cipher-position', 'math-marker', 'math-symbol', 'position-pattern', 'riddle-position', 'word-marker']);
console.log(JSON.stringify({ status: 'passed', rounds: 400, commandsChecked, locales: ['en', 'es'], directTemplates: directTemplates.size, combinedRecipes: combinedRecipes.size, sourceOnly: true }));
