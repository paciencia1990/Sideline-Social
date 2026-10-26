'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'functions/src/triviaGame.ts'), 'utf8');
const ast = ts.createSourceFile('triviaGame.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['normalizeQuestionBank', 'selectQuestions', 'toPublicQuestion', 'stableQuestionId', 'readNonEmptyString', 'readStringArray']);
const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text));
assert.equal(declarations.length, names.size, 'Exercise the shipped server declarations, not a copied client algorithm');
const rawBank = JSON.parse(fs.readFileSync(path.join(root, 'functions/src/triviaQuestions.json'), 'utf8'));
const body = declarations.map(node => node.getText(ast)).join('\n') +
  '\nconst questionBank = normalizeQuestionBank(rawTriviaQuestions);\n' +
  'module.exports = { normalizeQuestionBank, selectQuestions, toPublicQuestion, stableQuestionId };';
const compiled = ts.transpileModule(body, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(randomInt) {
  const module = { exports: {} };
  // No Firebase entry point, SDK initialization, credentials or network access.
  new Function('module', 'rawTriviaQuestions', 'randomInt', compiled)(module, rawBank, randomInt);
  return module.exports;
}
const server = load(maximum => maximum - 1);
const bank = server.normalizeQuestionBank(rawBank);
assert.ok(bank.length >= 10);
assert.equal(new Set(bank.map(question => question.id)).size, bank.length);
const sample = { category: 'Sports', question_en: 'Which color?', question_es: '¿Qué color?', options_en: ['Red', 'Blue'], options_es: ['Rojo', 'Azul'], answer: 1 };
const normalized = server.normalizeQuestionBank([sample, { ...sample }, { ...sample, answer: 99 }, { ...sample, options_es: ['Rojo'] }, null]);
assert.equal(normalized.length, 1, 'Duplicate and malformed questions are excluded');
assert.equal(normalized[0].id, server.stableQuestionId(sample.category, sample.question_en));
assert.equal(server.normalizeQuestionBank([{ ...sample, question_es: 'Otro texto' }])[0].id, normalized[0].id, 'Identity remains independent of the translated text');
const first = server.selectQuestions(10), second = load(() => 0).selectQuestions(10);
assert.equal(first.length, 10);
assert.equal(new Set(first.map(question => question.id)).size, 10, 'A session contains no duplicate IDs');
assert.notDeepEqual(first.map(question => question.id), second.map(question => question.id), 'A fresh server shuffle can produce a new order');
assert.equal(server.selectQuestions(0).length, 0);
assert.equal(server.selectQuestions(bank.length + 1).length, bank.length);
for (const question of first) {
  const publicQuestion = server.toPublicQuestion(question);
  assert.equal(Object.hasOwn(publicQuestion, 'answer'), false, 'The answer key stays server-only');
  assert.equal(publicQuestion.options_en[question.answer], question.options_en[question.answer]);
  assert.equal(publicQuestion.options_es[question.answer], question.options_es[question.answer]);
}
console.log('Shipped server trivia normalization, unique selection, fresh shuffle, bilingual answers and public redaction passed.');
