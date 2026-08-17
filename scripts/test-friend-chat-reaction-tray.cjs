const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.ok(startIndex >= 0, `missing ${start}`);
  assert.ok(endIndex > startIndex, `missing ${end} after ${start}`);
  return source.slice(startIndex, endIndex);
}

const chatScreen = read("app", "(social)", "chat", "[chatId].tsx");
const reactionTray = read("components", "FriendChatReactionTray.tsx");
const expandedPicker = read("components", "FriendChatExpandedReactionPicker.tsx");
const overflowMenu = read("components", "FriendChatSelectionOverflowMenu.tsx");
const imageMessage = read("components", "FriendChatImageMessage.tsx");
const voicePlayer = read("components", "VoiceMemoPlayer.tsx");
const service = read("services", "chatService.ts");
const functionsSource = read("functions", "src", "friendChat.ts");
const rules = read("firestore.rules");
const translations = read("i18n", "index.ts");
const messageBubble = sourceBetween(chatScreen, "function MessageBubble({", "function quotePreview");

assert.match(service, /FRIEND_CHAT_QUICK_REACTIONS/);
assert.match(service, /FRIEND_CHAT_REACTIONS = \[\s*\.\.\.FRIEND_CHAT_QUICK_REACTIONS/u);
assert.match(service, /FRIEND_CHAT_FORWARD_MAX_DESTINATIONS = 3/);
assert.match(service, /setFriendChatMessagesStarred/);
assert.match(service, /deleteFriendChatMessagesForMe/);
assert.match(service, /forwardFriendChatMessages/);
assert.match(service, /pinFriendChatMessage/);
assert.match(service, /unpinFriendChatMessage/);
assert.match(service, /subscribeToStarredFriendChatMessages/);
assert.match(service, /loadOwnMessageStates/);
assert.match(service, /replyToMessageId/);
assert.match(service, /hiddenForMe/);
assert.match(service, /starredBySelf/);

assert.match(functionsSource, /FRIEND_CHAT_FORWARD_COOLDOWN_MS/);
assert.match(functionsSource, /FRIEND_CHAT_FORWARD_MAX_DESTINATIONS/);
assert.match(functionsSource, /FRIEND_CHAT_PIN_DURATIONS/);
assert.match(functionsSource, /resolveReplyContext/);
assert.match(functionsSource, /userMessageStateRef/);
assert.match(functionsSource, /forwardRateRef/);
assert.match(functionsSource, /export const setFriendChatMessagesStarred/);
assert.match(functionsSource, /export const deleteFriendChatMessagesForMe/);
assert.match(functionsSource, /export const forwardFriendChatMessages/);
assert.match(functionsSource, /export const pinFriendChatMessage/);
assert.match(functionsSource, /export const unpinFriendChatMessage/);
assert.doesNotMatch(functionsSource, /messageData\?\.messageType === 'image' \|\| messageData\?\.messageType === 'voice'/, "secure image forwarding replaces the old blanket media rejection");
assert.match(functionsSource, /message\?\.messageType === 'voice' \|\| message\?\.messageType === 'system'/, "voice forwarding remains disabled");
assert.match(functionsSource, /loadForwardImageBytes/);
assert.match(functionsSource, /forwarded: true/);
assert.match(functionsSource, /replyTo/);

assert.match(rules, /match \/userMessageStates\/\{userId\}\/messages\/\{messageId\}/);
assert.match(rules, /request\.auth\.uid == userId/);
assert.match(rules, /allow create, update, delete: if false/);
assert.match(rules, /match \/friendChatForwardRateLimits\/\{userHash\}/);

assert.match(chatScreen, /import \* as Haptics from "expo-haptics"/);
assert.match(chatScreen, /FriendChatReactionTray/);
assert.match(chatScreen, /FriendChatExpandedReactionPicker/);
assert.match(chatScreen, /FriendChatSelectionOverflowMenu/);
assert.match(chatScreen, /ForwardMessagesSheet/);
assert.match(chatScreen, /type ReactionTrayState = \{ anchor: FriendChatReactionTrayAnchor; messageId: string \}/);
assert.match(chatScreen, /selectedMessageIds/);
assert.match(chatScreen, /selectionMode/);
assert.match(chatScreen, /BackHandler\.addEventListener\("hardwareBackPress"/);
assert.match(chatScreen, /setSelectedMessageIds\(\[message\.messageId\]\)/);
assert.match(chatScreen, /void Haptics\.selectionAsync\(\)\.catch\(\(\) => undefined\)/);
assert.match(chatScreen, /reactionSubmittingRef\.current/);
assert.match(chatScreen, /await toggleFriendChatReaction\(chatId, messageId, emoji\)/);
assert.match(chatScreen, /options=\{FRIEND_CHAT_QUICK_REACTIONS\}/);
assert.match(chatScreen, /onMore=\{\(\) => setReactionPickerVisible\(true\)\}/);
assert.match(chatScreen, /categories=\{reactionCategories\}/);
assert.doesNotMatch(chatScreen, /openMessageActionsFromTray/);
assert.doesNotMatch(chatScreen, /Clipboard/);

assert.match(messageBubble, /<Pressable/);
assert.match(messageBubble, /onLongPress=\{openReactionTray\}/);
assert.match(messageBubble, /delayLongPress=\{360\}/);
assert.match(messageBubble, /measureInWindow\(\(x, y, width, height\) =>/);
assert.match(messageBubble, /accessibilityActions=\{interactive/);
assert.match(messageBubble, /name: "select"/);
assert.match(messageBubble, /name: "react"/);
assert.match(messageBubble, /name: "more"/);
assert.match(messageBubble, /onPress=\{selectionMode \? \(\) => onToggleSelection\(message\) : undefined\}/);
assert.match(messageBubble, /styles\.dimmedMessage/);
assert.match(messageBubble, /styles\.selectedBubble/);
assert.match(messageBubble, /message\.forwarded/);
assert.match(messageBubble, /message\.replyTo/);
assert.match(messageBubble, /quotePreview\(message\.replyTo, t\)/);
assert.match(messageBubble, /reactionSummary/);
assert.match(messageBubble, /styles\.reactionChipSelected/);
assert.doesNotMatch(messageBubble, /numberOfLines=\{1\}[\s\S]*message\.text/u, "text messages must not be line-limited");
assert.doesNotMatch(chatScreen, /messageMenu:/);

assert.match(chatScreen, /setFriendChatMessagesStarred\(chatId, selectedMessages\.map/);
assert.match(chatScreen, /deleteFriendChatMessagesForMe\(chatId, otherMessages\.map/);
assert.match(chatScreen, /removeOwnFriendChatMessage\(chatId, message\.messageId\)/);
assert.match(chatScreen, /forwardFriendChatMessages\([\s\S]*clientForwardId/u);
assert.match(chatScreen, /pinFriendChatMessage\(chatId, message\.messageId, "7d"\)/);
assert.match(chatScreen, /unpinFriendChatMessage\(chatId, message\.messageId\)/);
assert.match(chatScreen, /replyDraft\?\.messageId/);
assert.match(chatScreen, /setReplyDraft\(makeReplyDraft\(message\)\)/);
assert.match(chatScreen, /access\.conversation\.pinnedMessage/);

assert.match(reactionTray, /<Modal/);
assert.match(reactionTray, /onRequestClose=\{onDismiss\}/);
assert.match(reactionTray, /useSafeAreaInsets/);
assert.match(reactionTray, /useWindowDimensions/);
assert.match(reactionTray, /<Plus/);
assert.match(reactionTray, /accessibilityLabel=\{t\("chat\.moreReactions"\)\}/);
assert.match(reactionTray, /minHeight: 42/);
assert.match(reactionTray, /minWidth: 42/);

assert.match(expandedPicker, /<Modal/);
assert.match(expandedPicker, /categories\.map/);
assert.match(expandedPicker, /category\.options\.map/);
assert.match(expandedPicker, /chat\.expandedReactionPicker/);
assert.match(expandedPicker, /chat\.moreReactions/);

assert.match(overflowMenu, /accessibilityState=\{\{ disabled: action\.disabled \}\}/);
assert.match(overflowMenu, /action\.destructive/);

assert.match(imageMessage, /onPress=\{handlePress\}/, "quick tapping an image opens the explicit photo actions menu");
assert.match(imageMessage, /onLongPress=\{handleLongPress\}/, "long pressing an image still opens reactions and selection");
assert.match(imageMessage, /chat\.viewPhoto/);
assert.match(imageMessage, /chat\.forwardPhoto/);
assert.match(imageMessage, /chat\.savePhoto/);
assert.match(voicePlayer, /onPress=\{toggle\}/, "voice playback keeps its existing quick-tap control");

for (const expected of [
  "moreReactions",
  "expandedReactionPicker",
  "reactionCategories",
  "selectMessage",
  "selectedMessages",
  "replyingTo",
  "forwardMessages",
  "copyUnavailable",
  "translateUnavailable",
  "starredMessages",
  "noStarredMessages",
]) {
  assert.equal(translations.includes(expected), true, `${expected} is localized`);
}

console.log("Friend Chat upgraded long-press selection, reactions, replies, forwarding blockers, pinning, starring, accessibility, and media-control contracts passed.");
