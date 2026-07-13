"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  module._compile(compiled, filename);
};

const {
  ICEBREAKER_QUESTIONS,
  createIcebreakerRotation,
} = require(path.join(process.cwd(), "constants", "icebreakerQuestions.ts"));

assert.equal(ICEBREAKER_QUESTIONS.length, 80, "The catalog must contain 80 questions.");
assert.equal(new Set(ICEBREAKER_QUESTIONS.map(({ id }) => id)).size, 80, "Question IDs must be unique.");
assert.equal(
  new Set(ICEBREAKER_QUESTIONS.map(({ translationKey }) => translationKey)).size,
  80,
  "Translation keys must be unique.",
);

for (const category of ["playful", "interests", "warm", "sideline"]) {
  assert.equal(
    ICEBREAKER_QUESTIONS.filter((question) => question.category === category).length,
    20,
    `Expected 20 ${category} questions.`,
  );
}

let seed = 123456789;
const random = () => {
  seed = (1664525 * seed + 1013904223) % 0x100000000;
  return seed / 0x100000000;
};
const rotation = createIcebreakerRotation(random);
const initial = rotation.getCurrent();
assert.equal(rotation.getCurrent().id, initial.id, "The current question must stay stable.");
assert.notEqual(initial.category, "warm", "The first question should favor lower-pressure categories.");

const firstCycle = [initial];
for (let index = 1; index < 80; index += 1) {
  const previous = firstCycle[index - 1];
  const next = rotation.next();
  assert.notEqual(next.id, previous.id, "Questions must not immediately repeat.");
  assert.notEqual(next.category, previous.category, "Adjacent questions should avoid the same category.");
  firstCycle.push(next);
}
assert.equal(new Set(firstCycle.map(({ id }) => id)).size, 80, "A cycle must show all questions without repeats.");

const firstOfNextCycle = rotation.next();
assert.notEqual(
  firstOfNextCycle.id,
  firstCycle[firstCycle.length - 1].id,
  "A reshuffled cycle must not immediately repeat the last question.",
);

const translations = fs.readFileSync(path.join(process.cwd(), "i18n", "index.ts"), "utf8");
for (const { translationKey } of ICEBREAKER_QUESTIONS) {
  const key = translationKey.split(".").at(-1);
  const matches = translations.match(new RegExp(`\\b${key}:`, "g")) ?? [];
  assert.equal(matches.length, 2, `${translationKey} must exist in English and Spanish.`);
}

console.log("Icebreaker catalog, translations, and session rotation checks passed.");