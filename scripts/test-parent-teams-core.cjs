const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadTypeScript(relativePath) {
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", output)(loaded, loaded.exports);
  return loaded.exports;
}

const { groupTeamsByChild, summarizeTeamUpdates } = loadTypeScript("utils/parentTeamCore.ts");
const {
  activeLinkReferencesChild,
  allChildProfilesExist,
  hasCoachAccess,
  hasParentRole,
  mergeChildIds,
  mergeParentRole,
  normalizeChildIds,
  removeChildReference,
  resolveTeamRoleFlags,
} = loadTypeScript("functions/src/teamMembershipCore.ts");

function team(teamId, name, children, unreadCount, updatedAt, legacyChildName = null) {
  return {
    teamId,
    team: { name },
    children,
    legacyChildName,
    unreadCount,
    latestAnnouncement: updatedAt ? { createdAtDate: new Date(updatedAt) } : null,
  };
}
const child = (id, displayName) => ({ id, displayName, legacy: false });

assert.deepEqual(resolveTeamRoleFlags(undefined, "parent"), { parent: true, coach: false, staff: false });
assert.deepEqual(resolveTeamRoleFlags(undefined, "assistantCoach"), { parent: false, coach: false, staff: true });
assert.deepEqual(mergeParentRole({ coach: true, staff: false }, "coach"), { parent: true, coach: true, staff: false });
assert.equal(hasParentRole({ roles: { parent: true, coach: true } }), true);
assert.equal(hasCoachAccess({ roles: { parent: true, staff: true } }), true);
assert.deepEqual(normalizeChildIds(["child-a", "child-a", "child-b"]), ["child-a", "child-b"]);
assert.throws(() => normalizeChildIds([]));
assert.throws(() => normalizeChildIds(["private/path"]));
assert.deepEqual(mergeChildIds(["child-a"], ["child-b", "child-a"]), ["child-a", "child-b"]);
assert.equal(allChildProfilesExist(["child-a", "child-b"], [true, true]), true);
assert.equal(allChildProfilesExist(["other-users-child"], [false]), false);
assert.deepEqual(resolveTeamRoleFlags({ parent: true, staff: true, coach: false }), { parent: true, coach: false, staff: true });
assert.deepEqual(resolveTeamRoleFlags({ parent: true, staff: false, coach: false }), { parent: true, coach: false, staff: false });
assert.equal(activeLinkReferencesChild("child-a", [{ status: "active", childIds: ["child-a"] }]), true);
assert.equal(activeLinkReferencesChild("child-a", [{ status: "inactive", childIds: ["child-a"] }]), false);
assert.deepEqual(removeChildReference("child-a", ["child-a", "child-b"]), ["child-b"]);

const emma = child("child-emma", "Emma");
const sameNameA = child("child-sam-a", "Sam");
const sameNameB = child("child-sam-b", "Sam");
const sharedTeam = team("team-shared", "Wildcats", [emma, child("child-noah", "Noah")], 2, "2026-07-11T12:00:00Z");
const teams = [
  sharedTeam,
  team("team-storm", "Storm", [emma], 1, "2026-07-12T12:00:00Z"),
  team("team-sam-a", "Falcons", [sameNameA], 3, "2026-07-10T12:00:00Z"),
  team("team-sam-b", "Tigers", [sameNameB], 4, "2026-07-09T12:00:00Z"),
];
const groups = groupTeamsByChild(teams);
assert.equal(groups.length, 4);
assert.deepEqual(groups.find((group) => group.childId === "child-emma").teams.map((item) => item.teamId), ["team-storm", "team-shared"]);
assert.equal(groups.find((group) => group.childId === "child-noah").teams[0].teamId, "team-shared");
assert.equal(groups.filter((group) => group.childName === "Sam").length, 2);
assert.equal(groups.find((group) => group.childId === "child-sam-a").key, "child-sam-a");

const summary = summarizeTeamUpdates([...teams, sharedTeam]);
assert.equal(summary.totalTeams, 4);
assert.equal(summary.unreadCount, 10);
assert.equal(summary.latestTeam.teamId, "team-storm");

const legacyGroups = groupTeamsByChild([
  team("legacy-1", "Legacy One", [], 0, null, "Alex"),
  team("legacy-2", "Legacy Two", [], 0, null, "Alex"),
]);
assert.equal(legacyGroups.length, 2);
assert.notEqual(legacyGroups[0].key, legacyGroups[1].key);
assert.equal(groupTeamsByChild([team("unassigned", "Unassigned", [], 0, null)])[0].key, "unassigned:unassigned");
const mixedLegacyGroups = groupTeamsByChild([
  team("mixed", "Mixed", [child("child-new", "New Child")], 1, null, "Legacy Child"),
]);
assert.equal(mixedLegacyGroups.length, 2);
assert.deepEqual(mixedLegacyGroups.map((group) => group.childName), ["Legacy Child", "New Child"]);

const functionsSource = fs.readFileSync(path.join(process.cwd(), "functions", "src", "index.ts"), "utf8");
const deleteCallableSource = functionsSource.slice(
  functionsSource.indexOf("export const deleteChildProfile"),
  functionsSource.indexOf("function serializeWeeklyChallenge"),
);
assert.equal(deleteCallableSource.includes("data.parentUid"), false);
assert.equal(deleteCallableSource.includes("collection('teams')"), false);
assert.equal(deleteCallableSource.includes("roles"), false);
assert.equal(deleteCallableSource.includes("Child profile reference is invalid or unavailable."), true);
const notificationSource = functionsSource.slice(
  functionsSource.indexOf("export const notifyParentsOfTeamAnnouncement"),
  functionsSource.indexOf("export const joinParentTeamByInviteCode"),
);
assert.equal(notificationSource.includes("announcement.body"), false);
assert.equal(notificationSource.includes("announcement.title"), false);
assert.equal(notificationSource.includes("Open Sideline Social to view it."), true);

const childServiceSource = fs.readFileSync(path.join(process.cwd(), "services", "childService.ts"), "utf8");
const createChildSource = childServiceSource.slice(
  childServiceSource.indexOf("export async function createChildProfile"),
  childServiceSource.indexOf("export async function updateChildProfile"),
);
assert.equal(createChildSource.includes("normalizedName"), false);
assert.equal(createChildSource.includes("doc(collection(db, \"users\", user.uid, \"children\"))"), true);

const translations = fs.readFileSync(path.join(process.cwd(), "i18n", "index.ts"), "utf8");
assert.equal((translations.match(/selectChildren:/g) || []).length, 2);
assert.equal((translations.match(/confirmChildrenTitle:/g) || []).length, 2);

console.log("Parent Teams multi-role, stable-child, privacy core tests passed (39 assertions).");