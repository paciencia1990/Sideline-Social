const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const home = read("app/(tabs)/index.tsx");
const selector = read("components/SquadSelector.tsx");
const context = read("context/SquadContext.tsx");
const service = read("services/squadService.ts");
const homeFeedService = read("services/homeFeedService.ts");
const translations = read("i18n/index.ts");
const layout = home.slice(home.indexOf("<ScrollView"), home.indexOf("</ScrollView>"));

assert.match(home, /function YourSquadCard\(/, "Home must have one canonical Your Squad card");
assert.equal((home.match(/function YourSquadCard\(/g) ?? []).length, 1, "Your Squad card must not be duplicated");
assert.doesNotMatch(home, /HomeProximityCard|LiveSquadCard|SquadSummaryCard|SectionTitle/, "redundant Squad cards must be removed");
assert.doesNotMatch(home, /fetchNearbySquads|getCurrentLocation|getLocationPermissionStatus|requestLocationPermission|subscribeLiveSquadCard|fetchUserSquadsDetail/, "Home must not request location or run redundant Squad reads");
assert.doesNotMatch(homeFeedService, /fetchUserSquadsDetail|subscribeLiveSquadCard|activeMemberCount|memberAvatars/, "obsolete Home-only Squad reads and listeners must be removed");

const myTeamsIndex = layout.indexOf("<MyTeamsCard");
const actionsIndex = layout.indexOf("<SecondaryActions");
const squadIndex = layout.indexOf("<YourSquadCard");
const challengeIndex = layout.indexOf("<ChallengeCard");
const icebreakerIndex = layout.indexOf("<IcebreakerCard />");
assert.ok(myTeamsIndex >= 0 && myTeamsIndex < actionsIndex, "My Teams must precede Chat and Leaderboard");
assert.ok(actionsIndex < squadIndex, "Chat and Leaderboard must precede Your Squad");
assert.ok(squadIndex < challengeIndex, "Your Squad must precede Weekly Challenge");
assert.ok(challengeIndex < icebreakerIndex, "Weekly Challenge must precede Icebreaker");
assert.equal(layout.slice(icebreakerIndex).trim(), "<IcebreakerCard />", "Icebreaker must remain the final Home section");
assert.match(home, /home\.chat[\s\S]*home\.leaderboard/, "Chat must precede Leaderboard");

assert.match(home, /membershipLoading[\s\S]*membershipError[\s\S]*mySquads/, "Home must consume canonical membership state");
assert.match(home, /membershipCount > 0/, "memberships without a selection must receive an explicit choice state");
assert.match(home, /selectionWasStale[\s\S]*home\.staleSquadBody/, "stale selections with remaining memberships must receive distinct localized guidance");
assert.match(home, /membershipCount > 1[\s\S]*home\.switchSquad/, "Switch Squad must only appear for multiple memberships");
assert.match(home, /\(social\)\/squad-detail\?squadId=\$\{currentSquad\.squadId\}/, "View Squad must open the selected Squad detail route");
assert.match(home, /\(tabs\)\/squad/, "empty membership state must route to Squad discovery");
assert.match(home, /home\.yourSquadLoading[\s\S]*home\.yourSquadErrorTitle[\s\S]*home\.chooseSquadTitle[\s\S]*home\.noSquadTitle/, "loading, error, choose, and empty states must remain explicit");

assert.doesNotMatch(context, /validIds\s*\[\s*0\s*\]/, "membership reload must not silently select the first Squad");
assert.match(context, /state\.selectedSquadId && validIds\.includes\(state\.selectedSquadId\)[\s\S]*:\s*null/, "only a valid persisted selection may become current");
assert.match(context, /catch \(nextError\)[\s\S]{0,180}requestId === membershipRequestId\.current/, "stale membership failures must not replace a newer refresh");
assert.match(service, /serverSelected \|\| localSelected \|\| null/, "stale persisted selections must reach validation and repair");
assert.match(selector, /hideTrigger[\s\S]*selectedSquadId[\s\S]*selectSquad/, "embedded switching must use the shared persisted selection mechanism");

for (const key of [
  "yourSquad", "yourSquadLoading", "yourSquadErrorTitle", "yourSquadErrorBody",
  "chooseSquadTitle", "chooseSquadBody", "chooseSquad", "noSquadTitle", "noSquadBody",
  "staleSquadBody",
  "findSquad", "squadMemberCount", "viewSquad", "switchSquad",
]) {
  assert.ok((translations.match(new RegExp(`\\b${key}:`, "g")) ?? []).length >= 2, `${key} must be translated in English and Spanish`);
}

console.log("Home Squad consolidation source tests passed.");
