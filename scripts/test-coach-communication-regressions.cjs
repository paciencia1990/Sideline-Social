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

const coachCore = loadTypeScript("utils/coachCommunicationCore.ts");
assert.equal(coachCore.shouldShowPrivateMessagesCard({ hasActiveTeam: true, conversationCount: 0, loadState: "loading", unreadCount: 0 }), true);
assert.equal(coachCore.shouldShowPrivateMessagesCard({ hasActiveTeam: true, conversationCount: 0, loadState: "loaded", unreadCount: 0 }), true);
assert.equal(coachCore.shouldShowPrivateMessagesCard({ hasActiveTeam: true, conversationCount: 1, loadState: "error", unreadCount: 1 }), true);
assert.equal(coachCore.shouldShowPrivateMessagesCard({ hasActiveTeam: false, conversationCount: 1, loadState: "loaded", unreadCount: 2 }), false);

const acceptedParentActions = coachCore.getCoachRosterActionAvailability({
  authenticatedUserId: "coach",
  callerCanManageTeam: true,
  callerHasCoachAccess: true,
  coachOwnerUserId: "coach",
  memberRoles: { coach: false, parent: true, staff: false },
  membershipId: "parent",
  membershipStatus: "active",
  memberUserId: "parent",
  teamActive: true,
});
assert.deepEqual(acceptedParentActions, {
  showMakeStaff: true,
  showMenu: true,
  showRemoveStaffAccess: false,
  showSendPrivateMessage: true,
});

const announcementCore = loadTypeScript("utils/teamAnnouncementCore.ts");
const validVoice = {
  storagePath: "teamVoiceMemos/team/announcements/message/reservation/memo.m4a",
  durationMilliseconds: 20_000,
  sizeBytes: 120_000,
  mimeType: "audio/mp4",
};
assert.equal(announcementCore.resolveAnnouncementContentType(undefined, undefined), "text");
assert.equal(announcementCore.resolveAnnouncementContentType("text", undefined), "text");
assert.equal(announcementCore.resolveAnnouncementContentType("voice", validVoice), "voice");
assert.equal(announcementCore.resolveAnnouncementContentType("voice", { ...validVoice, storagePath: "public/message.m4a" }), "text");

const coachHome = read("app", "coach", "index.tsx");
const viewTeamIndex = coachHome.indexOf('label={t("coach.home.viewTeam")}');
const sendTeamMessageIndex = coachHome.indexOf('label={t("coach.home.sendMessage")}');
const privateMessagesIndex = coachHome.indexOf('label={t("teamMessages.title")}');
const resourcesIndex = coachHome.indexOf('label={t("coach.home.resources")}');
assert.ok(viewTeamIndex >= 0 && viewTeamIndex < sendTeamMessageIndex, "View Team must be first");
assert.ok(sendTeamMessageIndex < privateMessagesIndex, "Send Team Message must be second");
assert.ok(privateMessagesIndex < resourcesIndex, "Private Messages must precede Coach Resources when shown");
assert.equal((coachHome.match(/label=\{t\("coach\.home\.viewTeam"\)\}/g) ?? []).length, 1, "View Team must not be duplicated");
assert.match(coachHome, /showPrivateMessages \? <QuickAction/);
assert.match(coachHome, /hasActiveTeam: Boolean\(selectedTeam\)/);
assert.match(coachHome, /loadState: "loading"/);
assert.match(coachHome, /loadState: "error"/);

