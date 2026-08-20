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
  "export function listenToNewestPrivateTeamMessagesPage",
  "export async function markPrivateTeamConversationRead",
);
assert.match(listener, /hiddenMessages/);
assert.match(listener, /canonicalMessages: TeamPrivateMessage\[\] = \[\]/);
assert.match(listener, /receivedHiddenChunks\.size !== hiddenIdsByChunk\.size/);
assert.match(listener, /canonicalMessages\.filter\(\(message\) => !hiddenMessageIds\.has\(message\.id\)\)/);
assert.ok(
  listener.indexOf("receivedHiddenChunks.size !== hiddenIdsByChunk.size") < listener.indexOf("onValue({ messages"),
  "canonical messages cannot publish before every hidden-ID chunk is ready",
);
assert.ok(
  listener.indexOf("hiddenIdsByChunk = new Map()") < listener.indexOf("canonicalMessages = snapshot.docs.slice"),
  "reconnect snapshots reset hidden state before replacing canonical messages",
);
assert.match(listener, /if \(chunks\.length === 0\) \{\s*publishVisibleMessages\(\)/, "empty conversations resolve as a loaded empty page");
assert.match(listener, /hiddenUnsubscribes\.forEach\(\(unsubscribe\) => unsubscribe\(\)\)/, "old hidden listeners are retired on snapshot replacement and cleanup");
assert.match(service, /functions, "hidePrivateTeamMessageForCurrentUser"/);

function createVisibilityGate() {
  let generation = 0;
  let canonicalMessages = [];
  let hiddenIdsByChunk = new Map();
  let receivedHiddenChunks = new Set();
  const emitted = [];
  return {
    replace(messages, chunkCount) {
      generation += 1;
      canonicalMessages = messages;
      hiddenIdsByChunk = new Map(Array.from({ length: chunkCount }, (_, index) => [index, new Set()]));
      receivedHiddenChunks = new Set();
      if (chunkCount === 0) emitted.push([]);
      return generation;
    },
    receiveHidden(resultGeneration, chunkIndex, ids) {
      if (resultGeneration !== generation || !hiddenIdsByChunk.has(chunkIndex)) return;
      hiddenIdsByChunk.set(chunkIndex, new Set(ids));
      receivedHiddenChunks.add(chunkIndex);
      if (receivedHiddenChunks.size !== hiddenIdsByChunk.size) return;
      const hidden = new Set([...hiddenIdsByChunk.values()].flatMap((idsForChunk) => [...idsForChunk]));
      emitted.push(canonicalMessages.filter((message) => !hidden.has(message.id)));
    },
    emitted,
  };
}

const visibility = createVisibilityGate();
const startup = visibility.replace([{ id: "visible" }, { id: "hidden" }], 2);
assert.deepEqual(visibility.emitted, [], "an initial empty canonical container is not a loaded visibility result");
visibility.receiveHidden(startup, 0, ["hidden"]);
assert.deepEqual(visibility.emitted, [], "partial hidden hydration cannot flash canonical content");
visibility.receiveHidden(startup, 1, []);
assert.deepEqual(visibility.emitted, [[{ id: "visible" }]]);

const reconnect = visibility.replace([{ id: "next-visible" }, { id: "next-hidden" }], 1);
assert.equal(visibility.emitted.length, 1, "reconnect resets do not publish before new hidden state arrives");
visibility.receiveHidden(startup, 0, []);
assert.equal(visibility.emitted.length, 1, "stale listener results cannot restore hidden content");
visibility.receiveHidden(reconnect, 0, ["next-hidden"]);
assert.deepEqual(visibility.emitted.at(-1), [{ id: "next-visible" }]);

visibility.replace([], 0);
assert.deepEqual(visibility.emitted.at(-1), [], "empty conversations reach a valid loaded state");

function filterOlderPage(messages, hiddenIds) {
  return messages.filter((message) => !hiddenIds.has(message.id));
}
assert.deepEqual(
  filterOlderPage([{ id: "older-visible" }, { id: "older-hidden" }], new Set(["older-hidden"])),
  [{ id: "older-visible" }],
  "older pages are filtered before they are returned for display",
);
const olderPage = callableSlice(service, "export async function getOlderPrivateTeamMessagesPage", "export async function getPrivateTeamMessage");
assert.ok(olderPage.indexOf("await getHiddenMessageIds") < olderPage.indexOf("return {"));
assert.match(olderPage, /messages: canonicalMessages\.filter\(\(message\) => !hiddenMessageIds\.has\(message\.id\)\)/);

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
assert.match(thread, /const generation = \+\+paginationGeneration\.current/);
assert.match(thread, /setOlderMessages\(\[\]\);[\s\S]*setMessages\(\[\]\);[\s\S]*setHistoryCursor\(null\)/, "conversation/account route changes clear prior canonical and paginated state");
assert.match(thread, /if \(generation !== paginationGeneration\.current\) return;/, "stale newest and older page results are ignored");

assert.match(rules, /isPrivateTeamConversationParticipant\(conversationId\)/, "sign-out, restriction, or membership removal blocks hidden and canonical reads through authorization");
assert.match(thread, /readOnly = conversation\?\.status === "readOnly"/);

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
