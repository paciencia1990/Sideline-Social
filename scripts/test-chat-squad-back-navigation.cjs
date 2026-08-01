const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

const helper = read("components/NestedBackButton.tsx");
const chatIndex = read("app/(social)/chat/index.tsx");
const chatConversation = read("app/(social)/chat/[chatId].tsx");
const chatNew = read("app/(social)/chat/new.tsx");
const chatManage = read("app/(social)/chat/manage.tsx");
const chatInvitation = read("app/(social)/chat/invitation/[conversationId].tsx");
const squadDetail = read("app/(social)/squad-detail.tsx");
const friendsRoot = read("app/(tabs)/friends.tsx");
const squadRoot = read("app/(tabs)/squad.tsx");
const socialLayout = read("app/(social)/_layout.tsx");

assert.match(helper, /router\.canGoBack\(\)[\s\S]*router\.back\(\)[\s\S]*router\.replace\(fallbackRoute as never\)/, "nested back helper must use history first, then a route fallback");
assert.match(helper, /ArrowLeft[\s\S]*size=\{22\}/, "nested back helper must retain the app's ArrowLeft treatment");
assert.match(helper, /accessibilityLabel=\{accessibilityLabel \?\? t\("common\.back"\)\}/, "nested back helper must expose an accessible label");
assert.match(helper, /accessibilityRole="button"/, "nested back helper must keep button semantics");

assert.match(chatIndex, /NestedBackButton[\s\S]*fallbackRoute="\/\(tabs\)\/friends"/, "Chat list must return to Friends when deep-linked");
for (const [name, source] of [
  ["Chat conversation", chatConversation],
  ["New chat", chatNew],
  ["Chat settings", chatManage],
  ["Chat invitation", chatInvitation],
]) {
  assert.match(source, /NestedBackButton[\s\S]*fallbackRoute="\/\(social\)\/chat"/, `${name} must return to the Chat list when deep-linked`);
  assert.doesNotMatch(source, /onPress=\{\(\) => router\.back\(\)\}/, `${name} must not use unsafe raw router.back for the header arrow`);
}

assert.match(squadDetail, /SquadDetailHeader/, "Squad detail must render its own visible header because the social Stack hides native headers");
assert.match(squadDetail, /NestedBackButton[\s\S]*fallbackRoute="\/\(tabs\)\/squad"/, "Squad detail must return to the Squad tab when deep-linked");
assert.match(squadDetail, /navigateBackOrReplace\('\/\(tabs\)\/squad'\)/, "Squad detail error and leave flows must share the safe fallback");
assert.doesNotMatch(squadDetail, /Stack\.Screen/, "Squad detail must not rely on a hidden native header");
assert.match(socialLayout, /headerShown:\s*false/, "Social routes still hide native headers, so custom headers must not duplicate them");

assert.doesNotMatch(friendsRoot, /NestedBackButton/, "Friends tab root must not receive a nested back arrow");
assert.doesNotMatch(squadRoot, /NestedBackButton/, "Squad tab root must not receive a nested back arrow");

console.log("Chat and Squad nested back-navigation, fallback, header, and tab-root checks passed.");