const inbox = read("app", "coach", "team-messages", "index.tsx");
assert.match(inbox, /teamMessages\.inboxEmptyTitle/);
assert.match(inbox, /teamMessages\.inboxEmptyBody/);
assert.match(inbox, /router\.push\("\/coach\/team"/);

const translations = read("i18n", "index.ts");
assert.equal(translations.includes("title: 'Team Messages'"), false);
assert.equal(translations.includes("title: 'Mensajes del Equipo'"), false);
assert.match(translations, /title: 'Private Messages'/);
assert.match(translations, /title: 'Mensajes Privados'/);
assert.match(translations, /updatedBuildRequired:/);

const teamService = read("services", "teamMessageService.ts");
const parentService = read("services", "parentTeamService.ts");
for (const source of [teamService, parentService]) {
  assert.equal(/where\(["']contentType["']/.test(source), false, "announcement queries must not require contentType");
  assert.match(source, /normalizeVoiceMessageFields/);
  assert.match(source, /orderBy\("createdAt", "desc"\)/);
}
assert.match(teamService, /listenToAnnouncementReplies/);
const parentPageStart = parentService.indexOf("async function loadParentAnnouncementsPage");
const parentPageEnd = parentService.indexOf("type ResolvedMembershipChildren", parentPageStart);
const parentPage = parentService.slice(parentPageStart, parentPageEnd);
assert.ok(parentPageStart >= 0 && parentPageEnd > parentPageStart, "bounded parent announcement loader exists");
assert.match(parentPage, /knownUnreadIds \? Promise\.resolve\(null\) : Promise\.all\(visibleAnnouncements\.map/);
assert.match(parentPage, /isRead: knownUnreadIds \? !knownUnreadIds\.has\(announcement\.id\) : readStates\?\.\[index\]\?\.exists\(\) \?\? false/);
assert.match(parentPage, /snapshot\.docs\.slice\(0, pageSize\)/, "legacy reads and profiles are limited to visible announcements");
assert.match(parentService, /latestAnnouncement: announcements\[0\] \?\? null/);

function resolvePageReadState(announcementIds, summary, legacyReadIds = new Set()) {
  const knownUnreadIds = summary?.available ? new Set(summary.recentUnreadAnnouncementIds) : null;
  return {
    fallbackIds: knownUnreadIds ? [] : [...announcementIds],
    isReadById: new Map(announcementIds.map((id) => [
      id,
      knownUnreadIds ? !knownUnreadIds.has(id) : legacyReadIds.has(id),
    ])),
    unreadCount: summary?.available
      ? summary.unreadCount
      : announcementIds.filter((id) => !legacyReadIds.has(id)).length,
    unreadCountKnown: summary?.available === true || announcementIds.length === 0,
  };
}

const visibleIds = ["new-unread", "new-read", "moderated", "deleted"];
const summaryFirst = resolvePageReadState(visibleIds, {
  available: true,
  recentUnreadAnnouncementIds: ["new-unread", "new-unread"],
  unreadCount: 1,
});
assert.equal(summaryFirst.isReadById.get("new-unread"), false, "known unread content is never marked read");
assert.equal(summaryFirst.isReadById.get("new-read"), true, "absence from an available recent-unread set means read");
assert.equal(summaryFirst.isReadById.get("moderated"), true, "moderation does not bypass summary mapping");
assert.equal(summaryFirst.isReadById.get("deleted"), true, "tombstones retain deterministic read mapping");
assert.deepEqual(summaryFirst.fallbackIds, [], "available summaries avoid legacy per-document reads");
assert.equal(summaryFirst.unreadCount, 1, "duplicate or retried summary entries cannot double-count the authoritative total");

const summaryAfterPage = resolvePageReadState(visibleIds, {
  available: true,
  recentUnreadAnnouncementIds: ["new-unread"],
  unreadCount: 1,
});
assert.deepEqual([...summaryAfterPage.isReadById], [...summaryFirst.isReadById], "summary/page arrival order does not change mapping");

const missingSummary = resolvePageReadState(visibleIds, undefined, new Set(["new-read", "moderated"]));
assert.equal(missingSummary.isReadById.get("new-unread"), false);
assert.equal(missingSummary.isReadById.get("new-read"), true, "legacy read documents remain authoritative during fallback");
assert.equal(missingSummary.isReadById.get("deleted"), false);
assert.deepEqual(missingSummary.fallbackIds, visibleIds, "only the visible page receives fallback work");
assert.equal(missingSummary.unreadCountKnown, false, "a missing summary never silently displays a known zero");

const partiallyBackfilled = resolvePageReadState(visibleIds, {
  available: false,
  recentUnreadAnnouncementIds: ["new-unread"],
  unreadCount: 0,
}, new Set(["new-read"]));
assert.deepEqual(partiallyBackfilled.fallbackIds, visibleIds, "an unavailable partial projection falls back instead of trusting incomplete IDs");
assert.equal(partiallyBackfilled.unreadCountKnown, false);

const archivedPage = resolvePageReadState(["archived-unread"], undefined, new Set());
assert.equal(archivedPage.isReadById.get("archived-unread"), false, "archived history keeps the same legacy compatibility mapping");

const rules = read("firestore.rules");
assert.match(rules, /allow get, list: if canReadTeamAnnouncement\(teamId\)/, "parent and coach announcement access remains Rules-authorized");

const coachComposer = read("app", "coach", "messages.tsx");
const recorder = read("components", "VoiceMemoComposer.tsx");
const player = read("components", "VoiceMemoPlayer.tsx");
assert.match(coachComposer, /useState<"text" \| "voice">\("text"\)/);
assert.match(coachComposer, /\["text", "voice"\]/);
assert.match(coachComposer, /voiceMemo\.updatedBuildRequired/);
assert.match(coachComposer, /disabled=\{nextType === "voice" && !voiceAudioAvailable\}/);
assert.equal(coachComposer.includes("requestRecordingPermissionsAsync"), false, "screen load must not request microphone permission");
assert.match(recorder, /ensureVoiceRecordingPermissionDetails\(audioModule\)/);
assert.ok(recorder.indexOf("ensureVoiceRecordingPermissionDetails(audioModule)") > recorder.indexOf("const startRecording"));
assert.equal(recorder.includes('from "expo-audio"'), false, "old binaries must not evaluate expo-audio on import");
assert.equal(player.includes('from "expo-audio"'), false, "legacy announcement surfaces must not evaluate expo-audio on import");
assert.match(recorder, /isTeamVoiceAudioAvailable/);
assert.match(player, /isTeamVoiceAudioAvailable/);
assert.match(coachComposer, /const \[body, setBody\]/, "text drafts must remain independent of the selected mode");

const privateThread = read("components", "PrivateTeamMessageThread.tsx");
const coachTeam = read("app", "coach", "team.tsx");
assert.match(coachTeam, /teamMessages\.sendPrivateMessage/);
assert.match(coachTeam, /coach\.team\.makeStaff/);
assert.match(coachTeam, /coach\.team\.removeStaffAccess/);
assert.match(coachTeam, /getOrCreatePrivateTeamConversation\(selectedTeam\.id, target\.targetUserId\)/);
assert.match(coachTeam, /router\.push\(`\/coach\/team-messages\/\$\{conversation\.conversationId\}`/);
assert.match(coachTeam, /getCoachRosterActionAvailability/);
assert.match(coachTeam, /<MoreVertical/);
assert.match(coachTeam, /height: 44[\s\S]*width: 44/);
assert.match(coachTeam, /accessibilityLabel=\{t\("coach\.team\.memberActionsTitle"/);
assert.match(coachTeam, /resolveRosterName\(profiles\[member\.userId\], t\)/);
assert.equal(/getCoachRosterActionAvailability\([\s\S]{0,700}profile/.test(coachTeam), false, "name hydration must not control roster actions");
assert.match(privateThread, /teamPrivateConversations|listenToPrivateTeamConversation/);
assert.equal(privateThread.includes("friendConversations"), false);
assert.match(privateThread, /sendPrivateTeamTextMessage/);
assert.match(privateThread, /<VoiceMemoComposer/);
assert.match(privateThread, /reserveVoiceUpload/);
assert.match(privateThread, /finalizePrivateVoiceMessage/);
assert.match(privateThread, /<VoiceMemoPlayer/);

assert.match(translations, /makeStaff: 'Make Staff'/);
assert.match(translations, /removeStaffAccess: 'Remove Staff Access'/);
assert.match(translations, /sendPrivateMessage: 'Send Private Message'/);
assert.match(translations, /makeStaff: 'Hacer parte del staff'/);
assert.match(translations, /removeStaffAccess: 'Quitar acceso de staff'/);
assert.match(translations, /sendPrivateMessage: 'Enviar Mensaje Privado'/);

const functionsSource = read("functions", "src", "index.ts");
assert.match(functionsSource, /storedPath\.startsWith\(`teamVoiceMemos\/\$\{teamId\}\/announcements\/`\)/);
assert.equal(/cleanupAbandonedTeamVoiceUploads[\s\S]{0,1400}collection\('teams'\)/.test(functionsSource), false, "voice cleanup must not delete announcement documents");

console.log("Coach communication card order, terminology, legacy announcements, and safe audio capability regressions passed.");
