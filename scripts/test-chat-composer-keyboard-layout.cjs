const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

function sourceBetween(source, start, end) {
  const normalizedSource = source.replace(/\r\n/g, "\n");
  const startIndex = normalizedSource.indexOf(start);
  const endIndex = normalizedSource.indexOf(end, startIndex);
  assert.ok(startIndex >= 0, `missing ${start}`);
  assert.ok(endIndex > startIndex, `missing ${end} after ${start}`);
  return normalizedSource.slice(startIndex, endIndex);
}

function styleObject(source, styleName) {
  const match = source.match(new RegExp(`${styleName}: \\{([^}]*)\\}`));
  assert.ok(match, `missing ${styleName} style`);
  return match[1];
}

const friendChat = read("app", "(social)", "chat", "[chatId].tsx");
const friendLayout = sourceBetween(friendChat, "<KeyboardAvoidingView", "</KeyboardAvoidingView>");
const friendBubble = sourceBetween(friendChat, "function MessageBubble({", "function errorTranslationKey");
assert.match(friendLayout, /behavior=\{Platform\.OS === "ios" \? "padding" : "height"\}/);
assert.match(friendLayout, /<FlatList/);
assert.match(friendLayout, /style=\{styles\.messageList\}/);
assert.match(friendLayout, /<View style=\{styles\.composer\}>/);
assert.ok(
  friendLayout.indexOf("<FlatList") < friendLayout.indexOf("<View style={styles.composer}>"),
  "the resizable message list stays immediately above the composer",
);
assert.match(friendChat, /messageList: \{ flex: 1 \}/);
assert.match(friendChat, /fill: \{ flex: 1 \}/);
assert.doesNotMatch(friendChat, /keyboardVerticalOffset/, "no device-specific keyboard offset is used");

const bubbleStyle = styleObject(friendChat, "bubble");
const messageContentStyle = styleObject(friendChat, "messageContent");
const messageTextStyle = styleObject(friendChat, "messageText");
const messageRowStyle = styleObject(friendChat, "messageRow");
const mineRowStyle = styleObject(friendChat, "mineRow");
const reactionSummaryStyle = styleObject(friendChat, "reactionSummary");
const voiceBubbleStyle = styleObject(friendChat, "voiceBubble");

assert.match(bubbleStyle, /maxWidth: "84%"/, "text bubbles keep the existing maximum width");
assert.doesNotMatch(bubbleStyle, /\bheight\s*:/, "text bubbles must not use a fixed height");
assert.doesNotMatch(bubbleStyle, /\bmaxHeight\s*:/, "text bubbles must not cap their content height");
assert.match(messageContentStyle, /flexShrink: 1/, "message content can shrink horizontally and grow vertically inside the row");
assert.match(messageContentStyle, /minWidth: 0/, "message content allows long text to wrap within the bubble");
assert.doesNotMatch(messageContentStyle, /\bflex: 1\b/, "message content must not force a full-width row measurement");
assert.match(messageTextStyle, /flexShrink: 1/, "message text participates in horizontal shrinking");
assert.match(messageTextStyle, /flexWrap: "wrap"/, "message text wraps naturally across lines");
assert.match(messageTextStyle, /lineHeight: 21/, "message text keeps its readable multiline line height");
assert.match(messageTextStyle, /minWidth: 0/, "message text can wrap long words or URLs within the constrained bubble");
assert.doesNotMatch(messageTextStyle, /\bheight\s*:/, "message text must not use a fixed height");
assert.doesNotMatch(messageTextStyle, /\bmaxHeight\s*:/, "message text must not cap visible lines");
assert.doesNotMatch(
  friendBubble,
  /(?:numberOfLines=\{?\d+\}?[^>]*styles\.messageText|styles\.messageText[^>]*numberOfLines=\{?\d+\}?)/,
  "message text must not be line-clamped",
);
assert.doesNotMatch(friendChat, /messageMenu:/, "eligible friend-chat bubbles no longer render a permanent actions button that competes with text measurement");
assert.match(friendBubble, /onLongPress=\{openReactionTray\}/, "long press opens the reaction tray without adding a permanent per-message menu button");
assert.ok(
  friendBubble.indexOf("style={styles.messageTop}") < friendBubble.indexOf("style={[styles.time"),
  "the timestamp stays below the text/action row instead of overlapping message content",
);
assert.match(messageRowStyle, /alignItems: "flex-start"/, "incoming messages remain left aligned");
assert.match(mineRowStyle, /alignItems: "flex-end"/, "outgoing messages remain right aligned");
assert.match(voiceBubbleStyle, /width: "84%"/, "voice messages retain their existing full-width bubble layout");
assert.match(friendBubble, /<VoiceMemoPlayer/);
assert.match(friendBubble, /<FriendChatImageMessage/);
assert.match(reactionSummaryStyle, /flexWrap: "wrap"/, "reaction summaries can wrap below the bubble");
assert.match(reactionSummaryStyle, /maxWidth: "84%"/, "reaction summaries keep the same alignment width as message bubbles");

const privateChat = read("components", "PrivateTeamMessageThread.tsx");
const privateLayout = sourceBetween(privateChat, "<View style={styles.container}>", "</View>\n  );");
assert.match(privateLayout, /style=\{styles\.messageScroll\}/);
assert.match(privateLayout, /<Card style=\{styles\.composer\}>/);
assert.match(privateLayout, /ref=\{composerBoundaryRef\}/);
assert.match(privateLayout, /marginBottom: composerKeyboardOverlap/);
assert.ok(
  privateLayout.indexOf("</ScrollView>") < privateLayout.indexOf("<Card style={styles.composer}>"),
  "the private-message composer is fixed inside the keyboard-resized column, not inside message scrolling",
);
assert.match(privateChat, /container: \{ flex: 1/);
assert.match(privateChat, /messageScroll: \{ flex: 1 \}/);
assert.doesNotMatch(privateChat, /<KeyboardAvoidingView/, "private thread must not add a nested keyboard offset");
assert.match(privateChat, /measureInWindow/);
assert.match(privateChat, /unadjustedBottom - keyboardTop/);

for (const route of [
  ["app", "coach", "team-messages", "[conversationId].tsx"],
  ["app", "teams", "[teamId]", "messages", "[conversationId].tsx"],
]) {
  const source = read(...route);
  const keyboardLayout = sourceBetween(source, "<KeyboardAvoidingView", "</KeyboardAvoidingView>");
  assert.match(source, /content: \{ flex: 1/, `${route.join("/")} gives the thread a bounded flexible height`);
  assert.match(keyboardLayout, /behavior=\{Platform\.OS === "ios" \? "padding" : "height"\}/);
  assert.match(keyboardLayout, /keyboardVerticalOffset=\{Platform\.OS === "android" \? -insets\.bottom : 0\}/);
  assert.match(source, /const insets = useSafeAreaInsets\(\)/, `${route.join("/")} derives its Android offset from the live bottom safe area`);
  assert.match(keyboardLayout, /<PrivateTeamMessageThread/, `${route.join("/")} keeps its header and composer in one keyboard-resized column`);
}

const manifest = read("android", "app", "src", "main", "AndroidManifest.xml");
const appConfig = read("app.config.js");
assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);
assert.match(appConfig, /softwareKeyboardLayoutMode: "resize"/);

console.log("Direct, group, and private-team composers are inside an explicit Android/iOS keyboard-resized flex column.");
