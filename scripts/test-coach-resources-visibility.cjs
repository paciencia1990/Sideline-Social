const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

function loadTypeScript(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(require, loaded, loaded.exports);
  return loaded.exports;
}

const { createCoachResourcesAccessRequestGuard, resolveCoachResourcesAccess } = loadTypeScript("utils/coachResourcesAccess.ts");
const userId = "coach-owner";
const membership = (overrides = {}) => ({
  status: "active",
  userId,
  roles: { coach: true, parent: false, staff: false },
  team: { createdBy: userId, status: "active" },
  ...overrides,
});
const access = (overrides = {}) => resolveCoachResourcesAccess({
  activeMode: "coach",
  authenticatedUserId: userId,
  loadState: "loaded",
  memberships: [],
  ...overrides,
});

assert.equal(access(), "denied", "Coach Mode before first qualifying team must be denied");
assert.equal(access({ memberships: [membership()] }), "allowed", "an active coach who created the team qualifies");
assert.equal(access({ activeMode: "parent", memberships: [membership()] }), "denied", "Parent Mode hides resources for the same coach");
assert.equal(access({ authenticatedUserId: null, memberships: [membership()] }), "denied", "signed-out access fails closed");
assert.equal(access({ memberships: [membership({ roles: { coach: false, parent: true, staff: false } })] }), "denied", "parent-only membership does not qualify");
assert.equal(access({ memberships: [membership({ roles: { coach: false, parent: true, staff: true } })] }), "denied", "staff-only membership does not qualify");
assert.equal(access({ memberships: [membership({ team: { createdBy: "another-coach", status: "active" } })] }), "denied", "coaching another creator's team does not qualify");
assert.equal(access({ memberships: [membership({ team: { createdBy: userId, status: "archived" } })] }), "denied", "archived teams do not qualify");
assert.equal(access({ memberships: [membership({ team: null })] }), "denied", "deleted or unavailable teams do not qualify");
for (const status of ["pending", "inactive", "removed"]) {
  assert.equal(access({ memberships: [membership({ status })] }), "denied", `${status} membership does not qualify`);
}
assert.equal(access({ memberships: [membership({ userId: "different-user" })] }), "denied", "a stale membership for another account does not qualify");
assert.equal(access({ loadState: "loading", memberships: [membership()] }), "loading", "loading access fails closed");
assert.equal(access({ loadState: "error", memberships: [membership()] }), "error", "failed eligibility reads fail closed");
assert.equal(access({ memberships: [membership(), membership()] }), "allowed", "multiple qualifying teams still produce one access decision");

const requestGuard = createCoachResourcesAccessRequestGuard();
const parentRequest = requestGuard.begin("user-a:parent");
const coachRequest = requestGuard.begin("user-a:coach");
assert.equal(requestGuard.isCurrent(parentRequest, "user-a:coach"), false, "mode changes invalidate an earlier eligibility response");
assert.equal(requestGuard.isCurrent(coachRequest, "user-a:coach"), true);
assert.equal(requestGuard.isCurrent(coachRequest, "user-b:coach"), false, "account changes reject a response for the prior user");
requestGuard.invalidate();
assert.equal(requestGuard.isCurrent(coachRequest, "user-a:coach"), false, "sign-out or route cleanup invalidates the in-flight response");

const coachHome = read("app", "coach", "index.tsx");
const layout = read("app", "coach", "resources", "_layout.tsx");
const accessHook = read("hooks", "useCoachResourcesAccess.ts");
const aiAccess = read("utils", "coachAiAccess.ts");
const functionsSource = read("functions", "src", "coachResourceHelp.ts");
const resourceCardIndex = coachHome.indexOf('style={styles.resourceCard}');
const modeCardIndex = coachHome.indexOf('style={styles.modeCard}');
const teamCardsIndex = coachHome.indexOf('{teamCards.map((teamCard) => (');

assert.match(coachHome, /showCoachResources \? <Card style=\{styles\.resourceCard\}/, "home card must use shared access result");
assert.equal((coachHome.match(/style=\{styles\.resourceCard\}/g) ?? []).length, 1, "home renders one standalone resource card template");
assert.ok(resourceCardIndex > modeCardIndex && resourceCardIndex < teamCardsIndex, "resource card remains between mode and team cards");
assert.match(layout, /status === "allowed"[\s\S]*<Stack/, "direct and restored navigation must reveal content only after shared access allows it");
assert.match(layout, /status === "loading"/);
assert.match(layout, /status === "error"/);
assert.match(accessHook, /requireComplete: true/);
assert.match(accessHook, /isCurrent\(request, contextKeyRef\.current\)/, "stale account or mode responses must be ignored");
assert.match(accessHook, /AppState\.addEventListener/, "foreground restoration must recheck access");

assert.match(aiAccess, /testerClaimEntitled/);
assert.match(aiAccess, /adultEligible/);
assert.match(aiAccess, /activeMode === "coach"/);
assert.match(functionsSource, /aiCoachTester/);
assert.match(functionsSource, /adultEligibilityConfirmed/);
assert.match(functionsSource, /activeMode !== 'coach'/);

console.log("Coach Resources visibility, route guarding, refresh, and AI Coach separation tests passed.");
