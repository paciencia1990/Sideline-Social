"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const expo = file => require(path.join(root, "node_modules/expo-router/build", file));
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function load(file, modules = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const code = file.endsWith(".js") ? source : ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", code)(name => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected module ${name} in ${file}`);
    return modules[name];
  }, module, module.exports);
  return module.exports;
}
function harness(factory) {
  const slots = []; let cursor = 0, effects = [];
  const changed = (previous, deps) => !previous || deps.some((value, index) => value !== previous.deps[index]);
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const key = cursor++; if (!slots[key]) slots[key] = { value: typeof initial === "function" ? initial() : initial }; return [slots[key].value, value => { slots[key].value = typeof value === "function" ? value(slots[key].value) : value; }]; },
    useRef(initial) { const key = cursor++; if (!slots[key]) slots[key] = { current: initial }; return slots[key]; },
    useMemo(fn, deps) { const key = cursor++; if (changed(slots[key], deps)) slots[key] = { deps, value: fn() }; return slots[key].value; },
    // The harness intentionally receives a dynamic dependency list from the hook under test.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useCallback(fn, deps) { return React.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const key = cursor++, previous = slots[key]; if (changed(previous, deps)) effects.push(() => { previous?.cleanup?.(); slots[key] = { deps, cleanup: fn() }; }); },
  };
  const component = factory(React);
  return { render(props) { cursor = 0; effects = []; const tree = component(props); effects.forEach(fn => fn()); return tree; }, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}
function all(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate));
  return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
}
const native = { View: "View", Pressable: "Pressable", Text: "Text", StyleSheet: { create: value => value }, Alert: { alert() {} } };
const t = key => key;
const insets = { top: 30, bottom: 34, left: 8, right: 8 };
const core = load("utils/parentNavigation.ts");
const menuModules = {
  "react-native": native, "expo-router": {}, "lucide-react-native": { Home: "Home", MapPin: "MapPin", Gamepad2: "Gamepad2", Heart: "Heart", User: "User" },
  "react-i18next": { useTranslation: () => ({ t }) }, "react-native-safe-area-context": { useSafeAreaInsets: () => insets },
  "@/components/TabIcon": { TabIcon: "TabIcon" }, "@/constants/theme": { Colors: {}, Typography: {} },
  "@/utils/parentNavigation": core, "@/utils/safeAreaLayout": { PARENT_TAB_BAR_CONTENT_HEIGHT: 62 },
};

