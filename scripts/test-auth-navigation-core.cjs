"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText;
  module._compile(compiled, filename);
};

const root = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const {
  CHOOSE_START_MODE_ROUTE,
  COMPLETE_ACCOUNT_ROUTE,
  EMAIL_SIGN_IN_ROUTE,
  FORGOT_PASSWORD_ROUTE,
  SIGN_IN_ROUTE,
  SIGN_UP_ROUTE,
} = require(path.join(root, "constants", "routes.ts"));

assert.equal(SIGN_IN_ROUTE, "/sign-in");
assert.equal(EMAIL_SIGN_IN_ROUTE, "/email-login");
assert.equal(SIGN_UP_ROUTE, "/sign-up");
assert.equal(FORGOT_PASSWORD_ROUTE, "/forgot-password");
assert.equal(CHOOSE_START_MODE_ROUTE, "/choose-start-mode");
assert.equal(COMPLETE_ACCOUNT_ROUTE, "/complete-account");
for (const publicRoute of [SIGN_IN_ROUTE, EMAIL_SIGN_IN_ROUTE, SIGN_UP_ROUTE, FORGOT_PASSWORD_ROUTE, COMPLETE_ACCOUNT_ROUTE, CHOOSE_START_MODE_ROUTE]) {
  assert.equal(publicRoute.includes("(auth)"), false, "Public Expo Router URLs must omit route-group segments.");
}
for (const routeFile of ["sign-in.tsx", "email-login.tsx", "sign-up.tsx", "forgot-password.tsx", "complete-account.tsx", "choose-start-mode.tsx", "_layout.tsx"]) {
  assert.equal(fs.existsSync(path.join(root, "app", "(auth)", routeFile)), true, `${routeFile} must exist in the auth route group.`);
}

const signUp = read("app", "(auth)", "sign-up.tsx");
assert.ok(signUp.includes('const [sport, setSport] = useState("");'), "New accounts must start with no selected sport.");
assert.equal(signUp.includes('useState("Soccer")'), false, "Sign-up must not default to Soccer.");
assert.ok(signUp.includes("sports: sport.trim() ? [sport.trim()] : []"), "Blank sport input must save an empty sports array.");
assert.ok(signUp.includes("router.replace(CHOOSE_START_MODE_ROUTE"), "New accounts must replace sign-up with the start-mode choice.");

const profile = read("app", "(tabs)", "profile.tsx");
const signOutIndex = profile.indexOf("await signOut();");
const replaceIndex = profile.indexOf("router.replace(SIGN_IN_ROUTE", signOutIndex);
assert.ok(signOutIndex >= 0, "Profile must await the shared sign-out flow.");
assert.ok(replaceIndex > signOutIndex, "Profile must replace navigation with the sign-in route.");

const guardPath = path.join(root, "components", "AuthNavigationGuard.tsx");
assert.equal(fs.existsSync(guardPath), false, "The global imperative AuthNavigationGuard must not exist.");
const rootLayout = read("app", "_layout.tsx");
assert.equal(rootLayout.includes("AuthNavigationGuard"), false, "RootLayout must not render an auth guard.");
assert.equal(rootLayout.includes("router.replace"), false, "RootLayout must not imperatively redirect authentication.");

const tabsLayout = read("app", "(tabs)", "_layout.tsx");
const loadingIndex = tabsLayout.indexOf("if (authLoading || !modeHydrated)");
const signedOutIndex = tabsLayout.indexOf("if (!user)");
const onboardingIndex = tabsLayout.indexOf("if (!user.modeOnboardingCompleted)");
const accountOnboardingIndex = tabsLayout.indexOf("if (!user.accountOnboardingCompleted)");
const coachModeIndex = tabsLayout.indexOf('if (activeMode === "coach")');
const tabsIndex = tabsLayout.indexOf("<Tabs", coachModeIndex);
assert.ok(tabsLayout.includes('import { Redirect, Tabs } from "expo-router";'), "Tabs must use declarative Expo Router redirects.");
assert.ok(loadingIndex >= 0 && signedOutIndex > loadingIndex, "Tabs must resolve loading before signed-out routing.");
assert.ok(accountOnboardingIndex > signedOutIndex, "Tabs must route incomplete account setup before mode onboarding.");
assert.ok(onboardingIndex > signedOutIndex, "Tabs must route incomplete new accounts to mode onboarding.");
assert.ok(onboardingIndex > accountOnboardingIndex, "Mode onboarding must follow account completion.");
assert.ok(coachModeIndex > onboardingIndex, "Tabs must resolve mode only after onboarding completes.");
assert.ok(tabsIndex > coachModeIndex, "Parent users must reach the Tabs navigator.");
assert.equal(tabsLayout.includes("useEffect"), false, "Tabs mode routing must not use an Effect.");
assert.equal(tabsLayout.includes("router.replace"), false, "Tabs mode routing must remain declarative.");

const coachLayout = read("app", "coach", "_layout.tsx");
assert.ok(coachLayout.includes("<Redirect href={CHOOSE_START_MODE_ROUTE"), "Coach routes must protect incomplete onboarding.");
assert.ok(coachLayout.includes("<Redirect href={PARENT_PROFILE_ROUTE"), "Parent mode must redirect declaratively out of Coach routes.");
assert.equal(coachLayout.includes("useEffect"), false, "Coach route protection must not use an Effect.");
assert.equal(coachLayout.includes("router.replace"), false, "Coach route protection must not imperatively redirect.");

