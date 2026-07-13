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
  routeRequiresAuthentication,
  SIGN_IN_ROUTE,
  SIGN_UP_ROUTE,
} = require(path.join(process.cwd(), "constants", "routes.ts"));

assert.equal(SIGN_IN_ROUTE, "/(auth)/sign-in");
assert.equal(EMAIL_SIGN_IN_ROUTE, "/(auth)/email-login");
assert.equal(SIGN_UP_ROUTE, "/(auth)/sign-up");
for (const routeFile of ["sign-in.tsx", "email-login.tsx", "sign-up.tsx", "_layout.tsx"]) {
  assert.equal(
    fs.existsSync(path.join(process.cwd(), "app", "(auth)", routeFile)),
    true,
    `${routeFile} must exist in the auth route group.`,
  );
}
for (const segment of ["(tabs)", "(games)", "(social)", "coach", "games", "leaderboard", "teams"]) {
  assert.equal(routeRequiresAuthentication(segment), true, `${segment} must require authentication.`);
}
for (const segment of [undefined, "", "(auth)", "index", "splash", "+not-found"]) {
  assert.equal(routeRequiresAuthentication(segment), false, `${segment ?? "undefined"} must remain public.`);
}

const profile = fs.readFileSync(path.join(process.cwd(), "app", "(tabs)", "profile.tsx"), "utf8");
const signOutIndex = profile.indexOf("await signOut();");
const replaceIndex = profile.indexOf("router.replace(SIGN_IN_ROUTE", signOutIndex);
assert.ok(signOutIndex >= 0, "Profile must await the shared sign-out flow.");
assert.ok(replaceIndex > signOutIndex, "Profile must replace navigation with the sign-in route.");

const guard = fs.readFileSync(path.join(process.cwd(), "components", "AuthNavigationGuard.tsx"), "utf8");
assert.equal(guard.includes("router.dismissAll()"), false, "The fallback guard must not dismiss the public auth stack.");
assert.ok(guard.includes("router.replace(SIGN_IN_ROUTE"), "The fallback guard must use replacement navigation.");

const welcome = fs.readFileSync(path.join(process.cwd(), "app", "(auth)", "sign-in.tsx"), "utf8");
assert.ok(welcome.includes("router.push(EMAIL_SIGN_IN_ROUTE"), "The email button must open the existing email sign-in route.");
assert.ok(welcome.includes("router.push(SIGN_UP_ROUTE"), "The create-account button must open the existing registration route.");
assert.ok(welcome.includes("onPress={handleEmailSignIn}"), "The email handler must reach the shared button.");
assert.ok(welcome.includes("onPress={handleCreateAccount}"), "The registration handler must reach the shared button.");

for (const componentName of ["PrimaryButton.tsx", "OutlineButton.tsx"]) {
  const button = fs.readFileSync(path.join(process.cwd(), "components", componentName), "utf8");
  assert.ok(button.includes("onPress={onPress}"), `${componentName} must forward onPress to its touchable.`);
}

const authContext = fs.readFileSync(path.join(process.cwd(), "context", "AuthContext.tsx"), "utf8");
const cleanupIndex = authContext.indexOf("await unregisterCurrentDeviceNotificationToken();");
const firebaseSignOutIndex = authContext.indexOf("await firebaseSignOut(auth);");
assert.ok(cleanupIndex >= 0, "Notification-token cleanup must remain in the shared sign-out flow.");
assert.ok(firebaseSignOutIndex > cleanupIndex, "Firebase sign-out must run after notification-token cleanup.");

console.log("Auth routes, welcome buttons, route protection, and sign-out sequencing checks passed.");