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
  canAccessTeamAnnouncement,
  canDeleteTeamAnnouncementReply,
  canManageTeamAnnouncements,
  canManageTeamRoles,
  hasCoachAccess,
  hasParentRole,
  isTeamActive,
  isEligibleStaffRoleTarget,
  mergeChildIds,
  mergeParentRole,
  normalizeChildIds,
  removeParentRole,
  removeChildReference,
  resolveReplyAuthorName,
  resolveTeamRoleFlags,
  setStaffRole,
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
assert.equal(isTeamActive({}), true);
assert.equal(isTeamActive({ status: "active" }), true);
assert.equal(isTeamActive({ status: "archived" }), false);
assert.deepEqual(removeParentRole({ parent: true, coach: false, staff: false }, "parent"), {
  roles: { parent: false, coach: false, staff: false }, role: "inactive", status: "inactive",
});
assert.deepEqual(removeParentRole({ parent: true, coach: true, staff: false }, "coach"), {
  roles: { parent: false, coach: true, staff: false }, role: "coach", status: "active",
});
assert.deepEqual(removeParentRole({ parent: true, coach: false, staff: true }, "teamParent"), {
  roles: { parent: false, coach: false, staff: true }, role: "teamParent", status: "active",
});
assert.deepEqual(removeParentRole({ parent: true, coach: false, staff: true, permission: "preserved" }, "parent").roles, {
  parent: false, coach: false, staff: true, permission: "preserved",
});
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
assert.equal(canManageTeamRoles({ status: "active", roles: { coach: true } }), true);
assert.equal(canManageTeamRoles({ status: "active", roles: { staff: true } }), false);
assert.equal(canManageTeamRoles({ status: "active", roles: { staff: true } }, true), true);
assert.equal(canManageTeamRoles({ status: "removed", roles: { coach: true } }), false);
assert.equal(isEligibleStaffRoleTarget({ status: "active", roles: { parent: true, coach: false, staff: false } }), true);
assert.equal(isEligibleStaffRoleTarget({ status: "active", roles: { parent: true, coach: true, staff: false } }), false);
assert.equal(isEligibleStaffRoleTarget({ status: "removed", roles: { parent: true, coach: false, staff: false } }), false);
const activeParent = { status: "active", roles: { parent: true, coach: false, staff: false } };
const activeCoach = { status: "active", roles: { parent: false, coach: true, staff: false } };
const activeStaff = { status: "active", roles: { parent: false, coach: false, staff: true } };
assert.equal(canAccessTeamAnnouncement(activeParent, "parents"), true);
assert.equal(canAccessTeamAnnouncement(activeParent, "all"), true);
assert.equal(canAccessTeamAnnouncement(activeParent, "staff"), false);
assert.equal(canAccessTeamAnnouncement(activeStaff, "staff"), true);
assert.equal(canDeleteTeamAnnouncementReply("parent-a", activeParent, { userId: "parent-a" }), true);
assert.equal(canDeleteTeamAnnouncementReply("parent-a", activeParent, { userId: "parent-b" }), false);
assert.equal(canDeleteTeamAnnouncementReply("coach", activeCoach, { userId: "parent-a" }), true);
assert.equal(canDeleteTeamAnnouncementReply("staff", activeStaff, { userId: "parent-a" }), true);
assert.equal(canDeleteTeamAnnouncementReply("coach", { ...activeCoach, status: "removed" }, { userId: "parent-a" }), false);
assert.equal(canDeleteTeamAnnouncementReply("coach", undefined, { userId: "parent-a" }), false);
assert.equal(canManageTeamAnnouncements(activeCoach), true);
assert.equal(canManageTeamAnnouncements(activeStaff), true);
assert.equal(canManageTeamAnnouncements(activeParent), false);
assert.equal(canManageTeamAnnouncements({ ...activeCoach, status: "removed" }), false);
assert.equal(canManageTeamAnnouncements(undefined), false);
assert.equal(resolveReplyAuthorName({ displayName: "Saved Parent" }, activeParent, "Auth Parent"), "Saved Parent");
assert.equal(resolveReplyAuthorName({ displayName: "parent@example.com", firstName: "Saved", lastName: "Parent" }, activeParent, "Auth Parent"), "Saved Parent");
assert.equal(resolveReplyAuthorName({ displayName: "parent@example.com" }, { ...activeParent, displayName: "legacy@example.com" }, "auth@example.com"), "Sideline Social member");
assert.deepEqual(
  setStaffRole({ parent: true, coach: false, staff: false, customRole: "preserved" }, "parent", true),
  { parent: true, coach: false, staff: true, customRole: "preserved" },
);
assert.deepEqual(
  setStaffRole({ parent: true, coach: false, staff: true }, "teamParent", false),
  { parent: true, coach: false, staff: false },
);

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
const createReplyCallableSource = functionsSource.slice(
  functionsSource.indexOf("export const createTeamAnnouncementReply"),
  functionsSource.indexOf("export const deleteTeamAnnouncementReply"),
);
const deleteReplyCallableSource = functionsSource.slice(
  functionsSource.indexOf("export const deleteTeamAnnouncementReply"),
  functionsSource.indexOf("function readReplyPathId"),
);
const deleteAnnouncementCallableSource = functionsSource.slice(
  functionsSource.indexOf("export const deleteTeamAnnouncement ="),
  functionsSource.indexOf("export const createTeamAnnouncementReply"),
);
assert.equal(createReplyCallableSource.includes("context.auth?.uid"), true);
assert.equal(createReplyCallableSource.includes("data?.userId"), false);
assert.equal(createReplyCallableSource.includes("profileRef"), true);
assert.equal(createReplyCallableSource.includes("resolveReplyAuthorName"), true);
assert.equal(createReplyCallableSource.includes("FieldValue.serverTimestamp()"), true);
assert.equal(createReplyCallableSource.includes("announcement.allowReplies !== true"), true);
assert.equal(deleteReplyCallableSource.includes("context.auth?.uid"), true);
assert.equal(deleteReplyCallableSource.includes("data?.userId"), false);
assert.equal(deleteReplyCallableSource.includes("canDeleteTeamAnnouncementReply(uid, member"), true);
assert.equal(deleteReplyCallableSource.includes("memberRef = teamRef.collection('members').doc(uid)"), true);
assert.equal(deleteReplyCallableSource.includes("transaction.update(replyRef"), true);
assert.equal(deleteReplyCallableSource.includes("isDeleted: true"), true);
assert.equal(deleteReplyCallableSource.includes("body: null"), true);
assert.equal(deleteReplyCallableSource.includes("transaction.delete(replyRef)"), false);
assert.equal(deleteReplyCallableSource.includes("transaction.delete(announcementRef)"), false);
assert.equal(deleteAnnouncementCallableSource.includes("context.auth?.uid"), true);
assert.equal(deleteAnnouncementCallableSource.includes("data?.coachId"), false);
assert.equal(deleteAnnouncementCallableSource.includes("memberRef = teamRef.collection('members').doc(uid)"), true);
assert.equal(deleteAnnouncementCallableSource.includes("canManageTeamAnnouncements(member)"), true);
assert.equal(deleteAnnouncementCallableSource.includes("transaction.update(announcementRef"), true);
assert.equal(deleteAnnouncementCallableSource.includes("isDeleted: true"), true);
assert.equal(deleteAnnouncementCallableSource.includes("voiceMemo: null"), true);
assert.equal(deleteAnnouncementCallableSource.includes("transaction.delete(announcementRef)"), false);
assert.equal(deleteAnnouncementCallableSource.includes("deleteTeamVoiceStorageObject"), true);
assert.equal(deleteAnnouncementCallableSource.includes("status = 'deleted'"), true);
assert.equal(deleteAnnouncementCallableSource.includes("return { status, storageCleanup }"), true);
const deleteCallableSource = functionsSource.slice(
  functionsSource.indexOf("export const deleteChildProfile"),
  functionsSource.indexOf("async function generateAvailableTeamInviteCode"),
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
assert.equal(notificationSource.includes("createPersonalNotificationAndPush"), true);
assert.equal(notificationSource.includes("notifications.types.coachAnnouncementTitle"), true);
assert.equal(notificationSource.includes("storedAnnouncementRecipientUserIds(announcement.recipientUserIds)"), true);
assert.equal(notificationSource.includes("resolveAnnouncementRecipientUserIds"), true);
assert.equal(notificationSource.includes("recipientUserId"), true);
assert.equal(notificationSource.includes("isTeamActive(teamSnapshot.data())"), true);
const joinCallableSource = functionsSource.slice(
  functionsSource.indexOf("export const joinParentTeamByInviteCode"),
  functionsSource.indexOf("export const setTeamStaffRole"),
);
assert.equal(joinCallableSource.includes("team-archived"), true);
assert.equal(joinCallableSource.includes("transactionTeamSnapshot"), true);
const staffRoleCallableSource = functionsSource.slice(
  functionsSource.indexOf("export const setTeamStaffRole"),
  functionsSource.indexOf("export const setParentTeamChildLinks"),
);
assert.equal(staffRoleCallableSource.includes("context.auth?.uid"), true);
assert.equal(staffRoleCallableSource.includes("data.requester"), false);
assert.equal(staffRoleCallableSource.includes("staffRoleUpdatedBy: uid"), true);
assert.equal(staffRoleCallableSource.includes("staffRoleUpdatedAt"), true);
assert.equal(staffRoleCallableSource.includes("team.createdBy === targetUserId"), true);
assert.equal(staffRoleCallableSource.includes("childIds"), false);

const childLinksCallableSource = functionsSource.slice(
  functionsSource.indexOf("export const setParentTeamChildLinks"),
  functionsSource.indexOf("export const leaveParentTeam"),
);
assert.equal(childLinksCallableSource.includes("isTeamActive(teamSnapshot.data())"), true);
assert.equal(childLinksCallableSource.includes("allChildProfilesExist"), true);
assert.equal(childLinksCallableSource.includes("hasParentRole(member)"), true);
const leaveCallableSource = functionsSource.slice(
  functionsSource.indexOf("export const leaveParentTeam"),
  functionsSource.indexOf("export const setTeamArchived"),
);
assert.equal(leaveCallableSource.includes("context.auth?.uid"), true);
assert.equal(leaveCallableSource.includes("data.userId"), false);
assert.equal(leaveCallableSource.includes("removeParentRole"), true);
assert.equal(leaveCallableSource.includes("childIds: []"), true);
assert.equal(leaveCallableSource.includes("parentTeamIds: FieldValue.arrayRemove(teamId)"), true);
assert.equal(leaveCallableSource.includes("coachTeamIds = FieldValue.arrayUnion(teamId)"), true);
assert.equal(leaveCallableSource.includes("transaction.delete"), false);
assert.equal(leaveCallableSource.includes("collection('children')"), false);
const archiveCallableSource = functionsSource.slice(
  functionsSource.indexOf("export const setTeamArchived"),
  functionsSource.indexOf("export const deleteChildProfile"),
);
assert.equal(archiveCallableSource.includes("canManageTeamRoles"), true);
assert.equal(archiveCallableSource.includes("status: 'archived'"), true);
assert.equal(archiveCallableSource.includes("archivedAt"), true);
assert.equal(archiveCallableSource.includes("restoredAt"), true);
assert.equal(archiveCallableSource.includes("replacementInviteCode"), true);
assert.equal(archiveCallableSource.includes("transaction.delete"), false);

const teamServiceSource = fs.readFileSync(path.join(process.cwd(), "services", "teamService.ts"), "utf8");
const staffRoleClientSource = teamServiceSource.slice(
  teamServiceSource.indexOf("export async function setTeamStaffRole"),
  teamServiceSource.indexOf("export async function getTeamById"),
);
assert.equal(staffRoleClientSource.includes('functions, "setTeamStaffRole"'), true);
assert.equal(staffRoleClientSource.includes("updateDoc"), false);
assert.equal(teamServiceSource.includes('functions, "leaveParentTeam"'), true);
assert.equal(teamServiceSource.includes('functions, "setTeamArchived"'), true);
assert.equal(teamServiceSource.includes('status: "active"'), true);

const rosterServiceSource = fs.readFileSync(path.join(process.cwd(), "services", "teamRosterService.ts"), "utf8");
const replyServiceSource = fs.readFileSync(path.join(process.cwd(), "services", "teamMessageService.ts"), "utf8");
const quickReplySource = fs.readFileSync(path.join(process.cwd(), "constants", "teamReplies.ts"), "utf8");
const parentAnnouncementSource = fs.readFileSync(path.join(process.cwd(), "app", "teams", "[teamId]", "announcements", "[announcementId].tsx"), "utf8");
const coachAnnouncementSource = fs.readFileSync(path.join(process.cwd(), "app", "coach", "messages", "[announcementId].tsx"), "utf8");
const coachAnnouncementListSource = fs.readFileSync(path.join(process.cwd(), "app", "coach", "messages.tsx"), "utf8");
const parentTeamServiceSource = fs.readFileSync(path.join(process.cwd(), "services", "parentTeamService.ts"), "utf8");
assert.equal(rosterServiceSource.includes("getPublicUserProfiles"), true);
assert.equal(rosterServiceSource.includes("documentId()"), false);
assert.equal(rosterServiceSource.includes("looksLikeEmailAddress"), true);
assert.equal(rosterServiceSource.includes('.split("@")'), false);
assert.deepEqual(loadTypeScript("constants/teamReplies.ts").QUICK_REPLY_IDS, ["attending", "notAttending", "canHelp", "stillNeeded"]);
assert.equal(quickReplySource.includes("quickReplyIce"), false);
assert.equal(replyServiceSource.includes('functions, "createTeamAnnouncementReply"'), true);
assert.equal(replyServiceSource.includes('functions, "deleteTeamAnnouncementReply"'), true);
assert.equal(replyServiceSource.includes('functions, "deleteTeamAnnouncement"'), true);
assert.equal(replyServiceSource.includes("listenToTeamAnnouncement"), true);
assert.equal(replyServiceSource.includes('.split("@")'), false);
assert.equal(parentAnnouncementSource.includes("QUICK_REPLY_IDS.map"), true);
assert.equal(coachAnnouncementSource.includes("QUICK_REPLY_IDS.map"), true);
assert.equal(parentAnnouncementSource.includes("announcement.allowReplies ?"), true);
assert.equal(parentAnnouncementSource.includes("reply.userId === auth.currentUser?.uid"), true);
assert.equal(coachAnnouncementSource.includes("canModerateReplies"), true);
assert.equal(coachAnnouncementSource.includes("reply.userId === auth.currentUser?.uid"), true);
assert.equal(coachAnnouncementSource.includes("canManageTeamAnnouncements"), true);
assert.equal(coachAnnouncementSource.includes("deleteTeamAnnouncement(teamId, announcementId)"), true);
assert.equal(coachAnnouncementSource.includes("announcementDeletionInFlight.current"), true);
assert.equal(coachAnnouncementSource.includes('"teamMessages.deleteForEveryone"'), true);
assert.equal(coachAnnouncementSource.includes("announcement.isDeleted"), true);
assert.equal(parentAnnouncementSource.includes("reply.isDeleted"), true);
assert.equal(parentAnnouncementSource.includes("listenToTeamAnnouncement"), true);
assert.equal(coachAnnouncementListSource.includes("listenToTeamAnnouncements"), true);
assert.equal(parentTeamServiceSource.includes("latestAnnouncement: announcements[0] ?? null"), true);

const coachRosterSource = fs.readFileSync(path.join(process.cwd(), "app", "coach", "team.tsx"), "utf8");
assert.equal(coachRosterSource.includes("member.displayName"), false);
assert.equal(coachRosterSource.includes("roleStaffParent"), true);
assert.equal(coachRosterSource.includes("updatingUserId"), true);
assert.equal(coachRosterSource.includes("staffRoleUpdateInFlight.current"), true);
assert.equal(coachRosterSource.includes("Alert.alert"), true);
assert.equal(coachRosterSource.includes("archiveTeam"), true);
assert.equal(coachRosterSource.includes("setTeamArchived"), true);
const parentsSectionIndex = coachRosterSource.indexOf('title={t("coach.team.parents")}');
const parentEmptyStateIndex = coachRosterSource.indexOf('t("coach.team.noParentsBody")');
const teamSettingsIndex = coachRosterSource.indexOf('t("coach.team.teamSettings")');
assert.equal(parentsSectionIndex > -1, true);
assert.equal(teamSettingsIndex > parentsSectionIndex, true);
assert.equal(teamSettingsIndex > parentEmptyStateIndex, true);
assert.equal(coachRosterSource.includes("position: \"absolute\""), false);

const parentHubSource = fs.readFileSync(path.join(process.cwd(), "app", "teams", "[teamId]", "index.tsx"), "utf8");
assert.equal(parentHubSource.includes("removeChildFromTeam"), true);
assert.equal(parentHubSource.includes("manageChildren"), true);
assert.equal(parentHubSource.includes("leaveParentTeam"), true);
assert.equal(parentHubSource.includes('router.replace("/teams"'), true);
assert.equal(parentHubSource.includes("Delete Team"), false);
const manageChildrenSource = fs.readFileSync(path.join(process.cwd(), "app", "teams", "[teamId]", "children.tsx"), "utf8");
assert.equal(manageChildrenSource.includes("ChildProfilePicker"), true);
assert.equal(manageChildrenSource.includes("setParentTeamChildLinks(teamId, selectedChildIds)"), true);
const coachHomeSource = fs.readFileSync(path.join(process.cwd(), "app", "coach", "index.tsx"), "utf8");
assert.equal(coachHomeSource.includes("archivedTeams"), true);
assert.equal(coachHomeSource.includes("confirmRestore"), true);

const childServiceSource = fs.readFileSync(path.join(process.cwd(), "services", "childService.ts"), "utf8");
const createChildSource = childServiceSource.slice(
  childServiceSource.indexOf("export async function createChildProfile"),
  childServiceSource.indexOf("export async function updateChildProfile"),
);
assert.equal(createChildSource.includes("normalizedName"), false);
assert.equal(createChildSource.includes("doc(collection(db, \"users\", user.uid, \"children\"))"), true);

const translations = fs.readFileSync(path.join(process.cwd(), "i18n", "index.ts"), "utf8");
assert.equal(translations.includes("I’ll bring ice"), false);
assert.equal(translations.includes("Puedo traer hielo"), false);
assert.equal((translations.match(/attending:/g) || []).length, 2);
assert.equal((translations.match(/notAttending:/g) || []).length, 2);
assert.equal((translations.match(/stillNeeded:/g) || []).length, 2);
assert.equal(translations.includes("We’ll be there"), true);
assert.equal(translations.includes("Can’t make it"), true);
assert.equal(translations.includes("What is still needed?"), true);
assert.equal(translations.includes("¿Qué hace falta todavía?"), true);
assert.equal((translations.match(/selectChildren:/g) || []).length, 2);
assert.equal((translations.match(/confirmChildrenTitle:/g) || []).length, 2);
assert.equal((translations.match(/makeStaffTitle:/g) || []).length, 2);
assert.equal((translations.match(/roleStaffParent:/g) || []).length, 2);
assert.equal((translations.match(/staffRoleError:/g) || []).length, 2);
for (const key of [
  "manageChildren", "removeChildFromTeam", "leaveTeam", "archiveTeam", "restoreTeam",
  "archivedTeams", "teamInactive", "membershipUpdateError", "archiveError", "restoreError",
  "saving", "leaving", "archiving", "restoring", "deleteAnnouncement",
  "deleteAnnouncementTitle", "deleteAnnouncementBody", "deletingAnnouncement",
  "deleteSuccess", "announcementActions",
]) {
  assert.equal((translations.match(new RegExp(`${key}:`, "g")) || []).length >= 2, true, `${key} needs English and Spanish copy.`);
}
assert.equal((translations.match(/announcementUnavailable:/g) || []).length, 4);
assert.equal((translations.match(/deleteError:/g) || []).length >= 4, true);
assert.equal(translations.includes("Delete announcement?"), true);
assert.equal(translations.includes("This announcement and its replies will be permanently removed from the team."), true);
assert.equal(translations.includes("¿Eliminar anuncio?"), true);
assert.equal(translations.includes("Este anuncio y sus respuestas se eliminarán permanentemente del equipo."), true);

console.log("Parent Teams lifecycle, multi-role, stable-child, privacy, archive, and staff-role core tests passed.");
