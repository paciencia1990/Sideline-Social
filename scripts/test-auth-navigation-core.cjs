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

const {
  EMAIL_SIGN_IN_ROUTE,
  SIGN_IN_ROUTE,
  SIGN_UP_ROUTE,
} = require(path.join(process.cwd(), "constants", "routes.ts"));

assert.equal(SIGN_IN_ROUTE, "/sign-in");
assert.equal(EMAIL_SIGN_IN_ROUTE, "/email-login");
assert.equal(SIGN_UP_ROUTE, "/sign-up");
for (const publicRoute of [SIGN_IN_ROUTE, EMAIL_SIGN_IN_ROUTE, SIGN_UP_ROUTE]) {
  assert.equal(publicRoute.includes("(auth)"), false, "Public auth URLs must omit the route-group segment.");
}
for (const routeFile of ["sign-in.tsx", "email-login.tsx", "sign-up.tsx", "_layout.tsx"]) {
  assert.equal(
    fs.existsSync(path.join(process.cwd(), "app", "(auth)", routeFile)),
    true,
    `${routeFile} must exist in the auth route group.`,
  );
}

const profile = fs.readFileSync(path.join(process.cwd(), "app", "(tabs)", "profile.tsx"), "utf8");
const signOutIndex = profile.indexOf("await signOut();");
const replaceIndex = profile.indexOf("router.replace(SIGN_IN_ROUTE", signOutIndex);
assert.ok(signOutIndex >= 0, "Profile must await the shared sign-out flow.");
assert.ok(replaceIndex > signOutIndex, "Profile must replace navigation with the sign-in route.");

const guardPath = path.join(process.cwd(), "components", "AuthNavigationGuard.tsx");
assert.equal(fs.existsSync(guardPath), false, "The global imperative AuthNavigationGuard must not exist.");

const rootLayout = fs.readFileSync(path.join(process.cwd(), "app", "_layout.tsx"), "utf8");
assert.equal(rootLayout.includes("AuthNavigationGuard"), false, "RootLayout must not import or render an auth guard.");
assert.equal(rootLayout.includes("router.replace"), false, "RootLayout must not imperatively redirect authentication.");
assert.equal(rootLayout.includes("router.push"), false, "RootLayout must not imperatively navigate authentication.");

const tabsLayout = fs.readFileSync(path.join(process.cwd(), "app", "(tabs)", "_layout.tsx"), "utf8");
const loadingIndex = tabsLayout.indexOf("if (authLoading || !modeHydrated)");
const signedOutIndex = tabsLayout.indexOf("if (!user)");
const redirectIndex = tabsLayout.indexOf("<Redirect href={SIGN_IN_ROUTE as never} />", signedOutIndex);
const tabsIndex = tabsLayout.indexOf("<Tabs", redirectIndex);
assert.ok(tabsLayout.includes('import { Redirect, Tabs, router, usePathname } from "expo-router";'), "Tabs must use Expo Router Redirect.");
assert.ok(tabsLayout.includes("useAuth()"), "The protected tabs layout must read authentication state.");
assert.ok(loadingIndex >= 0, "Tabs must wait for authentication and mode hydration.");
assert.ok(signedOutIndex > loadingIndex, "The signed-out check must run after loading resolves.");
assert.ok(redirectIndex > signedOutIndex, "Signed-out tabs must return a declarative Redirect.");
assert.ok(tabsIndex > redirectIndex, "Authenticated users must reach the Tabs navigator.");
assert.equal(
  tabsLayout.includes("router.replace(SIGN_IN_ROUTE"),
  false,
  "The tabs auth guard must not use an imperative redirect Effect.",
);

const welcome = fs.readFileSync(path.join(process.cwd(), "app", "(auth)", "sign-in.tsx"), "utf8");
assert.ok(welcome.includes("router.push(EMAIL_SIGN_IN_ROUTE"), "The email button must open the existing email sign-in route.");
assert.ok(welcome.includes("router.push(SIGN_UP_ROUTE"), "The create-account button must open the existing registration route.");
assert.ok(welcome.includes("onPress={handleEmailSignIn}"), "The email handler must reach the shared button.");
assert.ok(welcome.includes("onPress={handleCreateAccount}"), "The registration handler must reach the shared button.");

for (const componentName of ["PrimaryButton.tsx", "OutlineButton.tsx"]) {
  const button = fs.readFileSync(path.join(process.cwd(), "components", componentName), "utf8");
  assert.ok(button.includes("onPress={onPress}"), `${componentName} must forward onPress to its touchable.`);
}

const appContext = fs.readFileSync(path.join(process.cwd(), "context", "AppContext.tsx"), "utf8");
assert.ok(appContext.includes("signedOutResetComplete.current"), "The signed-out mode reset must be idempotent.");
assert.ok(appContext.includes('if (activeMode !== "parent") setActiveModeState("parent");'), "The reset must not set unchanged mode state.");
assert.ok(appContext.includes("[activeMode, authLoading, modeHydrated, userId]"), "The mode reset must use stable primitive dependencies.");

const authContext = fs.readFileSync(path.join(process.cwd(), "context", "AuthContext.tsx"), "utf8");
const listenerIndex = authContext.indexOf("onAuthStateChanged(auth");
const listenerEffectEnd = authContext.indexOf("}, []);", listenerIndex);
const cleanupIndex = authContext.indexOf("await unregisterCurrentDeviceNotificationToken();");
const firebaseSignOutIndex = authContext.indexOf("await firebaseSignOut(auth);");
assert.ok(listenerIndex >= 0 && listenerEffectEnd > listenerIndex, "The Firebase auth listener must be registered once.");
assert.ok(cleanupIndex >= 0, "Notification-token cleanup must remain in the shared sign-out flow.");
assert.ok(firebaseSignOutIndex > cleanupIndex, "Firebase sign-out must run after notification-token cleanup.");

console.log("Declarative tabs auth protection, public auth routes, welcome buttons, and sign-out checks passed.");