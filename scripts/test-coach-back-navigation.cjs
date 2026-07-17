const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const team = read("app/coach/team.tsx");
const messages = read("app/coach/messages.tsx");
const resources = read("app/coach/resources/index.tsx");
const header = read("components/CoachResourceHeader.tsx");
const navigation = read("hooks/useCoachBackNavigation.ts");
const translations = read("i18n/index.ts");

for (const [name, source] of [["View Team", team], ["Send Team Message", messages]]) {
  assert.equal((source.match(/<CoachResourceHeader/g) ?? []).length, 1, `${name} must render exactly one shared back header`);
  assert.match(source, /useCoachBackNavigation\(\)/, `${name} must share safe header and Android back behavior`);
  assert.doesNotMatch(source, /ArrowLeft/, `${name} must not duplicate the shared arrow icon`);
}

assert.match(team, /CoachResourceHeader[\s\S]*backAccessibility[\s\S]*coach\.home\.viewTeam[\s\S]*teamLoading/, "View Team header must remain above loading and error content");
assert.match(messages, /CoachResourceHeader[\s\S]*backAccessibility[\s\S]*coach\.home\.sendMessage[\s\S]*loading/, "Send Team Message header must remain above loading and error content");
assert.match(header, /ArrowLeft[\s\S]*size=\{22\}/, "shared header must retain the Coach Resources icon");
assert.match(header, /height: 44[\s\S]*width: 44[\s\S]*Shadow\.card/, "shared header must retain the Coach Resources touch target and treatment");
assert.equal((resources.match(/<CoachResourceHeader/g) ?? []).length, 1, "Coach Resources must keep its existing shared header");
assert.doesNotMatch(resources, /onBack=|backAccessibility/, "Coach Resources behavior and appearance must remain unchanged");

assert.match(navigation, /router\.canGoBack\(\)[\s\S]*router\.back\(\)[\s\S]*router\.replace\(COACH_HOME_ROUTE/, "valid history must go back and no-history navigation must replace with Coach Mode");
assert.match(navigation, /COACH_HOME_ROUTE = "\/coach"/, "fallback must be Coach Mode home");
assert.match(navigation, /BackHandler\.addEventListener\("hardwareBackPress"[\s\S]*navigateBack\(\)[\s\S]*return true/, "Android system back must use the same navigation action");

assert.match(messages, /draftBody[\s\S]*draftTitle[\s\S]*selectedTeamId/, "communication-template drafts and team parameters must remain intact");
for (const audience of ["parents", "staff", "all"]) assert.match(messages, new RegExp(`"${audience}"`), `${audience} audience must remain available`);
assert.match(team, /getTeamMembers[\s\S]*setTeamStaffRole[\s\S]*setTeamArchived/, "team data, roles, and lifecycle controls must remain intact");

assert.equal((translations.match(/backAccessibility:/g) ?? []).length >= 4, true, "View Team and Send Team Message back labels must resolve in English and Spanish");

console.log("Coach View Team and Send Team Message shared back-header, fallback, Android back, parameters, localization, and accessibility tests passed.");
