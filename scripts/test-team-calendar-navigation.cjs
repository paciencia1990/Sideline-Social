const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

function loadNavigation(router) {
  const source = read("components/NestedBackButton.tsx");
  const output = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  const overrides = {
    "@/constants/theme": { Colors: { textHeading: "#000" } },
    "expo-router": { router },
    "lucide-react-native": { ArrowLeft: () => null },
    "react": { createElement: () => null },
    "react-i18next": { useTranslation: () => ({ t: (key) => key }) },
    "react-native": { StyleSheet: { create: (value) => value }, TouchableOpacity: () => null },
  };
  const localRequire = (request) => Object.prototype.hasOwnProperty.call(overrides, request) ? overrides[request] : require(request);
  new Function("require", "module", "exports", output)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

function exercise({ canDismiss, canGoBack }) {
  const calls = [];
  const navigation = loadNavigation({
    back: () => calls.push("back"),
    canDismiss: () => canDismiss,
    canGoBack: () => canGoBack,
    dismissAll: () => calls.push("dismissAll"),
    replace: (route) => calls.push(`replace:${route}`),
  });
  navigation.navigateBackOrReplace("/teams/team-a/schedule");
  navigation.replaceAfterOptionalDismiss("/coach");
  return calls;
}

assert.deepEqual(exercise({ canDismiss: false, canGoBack: false }), [
  "replace:/teams/team-a/schedule",
  "replace:/coach",
], "root/direct navigation must not dispatch POP_TO_TOP or an unhandled back action");
assert.deepEqual(exercise({ canDismiss: true, canGoBack: true }), [
  "back",
  "dismissAll",
  "replace:/coach",
], "nested navigation preserves normal back and reset behavior");

const connect = read("app/teams/[teamId]/schedule/connect.tsx");
const importIcs = read("app/teams/[teamId]/schedule/import-ics.tsx");
const addSchedule = read("app/teams/[teamId]/schedule/add.tsx");
const parentTeam = read("app/teams/[teamId]/index.tsx");
const coachTeam = read("app/coach/team.tsx");
const coachHome = read("app/coach/index.tsx");
const parentProfile = read("app/(tabs)/profile.tsx");

assert.match(connect, /NestedBackButton[\s\S]*fallbackRoute=\{`\/teams\/\$\{teamId\}\/schedule`\}/u);
assert.doesNotMatch(connect, /router\.(back|dismiss|dismissAll)\(/u);
assert.match(importIcs, /NestedBackButton[\s\S]*fallbackRoute=\{`\/teams\/\$\{teamId\}\/schedule\/upload`\}/u);
assert.match(addSchedule, /pathname:\s*"\/teams\/\[teamId\]\/schedule\/connect"/u);
assert.match(parentTeam, /pathname:\s*"\/teams\/\[teamId\]\/schedule"/u);
assert.match(coachTeam, /pathname:\s*"\/teams\/\[teamId\]\/schedule"/u);
assert.match(coachHome, /replaceAfterOptionalDismiss\(targetRoute\)/u);
assert.match(parentProfile, /replaceAfterOptionalDismiss\(targetRoute\)/u);
assert.doesNotMatch(coachHome, /router\.dismissAll\(\)/u);
assert.doesNotMatch(parentProfile, /router\.dismissAll\(\)/u);
assert.match(connect, /calendarConnectContextKey/u);
assert.match(connect, /requestGuard/u);
assert.match(connect, /const \[url, setUrl\] = useState/u);

console.log("Connect Calendar parent/Coach navigation and no-stack fallback tests passed.");
