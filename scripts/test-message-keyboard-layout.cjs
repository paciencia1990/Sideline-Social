const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

const keyboardLayout = read("components", "MessageKeyboardAwareScrollView.tsx");
assert.match(keyboardLayout, /KeyboardAvoidingView/);
assert.match(keyboardLayout, /Platform\.OS === "ios" \? "padding" : "height"/);
assert.match(keyboardLayout, /keyboardShouldPersistTaps="handled"/);
assert.match(keyboardLayout, /"interactive" : "on-drag"/);
assert.match(keyboardLayout, /currentlyFocusedInput\(\)/);
assert.match(keyboardLayout, /scrollResponderScrollNativeHandleToKeyboard/);
assert.match(keyboardLayout, /onContentSizeChange/, "growing multiline input keeps the active field revealed");
assert.match(keyboardLayout, /onFocus=/, "moving between fields while the keyboard is open reveals the newly active field");
assert.match(keyboardLayout, /showSubscription\.remove\(\)/);
assert.match(keyboardLayout, /hideSubscription\.remove\(\)/);

for (const route of [
  ["app", "coach", "team-messages", "[conversationId].tsx"],
  ["app", "teams", "[teamId]", "messages", "[conversationId].tsx"],
  ["app", "coach", "messages.tsx"],
  ["app", "coach", "messages", "[announcementId].tsx"],
  ["app", "teams", "[teamId]", "announcements", "[announcementId].tsx"],
]) {
  const source = read(...route);
  assert.match(source, /MessageKeyboardAwareScrollView/, `${route.join("/")} uses the shared keyboard layout`);
}

const privateComposer = read("components", "PrivateTeamMessageThread.tsx");
const coachComposer = read("app", "coach", "messages.tsx");
assert.match(privateComposer, /maxHeight: 144/);
assert.match(privateComposer, /multiline/);
assert.match(coachComposer, /bodyInput: \{ maxHeight: 144/);

const manifest = read("android", "app", "src", "main", "AndroidManifest.xml");
assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);

console.log("Private/team keyboard avoidance, focused-input reveal, multiline growth, dismissal, listener cleanup, and Android resize contracts passed.");
