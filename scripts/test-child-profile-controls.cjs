"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const flush = () => new Promise((resolve) => setImmediate(resolve));

function load(relativePath, dependencies) {
  const loaded = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("require", "module", "exports", "console", output)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, { warn: (_, code) => assert.equal(typeof code, "string") });
  return loaded.exports;
}
function nodes(view) {
  if (!view || typeof view !== "object") return [];
  return [view, ...[view.props?.children].flat(Infinity).flatMap(nodes)];
}
function find(view, predicate) {
  const node = nodes(view).find(predicate);
  assert.ok(node, "Expected control was not rendered");
  return node;
}
function button(view, text) {
  return find(view, (node) => node.type === "TouchableOpacity" && nodes(node).some((child) => child.type === "Text" && child.props.children === text));
}
function fixture() {
  const slots = [];
  let cursor = 0;
  const effects = [];
  const React = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(fn, dependencies) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, offset) => value !== slots[index].dependencies[offset])) {
        slots[index] = { fn, dependencies };
      }
      return slots[index].fn;
    },
    useEffect(fn, dependencies) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, offset) => value !== slots[index][offset])) {
        slots[index] = dependencies;
        effects.push(fn);
      }
    },
  };
  const calls = [];
  const alerts = [];
  let update = async () => undefined;
  let deletion = async () => true;
  const jsx = (type, props) => ({ type, props });
  const translate = (key, input) => input?.name ? `${key}:${input.name}` : key;
  const service = {
    getCurrentUserChildren: async () => [
      { id: "child-a", parentUid: "synthetic-parent", displayName: "Typo" },
      { id: "child-b", parentUid: "synthetic-parent", displayName: "Other" },
    ],
    createChildProfile: async () => assert.fail("Editing must not create a duplicate child"),
    updateChildProfile: async (id, name) => { calls.push(["update", id, name]); await update(); },
    deleteChildProfile: async (id) => { calls.push(["delete", id]); return deletion(); },
  };
  const { ChildProfilePicker } = load("components/ChildProfilePicker.tsx", {
    react: React,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      ActivityIndicator: "ActivityIndicator", Text: "Text", TextInput: "TextInput", TouchableOpacity: "TouchableOpacity", View: "View",
      Alert: { alert: (...args) => alerts.push(args) }, StyleSheet: { create: (styles) => styles },
    },
    "lucide-react-native": { Check: "Check", Pencil: "Pencil", Plus: "Plus", Trash2: "Trash2" },
    "react-i18next": { useTranslation: () => ({ t: translate }) },
    "@/constants/theme": { Colors: {}, Radius: {}, Spacing: {}, Typography: {} },
    "@/services/childService": service,
  });
  let selected = ["child-a"];
  const profileChanges = [];
  const onChange = (ids) => { selected = ids; };
  const onProfilesChange = (profiles) => profileChanges.push(profiles);
  function render() {
    cursor = 0;
    const view = ChildProfilePicker({ selectedIds: selected, onChange, onProfilesChange });
    effects.splice(0).forEach((effect) => effect());
    return view;
  }
  return { render, calls, alerts, profileChanges, selected: () => selected, setUpdate: (value) => { update = value; }, setDeletion: (value) => { deletion = value; } };
}

