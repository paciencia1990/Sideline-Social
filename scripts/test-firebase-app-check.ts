import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  APP_CHECK_BRIDGE_CACHE_MILLIS,
  assertMatchingFirebaseAppIdentity,
  resolveModerationReportReadiness,
  STORE_APP_CHECK_PROVIDERS,
} from "../config/firebaseAppCheckCore";

const read = (...segments: string[]) => fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");

assert.deepEqual(STORE_APP_CHECK_PROVIDERS, {
  android: "playIntegrity",
  apple: "appAttestWithDeviceCheckFallback",
});
assert.equal(APP_CHECK_BRIDGE_CACHE_MILLIS, 25 * 60 * 1000);
assert.doesNotThrow(() => assertMatchingFirebaseAppIdentity(
  { appId: "mobile-app", projectId: "staging-project" },
  { appId: "mobile-app", projectId: "staging-project" },
));
for (const actual of [
  { appId: "wrong-app", projectId: "staging-project" },
  { appId: "mobile-app", projectId: "wrong-project" },
  { appId: null, projectId: "staging-project" },
]) {
  assert.throws(
    () => assertMatchingFirebaseAppIdentity(
      { appId: "mobile-app", projectId: "staging-project" },
      actual,
    ),
    /app-check\/native-firebase-mismatch/,
  );
}

assert.equal(resolveModerationReportReadiness({ appCheckStatus: "initializing", authResolved: false, signedIn: false }), "checking");
assert.equal(resolveModerationReportReadiness({ appCheckStatus: "initializing", authResolved: true, signedIn: true }), "checking");
assert.equal(resolveModerationReportReadiness({ appCheckStatus: "ready", authResolved: true, signedIn: false }), "signedOut");
assert.equal(resolveModerationReportReadiness({ appCheckStatus: "failed", authResolved: true, signedIn: true }), "unavailable");
assert.equal(resolveModerationReportReadiness({ appCheckStatus: "ready", authResolved: true, signedIn: true }), "ready");

const integration = read("config", "firebaseAppCheck.ts");
assert.match(integration, /ReactNativeFirebaseAppCheckProvider/);
assert.match(integration, /CustomProvider/);
assert.match(integration, /getJsAppCheckToken\(jsAppCheck, false\)/);
assert.match(integration, /assertMatchingFirebaseAppIdentity/);
assert.match(integration, /isTokenAutoRefreshEnabled: true/g);
assert.match(integration, /readinessPromise\.catch\(\(\) => undefined\)/);
assert.doesNotMatch(integration, /provider:\s*["']debug["']/);
assert.doesNotMatch(integration, /debugToken/);
assert.doesNotMatch(integration, /console\.(?:log|warn|error)/);

const firebaseBootstrap = read("config", "firebase.ts");
assert.match(firebaseBootstrap, /startFirebaseAppCheck\(firebaseApp\)/);

const moderationService = read("services", "moderationReportService.ts");
assert.match(moderationService, /await auth\.authStateReady\(\)/);
assert.match(moderationService, /if \(!auth\.currentUser\) throw new Error\("auth\/sign-in-required"\)/);
assert.match(moderationService, /await requireFirebaseAppCheckReady\(\)/);
const readinessPosition = moderationService.indexOf("await requireModerationCallableReady()");
const callablePosition = moderationService.indexOf("const callable = httpsCallable");
assert.ok(readinessPosition >= 0 && readinessPosition < callablePosition, "readiness precedes the protected callable");

const appConfig = read("app.config.js");
assert.match(appConfig, /"@react-native-firebase\/app"/);
assert.match(appConfig, /"@react-native-firebase\/app-check"/);
assert.match(appConfig, /"@react-native-firebase\/app"[\s\S]*ios:\s*\{[\s\S]*disableSPM:\s*true/);
assert.match(appConfig, /"expo-build-properties"[\s\S]*useFrameworks:\s*"static"/);
assert.doesNotMatch(appConfig, /APP_CHECK_DEBUG|appCheckDebug|debugToken/);

const packageJson = JSON.parse(read("package.json"));
assert.equal(packageJson.dependencies["@react-native-firebase/app"], "26.4.0");
assert.equal(packageJson.dependencies["@react-native-firebase/app-check"], "26.4.0");
assert.equal(packageJson.dependencies["expo-build-properties"], "~57.0.22");

console.log("Native App Check provider, JS bridge, identity matching, readiness, and release fail-closed checks passed.");