const signIn = read("app", "(auth)", "sign-in.tsx");
const emailCompatibilityRoute = read("app", "(auth)", "email-login.tsx");
assert.ok(signIn.includes('autoComplete="email"'), "Sign In must render the email field directly.");
assert.ok(signIn.includes('autoComplete="current-password"'), "Sign In must render the password field directly.");
assert.ok(signIn.includes("handleEmailSignIn"), "The primary action must retain email sign-in behavior.");
assert.ok(signIn.includes("router.push(SIGN_UP_ROUTE"), "The bottom create-account link must open registration.");
assert.ok(emailCompatibilityRoute.includes('export { default } from "./sign-in"'), "Legacy email-login links must resolve to the simplified Sign In screen.");

for (const componentName of ["PrimaryButton.tsx", "OutlineButton.tsx"]) {
  const button = read("components", componentName);
  assert.ok(button.includes("onPress={onPress}"), `${componentName} must forward onPress.`);
}

const appContext = read("context", "AppContext.tsx");
assert.ok(appContext.includes('const MODE_STORAGE_KEY = "sidelineSocial.activeMode"'), "The established local mode key must be preserved.");
assert.ok(appContext.includes("resolveInitialMode(user, storedMode)"), "Mode hydration must use Firestore preferences with local compatibility fallback.");
assert.ok(appContext.includes("hydratedUserId === userId"), "Mode hydration must be scoped to the current account.");
assert.ok(appContext.includes("AsyncStorage.removeItem(MODE_STORAGE_KEY)"), "Sign-out must clear local mode state.");

const authContext = read("context", "AuthContext.tsx");
const listenerIndex = authContext.indexOf("onAuthStateChanged(auth");
const listenerEffectEnd = authContext.indexOf("}, []);", listenerIndex);
const cleanupIndex = authContext.indexOf("await unregisterCurrentDeviceNotificationToken();");
const localSignOutIndex = authContext.indexOf("await completeLocalSignOut({", cleanupIndex);
const firebaseSignOutIndex = authContext.indexOf(
  "firebaseSignOut: () => firebaseSignOut(auth)",
  localSignOutIndex,
);
const localStateCleanupIndex = authContext.indexOf(
  "clearLocalUserState: clearSignedInUserLocalState",
  localSignOutIndex,
);
assert.ok(listenerIndex >= 0 && listenerEffectEnd > listenerIndex, "The Firebase auth listener must be registered once.");
assert.ok(cleanupIndex >= 0, "Notification-token cleanup must remain in sign-out.");
assert.ok(localSignOutIndex > cleanupIndex, "Shared local sign-out must follow notification cleanup.");
assert.ok(firebaseSignOutIndex > localSignOutIndex, "Shared sign-out must receive Firebase sign-out.");
assert.ok(localStateCleanupIndex > localSignOutIndex, "Shared sign-out must receive local-state cleanup.");

const rootIndex = read("app", "index.tsx");
const pickerReturnIndex = rootIndex.indexOf("readFriendChatImagePickerNavigationReturn(user.uid)");
const pickerAuthorizationIndex = rootIndex.indexOf("getFriendConversationAccess(imagePickerReturn.conversationId)", pickerReturnIndex);
const notificationRouteIndex = rootIndex.indexOf("getPendingNotificationOpenTarget({ activeMode })", pickerReturnIndex);
const homeFallbackIndex = rootIndex.indexOf('router.replace("/(tabs)")', notificationRouteIndex);
assert.ok(pickerReturnIndex >= 0, "Root navigation must inspect a valid image-picker return after auth and mode hydration.");
assert.ok(pickerAuthorizationIndex > pickerReturnIndex, "Picker restoration must revalidate conversation membership.");
assert.ok(notificationRouteIndex > pickerAuthorizationIndex, "Picker restoration wins the lifecycle race before unrelated initial navigation.");
assert.ok(homeFallbackIndex > notificationRouteIndex, "Home remains the final authenticated fallback only after resume routing.");
assert.match(rootIndex.slice(pickerReturnIndex, notificationRouteIndex), /access\?\.member\.status === "active"/);
assert.match(rootIndex.slice(pickerReturnIndex, notificationRouteIndex), /pathname: imagePickerReturn\.route/);
assert.match(rootIndex.slice(pickerReturnIndex, notificationRouteIndex), /router\.replace\("\/\(social\)\/chat"/);
assert.doesNotMatch(rootIndex.slice(pickerReturnIndex, notificationRouteIndex), /router\.replace\("\/\(tabs\)"/);

const authenticatedRouteGate = read("components", "AuthenticatedRouteGate.tsx");
assert.ok(
  authenticatedRouteGate.indexOf("if (loading)") < authenticatedRouteGate.indexOf("if (!user"),
  "Authenticated routes must wait for auth hydration before applying redirects.",
);

console.log("Declarative auth/onboarding protection, public routes, welcome buttons, and sign-out checks passed.");
