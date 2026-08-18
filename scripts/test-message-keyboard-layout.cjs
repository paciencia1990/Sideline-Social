const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

const keyboardLayout = read("components", "KeyboardAwareScrollView.tsx");
assert.match(keyboardLayout, /KeyboardAvoidingView/);
assert.match(keyboardLayout, /Platform\.OS === "ios" \? "padding" : undefined/);
assert.match(keyboardLayout, /keyboardShouldPersistTaps = "handled"/);
assert.match(keyboardLayout, /"interactive" : "on-drag"/);
assert.match(keyboardLayout, /currentlyFocusedInput\(\)/);
assert.match(keyboardLayout, /scrollResponderScrollNativeHandleToKeyboard/);
assert.match(keyboardLayout, /onContentSizeChange/, "growing multiline input keeps the active field revealed");
assert.match(keyboardLayout, /onFocus=/, "moving between fields reveals the newly active field");
assert.match(keyboardLayout, /keepEndVisibleOnKeyboard/);
assert.match(keyboardLayout, /scrollToEnd/, "message screens keep their composer controls and latest content visible");
assert.match(keyboardLayout, /showSubscription\.remove\(\)/);
assert.match(keyboardLayout, /hideSubscription\.remove\(\)/);

const messageWrapper = read("components", "MessageKeyboardAwareScrollView.tsx");
assert.match(messageWrapper, /keepEndVisibleOnKeyboard/);

for (const route of [
  ["app", "coach", "messages.tsx"],
  ["app", "coach", "messages", "[announcementId].tsx"],
  ["app", "teams", "[teamId]", "announcements", "[announcementId].tsx"],
]) {
  const source = read(...route);
  assert.match(source, /MessageKeyboardAwareScrollView/, `${route.join("/")} keeps the end visible`);
}

for (const route of [
  ["app", "coach", "team-messages", "[conversationId].tsx"],
  ["app", "teams", "[teamId]", "messages", "[conversationId].tsx"],
]) {
  const source = read(...route);
  assert.match(source, /PrivateTeamMessageThread/, `${route.join("/")} uses the fixed private-message layout`);
  assert.match(source, /KeyboardAvoidingView/, `${route.join("/")} keeps its header and composer in one keyboard-resized column`);
  assert.match(source, /flex: 1/, `${route.join("/")} gives the conversation the available keyboard-resized height`);
}

for (const route of [
  ["app", "(auth)", "sign-in.tsx"],
  ["app", "(auth)", "forgot-password.tsx"],
  ["app", "(auth)", "sign-up.tsx"],
  ["app", "(tabs)", "friends.tsx"],
  ["app", "(tabs)", "games.tsx"],
  ["app", "(tabs)", "profile.tsx"],
  ["app", "(social)", "chat", "new.tsx"],
  ["app", "(social)", "chat", "manage.tsx"],
  ["app", "coach", "create-team.tsx"],
  ["app", "coach", "resources", "communication", "[templateId].tsx"],
  ["app", "coach", "resources", "help", "index.tsx"],
  ["app", "coach", "resources", "help", "result.tsx"],
  ["app", "settings", "delete-account.tsx"],
  ["app", "teams", "join.tsx"],
  ["app", "teams", "[teamId]", "children.tsx"],
  ["app", "teams", "[teamId]", "index.tsx"],
]) {
  const source = read(...route);
  assert.match(source, /KeyboardAwareScrollView/, `${route.join("/")} uses shared keyboard protection`);
}

const emailLoginAlias = read("app", "(auth)", "email-login.tsx");
assert.match(
  emailLoginAlias,
  /export \{ default \} from ["']\.\/sign-in["']/,
  "email-login remains an alias of the keyboard-protected sign-in route",
);

const friendConversation = read("app", "(social)", "chat", "[chatId].tsx");
assert.match(friendConversation, /KeyboardAvoidingView/);
assert.doesNotMatch(friendConversation, /keyboardVerticalOffset/, "chat does not use a device-specific fixed offset");
assert.match(friendConversation, /keyboardWillShow/);
assert.match(friendConversation, /keyboardDidShow/);
assert.match(friendConversation, /scrollToLatest/);
assert.match(friendConversation, /onContentSizeChange=\{\(\) => scrollToLatest/);
assert.match(friendConversation, /onFocus=\{\(\) => scrollToLatest/);
assert.match(friendConversation, /onLayout=/);
assert.match(friendConversation, /keyboardDismissMode=/);

const squadTab = read("app", "(tabs)", "squad.tsx");
assert.match(squadTab, /KeyboardAvoidingView/);
assert.match(squadTab, /keyboardDismissMode=/);
assert.match(squadTab, /keyboardShouldPersistTaps="handled"/);

const createSquadSheet = read("components", "CreateSquadSheet.tsx");
assert.match(createSquadSheet, /KeyboardAvoidingView/);
assert.match(createSquadSheet, /Platform\.OS === "ios" \? "padding" : "height"/);
assert.match(createSquadSheet, /paddingBottom: insets\.bottom/);
assert.match(createSquadSheet, /keyboardDismissMode=/);

const seasonManager = read("components", "SquadSeasonManager.tsx");
assert.match(seasonManager, /KeyboardAvoidingView/);
assert.match(seasonManager, /keyboardDismissMode=/);
assert.match(seasonManager, /paddingBottom: bottomPadding/);

const privateComposer = read("components", "PrivateTeamMessageThread.tsx");
const coachComposer = read("app", "coach", "messages.tsx");
assert.doesNotMatch(privateComposer, /<KeyboardAvoidingView/, "the private thread does not apply a second keyboard offset");
assert.match(privateComposer, /messageScrollRef/);
assert.match(privateComposer, /scrollToLatest/);
assert.match(privateComposer, /measureInWindow/, "Android navigation-mode overlap is measured at runtime");
assert.match(privateComposer, /marginBottom: composerKeyboardOverlap/, "any measured overlap shrinks the list and keeps the full composer visible");
assert.ok(
  privateComposer.indexOf("</ScrollView>") < privateComposer.indexOf("<Card style={styles.composer}>"),
  "private-message history scrolls independently above the fixed composer",
);
assert.match(privateComposer, /maxHeight: 144/);
assert.match(privateComposer, /multiline/);
assert.match(coachComposer, /bodyInput: \{ maxHeight: 144/);

const manifest = read("android", "app", "src", "main", "AndroidManifest.xml");
const appConfig = read("app.config.js");
assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);
assert.match(appConfig, /softwareKeyboardLayoutMode: "resize"/);
assert.match(read("app", "(tabs)", "_layout.tsx"), /tabBarHideOnKeyboard: true/);

console.log("All typing surfaces use shared keyboard protection; chats preserve the latest message/composer, multiline growth and dismissal are covered, sheets use safe-area-aware avoidance, and Android resize is configured.");
