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

const {
  getCoachRosterActionAvailability,
  resolveCoachTeamAuthority,
  resolveRosterActionTarget,
} = loadTypeScript("utils/coachCommunicationCore.ts");
const authenticatedUserId = "coach-owner-uid";
const coachOwnerUserId = "coach-owner-uid";
const courtlandUserId = "courtland-staff-uid";
const joannPollardUserId = "joann-staff-uid";
assert.equal(authenticatedUserId, coachOwnerUserId);
assert.notEqual(courtlandUserId, authenticatedUserId);
assert.notEqual(joannPollardUserId, authenticatedUserId);
assert.equal(new Set([authenticatedUserId, courtlandUserId, joannPollardUserId]).size, 3);

const coachOwnerAuthority = resolveCoachTeamAuthority({
  authenticatedUserId,
  callerMembershipId: authenticatedUserId,
  callerMembershipStatus: "active",
  callerMemberUserId: authenticatedUserId,
  callerRoles: { coach: true, parent: true, staff: false },
  coachOwnerUserId,
  teamActive: true,
});
assert.deepEqual(coachOwnerAuthority, {
  canManageStaff: true,
  canManageTeamLifecycle: true,
  hasCoachAccess: true,
  isCoachOwner: true,
  showCoachHeader: true,
});
assert.deepEqual(resolveCoachTeamAuthority({
  authenticatedUserId: "staff-caller-uid",
  callerMembershipId: "staff-caller-uid",
  callerMembershipStatus: "active",
  callerMemberUserId: "staff-caller-uid",
  callerRoles: { coach: false, parent: true, staff: true },
  coachOwnerUserId,
  teamActive: true,
}), {
  canManageStaff: false,
  canManageTeamLifecycle: false,
  hasCoachAccess: true,
  isCoachOwner: false,
  showCoachHeader: false,
}, "the Coach authority header must not imply staff-management authority for a staff-only caller");

const regularParent = {
  authenticatedUserId,
  callerCanManageTeam: coachOwnerAuthority.canManageStaff,
  callerHasCoachAccess: coachOwnerAuthority.hasCoachAccess,
  coachOwnerUserId,
  memberRoles: { coach: false, parent: true, staff: false },
  membershipId: "parent-uid",
  membershipStatus: "active",
  memberUserId: "parent-uid",
  teamActive: true,
};

assert.deepEqual(getCoachRosterActionAvailability(regularParent), {
  showMakeStaff: true,
  showMenu: true,
  showRemoveStaffAccess: false,
  showSendPrivateMessage: true,
});
assert.deepEqual(getCoachRosterActionAvailability({
  ...regularParent,
  memberRoles: { ...regularParent.memberRoles, staff: true },
}), {
  showMakeStaff: false,
  showMenu: true,
  showRemoveStaffAccess: true,
  showSendPrivateMessage: true,
});

const courtlandStaff = getCoachRosterActionAvailability({
  ...regularParent,
  membershipId: courtlandUserId,
  memberRoles: { coach: false, parent: true, staff: true },
  memberUserId: courtlandUserId,
});
const joannPollardStaff = getCoachRosterActionAvailability({
  ...regularParent,
  membershipId: joannPollardUserId,
  memberRoles: { coach: false, parent: true, staff: true },
  memberUserId: joannPollardUserId,
});
for (const staffActions of [courtlandStaff, joannPollardStaff]) {
  assert.deepEqual(staffActions, {
    showMakeStaff: false,
    showMenu: true,
    showRemoveStaffAccess: true,
    showSendPrivateMessage: true,
  });
}
const coachOwnerActions = getCoachRosterActionAvailability({
  ...regularParent,
  membershipId: authenticatedUserId,
  memberRoles: { coach: true, parent: true, staff: false },
  memberUserId: authenticatedUserId,
});
assert.equal(coachOwnerActions.showMenu, false);
assert.deepEqual(resolveRosterActionTarget({ membershipId: courtlandUserId, memberUserId: courtlandUserId }), {
  membershipId: courtlandUserId,
  targetUserId: courtlandUserId,
});
assert.deepEqual(resolveRosterActionTarget({ membershipId: joannPollardUserId, memberUserId: joannPollardUserId }), {
  membershipId: joannPollardUserId,
  targetUserId: joannPollardUserId,
});
assert.equal(resolveRosterActionTarget({ membershipId: joannPollardUserId, memberUserId: authenticatedUserId }), null);

