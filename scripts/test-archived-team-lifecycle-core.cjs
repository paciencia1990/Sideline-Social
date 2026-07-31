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

const {
  parentRemovedArchivedTeam,
  shouldIndexCoachMembership,
  shouldRestoreArchivedParentMembership,
} = loadTypeScript("functions/src/teamMembershipCore.ts");

assert.equal(parentRemovedArchivedTeam({ archivedParentRemovedAt: {} }), true);
assert.equal(parentRemovedArchivedTeam({ parentArchivedRemovalState: "removed" }), true);
assert.equal(parentRemovedArchivedTeam({ roles: { parent: true } }), false);
assert.equal(shouldRestoreArchivedParentMembership({
  status: "active",
  roles: { parent: true, coach: false, staff: false },
}), true);
assert.equal(shouldRestoreArchivedParentMembership({
  status: "active",
  roles: { parent: true, coach: false, staff: false },
  parentArchivedRemovalState: "removed",
}), false);
assert.equal(shouldRestoreArchivedParentMembership({
  status: "inactive",
  roles: { parent: true, coach: false, staff: false },
}), false);
assert.equal(shouldIndexCoachMembership({
  status: "active",
  roles: { parent: true, coach: true, staff: false },
}), true);
assert.equal(shouldIndexCoachMembership({
  status: "active",
  roles: { parent: true, coach: false, staff: true },
}), true);
assert.equal(shouldIndexCoachMembership({
  status: "inactive",
  roles: { parent: false, coach: true, staff: false },
}), false);

const functionsSource = fs.readFileSync(path.join(process.cwd(), "functions", "src", "index.ts"), "utf8");
const archiveCallableSource = functionsSource.slice(
  functionsSource.indexOf("export const setTeamArchived"),
  functionsSource.indexOf("export const removeArchivedParentTeamFromAccount"),
);
const removeCallableSource = functionsSource.slice(
  functionsSource.indexOf("export const removeArchivedParentTeamFromAccount"),
  functionsSource.indexOf("export const deleteChildProfile"),
);
const privateInboxSource = functionsSource.slice(
  functionsSource.indexOf("export const getTeamPrivateMessageInbox"),
  functionsSource.indexOf("export const getTeamVoiceMemoDownloadUrl"),
);
assert.equal(archiveCallableSource.includes("inviteCode: null"), true);
assert.equal(archiveCallableSource.includes("alreadyDesired"), true);
assert.equal(archiveCallableSource.includes("reconcileTeamLifecycleIndexes"), true);
assert.equal(archiveCallableSource.includes("markTeamPrivateConversationsReadOnly"), true);
assert.equal(archiveCallableSource.includes("transaction.delete"), false);
assert.equal(functionsSource.includes("update.archivedParentTeamIds = FieldValue.arrayUnion(teamId)"), true);
assert.equal(functionsSource.includes("update.archivedCoachTeamIds = FieldValue.arrayUnion(teamId)"), true);
assert.equal(functionsSource.includes("shouldRestoreArchivedParentMembership(member)"), true);
assert.equal(functionsSource.includes("parentRemovedArchivedTeam(member)"), true);
assert.equal(functionsSource.includes("mode === 'restore' && parentRemovedArchivedTeam(member)"), true);
assert.equal(removeCallableSource.includes("functions.https.onCall"), true);
assert.equal(removeCallableSource.includes("communicationFunctions.https.onCall"), false);
assert.equal(removeCallableSource.includes("reason: 'active-team'"), true);
assert.equal(removeCallableSource.includes("archivedParentRemovedAt"), true);
assert.equal(removeCallableSource.includes("parentArchivedRemovalState: 'removed'"), true);
assert.equal(removeCallableSource.includes("childIds: []"), true);
assert.equal(removeCallableSource.includes("collection('children')"), false);
assert.equal(removeCallableSource.includes("transaction.delete"), false);
assert.equal(privateInboxSource.includes("coachTeamIds"), true);
assert.equal(privateInboxSource.includes("parentTeamIds"), true);
assert.equal(privateInboxSource.includes("value.status === 'readOnly'"), true);

const teamServiceSource = fs.readFileSync(path.join(process.cwd(), "services", "teamService.ts"), "utf8");
assert.equal(teamServiceSource.includes("getArchivedParentTeamCount"), true);
assert.equal(teamServiceSource.includes("getArchivedParentTeamMembershipsPage"), true);
assert.equal(teamServiceSource.includes("getArchivedCoachTeamMembershipsPage"), true);
assert.equal(teamServiceSource.includes('functions, "removeArchivedParentTeamFromAccount"'), true);

const parentServiceSource = fs.readFileSync(path.join(process.cwd(), "services", "parentTeamService.ts"), "utf8");
assert.equal(parentServiceSource.includes("ArchivedParentTeamSummary"), true);
assert.equal(parentServiceSource.includes("getParentPastTeamsPage"), true);
assert.equal(parentServiceSource.includes("privateConversations"), true);
const pastSummarySource = parentServiceSource.slice(
  parentServiceSource.indexOf("function toArchivedParentSummary"),
  parentServiceSource.indexOf("function readDate"),
);
assert.equal(pastSummarySource.includes("announcements"), false);
assert.equal(pastSummarySource.includes("privateConversations"), false);
assert.equal(pastSummarySource.includes("children"), false);

const parentTeamsScreen = fs.readFileSync(path.join(process.cwd(), "app", "teams", "index.tsx"), "utf8");
assert.equal(parentTeamsScreen.includes("PastTeamsSection"), true);
assert.equal(parentTeamsScreen.includes("pastExpanded"), true);
assert.equal(parentTeamsScreen.includes("removeParentPastTeam"), true);
assert.equal(parentTeamsScreen.includes("Delete Team"), false);

const coachHomeSource = fs.readFileSync(path.join(process.cwd(), "app", "coach", "index.tsx"), "utf8");
assert.equal(coachHomeSource.includes("getArchivedCoachTeamCount"), true);
assert.equal(coachHomeSource.includes("getArchivedCoachTeamMembershipsPage"), true);
assert.equal(coachHomeSource.includes("archivedExpanded"), true);

const reconciliationScript = fs.readFileSync(path.join(process.cwd(), "scripts", "reconcile-archived-team-indexes.cjs"), "utf8");
assert.equal(reconciliationScript.includes("Dry-run by default"), true);
assert.equal(reconciliationScript.includes("--apply"), true);
assert.equal(reconciliationScript.includes("staleUserIndexes"), true);
assert.equal(reconciliationScript.includes("archivedTeamsWithInviteCodes"), true);

const translations = fs.readFileSync(path.join(process.cwd(), "i18n", "index.ts"), "utf8");
for (const key of [
  "archivedTeamsCount", "archivedTeamsLoadMore", "archivedTeamsLoadError",
  "pastTeamsTitle", "pastTeamsCount", "pastTeamsLoadMore", "pastTeamsRemoveAction",
  "pastTeamsRemoveBody", "pastTeamsRemoveError", "pastTeamsRemoveSuccess",
]) {
  assert.equal((translations.match(new RegExp(`${key}:`, "g")) || []).length, 2, `${key} needs English and Spanish copy.`);
}

console.log("Archived team lifecycle core tests passed.");
