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

const forgotPassword = read("app", "(auth)", "forgot-password.tsx");
assert.ok(forgotPassword.includes('behavior={Platform.OS === "ios" ? "padding" : undefined}'), "Android must rely on native keyboard resizing instead of a second height adjustment.");
assert.ok(forgotPassword.includes('value={email} onChangeText={setEmail}'), "Reset Password email must remain controlled and stable.");
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
assert.ok(home.includes('height: 36'), "The compact Home logo must use the verified 36-pixel height.");
assert.ok(home.includes('width: 36 * (1637 / 1536)'), "The compact Home logo must use an explicit width that preserves its exact source ratio.");
assert.equal(home.includes('aspectRatio: 1637 / 1536'), false, "Android must not infer the logo box from the large bitmap's intrinsic dimensions.");
assert.ok(home.includes('minHeight: 44'), "The notification summary must retain an accessible 44-pixel target area.");
assert.ok(home.includes('const safeUnreadCount = Number.isFinite(unreadCount)'), "Home must safely normalize unavailable notification counts.");
assert.ok(home.includes('accessibilityLabel={t("home.notificationUnread", { count: safeUnreadCount })}'), "The bell count must have translated accessibility copy.");
assert.equal(home.includes('t("home.subtitle")'), false, "The unnecessary Home subtitle must be removed.");
assert.equal(home.includes("styles.headerCard"), false, "Home must not use the oversized welcome card.");
assert.equal(home.includes("styles.greeting"), false, "Home must not retain greeting-specific styling.");
assert.equal(home.includes("<View style={styles.header}>"), false, "Home must not reserve a separate greeting container or gap.");
for (const existingSection of ["MyTeamsCard", "SecondaryActions", "ChallengeCard", "IcebreakerCard", 't("home.activity")']) {
  assert.ok(home.includes(existingSection), `Home must preserve its existing ${existingSection} section.`);
}

const translations = read("i18n", "index.ts");
assert.equal(occurrences(translations, /selectSportOptional:/g), 2, "English and Spanish need the optional sport prompt.");
assert.equal(occurrences(translations, /welcomeNamed:/g), 0, "Home-only named greeting translations must be removed.");
assert.equal(occurrences(translations, /notificationUnread:/g), 2, "English and Spanish need accessible notification counts.");
assert.equal(occurrences(translations, /notificationUnread_other:/g), 2, "English and Spanish need plural notification counts.");
assert.equal(translations.includes("welcome: 'Welcome',"), false, "The Home-only English generic greeting must be removed.");
assert.equal(translations.includes("welcome: 'Te damos la bienvenida'"), false, "The Home-only Spanish generic greeting must be removed.");
assert.equal(translations.includes("Your sideline circle is waiting"), false, "The removed Home subtitle must not remain in English.");
assert.equal(translations.includes("Tu circulo en la cancha te espera"), false, "The removed Home subtitle must not remain in Spanish.");
assert.equal(translations.includes("Welcome, {{name}}"), false, "The obsolete email-compatible greeting must be removed.");

console.log("Sign-up sport, password reset stability, team-code typography, and compact Home header checks passed.");