function coverageAndLayout() {
  let segments = ["leaderboard"], keyboard = false;
  let app = { activeMode: "parent", modeHydrated: true };
  let auth = { loading: false, user: { uid: "test-parent", accountOnboardingCompleted: true, modeOnboardingCompleted: true } };
  const destinations = [];
  const shell = harness(React => load("components/ParentNavigationShell.tsx", {
    react: React, "react-native": native, "expo-router": { useSegments: () => segments, router: { dismissTo: href => destinations.push(href) } },
    "@/components/ParentNavigationBar": { ParentNavigationBar: "ParentNavigationBar" },
    "@/context/AppContext": { useApp: () => app }, "@/context/AuthContext": { useAuth: () => auth },
    "@/context/ParentNavigationContext": { ParentNavigationContext: { Provider: "MenuProvider" } },
    "@/hooks/useNavigationKeyboardVisible": { useNavigationKeyboardVisible: () => keyboard }, "@/utils/parentNavigation": core,
  }).ParentNavigationShell);
  const expected = [
    [["leaderboard"], "index"], [["(social)", "chat"], "friends"], [["(social)", "chat", "[chatId]"], "friends"],
    [["(social)", "squad-detail"], "squad"], [["teams", "[teamId]"], "index"],
    [["teams", "[teamId]", "schedule"], "index"], [["teams", "[teamId]", "schedule", "[eventId]"], "index"],
    [["teams", "[teamId]", "announcements", "[announcementId]"], "index"],
    [["teams", "[teamId]", "messages", "[conversationId]"], "index"], [["(games)", "lobbies"], "games"],
    ...["bomb-defusal", "trivia-blitz", "spot-the-difference"].map(game => [["(games)", game, "Lobby"], "games"]),
  ];
  for (const [route, section] of expected) {
    segments = route;
    const tree = shell.render({ children: "Screen" });
    const menus = all(tree, node => node.type === "ParentNavigationBar");
    assert.equal(menus.length, 1, `One menu on ${route.join("/")}`);
    assert.equal(menus[0].props.activeTab, section);
    assert.equal(tree.props.value, true, "The content knows the footer owns its bottom inset");
    const column = tree.props.children[0];
    assert.equal(column.props.children[0].props.children[0], "Screen");
    assert.equal(column.props.children[1], menus[0], "Footer takes layout space after content, rather than covering it");
    for (const destination of core.PARENT_DESTINATIONS) menus[0].props.onSelect(destination.name);
    assert.deepEqual(destinations.splice(0), core.PARENT_DESTINATIONS.map(destination => destination.href));
  }
  for (const route of [["(tabs)"], ["(auth)", "sign-in"], ["coach"], ["games", "trivia-blitz", "play"], ["(games)", "results"], ["settings", "legal"]]) {
    segments = route;
    assert.equal(all(shell.render({ children: "Screen" }), node => node.type === "ParentNavigationBar").length, 0);
  }
  segments = ["(games)", "lobbies"];
  for (const patch of [{ activeMode: "coach" }, { modeHydrated: false }]) {
    const previous = app; app = { ...app, ...patch };
    assert.equal(all(shell.render({ children: "Screen" }), node => node.type === "ParentNavigationBar").length, 0);
    app = previous;
  }
  for (const state of [{ loading: true, user: auth.user }, { loading: false, user: null }, { loading: false, user: { ...auth.user, accountOnboardingCompleted: false } }, { loading: false, user: { ...auth.user, modeOnboardingCompleted: false } }]) {
    const previous = auth; auth = state;
    assert.equal(all(shell.render({ children: "Screen" }), node => node.type === "ParentNavigationBar").length, 0);
    auth = previous;
  }
  keyboard = true;
  assert.equal(shell.render({ children: "Screen" }).props.value, false, "Typing hides the menu and restores content safe-area ownership");
  assert.equal(all(shell.render({ children: "Screen" }), node => node.type === "ParentNavigationBar").length, 0);
  keyboard = false;
  assert.equal(all(shell.render({ children: "Screen" }), node => node.type === "ParentNavigationBar").length, 1);
  shell.unmount();

  const selections = [];
  const bar = harness(React => load("components/ParentNavigationBar.tsx", { ...menuModules, react: React, "@/hooks/useNavigationKeyboardVisible": { useNavigationKeyboardVisible: () => false } }).ParentNavigationBar);
  const tree = bar.render({ activeTab: "games", onSelect: tab => selections.push(tab) });
  const buttons = all(tree, node => node.type === "Pressable");
  assert.equal(buttons.length, 5);
  assert.equal(buttons.filter(button => button.props.accessibilityState.selected).length, 1);
  assert.equal(buttons[2].props.accessibilityState.selected, true);
  buttons.forEach(button => { assert.equal(button.props.accessibilityRole, "tab"); assert.ok(button.props.accessibilityLabel); button.props.onPress(); });
  assert.deepEqual(selections, core.PARENT_DESTINATIONS.map(destination => destination.name));
  assert.equal(tree.props.style[1].paddingBottom, 34);
  assert.equal(tree.props.style[1].paddingLeft, 8);
  assert.ok(buttons[0].props.style({ pressed: false })[0].minHeight >= 44);
  bar.unmount();

  let menuVisible = true;
  const insetHook = load("context/ParentNavigationContext.tsx", {
    react: { createContext: () => ({}), useContext: () => menuVisible }, "react-native-safe-area-context": { useSafeAreaInsets: () => insets },
  }).useParentScreenInsets;
  assert.deepEqual(insetHook(), { ...insets, bottom: 0 });
  menuVisible = false;
  assert.deepEqual(insetHook(), insets, "Screens without a visible menu retain their original safe-area padding");
}

