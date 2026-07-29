const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const i18nPath = path.join(root, "i18n", "index.ts");
const i18nSource = fs.readFileSync(i18nPath, "utf8");
const i18nFile = ts.createSourceFile(
  i18nPath,
  i18nSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const resources = findVariableInitializer(i18nFile, "resources");

assert(ts.isObjectLiteralExpression(resources), "i18n resources must remain an object literal");

const english = getTranslationObject(resources, "en");
const spanish = getTranslationObject(resources, "es");
const englishKeys = flattenTranslations(english);
const spanishKeys = flattenTranslations(spanish);
const gameNamespaces = ["icebreaker", "game", "spot", "bomb", "trivia", "games", "rewards"];

for (const namespace of gameNamespaces) {
  const englishNamespace = subsetByPrefix(englishKeys, `${namespace}.`);
  const spanishNamespace = subsetByPrefix(spanishKeys, `${namespace}.`);

  assert(englishNamespace.size > 0, `English game namespace "${namespace}" must not be empty`);
  assert.deepEqual(
    [...spanishNamespace.keys()].sort(),
    [...englishNamespace.keys()].sort(),
    `English and Spanish keys differ in the "${namespace}" namespace`,
  );

  for (const [key, englishValue] of englishNamespace) {
    const spanishValue = spanishNamespace.get(key);
    assert.equal(
      typeof spanishValue,
      "string",
      `Spanish translation is missing for ${key}`,
    );
    assert.deepEqual(
      interpolationVariables(spanishValue),
      interpolationVariables(englishValue),
      `Interpolation variables differ for ${key}`,
    );
  }
}

assertPluralPair(englishKeys, "bomb.secondsRemaining");
assertPluralPair(spanishKeys, "bomb.secondsRemaining");
assertPluralPair(englishKeys, "spot.completeBody");
assertPluralPair(spanishKeys, "spot.completeBody");
assertPluralPair(englishKeys, "spot.secondsRemaining");
assertPluralPair(spanishKeys, "spot.secondsRemaining");
assertPluralPair(englishKeys, "trivia.secondsRemaining");
assertPluralPair(spanishKeys, "trivia.secondsRemaining");

const releasedGameFiles = [
  "app/(tabs)/games.tsx",
  "app/(games)/results.tsx",
  "app/(games)/trivia-blitz/Lobby.tsx",
  "app/(games)/bomb-defusal/Lobby.tsx",
  "app/(games)/spot-the-difference/Lobby.tsx",
  "components/CountdownOverlay.tsx",
  "components/GameEndActions.tsx",
  "components/GameRewardSummary.tsx",
  "components/IcebreakerCard.tsx",
  "components/LobbyBase.tsx",
  "src/game/BombDefusalScreen.tsx",
  "src/game/spotDifference/SpotDifferenceScreen.tsx",
  "src/game/triviaBlitz/TriviaBlitzScreen.tsx",
];

const hardCodedFindings = [];
for (const relativePath of releasedGameFiles) {
  const absolutePath = path.join(root, relativePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  const sourceFile = ts.createSourceFile(
    absolutePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  validateLiteralTranslationCalls(sourceFile, relativePath, englishKeys, spanishKeys);
  collectHardCodedVisibleCopy(sourceFile, relativePath, hardCodedFindings);
}

assert.deepEqual(
  hardCodedFindings,
  [],
  `Released game UI contains avoidable hard-coded copy:\n${hardCodedFindings.join("\n")}`,
);

const triviaQuestions = JSON.parse(
  fs.readFileSync(path.join(root, "assets", "triviaBlitz", "questions.json"), "utf8"),
);
const serverTriviaQuestions = JSON.parse(
  fs.readFileSync(path.join(root, "functions", "src", "triviaQuestions.json"), "utf8"),
);
assert.equal(triviaQuestions.length, 60, "Trivia Blitz must keep all 60 released questions");
assert.deepEqual(
  serverTriviaQuestions,
  triviaQuestions,
  "The server-authoritative Trivia bank must match the bilingual source bank",
);

const questionIds = new Set();
const triviaCategories = new Set();
for (const [index, question] of triviaQuestions.entries()) {
  const label = `Trivia question ${index + 1}`;
  if (question.id != null) assertNonEmptyString(question.id, `${label} id`);
  const questionIdentity =
    question.id ?? `${String(question.category).trim()}::${String(question.question_en).trim()}`;
  assert(!questionIds.has(questionIdentity), `${label} has a duplicate stable identity`);
  questionIds.add(questionIdentity);
  assertNonEmptyString(question.category, `${label} category`);
  triviaCategories.add(question.category);
  assertNonEmptyString(question.question_en, `${label} English prompt`);
  assertNonEmptyString(question.question_es, `${label} Spanish prompt`);
  assert(Array.isArray(question.options_en), `${label} English options must be an array`);
  assert(Array.isArray(question.options_es), `${label} Spanish options must be an array`);
  assert(question.options_en.length >= 2, `${label} needs at least two answers`);
  assert.equal(
    question.options_es.length,
    question.options_en.length,
    `${label} English and Spanish answer counts differ`,
  );
  question.options_en.forEach((option, optionIndex) =>
    assertNonEmptyString(option, `${label} English option ${optionIndex + 1}`),
  );
  question.options_es.forEach((option, optionIndex) =>
    assertNonEmptyString(option, `${label} Spanish option ${optionIndex + 1}`),
  );
  assert(
    Number.isInteger(question.answer) &&
      question.answer >= 0 &&
      question.answer < question.options_en.length,
    `${label} has an invalid answer index`,
  );
}

assert.deepEqual(
  [...triviaCategories].sort(),
  ["Parenting & Family", "Pop Culture", "Sports"],
  "Every released Trivia category needs an explicit localized label",
);
for (const key of [
  "trivia.categories.parentingFamily",
  "trivia.categories.popCulture",
  "trivia.categories.sports",
]) {
  assert(englishKeys.has(key) && spanishKeys.has(key), `Missing Trivia category key ${key}`);
}

for (let index = 1; index <= 80; index += 1) {
  const key = `icebreaker.questions.q${String(index).padStart(2, "0")}`;
  assert(englishKeys.has(key), `Missing English Icebreaker prompt ${key}`);
  assert(spanishKeys.has(key), `Missing Spanish Icebreaker prompt ${key}`);
}

const bombSource = fs.readFileSync(path.join(root, "src", "game", "BombDefusalScreen.tsx"), "utf8");
assert.match(
  bombSource,
  /useState<BombMessageKey>\("bomb\.followSequence"\)/,
  "Bomb Defusal status must remain semantic so language changes cannot leave stale copy",
);
assert.doesNotMatch(
  bombSource,
  /useState\(\s*t\("bomb\./,
  "Bomb Defusal must not store translated copy in state",
);

const spotSource = fs.readFileSync(
  path.join(root, "src", "game", "spotDifference", "SpotDifferenceScreen.tsx"),
  "utf8",
);
assert.match(
  spotSource,
  /useState<SpotFeedback>\(\{\s*kind:\s*"instructions"\s*\}\)/,
  "Spot-the-Difference feedback must remain semantic",
);
assert.doesNotMatch(
  spotSource,
  /useState\(\s*t\("spot\./,
  "Spot-the-Difference must not store translated copy in state",
);

const gameServiceSource = fs.readFileSync(path.join(root, "services", "gameService.ts"), "utf8");
assert.match(gameServiceSource, /export function getGameLabelKey\(/);
assert.doesNotMatch(
  gameServiceSource,
  /return\s+["'](?:Bomb Defusal|Spot the Differences|Trivia Blitz)["']/,
  "Active-game labels must return localization keys, not English copy",
);

console.log(
  `Game localization checks passed (${gameNamespaces.length} namespaces, ` +
    `${triviaQuestions.length} Trivia questions, 80 Icebreaker prompts, ` +
    `${releasedGameFiles.length} released UI files).`,
);

function findVariableInitializer(sourceFile, variableName) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === variableName) {
        return unwrapExpression(declaration.initializer);
      }
    }
  }
  throw new Error(`Could not find ${variableName}`);
}

function getTranslationObject(resourcesObject, language) {
  const languageObject = getObjectProperty(resourcesObject, language);
  assert(ts.isObjectLiteralExpression(languageObject), `Missing ${language} resource object`);
  const translationObject = getObjectProperty(languageObject, "translation");
  assert(ts.isObjectLiteralExpression(translationObject), `Missing ${language}.translation object`);
  return translationObject;
}

function getObjectProperty(objectLiteral, name) {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyName(property.name) === name) return unwrapExpression(property.initializer);
  }
  return undefined;
}

function flattenTranslations(objectLiteral, prefix = "", output = new Map()) {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyName(property.name);
    if (!name) continue;
    const key = prefix ? `${prefix}.${name}` : name;
    const value = unwrapExpression(property.initializer);

    if (ts.isObjectLiteralExpression(value)) {
      flattenTranslations(value, key, output);
    } else if (ts.isStringLiteralLike(value)) {
      output.set(key, value.text);
    }
  }
  return output;
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return "";
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function subsetByPrefix(values, prefix) {
  return new Map([...values].filter(([key]) => key.startsWith(prefix)));
}

function interpolationVariables(value) {
  return [
    ...new Set(
      [...value.matchAll(/{{\s*([^},\s]+)(?:\s*,[^}]*)?}}/g)].map((match) => match[1]),
    ),
  ].sort();
}

function assertPluralPair(values, baseKey) {
  assert(values.has(`${baseKey}_one`), `Missing singular translation ${baseKey}_one`);
  assert(values.has(`${baseKey}_other`), `Missing plural translation ${baseKey}_other`);
}

function validateLiteralTranslationCalls(sourceFile, relativePath, englishValues, spanishValues) {
  walk(sourceFile, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      node.expression.text !== "t" ||
      node.arguments.length === 0 ||
      !ts.isStringLiteralLike(node.arguments[0])
    ) {
      return;
    }

    const key = node.arguments[0].text;
    assert(hasTranslationKey(englishValues, key), `${relativePath} uses missing English key ${key}`);
    assert(hasTranslationKey(spanishValues, key), `${relativePath} uses missing Spanish key ${key}`);
  });
}

