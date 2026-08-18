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
const squadService = read("services", "squadService.ts");
const teamService = read("services", "teamService.ts");
const diagnostics = read("utils", "performanceDiagnostics.ts");

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

const parentSummary = parentTeams.slice(
  parentTeams.indexOf("async function loadParentTeamSummary"),
  parentTeams.indexOf("type ResolvedMembershipChildren"),
);
assert.match(parentSummary, /const \[profileResults, readStates, coachIdentity\] = await Promise\.all\(\[/);
assert.match(parentSummary, /getPublicUserProfiles/);
assert.match(parentSummary, /resolveCoachName\(team\)/);
assert.match(parentSummary, /Promise\.all\(\s*visibleAnnouncements\.map/);

assert.match(diagnostics, /if \(__DEV__\)/, "Performance logging must remain development-only.");
assert.match(diagnostics, /durationMs: Math\.round\(durationMs\)/);
for (const sensitiveField of ["email", "latitude", "longitude", "messageContent", "token", "userId"]) {
  assert.equal(diagnostics.includes(sensitiveField), false, `Performance diagnostics must not record ${sensitiveField}.`);
}

console.log("Startup, request-coalescing, parallel-loading, and privacy-safe performance checks passed.");