(async () => {
  const screen = fixture();
  screen.render();
  await flush();
  let view = screen.render();
  find(view, (node) => node.props.accessibilityLabel === "myTeams.editChildNamed:Typo").props.onPress();
  view = screen.render();
  const input = find(view, (node) => node.type === "TextInput" && node.props.accessibilityLabel === "myTeams.childNamePlaceholder");
  assert.equal(input.props.value, "Typo");
  input.props.onChangeText("  Corrected  ");
  view = screen.render();
  let release;
  screen.setUpdate(() => new Promise((resolve) => { release = resolve; }));
  const save = button(view, "myTeams.saveChild");
  save.props.onPress();
  save.props.onPress();
  assert.deepEqual(screen.calls, [["update", "child-a", "Corrected"]], "Rapid saves must produce one update");
  view = screen.render();
  assert.equal(find(view, (node) => node.props.accessibilityLabel === "myTeams.deleteChildNamed:Other").props.disabled, true);
  assert.equal(button(view, "myTeams.addChild").props.disabled, true);
  assert.equal(button(view, "common.cancel").props.disabled, true);
  release();
  await flush();
  view = screen.render();
  assert.ok(nodes(view).some((node) => node.type === "Text" && node.props.children === "Corrected"));
  assert.deepEqual(screen.selected(), ["child-a"], "Renaming must preserve selected IDs");
  assert.equal(screen.profileChanges.at(-1).find((child) => child.id === "child-a").displayName, "Corrected");

  find(view, (node) => node.props.accessibilityLabel === "myTeams.editChildNamed:Corrected").props.onPress();
  view = screen.render();
  find(view, (node) => node.type === "TextInput" && node.props.accessibilityLabel).props.onChangeText("Retry name");
  screen.setUpdate(async () => { throw Object.assign(new Error("synthetic failure"), { code: "permission-denied" }); });
  button(screen.render(), "myTeams.saveChild").props.onPress();
  await flush();
  view = screen.render();
  assert.equal(find(view, (node) => node.type === "TextInput" && node.props.accessibilityLabel).props.value, "Retry name");
  assert.ok(nodes(view).some((node) => node.props.children === "myTeams.childRenameError"));
  assert.equal(screen.profileChanges.at(-1).find((child) => child.id === "child-a").displayName, "Corrected");
  screen.setUpdate(async () => undefined);
  button(view, "myTeams.saveChild").props.onPress();
  await flush();
  view = screen.render();
  find(view, (node) => node.props.accessibilityLabel === "myTeams.editChildNamed:Retry name").props.onPress();
  const beforeCancel = screen.calls.length;
  button(screen.render(), "common.cancel").props.onPress();
  assert.equal(screen.calls.length, beforeCancel);
  view = screen.render();
  find(view, (node) => node.props.accessibilityLabel === "myTeams.deleteChildNamed:Retry name").props.onPress();
  assert.equal(screen.calls.length, beforeCancel, "Delete must wait for confirmation");
  screen.setDeletion(async () => { throw Object.assign(new Error("linked"), { code: "functions/failed-precondition" }); });
  screen.alerts.at(-1)[2].find((item) => item.style === "destructive").onPress();
  await flush();
  view = screen.render();
  assert.ok(nodes(view).some((node) => node.props.children === "myTeams.childDeleteLinkedError"));
  assert.deepEqual(screen.selected(), ["child-a"]);
  screen.setDeletion(async () => true);
  find(view, (node) => node.props.accessibilityLabel === "myTeams.deleteChildNamed:Retry name").props.onPress();
  const confirm = screen.alerts.at(-1)[2].find((item) => item.style === "destructive");
  const beforeDelete = screen.calls.length;
  confirm.onPress();
  confirm.onPress();
  await flush();
  assert.equal(screen.calls.length, beforeDelete + 1);
  view = screen.render();
  assert.deepEqual(screen.selected(), []);
  assert.equal(screen.profileChanges.at(-1).length, 1);
  assert.equal(screen.profileChanges.at(-1)[0].id, "child-b");

  const writes = [];
  let deleteResponse = { data: { deleted: true } };
  const auth = { currentUser: { uid: "synthetic-parent" } };
  const childService = load("services/childService.ts", {
    "@/config/firebase": { auth, db: {}, functions: {} },
    "firebase/functions": { httpsCallable: (_, name) => async (input) => { writes.push([name, input]); return deleteResponse; } },
    "firebase/firestore": {
      doc: (_, ...parts) => parts.join("/"), collection: () => undefined, getDocs: () => undefined, setDoc: () => undefined,
      deleteField: () => "DELETE", serverTimestamp: () => "SERVER_TIME", updateDoc: async (ref, data) => writes.push([ref, data]),
    },
  });
  await childService.updateChildProfile("child-a", " Corrected ");
  assert.equal(writes[0][0], "users/synthetic-parent/children/child-a");
  assert.equal(writes[0][1].displayName, "Corrected");
  assert.equal(await childService.deleteChildProfile("child-a"), true);
  deleteResponse = { data: { deleted: false } };
  await assert.rejects(childService.deleteChildProfile("child-a"), /not confirmed/);
  deleteResponse = { data: {} };
  await assert.rejects(childService.deleteChildProfile("child-a"), /not confirmed/);
  auth.currentUser = null;
  await assert.rejects(childService.updateChildProfile("child-a", "Corrected"), /Sign in/);
  const translations = fs.readFileSync(path.join(root, "i18n/index.ts"), "utf8");
  for (const key of ["editChild", "editChildNamed", "deleteChildNamed", "childRenameError"]) {
    assert.equal((translations.match(new RegExp(`${key}:`, "g")) ?? []).length, 2, `${key} requires both languages`);
  }
  console.log("Child edit/cancel/retry, stable selection, confirmed deletion, linked-child protection, duplicate-tap guards, and localization passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
