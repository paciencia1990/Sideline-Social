"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  module._compile(compiled, filename);
};

const root = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const occurrences = (source, pattern) => (source.match(pattern) ?? []).length;

function parseTsx(...parts) {
  const filePath = path.join(root, ...parts);
  return {
    filePath,
    sourceFile: ts.createSourceFile(
      filePath,
      fs.readFileSync(filePath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  };
}

function getImportedLocalName(sourceFile, moduleName, exportName) {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== moduleName
    ) {
      continue;
    }
    const namedImports = statement.importClause?.namedBindings;
    if (!namedImports || !ts.isNamedImports(namedImports)) continue;
    const imported = namedImports.elements.find(
      (element) => (element.propertyName ?? element.name).text === exportName,
    );
    if (imported) return imported.name.text;
  }
  return null;
}

function getJsxTagName(node) {
  const tagName = ts.isJsxElement(node)
    ? node.openingElement.tagName
    : ts.isJsxSelfClosingElement(node)
      ? node.tagName
      : null;
  return tagName?.getText() ?? null;
}

function getJsxAttributes(node) {
  if (ts.isJsxElement(node)) return node.openingElement.attributes.properties;
  if (ts.isJsxSelfClosingElement(node)) return node.attributes.properties;
  return [];
}

function getJsxAttribute(node, name) {
  return getJsxAttributes(node).find(
    (property) =>
      ts.isJsxAttribute(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === name,
  );
}

function hasIdentifierAttribute(node, attributeName, identifierName) {
  const attribute = getJsxAttribute(node, attributeName);
  const expression = attribute?.initializer && ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : null;
  return Boolean(expression && ts.isIdentifier(expression) && expression.text === identifierName);
}

function attributeReferencesIdentifier(node, attributeName, identifierName) {
  const attribute = getJsxAttribute(node, attributeName);
  const expression = attribute?.initializer && ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : null;
  let found = false;
  const visit = (current) => {
    if (ts.isIdentifier(current) && current.text === identifierName) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  if (expression) visit(expression);
  return found;
}

function collectJsx(sourceNode, predicate) {
  const matches = [];
  const visit = (node) => {
    if (
      (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) &&
      predicate(node)
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceNode);
  return matches;
}

function getBindingDefault(sourceFile, functionName, bindingName) {
  let initializer = null;
  const visit = (node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === functionName &&
      node.parameters.length > 0 &&
      ts.isObjectBindingPattern(node.parameters[0].name)
    ) {
      const binding = node.parameters[0].name.elements.find(
        (element) => (element.propertyName ?? element.name).getText() === bindingName,
      );
      initializer = binding?.initializer ?? null;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return initializer;
}

function isPlatformIosCondition(node) {
  if (!ts.isBinaryExpression(node)) return false;
  const operator = node.operatorToken.kind;
  if (operator !== ts.SyntaxKind.EqualsEqualsEqualsToken && operator !== ts.SyntaxKind.EqualsEqualsToken) {
    return false;
  }
  const isPlatformOs = (candidate) =>
    ts.isPropertyAccessExpression(candidate) &&
    ts.isIdentifier(candidate.expression) &&
    candidate.expression.text === "Platform" &&
    candidate.name.text === "OS";
  const isIos = (candidate) => ts.isStringLiteral(candidate) && candidate.text === "ios";
  return (
    (isPlatformOs(node.left) && isIos(node.right)) ||
    (isIos(node.left) && isPlatformOs(node.right))
  );
}

function assertConditionalDefault(initializer, trueValue, falseValue, message) {
  assert.ok(initializer && ts.isConditionalExpression(initializer), message);
  assert.ok(isPlatformIosCondition(initializer.condition), message);
  assert.ok(ts.isStringLiteral(initializer.whenTrue) && initializer.whenTrue.text === trueValue, message);
  if (falseValue === undefined) {
    assert.ok(ts.isIdentifier(initializer.whenFalse) && initializer.whenFalse.text === "undefined", message);
  } else {
    assert.ok(ts.isStringLiteral(initializer.whenFalse) && initializer.whenFalse.text === falseValue, message);
  }
}

function assertSharedKeyboardAwareContract() {
  const { sourceFile } = parseTsx("components", "KeyboardAwareScrollView.tsx");
  const avoidingViews = collectJsx(sourceFile, (node) => getJsxTagName(node) === "KeyboardAvoidingView");
  assert.equal(avoidingViews.length, 1, "The shared keyboard-aware component must have one native keyboard-resizing root.");

  const scrollViews = collectJsx(avoidingViews[0], (node) => getJsxTagName(node) === "ScrollView");
  assert.equal(scrollViews.length, 1, "The shared keyboard-aware component must keep its ScrollView inside KeyboardAvoidingView.");
  const protectedNodes = new Set();
  const visitProtectedTree = (node) => {
    protectedNodes.add(node);
    ts.forEachChild(node, visitProtectedTree);
  };
  visitProtectedTree(scrollViews[0]);
  assert.ok(
    [...protectedNodes].some(
      (node) => ts.isJsxExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "children",
    ),
    "The shared ScrollView must render its form children inside the keyboard-resizing layout.",
  );

  assert.ok(
    hasIdentifierAttribute(scrollViews[0], "keyboardDismissMode", "keyboardDismissMode"),
    "The shared ScrollView must forward its keyboard-dismissal mode.",
  );
  assert.ok(
    hasIdentifierAttribute(scrollViews[0], "keyboardShouldPersistTaps", "keyboardShouldPersistTaps"),
    "The shared ScrollView must forward its keyboard tap policy.",
  );
  assert.ok(getJsxAttribute(scrollViews[0], "onFocus"), "The shared ScrollView must reveal newly focused inputs.");
  assert.ok(
    getJsxAttribute(scrollViews[0], "onContentSizeChange"),
    "The shared ScrollView must re-evaluate visibility when multiline content grows.",
  );

  const dismissModeDefault = getBindingDefault(sourceFile, "KeyboardAwareScrollView", "keyboardDismissMode");
  assertConditionalDefault(
    dismissModeDefault,
    "interactive",
    "on-drag",
    "Keyboard dismissal must remain interactive on iOS and on-drag on Android.",
  );
  const persistTapsDefault = getBindingDefault(sourceFile, "KeyboardAwareScrollView", "keyboardShouldPersistTaps");
  assert.ok(
    persistTapsDefault && ts.isStringLiteral(persistTapsDefault) && persistTapsDefault.text === "handled",
    "Handled controls must remain tappable while the keyboard is open.",
  );

  const avoidingBehavior = getJsxAttribute(avoidingViews[0], "behavior");
  const avoidingBehaviorExpression =
    avoidingBehavior?.initializer && ts.isJsxExpression(avoidingBehavior.initializer)
      ? avoidingBehavior.initializer.expression
      : null;
  assertConditionalDefault(
    avoidingBehaviorExpression,
    "padding",
    undefined,
    "The shared layout must use iOS padding while Android relies on native resize.",
  );

  let revealsFocusedInput = false;
  const findFocusedInputReveal = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "scrollResponderScrollNativeHandleToKeyboard"
    ) {
      revealsFocusedInput = true;
    }
    ts.forEachChild(node, findFocusedInputReveal);
  };
  findFocusedInputReveal(sourceFile);
  assert.equal(
    revealsFocusedInput,
    true,
    "The shared component must scroll the focused native input above the keyboard.",
  );
}

function assertProtectedTypingSurface(parts, inputBindings, submitControl) {
  const { filePath, sourceFile } = parseTsx(...parts);
  const label = path.relative(root, filePath).replaceAll("\\", "/");
  const keyboardAwareName = getImportedLocalName(
    sourceFile,
    "@/components/KeyboardAwareScrollView",
    "KeyboardAwareScrollView",
  );
  assert.ok(keyboardAwareName, `${label} must import the shared KeyboardAwareScrollView.`);

  const wrappers = collectJsx(sourceFile, (node) => getJsxTagName(node) === keyboardAwareName);
  assert.equal(wrappers.length, 1, `${label} must render one shared keyboard-aware form wrapper.`);
  const protectedJsx = new Set(collectJsx(wrappers[0], () => true));

  for (const { tagName, valueBinding, changeHandler } of inputBindings) {
    const inputs = collectJsx(
      sourceFile,
      (node) =>
        getJsxTagName(node) === tagName &&
        hasIdentifierAttribute(node, "value", valueBinding) &&
        hasIdentifierAttribute(node, "onChangeText", changeHandler),
    );
    assert.equal(inputs.length, 1, `${label} must render the controlled ${valueBinding} input exactly once.`);
    assert.ok(
      protectedJsx.has(inputs[0]),
      `${label} must keep the ${valueBinding} input inside KeyboardAwareScrollView.`,
    );
  }

  const submitControls = collectJsx(
    sourceFile,
    (node) =>
      getJsxTagName(node) === submitControl.tagName &&
      attributeReferencesIdentifier(node, "onPress", submitControl.handler),
  );
  assert.equal(
    submitControls.length,
    1,
    `${label} must render the ${submitControl.handler} submission control exactly once.`,
  );
  assert.ok(
    protectedJsx.has(submitControls[0]),
    `${label} must keep the ${submitControl.handler} submission control inside KeyboardAwareScrollView.`,
  );
}

const { getFirstName, getPersistedDisplayName, resolveDisplayName } = require(path.join(root, "utils", "profileName.ts"));
assert.equal(getFirstName(" Joann   Pollard "), "Joann");
assert.equal(getFirstName("Mary-Jane O'Neill"), "Mary-Jane");
assert.equal(getFirstName("  Élodie  Martin "), "Élodie");
assert.equal(getFirstName("Prince"), "Prince");
assert.equal(getFirstName(""), null);
assert.equal(getFirstName(null), null);
assert.equal(getPersistedDisplayName({ displayName: " Saved Name ", firstName: "Ignored" }), "Saved Name");
assert.equal(getPersistedDisplayName({ firstName: " Joann ", lastName: " Pollard " }), "Joann Pollard");
assert.equal(resolveDisplayName({ displayName: "Persisted Name" }, "Firebase Name"), "Persisted Name");
assert.equal(resolveDisplayName({}, " Firebase Name "), "Firebase Name");
assert.equal(resolveDisplayName({}, null), null);

const signUp = read("app", "(auth)", "sign-up.tsx");
assert.ok(signUp.includes('const [sport, setSport] = useState("");'), "Sign-up must open without a selected sport.");
assert.equal(signUp.includes('useState("Soccer")'), false, "Sign-up must not default to Soccer.");
assert.ok(signUp.includes("sports: sport.trim() ? [sport.trim()] : []"), "Sport must only be saved after explicit input.");
assert.ok(signUp.includes('placeholder={t("auth.selectSportOptional")}'), "The optional sport prompt must be translated.");

const { FORGOT_PASSWORD_ROUTE } = require(path.join(root, "constants", "routes.ts"));
assert.equal(FORGOT_PASSWORD_ROUTE, "/forgot-password", "Reset Password must use its public URL without a route-group segment.");
assert.equal(fs.existsSync(path.join(root, "app", "(auth)", "forgot-password.tsx")), true, "Reset Password must remain in the public auth route group.");
const authLayout = read("app", "(auth)", "_layout.tsx");
assert.equal(authLayout.includes("Redirect"), false, "The public auth layout must not redirect Reset Password while signed out.");

assertSharedKeyboardAwareContract();
assertProtectedTypingSurface(
  ["app", "(auth)", "forgot-password.tsx"],
  [{ tagName: "TextInput", valueBinding: "email", changeHandler: "setEmail" }],
  { tagName: "TouchableOpacity", handler: "handleReset" },
);
assertProtectedTypingSurface(
  ["app", "(auth)", "sign-in.tsx"],
  [
    { tagName: "TextInput", valueBinding: "email", changeHandler: "setEmail" },
    { tagName: "PasswordInput", valueBinding: "password", changeHandler: "setPassword" },
  ],
  { tagName: "PrimaryButton", handler: "handleEmailSignIn" },
);
assertProtectedTypingSurface(
  ["app", "(auth)", "sign-up.tsx"],
  [
    { tagName: "TextInput", valueBinding: "firstName", changeHandler: "setFirstName" },
    { tagName: "TextInput", valueBinding: "lastName", changeHandler: "setLastName" },
    { tagName: "TextInput", valueBinding: "email", changeHandler: "setEmail" },
    { tagName: "PasswordInput", valueBinding: "password", changeHandler: "setPassword" },
    { tagName: "TextInput", valueBinding: "zipCode", changeHandler: "setZipCode" },
    { tagName: "TextInput", valueBinding: "sport", changeHandler: "setSport" },
  ],
  { tagName: "PrimaryButton", handler: "handleCreate" },
);
assertProtectedTypingSurface(
  ["app", "(tabs)", "profile.tsx"],
  [
    { tagName: "TextInput", valueBinding: "firstName", changeHandler: "setFirstName" },
    { tagName: "TextInput", valueBinding: "lastName", changeHandler: "setLastName" },
  ],
  { tagName: "PrimaryButton", handler: "handleSaveName" },
);

const forgotPassword = read("app", "(auth)", "forgot-password.tsx");
assert.equal(forgotPassword.includes("useEffect"), false, "Reset Password must not initialize or navigate from an Effect.");
assert.equal(forgotPassword.includes("router.replace"), false, "Reset Password must not imperatively redirect.");
assert.equal(forgotPassword.includes("setTimeout"), false, "The flicker fix must not use a delay.");

const theme = read("constants", "theme.ts");
assert.ok(theme.includes("fontFamily: Typography.bodyBold"), "Team codes must use the loaded Montserrat brand family.");
assert.ok(theme.includes("letterSpacing: 3"), "Entered codes must use moderate spacing.");
assert.equal(theme.includes("fontVariant"), false, "Team codes must not rely on unverified numeral variants.");

const joinTeam = read("app", "teams", "join.tsx");
assert.ok(joinTeam.includes('accessibilityLabel={t("team.join.enterCode")}'), "The code input must retain a screen-reader label.");
assert.ok(joinTeam.includes('pointerEvents="none"'), "The visual placeholder must not block input taps.");
assert.ok(joinTeam.includes("!inviteCode ?"), "The overlay placeholder must disappear as soon as a code is entered.");
assert.equal(joinTeam.includes("placeholder={"), false, "The native placeholder must be omitted to avoid duplicate styling and announcements.");
for (const file of [["app", "coach", "index.tsx"], ["app", "coach", "team.tsx"]]) {
  const source = read(...file);
  assert.ok(source.includes("...TeamCodeTypography"), `${file.join("/")} must use shared invite-code typography.`);
}

const authContext = read("context", "AuthContext.tsx");
assert.ok(authContext.includes('getDoc(doc(db, "users", nextUser.uid))'), "Sign-in and restart must hydrate the persisted profile.");
assert.ok(authContext.includes("displayName: resolveDisplayName(profile, firebaseUser.displayName)"), "Firestore display name must precede Firebase displayName.");
assert.ok(authContext.includes("const profileLoadVersion = useRef(0)"), "Profile hydration must reject stale account results.");
assert.ok(authContext.includes("setUser(null);"), "Sign-out and account changes must clear the previous profile.");
assert.ok(authContext.includes("await updateProfile(credential.user, { displayName })"), "Sign-up must await Firebase displayName persistence.");
assert.ok(authContext.includes('await setDoc(doc(db, "users", credential.user.uid)'), "Sign-up must await the Firestore profile write.");

const home = read("app", "(tabs)", "index.tsx");
assert.equal(home.includes("getFirstName"), false, "Home must not retain first-name greeting logic.");
assert.equal(home.includes("welcomeText"), false, "Home must not retain greeting fallback logic.");
assert.equal(home.includes('t("home.welcome'), false, "Home must not render a named or generic greeting.");
assert.equal(home.includes('email?.split("@")'), false, "Home must never derive a greeting from email.");
assert.ok(home.includes("styles.brandRow"), "Home must use the compact horizontal brand row.");
assert.ok(home.includes("styles.brandUnit"), "The logo and app name must stay together as one brand unit.");
const fixedHeaderPosition = home.indexOf('<View style={styles.fixedHeader}>');
const scrollViewPosition = home.indexOf("<ScrollView");
const firstHomeCardPosition = home.indexOf("<MyTeamsCard");
assert.ok(fixedHeaderPosition >= 0 && fixedHeaderPosition < scrollViewPosition, "The approved Home header must remain outside the scrolling content.");
assert.ok(scrollViewPosition >= 0 && scrollViewPosition < firstHomeCardPosition, "My Teams and the remaining Home sections must stay inside the ScrollView.");
assert.ok(home.includes('style={styles.headerDivider}'), "Home must render a static divider below the header.");
assert.ok(home.includes('height: StyleSheet.hairlineWidth'), "The fixed-header divider must use a subtle hairline.");
assert.ok(home.includes('backgroundColor: Colors.secondary'), "The fixed-header divider must use the existing neutral border color.");
assert.ok(home.includes('importantForAccessibility="no"'), "The decorative divider must be ignored by screen readers.");
assert.ok(home.includes('style={styles.scrollView}'), "The Home ScrollView must fill only the area below the fixed header.");
assert.ok(home.includes('height: 36'), "The compact Home logo must use the verified 36-pixel height.");
assert.ok(home.includes('width: 36 * (1637 / 1536)'), "The compact Home logo must use an explicit width that preserves its exact source ratio.");
assert.equal(home.includes('aspectRatio: 1637 / 1536'), false, "Android must not infer the logo box from the large bitmap's intrinsic dimensions.");
assert.ok(home.includes('minHeight: 44'), "The notification summary must retain an accessible 44-pixel target area.");
assert.ok(home.includes('const safeUnreadCount = Number.isFinite(unreadCount)'), "Home must safely normalize unavailable notification counts.");
assert.ok(home.includes('t("notifications.bellUnread", { count: safeUnreadCount })'), "The bell count must have translated accessibility copy.");
assert.ok(home.includes('onPress={() => router.push("/notifications")}'), "The Home bell must open the personal notification inbox.");
assert.equal(home.includes('t("home.subtitle")'), false, "The unnecessary Home subtitle must be removed.");
assert.equal(home.includes("styles.headerCard"), false, "Home must not use the oversized welcome card.");
assert.equal(home.includes("styles.greeting"), false, "Home must not retain greeting-specific styling.");
assert.equal(home.includes("<View style={styles.header}>"), false, "Home must not reserve a separate greeting container or gap.");
for (const existingSection of ["MyTeamsCard", "SecondaryActions", "ChallengeCard", "IcebreakerCard"]) {
  assert.ok(home.includes(existingSection), `Home must preserve its existing ${existingSection} section.`);
}
assert.equal(home.includes('t("home.activity")'), false, "Community Activity must be removed from Parent Home.");
assert.equal(home.includes("subscribeToActivityFeed"), false, "Parent Home must not retain the Community Activity listener.");
assert.equal(home.includes("ActivityRow"), false, "Parent Home must not retain Community Activity cards.");

const translations = read("i18n", "index.ts");
assert.equal(occurrences(translations, /selectSportOptional:/g), 2, "English and Spanish need the optional sport prompt.");
assert.equal(occurrences(translations, /welcomeNamed:/g), 0, "Home-only named greeting translations must be removed.");
assert.equal(occurrences(translations, /bellNoUnread:/g), 2, "English and Spanish need zero-unread bell labels.");
assert.equal(occurrences(translations, /bellUnread:/g), 2, "English and Spanish need accessible notification counts.");
assert.equal(translations.includes("welcome: 'Welcome',"), false, "The Home-only English generic greeting must be removed.");
assert.equal(translations.includes("welcome: 'Te damos la bienvenida'"), false, "The Home-only Spanish generic greeting must be removed.");
assert.equal(translations.includes("Your sideline circle is waiting"), false, "The removed Home subtitle must not remain in English.");
assert.equal(translations.includes("Tu circulo en la cancha te espera"), false, "The removed Home subtitle must not remain in Spanish.");
assert.equal(translations.includes("Welcome, {{name}}"), false, "The obsolete email-compatible greeting must be removed.");

console.log("Auth/profile keyboard protection, sign-up sport, password reset stability, team-code typography, and compact Home header checks passed.");
