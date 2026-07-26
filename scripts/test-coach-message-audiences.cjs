const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const read = (...segments) => fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
function loadTypeScript(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(require, loaded, loaded.exports);
  return loaded.exports;
}

const audienceCore = loadTypeScript("functions/src/teamVoiceMessagingCore.ts");
const membershipCore = loadTypeScript("functions/src/teamMembershipCore.ts");
const members = [
  { membershipId: "coach-sender", data: { status: "active", roles: { coach: true } } },
  { membershipId: "parent-active", data: { status: "active", roles: { parent: true } } },
  { membershipId: "guardian-legacy", data: { status: "active", role: "parent" } },
  { membershipId: "staff-active", data: { status: "active", roles: { staff: true } } },
  { membershipId: "coach-active", data: { status: "active", roles: { coach: true } } },
  { membershipId: "dual-role", data: { status: "active", roles: { parent: true, staff: true } } },
  { membershipId: "parent-removed", data: { status: "removed", roles: { parent: true } } },
  { membershipId: "staff-inactive", data: { status: "inactive", roles: { staff: true } } },
  { membershipId: "unauthorized-active", data: { status: "active", roles: {} } },
];

assert.equal(audienceCore.readAnnouncementAudience("everyone"), "all", "legacy everyone maps to Team");
assert.equal(audienceCore.readAnnouncementAudience("all"), "all");
assert.equal(audienceCore.readAnnouncementAudience("parents"), "parents");
assert.equal(audienceCore.readAnnouncementAudience("staff"), "staff");
assert.throws(() => audienceCore.readAnnouncementAudience("team"), /invalid_audience/);
assert.deepEqual(
  audienceCore.resolveAnnouncementRecipientUserIds(members, "coach-sender", "all"),
  ["coach-active", "dual-role", "guardian-legacy", "parent-active", "staff-active"],
  "Team includes every supported active adult role once and excludes the sender/inactive rows",
);
assert.deepEqual(
  audienceCore.resolveAnnouncementRecipientUserIds(members, "coach-sender", "staff"),
  ["coach-active", "dual-role", "staff-active"],
  "Staff includes supported coach/staff roles only and deduplicates dual-role users",
);
assert.deepEqual(
  audienceCore.resolveAnnouncementRecipientUserIds(members, "coach-sender", "parents"),
  ["dual-role", "guardian-legacy", "parent-active"],
  "historical Parents behavior remains available",
);
assert.equal(membershipCore.hasActiveTeamChildRelationship(
  { status: "active", roles: { parent: true } },
  { status: "active", childIds: ["child-1"] },
), true);
assert.equal(membershipCore.hasActiveTeamChildRelationship(
  { status: "active", role: "parent", childId: "legacy-child" },
  undefined,
), true, "legacy child linkage remains eligible");
assert.equal(membershipCore.hasActiveTeamChildRelationship(
  { status: "active", roles: { parent: true } },
  { status: "inactive", childIds: ["child-1"] },
), false);
assert.equal(membershipCore.hasActiveTeamChildRelationship(
  { status: "removed", roles: { parent: true }, childId: "legacy-child" },
  { status: "active", childIds: ["child-1"] },
), false);

const composer = read("app", "coach", "messages.tsx");
assert.match(composer, /const AUDIENCES = \["all", "staff"\] as const/);
assert.doesNotMatch(composer, /const AUDIENCES[^\n]*parents/);
assert.match(composer, /useState<AnnouncementAudience>\("all"\)/);
assert.match(composer, /getTeamAnnouncementRecipientCounts/);
assert.match(composer, /selectedRecipientCount === 0/);

const templates = read("content", "coachResources", "communicationTemplates.ts");
for (const id of ["parent-concern", "private-conversation", "difficult-follow-up"]) {
  assert.match(templates, new RegExp(`template\\("${id}", "message_parent"`));
  assert.equal((templates.match(new RegExp(`template\\("${id}"`, "g")) ?? []).length, 1);
}
assert.match(templates, /Following Up After a Private Conversation/);
assert.match(templates, /canSendAsAnnouncement: category !== "message_parent"/);

const library = read("app", "coach", "resources", "communication", "index.tsx");
assert.match(library, /\["schedule", "parents", "message_parent", "culture"\]/);
assert.match(library, /entry\.category === "message_parent"[\s\S]*\/coach\/resources\/message-parent/);

const privatePicker = read("app", "coach", "resources", "message-parent", "[templateId].tsx");
assert.match(privatePicker, /getEligiblePrivateTeamParents/);
assert.match(privatePicker, /getOrCreatePrivateTeamConversation/);
assert.match(privatePicker, /parent\.displayName\.toLocaleLowerCase\(\)\.includes/);
assert.match(privatePicker, /accessibilityRole="radio"/);
assert.match(privatePicker, /initialText/);
assert.doesNotMatch(privatePicker, /createTeamAnnouncement|\/coach\/messages/);

const communicationDetail = read("app", "coach", "resources", "communication", "[templateId].tsx");
assert.match(communicationDetail, /template\.category === "message_parent"[\s\S]*<Redirect/);
const privateThread = read("components", "PrivateTeamMessageThread.tsx");
assert.match(privateThread, /initialText\.slice\(0, 2000\)/);
assert.match(privateThread, /sendPrivateTeamTextMessage/);

const functionsSource = read("functions", "src", "index.ts");
for (const required of [
  "getTeamAnnouncementRecipientCounts",
  "recipientUserIds",
  "empty_audience",
  "getEligiblePrivateTeamParents",
  "teamChildLinks",
  "blockedByCoachRef",
  "blockedByParentRef",
]) {
  assert.ok(functionsSource.includes(required), `${required} backend safeguard must exist`);
}
assert.match(functionsSource, /createPrivateTeamMessageTransaction[\s\S]*isEligiblePrivateTeamParent/);
assert.match(functionsSource, /notifyPrivateTeamMessage[\s\S]*recipientUserId/);

const translations = read("i18n", "index.ts");
for (const key of [
  "audienceAllDescription",
  "audienceStaffDescription",
  "audienceEmpty",
  "message_parent",
  "messageParentPrivateTitle",
  "chooseParent",
  "parentSearchPlaceholder",
  "openPrivateMessage",
]) {
  assert.equal((translations.match(new RegExp(`${key}:`, "g")) ?? []).length, 2, `${key} needs English and Spanish`);
}

console.log("Coach Team/Staff audiences and private Message a Parent workflow tests passed.");