function tabsAndKeyboard() {
  let keyboard = false, prevented = false;
  const events = [], navigations = [];
  const bar = harness(React => load("components/ParentNavigationBar.tsx", {
    ...menuModules, react: React, "@/hooks/useNavigationKeyboardVisible": { useNavigationKeyboardVisible: () => keyboard },
  }).ParentTabsBar);
  const props = {
    state: { index: 0, routes: core.PARENT_DESTINATIONS.map(destination => ({ name: destination.name, key: `key-${destination.name}`, params: { retained: true } })) },
    navigation: { emit: event => { events.push(event); return { defaultPrevented: prevented }; }, navigate: (...args) => navigations.push(args) },
  };
  let tree = bar.render(props);
  tree.props.onSelect("index"); assert.equal(navigations.length, 0, "Selected tab emits its event without stacking itself");
  tree.props.onSelect("squad"); assert.deepEqual(navigations[0], ["squad", { retained: true }]);
  prevented = true; tree.props.onSelect("games"); assert.equal(navigations.length, 1, "Tab listeners can prevent navigation");
  tree.props.onLongPress("profile"); assert.deepEqual(events.at(-1), { type: "tabLongPress", target: "key-profile" });
  keyboard = true; assert.equal(bar.render(props), null);
  bar.unmount();
  for (const OS of ["ios", "android"]) {
    const listeners = new Map(); let removed = 0;
    const hook = harness(React => load("hooks/useNavigationKeyboardVisible.ts", {
      react: React, "react-native": { Platform: { OS }, Keyboard: { isVisible: () => false, addListener: (event, callback) => { listeners.set(event, callback); return { remove() { removed++; } }; } } },
    }).useNavigationKeyboardVisible);
    assert.equal(hook.render(), false);
    if (OS === "ios") { listeners.get("keyboardWillShow")(); assert.equal(hook.render(), true); }
    listeners.get("keyboardDidShow")(); assert.equal(hook.render(), true);
    listeners.get("keyboardDidHide")(); assert.equal(hook.render(), false);
    hook.unmount(); assert.equal(removed, OS === "ios" ? 4 : 2);
  }
}

