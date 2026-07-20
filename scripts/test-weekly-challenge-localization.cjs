"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText;
  module._compile(compiled, filename);
};

const root = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const { WEEKLY_CHALLENGES } = require(path.join(root, "functions", "lib", "weeklyChallengeCore.js"));
const {
  WEEKLY_CHALLENGE_IDS,
  weeklyChallengeTranslations,
} = require(path.join(root, "content", "weeklyChallenges.ts"));
const {
  localizeWeeklyChallenge,
} = require(path.join(root, "services", "weeklyChallengeLocalization.ts"));

function translator(language) {
  return (key, options) => {
    if (key === "weeklyChallenges.fallbackTitle") {
      return language === "es" ? "Reto semanal" : "Weekly Challenge";
    }
    if (key === "weeklyChallenges.fallbackDescription") {
      return language === "es"
        ? "Vuelve a abrir este reto más tarde para ver más detalles."
        : "Open this challenge again later for more details.";
    }
    const match = /^weeklyChallenges\.catalog\.(.+)\.(title|description)$/.exec(key);
    return match
      ? weeklyChallengeTranslations[language][match[1]]?.[match[2]] ?? options?.defaultValue ?? key
      : options?.defaultValue ?? key;
  };
}

const activeChallenges = WEEKLY_CHALLENGES.filter(({ isActive }) => isActive);
const activeIds = activeChallenges.map(({ id }) => id);
assert.equal(activeChallenges.length, 17, "The active Weekly Challenge catalog size must remain unchanged.");
assert.equal(new Set(activeIds).size, activeIds.length, "Every active challenge ID must be unique.");
assert.deepEqual(activeIds, [...WEEKLY_CHALLENGE_IDS], "Client localization IDs must exactly match the server selection catalog.");

for (const challenge of activeChallenges) {
  const english = weeklyChallengeTranslations.en[challenge.id];
  const spanish = weeklyChallengeTranslations.es[challenge.id];
  assert.ok(english?.title.trim(), `${challenge.id} needs an English title.`);
  assert.ok(english?.description.trim(), `${challenge.id} needs an English description.`);
  assert.ok(spanish?.title.trim(), `${challenge.id} needs a Spanish title.`);
  assert.ok(spanish?.description.trim(), `${challenge.id} needs a Spanish description.`);
  assert.equal(english.title, challenge.title, `${challenge.id} must preserve its approved English title.`);
  assert.equal(english.description, challenge.description, `${challenge.id} must preserve its approved English description.`);
  assert.notEqual(spanish.title, english.title, `${challenge.id} must not fall back to its English title in Spanish.`);
  assert.notEqual(spanish.description, english.description, `${challenge.id} must not fall back to its English description in Spanish.`);
}

const assignment = {
  weekKey: "2026-07-20",
  challengeId: "meet-new-parent",
  title: "Meet Someone New",
  description: "Introduce yourself to one parent you have not met before.",
  points: 5,
  completed: true,
  pointsAwarded: true,
};
const englishAssignment = localizeWeeklyChallenge(assignment, translator("en"));
const spanishAssignment = localizeWeeklyChallenge(assignment, translator("es"));
assert.equal(englishAssignment.title, "Meet Someone New");
assert.equal(spanishAssignment.title, "Conoce a alguien nuevo");
assert.equal(spanishAssignment.description, "Preséntate a una madre o un padre que aún no conozcas.");
for (const field of ["weekKey", "challengeId", "points", "completed", "pointsAwarded"]) {
  assert.equal(spanishAssignment[field], assignment[field], `Language changes must not alter ${field}.`);
}

const legacy = localizeWeeklyChallenge({
  challengeId: "retired-legacy-challenge",
  title: "Legacy title",
  description: "Legacy description",
  points: 5,
  completed: false,
}, translator("es"));
assert.equal(legacy.title, "Legacy title", "Unknown legacy IDs must retain stored title text.");
assert.equal(legacy.description, "Legacy description", "Unknown legacy IDs must retain stored description text.");

const missingLegacyText = localizeWeeklyChallenge({ challengeId: null }, translator("es"));
assert.equal(missingLegacyText.title, "Reto semanal");
assert.match(missingLegacyText.description, /Vuelve a abrir/);

const i18nSource = read("i18n", "index.ts");
const squadSource = read("app", "(tabs)", "squad.tsx");
const homeSource = read("app", "(tabs)", "index.tsx");
const functionsSource = read("functions", "src", "index.ts");
const englishLocation = "Sideline Social uses your current location to find communities near you. Your precise location is not shown to others.";
const spanishLocation = "Sideline Social usa tu ubicación actual para encontrar comunidades cerca de ti. Tu ubicación precisa no se muestra a otras personas.";
assert.ok(i18nSource.includes(`locationDisclosure: '${englishLocation}'`), "The exact English location disclosure must be translated.");
assert.ok(i18nSource.includes(`locationDisclosure: '${spanishLocation}'`), "The exact Spanish location disclosure must be translated.");
assert.match(squadSource, /t\("squad\.locationDisclosure"\)/, "Squad discovery must render the disclosure through i18n.");
assert.match(squadSource, /t\("squad\.findNearby"\)/, "The existing Find nearby Squads heading must remain.");
assert.doesNotMatch(squadSource, /numberOfLines=.*locationDisclosure/, "The disclosure must wrap instead of clipping at large text sizes.");

assert.match(i18nSource, /catalog: weeklyChallengeTranslations\.en/, "English challenges must be registered as i18n keys.");
assert.match(i18nSource, /catalog: weeklyChallengeTranslations\.es/, "Spanish challenges must be registered as i18n keys.");
assert.match(homeSource, /const \{ t \} = useTranslation\(\)/, "The challenge card must react to active-language changes.");
assert.match(homeSource, /localizeWeeklyChallenge\(challenge, t\)/, "The Home card must resolve challenge content at render time.");
assert.doesNotMatch(homeSource, />\{challenge\.(title|description)\}</, "The Home card must not render cached English fields directly.");
assert.match(homeSource, /t\("home\.challengeConfirmTitle"\)/, "Completion confirmation must remain localized.");
assert.match(homeSource, /t\("home\.challengeSuccessTitle"\)/, "Completion success copy must remain localized.");
assert.match(functionsSource, /const rewardId = `weeklyChallenge_\$\{weekKey\}`/, "Completion idempotency must remain keyed by week, not language.");
assert.match(functionsSource, /challengeId: definition\.id/, "Rewards must remain attached to the stable challenge ID.");
assert.match(functionsSource, /serializeWeeklyChallenge/, "Server assignments must continue returning stable assignment metadata.");

console.log("Squad location copy and all 17 bilingual Weekly Challenge localization checks passed.");
