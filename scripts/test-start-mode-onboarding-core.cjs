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
const count = (source, pattern) => (source.match(pattern) ?? []).length;
const { readModeOnboardingState, resolveInitialMode } = require(path.join(root, "utils", "onboardingMode.ts"));

assert.deepEqual(readModeOnboardingState({ modeOnboardingCompleted: false }), {
  activeMode: null,
  preferredMode: null,
  onboardingPath: null,
  onboardingCompleted: false,
});
assert.equal(readModeOnboardingState({}).onboardingCompleted, true, "Existing users missing the marker must be treated as complete.");
assert.equal(readModeOnboardingState(null).onboardingCompleted, true, "Missing legacy profile data must not force onboarding.");
assert.equal(resolveInitialMode({ activeMode: "coach" }, "parent"), "coach");
assert.equal(resolveInitialMode({ defaultMode: "coach" }, "parent"), "coach");
assert.equal(resolveInitialMode({}, "coach"), "coach", "Existing local mode must remain a compatibility fallback.");
assert.equal(resolveInitialMode({ activeMode: "invalid" }, "invalid"), "parent", "Invalid mode state must fall back safely.");

const auth = read("context", "AuthContext.tsx");
assert.ok(auth.includes("modeOnboardingCompleted: false"), "New account profiles must be explicitly incomplete.");
assert.ok(auth.includes("readModeOnboardingState(profile)"), "Auth hydration must apply existing-user compatibility logic.");
assert.ok(auth.includes("refreshProfile"), "The saved onboarding choice must refresh authenticated profile state.");

const service = read("services", "onboardingModeService.ts");
for (const field of ["onboardingPath: mode", "defaultMode: mode", "activeMode: mode", "modeOnboardingCompleted: true"]) {
  assert.ok(service.includes(field), `Onboarding preference write must include ${field}.`);
}
for (const elevatedField of ["roles", "coachTeamIds", "activeTeamId", "verifiedCoach"]) {
  assert.equal(service.includes(elevatedField), false, `Onboarding preference must not write ${elevatedField}.`);
}

const choice = read("app", "(auth)", "choose-start-mode.tsx");
assert.ok(choice.includes('if (!user)'), "The choice screen must reject signed-out access.");
assert.ok(choice.includes("if (user.modeOnboardingCompleted && !savingMode)"), "Completed users must not see the choice again, while an in-flight save must finish its replacement navigation.");
assert.ok(choice.includes("if (savingMode) return"), "Repeated taps must be ignored.");
assert.ok(choice.includes("disabled={Boolean(savingMode)}"), "Both choices must disable while saving.");
assert.ok(choice.includes("await completeModeOnboarding(mode)"), "Navigation must wait for the preference write.");
assert.ok(choice.includes("await refreshProfile()"), "Local profile state must refresh before entering the app.");
assert.ok(choice.includes("router.replace"), "Completed onboarding must replace the choice route for Android Back safety.");
assert.equal(choice.includes("roles.coach"), false, "Selecting Coach must not grant a role.");
assert.equal(choice.includes("useEffect"), false, "The choice screen must not navigate from an Effect.");

const tabs = read("app", "(tabs)", "_layout.tsx");
const coachLayout = read("app", "coach", "_layout.tsx");
for (const layout of [tabs, coachLayout]) {
  assert.ok(layout.includes("CHOOSE_START_MODE_ROUTE"), "Authenticated layouts must route incomplete onboarding to the choice.");
  assert.equal(layout.includes("router.replace"), false, "Onboarding guards must be declarative.");
}
assert.ok(read("app", "leaderboard.tsx").includes("AuthenticatedRouteGate"), "The standalone Leaderboard route must protect incomplete onboarding.");

for (const group of [["app", "(games)", "_layout.tsx"], ["app", "(social)", "_layout.tsx"], ["app", "teams", "_layout.tsx"], ["app", "games", "_layout.tsx"]]) {
  assert.ok(read(...group).includes("AuthenticatedRouteGate"), `${group.join("/")} must protect incomplete onboarding.`);
}

const profile = read("app", "(tabs)", "profile.tsx");
assert.ok(profile.includes("memberships.some(hasCoachAccess)"), "Profile must still distinguish actual coach authorization.");
assert.equal(profile.includes('if (!hasCoachRole || activeMode !== "parent")'), false, "A parent without a team role must be allowed into Coach onboarding.");
assert.ok(profile.includes('t("mode.switchToCoach")'), "Every parent must retain the Coach Mode entry point.");

const coachHome = read("app", "coach", "index.tsx");
assert.ok(coachHome.includes('t("startMode.coachWelcome")'), "No-team Coach Mode must show the onboarding welcome.");
assert.ok(coachHome.includes('t("startMode.coachWelcomeBody")'), "No-team Coach Mode must explain first-team creation.");
assert.ok(coachHome.includes('router.push("/coach/create-team"'), "Coach onboarding must open secure team creation.");
assert.ok(coachHome.includes('t("mode.switchToParent")'), "Coach onboarding must allow switching to Parent Mode.");

const createTeamScreen = read("app", "coach", "create-team.tsx");
assert.ok(createTeamScreen.includes("await createTeam("), "The form must use the existing protected team-creation service.");
assert.ok(createTeamScreen.includes("if (creating) return"), "Duplicate team-creation taps must be ignored.");
const teamService = read("services", "teamService.ts");
assert.ok(teamService.includes('role: "coach"'), "Successful team creation must assign the creator's authoritative membership role.");
assert.ok(teamService.includes("coachTeamIds: arrayUnion(teamRef.id)"), "Successful team creation must update the existing team index.");
assert.ok(teamService.includes("await batch.commit()"), "Team, membership, and user index writes must remain atomic.");
const rules = read("firestore.rules");
assert.ok(rules.includes("hasCoachRoleData(request.resource.data)"), "Rules must validate creator coach membership data.");
assert.ok(rules.includes("isTeamCreator(teamId)"), "Rules must restrict initial coach membership to the authenticated team creator.");
assert.ok(rules.includes("allow update: if isCoachStaff(teamId);"), "Parents must not grant themselves team roles.");

const translations = read("i18n", "index.ts");
for (const key of ["eyebrow", "parentTitle", "parentBody", "coachTitle", "coachBody", "switchNote", "coachWelcome", "coachWelcomeBody", "continue", "saveError"]) {
  assert.equal(count(translations, new RegExp(`\\b${key}:`, "g")), 2, `${key} needs English and Spanish copy.`);
}

console.log("Start-mode onboarding, compatibility migration, mode switching, team authorization, and translation checks passed.");