"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");

const rootLayout = read("app", "_layout.tsx");
const rootIndex = read("app", "index.tsx");
const appContext = read("context", "AppContext.tsx");
const authContext = read("context", "AuthContext.tsx");
const squadContext = read("context", "SquadContext.tsx");
const accountStanding = read("services", "accountStandingService.ts");
const parentTeams = read("services", "parentTeamService.ts");
const teamMessages = read("services", "teamMessageService.ts");
const squadService = read("services", "squadService.ts");
const teamService = read("services", "teamService.ts");
const diagnostics = read("utils", "performanceDiagnostics.ts");
const paginationConstants = read("constants", "teamHistoryPagination.ts");

function sourceSlice(source, startName, endName) {
  const start = source.indexOf(startName);
  const end = source.indexOf(endName, start + startName.length);
  assert.notEqual(start, -1, `${startName} exists`);
  assert.notEqual(end, -1, `${endName} exists after ${startName}`);
  return source.slice(start, end);
}

assert.doesNotMatch(
  rootLayout,
  /SpaceMono-Regular|SpaceMono:/,
  "The unused Space Mono font must not block startup or enter production exports.",
);

const signedInBranch = rootIndex.indexOf("if (user)");
const onboardingRead = rootIndex.indexOf('AsyncStorage.getItem("onboardingComplete")');
assert.ok(signedInBranch >= 0 && onboardingRead > signedInBranch, "Signed-in routing must be resolved before reading signed-out onboarding state.");
assert.equal((rootIndex.match(/AsyncStorage\.getItem\("onboardingComplete"\)/g) ?? []).length, 1);
assert.match(rootIndex, /startDevelopmentPerformanceTrace\("startup\.route-resolution"\)/);

assert.match(appContext, /useMemo<AppContextType>/, "App context values must remain referentially stable.");
assert.match(authContext, /measureDevelopmentPerformance\(\s*"startup\.auth-profile"/);

assert.match(accountStanding, /standingRequest\?\.uid === uid/);
assert.match(accountStanding, /standingRequest = \{ uid, promise: trackedRequest \}/);
assert.match(accountStanding, /"startup\.account-standing"/);

assert.match(squadContext, /membershipLoad\.current\?\.userId === requestUserId/);
assert.match(squadContext, /membershipLoad\.current = \{ userId: requestUserId, promise: trackedRequest \}/);
assert.match(squadContext, /useMemo<SquadContextType>/, "Squad context values must remain referentially stable.");
assert.match(squadService, /Promise\.all\(\[\s*getDoc\(doc\(db, "users", userId\)\),\s*AsyncStorage\.getItem/);

assert.match(teamService, /userTeamIndexRequest\?\.userId === userId/);
assert.equal(
  (teamService.match(/await getUserTeamIndex\(user\.uid\)/g) ?? []).length,
  3,
  "Active memberships, archived counts, and archived pages must share overlapping user-index reads.",
);

const parentSummary = sourceSlice(parentTeams, "async function loadParentTeamSummary", "type AnnouncementSummaryState");
const parentPage = sourceSlice(parentTeams, "async function loadParentAnnouncementsPage", "type ResolvedMembershipChildren");
const newestCoachPage = sourceSlice(teamMessages, "export function listenToNewestTeamAnnouncementsPage", "export async function getOlderTeamAnnouncementsPage");
const olderCoachPage = sourceSlice(teamMessages, "export async function getOlderTeamAnnouncementsPage", "export async function getTeamAnnouncement");

assert.match(paginationConstants, /announcements: 20/);
assert.match(parentPage, /collection\(db, "teams", teamId, "announcements"\)/);
assert.match(parentPage, /where\("audience", "in", \["parents", "all", "everyone"\]\)/);
assert.match(parentPage, /orderBy\("createdAt", "desc"\)[\s\S]*orderBy\(documentId\(\), "desc"\)/);
assert.match(parentPage, /limit\(pageSize \+ 1\)/, "the initial read keeps exactly one look-ahead document");
assert.match(parentPage, /snapshot\.docs\.slice\(0, pageSize\)/, "only the rendered page is hydrated");
assert.match(parentPage, /startAfter\(Timestamp\.fromMillis\(cursor\.timestampMillis\), cursor\.id\)/);
assert.match(parentPage, /nextCursor: oldest\?\.createdAtDate \? \{ id: oldest\.id, timestampMillis:/);
assert.doesNotMatch(parentPage, /getDocs\(collection\(db, "teams", teamId, "announcements"\)\)/, "announcement history must never be scanned without a query bound");

assert.match(newestCoachPage, /limit\(pageSize \+ 1\)/);
assert.match(newestCoachPage, /const unsubscribe = onSnapshot\(/, "only the newest bounded page remains realtime");
assert.match(newestCoachPage, /snapshot\.docs\.slice\(0, pageSize\)/);
assert.match(olderCoachPage, /getDocs\(query\([\s\S]*startAfter\([\s\S]*limit\(pageSize \+ 1\)/, "older pages remain one-time cursor reads");
assert.doesNotMatch(olderCoachPage, /onSnapshot\(/);

assert.match(parentPage, /getPublicUserProfiles\(visibleAnnouncements\.map/);
assert.match(parentPage, /knownUnreadIds \? Promise\.resolve\(null\) : Promise\.all\(visibleAnnouncements\.map/);
assert.match(parentPage, /getDoc\(doc\(db, "teams", teamId, "announcements", announcement\.id, "reads", userId\)\)/);
assert.match(parentSummary, /const \[announcementPage, coachIdentity\] = await Promise\.all\(\[/, "announcement and coach phases remain independent");
assert.match(parentSummary, /loadParentAnnouncementsPage\([\s\S]*resolveCoachName\(team\)/);

assert.match(diagnostics, /if \(__DEV__\)/, "Performance logging must remain development-only.");
assert.match(diagnostics, /durationMs: Math\.round\(durationMs\)/);
for (const sensitiveField of ["email", "latitude", "longitude", "messageContent", "token", "userId"]) {
  assert.equal(diagnostics.includes(sensitiveField), false, `Performance diagnostics must not record ${sensitiveField}.`);
}

console.log("Startup, request-coalescing, parallel-loading, and privacy-safe performance checks passed.");
