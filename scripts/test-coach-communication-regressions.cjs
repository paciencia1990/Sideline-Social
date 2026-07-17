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
assert.equal(coachCore.shouldShowPrivateMessagesCard({ conversationCount: 0, loadState: "loading", unreadCount: 0 }), false);
assert.equal(coachCore.shouldShowPrivateMessagesCard({ conversationCount: 0, loadState: "loaded", unreadCount: 0 }), false);
assert.equal(coachCore.shouldShowPrivateMessagesCard({ conversationCount: 1, loadState: "loaded", unreadCount: 0 }), true);
assert.equal(coachCore.shouldShowPrivateMessagesCard({ conversationCount: 0, loadState: "loaded", unreadCount: 2 }), true);
assert.equal(coachCore.shouldShowPrivateMessagesCard({ conversationCount: 1, loadState: "error", unreadCount: 1 }), false);

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
  assert.match(source, /resolveAnnouncementContentType/);
  assert.match(source, /orderBy\("createdAt", "desc"\)/);
}
assert.match(teamService, /listenToAnnouncementReplies/);
assert.match(parentService, /isRead: readStates\[index\]\?\.exists\(\)/);
assert.match(parentService, /latestAnnouncement: announcements\[0\] \?\? null/);

const coachComposer = read("app", "coach", "messages.tsx");
const recorder = read("components", "VoiceMemoComposer.tsx");
const player = read("components", "VoiceMemoPlayer.tsx");
assert.match(coachComposer, /useState<"text" \| "voice">\("text"\)/);
assert.match(coachComposer, /\["text", "voice"\]/);
assert.match(coachComposer, /voiceMemo\.updatedBuildRequired/);
assert.match(coachComposer, /disabled=\{nextType === "voice" && !voiceAudioAvailable\}/);
assert.equal(coachComposer.includes("Audio.requestPermissionsAsync"), false, "screen load must not request microphone permission");
assert.match(recorder, /Audio\.requestPermissionsAsync\(\)/);
assert.ok(recorder.indexOf("Audio.requestPermissionsAsync()") > recorder.indexOf("const startRecording"));
assert.equal(recorder.includes('from "expo-av"'), false, "old binaries must not evaluate expo-av on import");
assert.equal(player.includes('from "expo-av"'), false, "legacy announcement surfaces must not evaluate expo-av on import");
assert.match(recorder, /isTeamVoiceAudioAvailable/);
assert.match(player, /isTeamVoiceAudioAvailable/);
assert.match(coachComposer, /const \[body, setBody\]/, "text drafts must remain independent of the selected mode");

const privateThread = read("components", "PrivateTeamMessageThread.tsx");
const coachTeam = read("app", "coach", "team.tsx");
assert.match(coachTeam, /teamMessages\.sendPrivateMessage/);
assert.match(privateThread, /teamPrivateConversations|listenToPrivateTeamConversation/);
assert.equal(privateThread.includes("friendConversations"), false);

const functionsSource = read("functions", "src", "index.ts");
assert.match(functionsSource, /storedPath\.startsWith\(`teamVoiceMemos\/\$\{teamId\}\/announcements\/`\)/);
assert.equal(/cleanupAbandonedTeamVoiceUploads[\s\S]{0,1400}collection\('teams'\)/.test(functionsSource), false, "voice cleanup must not delete announcement documents");

console.log("Coach communication card order, terminology, legacy announcements, and safe audio capability regressions passed.");
