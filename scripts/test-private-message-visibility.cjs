const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

function callableSlice(source, startName, endName) {
  const start = source.indexOf(startName);
  const end = source.indexOf(endName, start + startName.length);
  assert.notEqual(start, -1, `${startName} exists`);
  assert.notEqual(end, -1, `${endName} exists after ${startName}`);
  return source.slice(start, end);
}

const functionsSource = read("functions", "src", "index.ts");
const hideCallable = callableSlice(
  functionsSource,
  "export const hidePrivateTeamMessageForCurrentUser",
  "export const markPrivateTeamConversationRead",
);
assert.match(hideCallable, /context\.auth\?\.uid/);
assert.match(hideCallable, /isExplicitConversationParticipant\(conversation, uid\)/);
assert.match(hideCallable, /memberRef\.collection\('hiddenMessages'\)\.doc\(messageId\)/);
assert.match(hideCallable, /message\.senderUserId === uid/);
assert.match(hideCallable, /not_message_recipient/);
assert.match(hideCallable, /transaction\.create\(hiddenRef/);
assert.match(hideCallable, /let status: 'hidden' \| 'alreadyHidden' = 'alreadyHidden'/);
assert.match(hideCallable, /if \(existingHiddenSnapshot\.exists\) return/);
assert.match(hideCallable, /status = 'hidden'/);
assert.match(hideCallable, /Math\.max\(0, Number\(member\.unreadCount \?\? 0\) - \(hidesUnreadMessage \? 1 : 0\)\)/);
assert.match(hideCallable, /privateMemberPreviewFields/);
assert.doesNotMatch(hideCallable, /data\?\.(?:target|user|participant)UserId/);
assert.doesNotMatch(hideCallable, /transaction\.(?:update|delete)\(messageRef/);
assert.doesNotMatch(hideCallable, /deleteTeamVoiceStorageObject/);

const globalDelete = callableSlice(
  functionsSource,
  "export const deletePrivateTeamMessage",
  "export const hidePrivateTeamMessageForCurrentUser",
);
assert.match(globalDelete, /message\.senderUserId !== uid/);
assert.match(globalDelete, /isDeleted: true/);
assert.match(globalDelete, /deleteTeamVoiceStorageObject/);
assert.match(globalDelete, /collection\('hiddenMessages'\)/);
assert.match(globalDelete, /privateMemberPreviewFields/);

const playbackCallable = callableSlice(
  functionsSource,
  "export const getTeamVoiceMemoDownloadUrl",
  "export const streamTeamVoiceMemo",
);
assert.match(playbackCallable, /collection\('hiddenMessages'\)\.doc\(reservation\.targetId\)/);
assert.match(playbackCallable, /hiddenSnapshot\.exists/);
const streamAuthorization = functionsSource.slice(functionsSource.indexOf("async function canStreamGrantedTeamVoiceMemo"));
assert.match(streamAuthorization, /collection\('hiddenMessages'\)\.doc\(storageReference\.messageId\)/);
assert.match(streamAuthorization, /!hiddenSnapshot\.exists/);

const service = read("services", "teamPrivateMessageService.ts");
const listener = callableSlice(
  service,
  "export function listenToPrivateTeamMessages",
  "export async function markPrivateTeamConversationRead",
);
assert.match(listener, /hiddenMessages/);
assert.match(listener, /canonicalMessages: TeamPrivateMessage\[\] \| null = null/);
assert.match(listener, /hiddenMessageIds: Set<string> \| null = null/);
assert.match(listener, /if \(!canonicalMessages \|\| !hiddenMessageIds\) return/);
assert.match(listener, /filter\(\(message\) => !hiddenMessageIds\?\.has\(message\.id\)\)/);
assert.match(service, /functions, "hidePrivateTeamMessageForCurrentUser"/);

const rules = read("firestore.rules");
const hiddenRules = rules.slice(rules.indexOf("match /hiddenMessages/{messageId}"));
assert.match(hiddenRules, /allow get, list: if isSelf\(userId\)/);
assert.match(hiddenRules, /isPrivateTeamConversationParticipant\(conversationId\)/);
assert.match(hiddenRules, /allow create, update, delete: if false/);

const thread = read("components", "PrivateTeamMessageThread.tsx");
assert.match(thread, /deleteForEveryone/);
assert.match(thread, /deleteForMe/);
assert.match(thread, /hidePrivateTeamMessageForCurrentUser/);
assert.match(thread, /clearPersistedVoicePlaybackArtifacts/);
assert.match(thread, /message\.senderUserId === auth\.currentUser\?\.uid/);

const cleanupService = read("services", "voicePlaybackCleanupService.ts");
assert.match(cleanupService, /stopVoicePlaybackForSource/);
assert.match(cleanupService, /invalidateVoicePlaybackSource/);
assert.match(cleanupService, /takeVoicePlaybackMediaFiles/);
assert.doesNotMatch(cleanupService, /deleteTeamVoiceStorageObject|deletePrivateTeamMessage/);

const mediaSource = ts.transpileModule(read("utils", "voicePlaybackMediaCache.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", mediaSource)(require, loaded, loaded.exports);
const media = loaded.exports;
assert.equal(media.registerVoicePlaybackMediaFile("source-a", "https://example.test/audio.m4a"), false);
assert.equal(media.registerVoicePlaybackMediaFile("source-a", "file:///cache/a.m4a"), true);
assert.equal(media.registerVoicePlaybackMediaFile("source-a", "cache:/b.m4a"), true);
assert.equal(media.registerVoicePlaybackMediaFile("source-a", "file:///cache/a.m4a"), true);
assert.deepEqual(media.takeVoicePlaybackMediaFiles("source-a").sort(), [
  "cache:/b.m4a",
  "file:///cache/a.m4a",
]);
assert.deepEqual(media.takeVoicePlaybackMediaFiles("source-a"), []);

const translations = read("i18n", "index.ts");
for (const expected of [
  "deleteForEveryone: 'Delete for Everyone'",
  "deleteForMe: 'Delete for Me'",
  "deleteForEveryoneTitle: 'Delete for everyone?'",
  "deleteForMeTitle: 'Delete for you?'",
  "deleteForEveryone: 'Eliminar para todos'",
  "deleteForMe: 'Eliminar para m\\u00ed'",
  "deleteForEveryoneTitle: '\\u00bfEliminar para todos?'",
  "deleteForMeTitle: '\\u00bfEliminar para ti?'",
]) {
  assert.equal(translations.includes(expected), true, `${expected} is localized`);
}

console.log("Trusted per-user private-message visibility, preview/unread, playback revocation, and local media-cache tests passed.");
