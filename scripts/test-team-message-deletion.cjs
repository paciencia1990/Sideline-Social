const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

const functionsSource = read("functions", "src", "index.ts");
const privateDelete = functionsSource.slice(
  functionsSource.indexOf("export const deletePrivateTeamMessage"),
  functionsSource.indexOf("export const markPrivateTeamConversationRead"),
);
assert.match(privateDelete, /context\.auth\?\.uid/);
assert.match(privateDelete, /message\.senderUserId !== uid/);
assert.doesNotMatch(privateDelete, /data\?\.senderUserId|data\?\.storagePath/);
assert.match(privateDelete, /isExplicitConversationParticipant\(conversation, uid\)/);
assert.match(privateDelete, /transaction\.update\(messageRef/);
assert.match(privateDelete, /isDeleted: true/);
assert.match(privateDelete, /text: null/);
assert.match(privateDelete, /caption: null/);
assert.match(privateDelete, /voiceMemo: null/);
assert.match(privateDelete, /lastMessagePreview/);
assert.match(privateDelete, /deleteTeamVoiceStorageObject/);
assert.doesNotMatch(privateDelete, /notifyPrivateTeamMessage|createPersonalNotificationAndPush/);

const announcementDelete = functionsSource.slice(
  functionsSource.indexOf("export const deleteTeamAnnouncement ="),
  functionsSource.indexOf("export const createTeamAnnouncementReply"),
);
assert.match(announcementDelete, /canManageTeamAnnouncements\(member\)/);
assert.match(announcementDelete, /transaction\.update\(announcementRef/);
assert.match(announcementDelete, /isDeleted: true/);
assert.match(announcementDelete, /title: null/);
assert.match(announcementDelete, /body: null/);
assert.match(announcementDelete, /voiceMemo: null/);
assert.doesNotMatch(announcementDelete, /transaction\.delete\(announcementRef\)/);

const replyDelete = functionsSource.slice(
  functionsSource.indexOf("export const deleteTeamAnnouncementReply"),
  functionsSource.indexOf("function readReplyPathId"),
);
assert.match(replyDelete, /canDeleteTeamAnnouncementReply\(uid, member/);
assert.match(replyDelete, /transaction\.update\(replyRef/);
assert.match(replyDelete, /body: null/);
assert.match(replyDelete, /isDeleted: true/);
assert.doesNotMatch(replyDelete, /transaction\.delete\(replyRef\)/);

assert.match(functionsSource, /messageSnapshot\.data\(\)\?\.isDeleted === true/);
assert.match(functionsSource, /announcement\?\.isDeleted === true/);
assert.match(functionsSource, /reservation\?\.status !== 'finalized'/);
assert.match(functionsSource, /status: 'deletePending'/);
assert.match(functionsSource, /ignoreNotFound: true/);

const privateThread = read("components", "PrivateTeamMessageThread.tsx");
assert.match(privateThread, /message\.senderUserId === auth\.currentUser\?\.uid/);
assert.match(privateThread, /\(mine \? !message\.isDeleted : true\)/);
assert.match(privateThread, /deleteInFlight\.current/);
assert.match(privateThread, /deletePrivateTeamMessage\(conversationId, message\.id\)/);
assert.match(privateThread, /hidePrivateTeamMessageForCurrentUser\(conversationId, message\.id\)/);
assert.match(privateThread, /clearPersistedVoicePlaybackArtifacts/);
assert.match(privateThread, /teamMessages\.deleteForEveryoneTitle/);
assert.match(privateThread, /teamMessages\.deleteForMeTitle/);
assert.match(privateThread, /teamMessages\.messageDeleted/);
assert.match(privateThread, /teamMessages\.youDeletedMessage/);
assert.match(privateThread, /MessageActionsModal/);

const messageService = read("services", "teamPrivateMessageService.ts");
assert.match(messageService, /functions, "deletePrivateTeamMessage"/);
assert.match(messageService, /isDeleted: data\.isDeleted === true/);
assert.match(messageService, /deletedBy:/);

const announcementService = read("services", "teamMessageService.ts");
assert.match(announcementService, /isDeleted: data\.isDeleted === true/g);
assert.match(announcementService, /deletedBy:/g);

const translations = read("i18n", "index.ts");
for (const value of [
  "deleteMessage: 'Delete Message'",
  "deleteConfirmTitle: 'Delete this message?'",
  "deleteConfirmBody: 'This will remove it for everyone in this conversation.'",
  "deleteForEveryone: 'Delete for Everyone'",
  "deleteForMe: 'Delete for Me'",
  "deleteForEveryoneTitle: 'Delete for everyone?'",
  "deleteForMeTitle: 'Delete for you?'",
  "messageDeleted: 'Message deleted'",
  "youDeletedMessage: 'You deleted this message'",
  "deleteMessage: 'Eliminar mensaje'",
  "deleteForEveryone: 'Eliminar para todos'",
  "deleteForMe: 'Eliminar para m\\u00ed'",
  "deleteConfirmTitle: '\\u00bfEliminar este mensaje?'",
  "messageDeleted: 'Mensaje eliminado'",
  "youDeletedMessage: 'Eliminaste este mensaje'",
]) {
  assert.equal(translations.includes(value), true, `${value} is localized`);
}

console.log("Global deletion tombstones plus participant-scoped hiding, voice cleanup, previews, UI actions, and localization contract tests passed.");
