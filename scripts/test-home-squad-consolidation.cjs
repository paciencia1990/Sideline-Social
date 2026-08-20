const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const home = read("app/(tabs)/index.tsx");
const selector = read("components/SquadSelector.tsx");
const context = read("context/SquadContext.tsx");
const service = read("services/squadService.ts");
const homeFeedService = read("services/homeFeedService.ts");
const parentTeamService = read("services/parentTeamService.ts");
const parentTeamsScreen = read("app/teams/index.tsx");
const translations = read("i18n/index.ts");
const layout = home.slice(home.indexOf("<ScrollView"), home.indexOf("</ScrollView>"));
const myTeamsCard = home.slice(home.indexOf("function MyTeamsCard"), home.indexOf("function SecondaryActions"));
const openParentTeam = home.slice(home.indexOf("const openParentTeam"), home.indexOf("const loadHome"));
const homeSummaryLoader = parentTeamService.slice(
  parentTeamService.indexOf("export async function getParentHomeTeamsSummary"),
  parentTeamService.indexOf("export async function isParentHomeTeamAvailable"),
);
const homeTeamAvailability = parentTeamService.slice(
  parentTeamService.indexOf("export async function isParentHomeTeamAvailable"),
  parentTeamService.indexOf("export async function getParentTeamsOverview"),
);