async function lobbyDeparture() {
  const { StackRouter } = expo("react-navigation/routers/StackRouter.js");
  const stack = StackRouter({});
  const stateUtils = expo("global-state/stateUtils.js");
  const navigationParams = expo("navigationParams.js");
  for (const game of ["bomb-defusal", "trivia-blitz", "spot-the-difference"]) {
    for (const hasTabs of [true, false]) {
      let state = {
        stale: false, type: "stack", key: "root-stack", index: hasTabs ? 1 : 0,
        routeNames: ["(tabs)", "(games)"], preloadedRoutes: [],
        routes: [...(hasTabs ? [{ key: "tabs", name: "(tabs)" }] : []), { key: "rooms", name: "(games)", state: { type: "stack", key: "room-stack", index: 0, routes: [{ key: "lobby", name: `${game}/Lobby` }] } }],
      };
      let guard, leaveCalls = 0, request = deferred();
      const dispatched = [];
      const rootRef = { getRootState: () => state, dispatch(action) { dispatched.push(action); state = stack.getStateForAction(state, action, { routeNames: state.routeNames, routeParamList: {}, routeGetIdList: {} }); assert.ok(state); } };
      const store = { assertIsReady() {}, navigationRef: { current: rootRef }, getRouteInfo: () => ({}), redirects: [], linking: { config: {}, getStateFromPath: href => ({ routes: [{ name: "(tabs)", state: { routes: [{ name: core.PARENT_DESTINATIONS.find(destination => destination.href === href).name }] } }] }) } };
      const { getNavigateAction } = load("node_modules/expo-router/build/global-state/getNavigationAction.js", {
        "./stateUtils": stateUtils, "./store": { store }, "../getRoutesRedirects": { applyRedirects: href => href }, "../link/href": { resolveHrefStringWithSegments: href => href }, "../navigationParams": navigationParams,
      });
      const queue = [];
      const { router } = load("node_modules/expo-router/build/global-state/router.js", {
        "expo/dom": { IS_DOM: false }, "expo-linking": {}, "react-native": { Platform: { OS: "android" } },
        "./routingQueue": { routingQueue: { add: action => queue.push(action) } }, "./store": { store },
        "../domComponents/emitDomEvent": { emitDomLinkEvent: () => false }, "../link/href": { resolveHref: href => href }, "../utils/url": { shouldLinkExternally: () => false },
      });
      const departure = load("utils/gameRoomDeparture.ts");
      const room = harness(React => load("hooks/useGameRoomDeparture.ts", {
        react: React, "react-native": native, "react-i18next": { useTranslation: () => ({ t }) }, "expo-router": { useNavigationContainerRef: () => rootRef },
        "expo-router/react-navigation": { usePreventRemove: (_enabled, callback) => { guard = callback; } },
        "@/services/gameJoinCodeService": { leaveGameLobby: async () => { leaveCalls++; await request.promise; }, readGameJoinCodeFailureReason: () => "network_unavailable" },
        "@/utils/gameRoomDeparture": departure,
      }).useGameRoomDeparture);
      room.render({ lobbyId: "test-lobby", enabled: true, presentFailureAlert: false });
      const shell = harness(React => load("components/ParentNavigationShell.tsx", {
        react: React, "react-native": native, "expo-router": { router, useSegments: () => ["(games)", game, "Lobby"] },
        "@/components/ParentNavigationBar": { ParentNavigationBar: "ParentNavigationBar" }, "@/context/AppContext": { useApp: () => ({ activeMode: "parent", modeHydrated: true }) },
        "@/context/AuthContext": { useAuth: () => ({ loading: false, user: { accountOnboardingCompleted: true, modeOnboardingCompleted: true } }) },
        "@/context/ParentNavigationContext": { ParentNavigationContext: { Provider: "MenuProvider" } }, "@/hooks/useNavigationKeyboardVisible": { useNavigationKeyboardVisible: () => false }, "@/utils/parentNavigation": core,
      }).ParentNavigationShell);
      const menu = all(shell.render({ children: "Lobby" }), node => node.type === "ParentNavigationBar")[0];
      const select = tab => {
        menu.props.onSelect(tab);
        const queued = queue.shift();
        const action = getNavigateAction(queued.payload.href, queued.payload.options, queued.payload.options.event);
        assert.equal(action.type, "POP_TO"); assert.equal(action.target, "root-stack");
        guard({ data: { action } });
      };
      select("index"); select("squad"); await flush();
      assert.equal(leaveCalls, 1, "Competing menu exits coalesce into one canonical leave");
      assert.equal(dispatched.length, 0, "The lobby remains mounted while leave is pending");
      request.reject(Error("offline")); await flush();
      let controller = room.render({ lobbyId: "test-lobby", enabled: true, presentFailureAlert: false });
      assert.equal(controller.departureError, "network_unavailable");
      assert.equal(controller.hasPendingNavigation(), true);
      assert.equal(dispatched.length, 0, "A failed leave cannot switch sections");
      request = deferred(); const retry = controller.retryDeparture(); await flush();
      assert.equal(leaveCalls, 2, "Only an explicit Retry submits the next leave");
      request.resolve(); await retry; await flush();
      assert.equal(dispatched.length, 1);
      assert.equal(state.routes.length, 1, "Existing tabs are reused; a direct-linked lobby gets exactly one replacement tab route");
      assert.equal(state.routes[0].name, "(tabs)");
      assert.equal(state.routes[0].params.screen, "squad", "Retry resumes only the most recent menu destination");
      shell.unmount(); room.unmount();
    }
  }
}

(async () => {
  global.__DEV__ = false;
  coverageAndLayout(); tabsAndKeyboard(); await lobbyDeparture();
  console.log("Parent menu passed: route/mode/auth coverage, shared accessible tabs, keyboard/safe-area layout, real Expo POP_TO, and three-lobby pending/failure/Retry/latest-destination cleanup.");
})().catch(error => { console.error(error); process.exitCode = 1; });