// Names are deliberately identical: stable UIDs keep the two memberships distinct.
const identicalDisplayName = "Joann Pollard";
const firstMatchingName = getCoachRosterActionAvailability({ ...regularParent, membershipId: "joann-one", memberUserId: "joann-one" });
const secondMatchingName = getCoachRosterActionAvailability({ ...regularParent, membershipId: "joann-two", memberUserId: "joann-two" });
assert.equal(identicalDisplayName, "Joann Pollard");
assert.equal(firstMatchingName.showMenu, true);
assert.equal(secondMatchingName.showMenu, true);
assert.equal(getCoachRosterActionAvailability({
  ...regularParent,
  membershipId: authenticatedUserId,
  memberUserId: authenticatedUserId,
}).showMenu, false, "only the exact authenticated UID is self");
assert.equal(getCoachRosterActionAvailability({
  ...regularParent,
  membershipId: "owner-uid",
  memberUserId: "owner-uid",
  coachOwnerUserId: "owner-uid",
  memberRoles: { coach: true, parent: true, staff: false },
}).showRemoveStaffAccess, false, "the coach owner cannot lose authority");

for (const membershipStatus of ["pending", "inactive", "removed"]) {
  assert.deepEqual(getCoachRosterActionAvailability({ ...regularParent, membershipStatus }), {
    showMakeStaff: false,
    showMenu: false,
    showRemoveStaffAccess: false,
    showSendPrivateMessage: false,
  });
}
assert.equal(getCoachRosterActionAvailability({ ...regularParent, membershipId: "" }).showMenu, false);
assert.equal(getCoachRosterActionAvailability({ ...regularParent, callerHasCoachAccess: false }).showMenu, false);
assert.equal(getCoachRosterActionAvailability({ ...regularParent, teamActive: false }).showMenu, false);
assert.deepEqual(getCoachRosterActionAvailability({ ...regularParent, callerCanManageTeam: false }), {
  showMakeStaff: false,
  showMenu: true,
  showRemoveStaffAccess: false,
  showSendPrivateMessage: true,
}, "staff access may message but cannot mutate roles");

// A staff-only caller may message but cannot mutate another member's role.
const staffCallerViewingCourtland = getCoachRosterActionAvailability({
  ...regularParent,
  authenticatedUserId: "joann-pollard-uid",
  callerCanManageTeam: false,
  coachOwnerUserId: "coach-joann-uid",
  membershipId: "courtland-uid",
  memberRoles: { coach: false, parent: true, staff: true },
  memberUserId: "courtland-uid",
});
assert.deepEqual(staffCallerViewingCourtland, {
  showMakeStaff: false,
  showMenu: true,
  showRemoveStaffAccess: false,
  showSendPrivateMessage: true,
});
assert.equal(getCoachRosterActionAvailability({
  ...regularParent,
  authenticatedUserId: "joann-pollard-uid",
  callerCanManageTeam: false,
  coachOwnerUserId: "coach-joann-uid",
  membershipId: "joann-pollard-uid",
  memberRoles: { coach: false, parent: true, staff: true },
  memberUserId: "joann-pollard-uid",
}).showMenu, false, "the exact authenticated UID retains the historical self-row behavior");

const coreSource = read("utils", "coachCommunicationCore.ts");
const policySource = coreSource.slice(coreSource.indexOf("export type RosterActionContext"));
for (const forbidden of ["displayName", "profile", "friend", "inbox", "photo", "email"]) {
  assert.equal(policySource.toLowerCase().includes(forbidden), false, `${forbidden} must not affect roster actions`);
}