assert.match(home, /function YourSquadCard\(/, "Home must have one canonical Your Squad card");
assert.equal((home.match(/function YourSquadCard\(/g) ?? []).length, 1, "Your Squad card must not be duplicated");
assert.doesNotMatch(home, /HomeProximityCard|LiveSquadCard|SquadSummaryCard|SectionTitle/, "redundant Squad cards must be removed");
assert.doesNotMatch(home, /fetchNearbySquads|getCurrentLocation|getLocationPermissionStatus|requestLocationPermission|subscribeLiveSquadCard|fetchUserSquadsDetail/, "Home must not request location or run redundant Squad reads");
assert.doesNotMatch(homeFeedService, /fetchUserSquadsDetail|subscribeLiveSquadCard|activeMemberCount|memberAvatars/, "obsolete Home-only Squad reads and listeners must be removed");

const myTeamsIndex = layout.indexOf("<MyTeamsCard");
const actionsIndex = layout.indexOf("<SecondaryActions");
const squadIndex = layout.indexOf("<YourSquadCard");
const challengeIndex = layout.indexOf("<ChallengeCard");
const localPerkIndex = layout.indexOf("<LocalPerkAdCard");
const icebreakerIndex = layout.indexOf("<IcebreakerCard />");
assert.ok(myTeamsIndex >= 0 && myTeamsIndex < actionsIndex, "My Teams must precede Chat and Leaderboard");
assert.ok(actionsIndex < squadIndex, "Chat and Leaderboard must precede Your Squad");
assert.ok(squadIndex < challengeIndex, "Your Squad must precede Weekly Challenge");
assert.ok(challengeIndex < localPerkIndex, "Weekly Challenge must precede the development Local Perk preview");
assert.ok(challengeIndex < icebreakerIndex, "Weekly Challenge must precede Icebreaker");
assert.ok(icebreakerIndex < localPerkIndex, "The development Local Perk preview must stay below Icebreaker");
assert.equal((layout.match(/<LocalPerkAdCard/g) ?? []).length, 1, "Home must render no more than one Local Perk preview card");
assert.doesNotMatch(layout.slice(localPerkIndex + 1), /<(?:MyTeamsCard|StateCard|SecondaryActions|YourSquadCard|SquadSelector|ChallengeCard|IcebreakerCard|LocalPerkAdCard)\b/, "Local Perk must remain the final Home content card");
assert.match(home, /home\.chat[\s\S]*home\.leaderboard/, "Chat must precede Leaderboard");

assert.match(home, /getParentHomeTeamsSummary/, "Home must use the lightweight parent-team association summary");
assert.doesNotMatch(home, /getParentTeamsOverview/, "Home must not restore the full message-hydrating My Teams overview");
assert.match(homeSummaryLoader, /Promise\.all\(/, "Home team membership, child, and link reads must begin in parallel");
assert.doesNotMatch(homeSummaryLoader, /Announcement|announcement|getTeamPrivateMessageInbox|privateConversation|resolveCoachName/, "Home summary loading must not hydrate announcements, messages, or coach profiles");
assert.match(homeTeamAvailability, /getCurrentUserTeamMembershipById\(teamId\)[\s\S]*hasTeamRole\(membership, "parent"\)[\s\S]*isTeamActive\(membership\.team\)/, "Home row validation must reject removed, unauthorized, and archived teams");
assert.match(parentTeamsScreen, /getParentTeamsOverview/, "The full My Teams page must preserve its established team cards and messaging data");

assert.match(myTeamsCard, /summary\?\.rows\.map/, "Home must render every child/team association row");
assert.match(myTeamsCard, /myTeams\.homeTeamLabel/, "Home rows must use the localized Child Name – Team Name format");
assert.doesNotMatch(myTeamsCard, /latestAnnouncement|privateConversations|unreadCount|privateUnreadCount|teamMessages\.|myTeams\.caughtUp|myTeams\.unreadUnknown|teamCount/, "Home must not render message previews, unread state, or secondary team metadata");
assert.match(myTeamsCard, /accessibilityRole="button"[\s\S]*myTeams\.openTeamForChild/, "Team rows must expose localized button accessibility");
assert.match(home, /myTeamsTeamRow:[\s\S]*minHeight: 48/, "Team rows must exceed the 44-point minimum touch target");
assert.match(home, /myTeamsTeamRowPressed[\s\S]*myTeamsTeamRowFocused/, "Team rows must expose visible pressed and focus states");
assert.match(home, /myTeamsTeamRowText:[\s\S]*flexShrink: 1[\s\S]*lineHeight: 21/, "Team labels must wrap safely at large text sizes");

assert.match(openParentTeam, /teamNavigationInFlight\.current[\s\S]*isParentHomeTeamAvailable\(teamId\)/, "Rapid team taps must be locked before availability validation");
assert.match(openParentTeam, /let didNavigate = false[\s\S]*didNavigate = true[\s\S]*if \(!didNavigate\)/, "The tap lock must remain active throughout a successful navigation transition");
assert.match(openParentTeam, /if \(!await isParentHomeTeamAvailable\(teamId\)\)[\s\S]*await loadMyTeams\(\)[\s\S]*myTeams\.teamLoadError[\s\S]*return/, "Inactive or unauthorized teams must refresh the bounded summary and recover without navigation");
assert.match(openParentTeam, /pathname: "\/teams\/\[teamId\]"[\s\S]*params: \{ teamId \}/, "Team rows must navigate directly with the canonical ID as a route parameter");
assert.doesNotMatch(openParentTeam, /teamName|row\.teamName/, "Navigation must never infer a team route from its display name");
assert.match(home, /onViewTeams=\{\(\) => router\.push\("\/teams" as never\)\}/, "View Teams must open the existing My Teams list");
assert.match(myTeamsCard, /<Card style=\{styles\.myTeamsCard\}>[\s\S]*onPress=\{onViewTeams\}/, "The header must be static and View Teams must be a separate sibling action");
assert.match(myTeamsCard, /loading && !summary[\s\S]*summary\?\.rows\.map[\s\S]*summary\?\.totalTeams === 0[\s\S]*error && summary/, "Loading, cached/partial, empty, and recovery states must remain explicit");
assert.match(home, /myTeamsRequestId\.current[\s\S]*requestId === myTeamsRequestId\.current/, "Slow or restored-session team loads must not replace a newer Home summary");

for (const key of ["homeTeamLabel", "openTeamForChild"]) {
  assert.equal((translations.match(new RegExp(`\\b${key}:`, "g")) ?? []).length, 2, `${key} must be translated in English and Spanish`);
}

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