function hasTranslationKey(values, key) {
  return values.has(key) || (values.has(`${key}_one`) && values.has(`${key}_other`));
}

function collectHardCodedVisibleCopy(sourceFile, relativePath, findings) {
  walk(sourceFile, (node) => {
    if (ts.isJsxText(node)) {
      recordVisibleText(node.text, node);
      return;
    }

    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      ts.isStringLiteralLike(node.expression) &&
      ts.isJsxElement(node.parent)
    ) {
      recordVisibleText(node.expression.text, node.expression);
      return;
    }

    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText(sourceFile);
      if (["accessibilityHint", "accessibilityLabel", "label", "placeholder", "title"].includes(name)) {
        recordVisibleText(node.initializer.text, node.initializer);
      }
      return;
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Alert" &&
      node.expression.name.text === "alert"
    ) {
      for (const argument of node.arguments.slice(0, 2)) {
        if (ts.isStringLiteralLike(argument)) recordVisibleText(argument.text, argument);
      }
    }
  });

  function recordVisibleText(rawText, node) {
    const text = rawText.replace(/\s+/g, " ").trim();
    if (/^(?=.*\d)[A-Z0-9]{4,6}$/.test(text)) return;
    if (!/[A-Za-zÀ-ÖØ-öø-ÿ]{2,}/u.test(text)) return;
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    findings.push(`${relativePath}:${line}: ${JSON.stringify(text)}`);
  }
}

function walk(node, visitor) {
  visitor(node);
  ts.forEachChild(node, (child) => walk(child, visitor));
}

function assertNonEmptyString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert(value.trim().length > 0, `${label} must not be empty`);
}