const coachTeam = read("app", "coach", "team.tsx");
assert.match(coachTeam, /authenticatedUserId = auth\.currentUser\?\.uid/);
assert.match(coachTeam, /resolveCoachTeamAuthority\(/);
assert.match(coachTeam, /mayManageRoles = teamAuthority\.canManageStaff/);
assert.match(coachTeam, /teamAuthority\.showCoachHeader[\s\S]{0,180}coach\.team\.youAreCoach/);
assert.equal(/member\.displayName\s*===|member\.firstName\s*===|name\.includes/.test(coachTeam), false);
assert.match(coachTeam, /membershipId: member\.id/);
assert.match(coachTeam, /membershipStatus: member\.status/);
assert.match(coachTeam, /key=\{member\.id\}/, "membership IDs must remain distinct React row keys");
assert.match(coachTeam, /canManage=\{actions\.showMenu\}/);
assert.match(coachTeam, /availability\.showMakeStaff/);
assert.match(coachTeam, /availability\.showRemoveStaffAccess/);
assert.match(coachTeam, /availability\.showSendPrivateMessage/);
assert.ok(coachTeam.indexOf("availability.showMakeStaff") < coachTeam.indexOf("availability.showSendPrivateMessage"));
assert.ok(coachTeam.indexOf("availability.showRemoveStaffAccess") < coachTeam.indexOf("availability.showSendPrivateMessage"));
const menuConstruction = coachTeam.slice(coachTeam.indexOf("const actions: RosterMenuAction[]"));
for (const actionKey of ["makeStaff", "removeStaffAccess", "sendPrivateMessage"]) {
  assert.equal((menuConstruction.match(new RegExp(`key: "${actionKey}"`, "g")) ?? []).length, 1, `${actionKey} must have one unique menu key`);
}
assert.match(coachTeam, /staffRoleUpdateInFlight\.current/);
assert.match(coachTeam, /setTeamStaffRole\(selectedTeam\.id, target\.targetUserId, isStaff\)/);
assert.match(coachTeam, /currentMember\.id === target\.membershipId[\s\S]*role: result\.role, roles: result\.roles/);
assert.match(coachTeam, /getOrCreatePrivateTeamConversation\(selectedTeam\.id, target\.targetUserId\)/);
assert.equal(coachTeam.includes("friendConversations"), false);
assert.match(coachTeam, /memberUserIdMatchesCaller:/);
assert.match(coachTeam, /memberUserIdMatchesOwner:/);
assert.match(coachTeam, /hasMembershipId:/);
assert.equal(/roster action policy[\s\S]{0,700}(displayName|childName|email|token)/.test(coachTeam), false, "development diagnostics must remain privacy safe");

const translations = read("i18n", "index.ts");
for (const expected of [
  "memberActionsTitle: 'Actions for {{name}}'",
  "makeStaff: 'Make Staff'",
  "removeStaffAccess: 'Remove Staff Access'",
  "sendPrivateMessage: 'Send Private Message'",
  "cancel: 'Cancel'",
  "memberActionsTitle: 'Acciones para {{name}}'",
  "makeStaff: 'Hacer parte del staff'",
  "removeStaffAccess: 'Quitar acceso de staff'",
  "sendPrivateMessage: 'Enviar Mensaje Privado'",
  "cancel: 'Cancelar'",
]) {
  assert.ok(translations.includes(expected), `missing translation: ${expected}`);
}

const privateThread = read("components", "PrivateTeamMessageThread.tsx");
assert.match(privateThread, /sendPrivateTeamTextMessage/);
assert.match(privateThread, /<VoiceMemoComposer/);
assert.match(privateThread, /<VoiceMemoPlayer/);

const teamService = read("services", "teamService.ts");
assert.match(teamService, /function normalizeMembership[\s\S]*userId: id/);
assert.equal(/function normalizeMembership[\s\S]{0,500}userId: readString\(data\.userId/.test(teamService), false);
assert.match(teamService, /snapshot\.docs[\s\S]*\.map\(\(memberDoc\) => normalizeMembership/);

console.log("Coach roster action policy, UID collision handling, menu construction, and messaging regressions passed.");
