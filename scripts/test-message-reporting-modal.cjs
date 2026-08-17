const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

const modal = read("components", "MessageActionsModal.tsx");
assert.match(modal, /<Modal/);
assert.match(modal, /allowSwipeDismissal/);
assert.match(modal, /onRequestClose=\{dismiss\}/);
assert.match(modal, /onPress=\{dismiss\}[\s\S]*styles\.backdropDismiss/);
assert.match(modal, /accessibilityViewIsModal/);
assert.match(modal, /accessibilityRole="radio"/);
assert.match(modal, /setReason\(option\)/);
assert.match(modal, /onPress=\{\(\) => \{ void submitReport\(\); \}\}/);
assert.match(modal, /if \(!report \|\| !reason \|\| submitting\) return/);
assert.match(modal, /setSubmitting\(true\)/);
assert.match(modal, /setError\(report\.errorMessage\)/);
assert.match(modal, /accessibilityLiveRegion="assertive"/);
assert.match(modal, /moderation\.close/);
assert.match(modal, /common\.cancel/g);
assert.doesNotMatch(modal, /const dismiss = \(\) => \{\s*if \(submitting\) return/);
assert.doesNotMatch(modal, /onPress=\{\(\) => void report\.onSubmit\(option\)/);

const privateThread = read("components", "PrivateTeamMessageThread.tsx");
const parentThread = read("app", "teams", "[teamId]", "announcements", "[announcementId].tsx");
const coachThread = read("app", "coach", "messages", "[announcementId].tsx");
const friendThread = read("app", "(social)", "chat", "[chatId].tsx");
for (const [name, source] of [
  ["private Team", privateThread],
  ["parent announcements", parentThread],
  ["coach announcements", coachThread],
]) {
  assert.match(source, /MessageActionsModal/, `${name} uses the shared actions modal`);
  assert.match(source, /More(?:Horizontal|Vertical)/, `${name} has an explicit overflow control`);
  assert.match(source, /teamMessages\.messageActions/, `${name} localizes the accessibility label`);
  assert.doesNotMatch(source, /showContentReportPrompt/, `${name} does not use the native reason alert`);
}
assert.match(friendThread, /MessageActionsModal/, "Friend Chat keeps the shared actions modal available for delete/report actions");
assert.match(friendThread, /FriendChatReactionTray/, "Friend Chat uses the floating reaction tray instead of a permanent bubble overflow button");
assert.match(friendThread, /FriendChatSelectionOverflowMenu/, "Friend Chat uses selection mode for expanded message actions");
assert.match(friendThread, /onLongPress=\{openReactionTray\}/, "Friend Chat opens reactions from a deliberate long press");
assert.match(friendThread, /name: "more"/, "Friend Chat exposes More message actions as an accessibility action");
assert.match(friendThread, /setActionMessage\(selectedMessages\[0\]\)/, "Friend Chat selection overflow can report the selected incoming message");
assert.doesNotMatch(friendThread, /style=\{styles\.messageMenu\}/, "Friend Chat no longer renders a permanent per-message overflow button");
assert.doesNotMatch(parentThread, /reportButton/);
assert.match(friendThread, /Alert\.alert\(t\("chat\.photoSavedTitle"\)/, "native alerts are limited to explicit Save Photo feedback, not report reason selection");
assert.match(friendThread, /reportFriendChatMessage\(reportAction\.chatId, reportAction\.messageId, reason\)/);
assert.match(privateThread, /report=\{!selectedMine/);
assert.match(parentThread, /report=\{actionTarget && !actionTarget\.mine/);
assert.match(coachThread, /report=\{actionTarget && !actionTarget\.mine/);

const friendFunction = read("functions", "src", "friendChat.ts");
const reportStart = friendFunction.indexOf("export const reportFriendChatMessage");
const reportSlice = friendFunction.slice(reportStart, friendFunction.indexOf("async function assertActiveMember", reportStart));
assert.match(reportSlice, /reason = data\?\.reason == null[\s\S]*\? 'other'/);
assert.match(reportSlice, /reason, reportType: 'message'/);
assert.match(reportSlice, /assertActiveMember\(conversationId, uid\)/);
assert.match(reportSlice, /visibleToUserIds/);

const translations = read("i18n", "index.ts");
for (const expected of [
  "messageActions: 'Message Actions'",
  "reportMessage: 'Report Message'",
  "reportQuestion: 'Why are you reporting this message?'",
  "submitReport: 'Submit Report'",
  "submitting: 'Submitting'",
  "privacy: 'Private or child information'",
  "harassment: 'Harassment or threats'",
  "offensive: 'Offensive content'",
  "other: 'Other'",
  "messageActions: 'Acciones del mensaje'",
  "reportMessage: 'Reportar mensaje'",
  "reportQuestion: '\\u00bfPor qu\\u00e9 reportas este mensaje?'",
  "submitReport: 'Enviar reporte'",
]) {
  assert.equal(translations.includes(expected), true, `${expected} is localized`);
}

assert.equal(fs.existsSync(path.join(process.cwd(), "utils", "contentReporting.ts")), false);
console.log("Explicit Message Actions, two-step report submission, dismissal, recovery, and localization contract tests passed.");
