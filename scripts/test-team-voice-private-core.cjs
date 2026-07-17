const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function read(...segments) { return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8"); }
function loadTypeScript(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(require, loaded, loaded.exports);
  return loaded.exports;
}

const core = loadTypeScript("functions/src/teamVoiceMessagingCore.ts");
assert.equal(core.TEAM_VOICE_MAX_DURATION_MS, 90000);
assert.equal(core.TEAM_VOICE_MAX_SIZE_BYTES, 2 * 1024 * 1024);
assert.deepEqual(core.validateVoiceMemoMetadata({ durationMilliseconds: 30000, sizeBytes: 240000, mimeType: "audio/mp4" }), {
  durationMilliseconds: 30000, sizeBytes: 240000, mimeType: "audio/mp4",
});
assert.throws(() => core.validateVoiceMemoMetadata({ durationMilliseconds: 90001, sizeBytes: 1, mimeType: "audio/mp4" }), /recording_too_long/);
assert.throws(() => core.validateVoiceMemoMetadata({ durationMilliseconds: 1000, sizeBytes: 2 * 1024 * 1024 + 1, mimeType: "audio/mp4" }), /voice_file_too_large/);
assert.throws(() => core.validateVoiceMemoMetadata({ durationMilliseconds: 1000, sizeBytes: 10, mimeType: "audio/mpeg" }), /unsupported_audio_type/);

const firstConversation = core.teamPrivateConversationId("team", "coach", "parent");
assert.equal(firstConversation, core.teamPrivateConversationId("team", "coach", "parent"));
assert.notEqual(firstConversation, core.teamPrivateConversationId("team", "coach", "other-parent"));
assert.equal(core.teamPrivateMessageId(firstConversation, "coach", "client_1"), core.teamPrivateMessageId(firstConversation, "coach", "client_1"));
assert.notEqual(core.teamPrivateMessageId(firstConversation, "coach", "client_1"), core.teamPrivateMessageId(firstConversation, "coach", "client_2"));
assert.equal(core.teamVoiceStoragePath({ teamId: "team", announcementId: "announcement", reservationId: "reservation" }), "teamVoiceMemos/team/announcements/announcement/reservation/memo.m4a");
assert.equal(core.teamVoiceStoragePath({ teamId: "team", conversationId: "conversation", messageId: "message", reservationId: "reservation" }), "teamVoiceMemos/team/privateConversations/conversation/message/reservation/memo.m4a");

const participants = { participantUserIds: ["coach", "parent"], coachUserId: "coach", parentUserId: "parent" };
assert.equal(core.isExplicitConversationParticipant(participants, "coach"), true);
assert.equal(core.isExplicitConversationParticipant(participants, "parent"), true);
assert.equal(core.isExplicitConversationParticipant(participants, "outsider"), false);
assert.equal(core.isExplicitConversationParticipant({ ...participants, participantUserIds: ["coach", "parent", "outsider"] }, "coach"), false);
assert.equal(core.shouldReceiveAnnouncement({ status: "active", roles: { parent: true } }, "parents"), true);
assert.equal(core.shouldReceiveAnnouncement({ status: "active", roles: { coach: true } }, "staff"), true);
assert.equal(core.shouldReceiveAnnouncement({ status: "removed", roles: { parent: true } }, "all"), false);
assert.equal(core.privateMessagePreview("voice", undefined, 32000), "voice:32000");
assert.equal(core.privateMessagePreview("text", "  hello   team  "), "hello team");

const recorder = read("components", "VoiceMemoComposer.tsx");
const player = read("components", "VoiceMemoPlayer.tsx");
const service = read("services", "teamPrivateMessageService.ts");
const coachComposer = read("app", "coach", "messages.tsx");
const privateThread = read("components", "PrivateTeamMessageThread.tsx");
const rules = read("firestore.rules");
const storageRules = read("storage.rules");
for (const required of ["Audio.requestPermissionsAsync", "MAX_DURATION_MS = 90_000", "MAX_SIZE_BYTES = 2 * 1024 * 1024", "AppState.addEventListener", "previewed: false", "deleteLocalVoiceMemo"]) assert.equal(recorder.includes(required), true, required);
assert.equal(recorder.includes('from "expo-av"'), false, "expo-av must load only after native capability detection");
assert.equal(player.includes('from "expo-av"'), false, "announcement surfaces must remain safe in old binaries");
assert.equal(player.includes("shouldPlay: true"), true);
assert.equal(player.includes("activateVoicePlayback"), true);
assert.equal(player.includes("useFocusEffect"), true);
assert.equal(service.includes("uploadBytesResumable"), true);
assert.equal(service.includes("getTeamVoiceMemoDownloadUrl"), true);
assert.equal(coachComposer.includes("confirmVoiceTitle"), true);
assert.equal(privateThread.includes("createClientMessageId"), true);
assert.equal(rules.includes("match /teamPrivateConversations/{conversationId}"), true);
assert.equal(storageRules.includes("request.resource.size == upload.voiceMemo.sizeBytes"), true);
assert.equal(storageRules.includes("allow read, update, delete: if false"), true);
assert.equal(read("functions", "src", "index.ts").includes("status: 'deletePending'"), true);

console.log("Team voice/private core limits, determinism, privacy, recorder, playback, and upload contract tests passed.");
