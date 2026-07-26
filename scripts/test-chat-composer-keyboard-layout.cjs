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

const friendChat = read("app", "(social)", "chat", "[chatId].tsx");
const friendLayout = sourceBetween(friendChat, "<KeyboardAvoidingView", "</KeyboardAvoidingView>");
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
