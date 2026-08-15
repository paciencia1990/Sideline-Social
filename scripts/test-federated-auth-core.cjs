"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText, filename);
};

const root = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const core = require(path.join(root, "utils", "federatedAuthCore.ts"));

assert.deepEqual(core.readSignInMethods([
  { providerId: "password" },
  { providerId: "google.com" },
  { providerId: "google.com" },
]), ["password", "google"]);
assert.equal(core.canUnlinkSignInMethod([{ providerId: "google.com" }], "google"), false);
assert.equal(core.canUnlinkSignInMethod([{ providerId: "password" }, { providerId: "google.com" }], "google"), true);
assert.equal(core.canUnlinkSignInMethod([{ providerId: "google.com" }, { providerId: "apple.com" }], "apple"), true);
assert.equal(core.readAccountOnboardingCompleted(false), false, "A missing new profile must enter account completion.");
assert.equal(core.readAccountOnboardingCompleted(true, {}), true, "Legacy profiles missing the marker must remain complete.");
assert.equal(core.readAccountOnboardingCompleted(true, { accountOnboardingCompleted: false }), false);
assert.equal(core.isApplePrivateRelayEmail("person@privaterelay.appleid.com"), true);
assert.equal(core.isApplePrivateRelayEmail("person@legacy.privaterelay.appleid.com"), true);
assert.equal(core.isApplePrivateRelayEmail("person@icloud.com"), false);
assert.equal(core.emailsMatch(" Person@Example.com ", "person@example.com"), true);
assert.equal(core.emailsMatch(null, "person@example.com"), false);
const operationGuard = core.createAuthOperationGuard();
const firstOperation = operationGuard.begin();
const secondOperation = operationGuard.begin();
assert.equal(operationGuard.isCurrent(firstOperation), false, "Stale provider callbacks must be rejected.");
assert.equal(operationGuard.isCurrent(secondOperation), true);

const providerService = read("services", "federatedAuthService.ts");
assert.match(providerService, /require\("react-native-nitro-google-signin"\)/u);
assert.match(providerService, /require\("expo-apple-authentication"\)/u);
assert.equal(/require\([^"']/u.test(providerService), false, "Metro-facing provider requires must use literal package names.");
assert.match(providerService, /getRandomBytesAsync/u, "Apple nonce material must come from a cryptographically secure source.");
assert.match(providerService, /CryptoDigestAlgorithm\.SHA256/u);
assert.match(providerService, /rawNonce/u);
assert.match(providerService, /isAvailableAsync/u, "Apple sign-in must fail closed when the native capability is unavailable.");
assert.match(providerService, /response\.state !== state/u, "Apple OAuth state must be validated before Firebase exchange.");
assert.match(providerService, /scopes: null/u, "Google must not request additional API scopes.");
assert.match(providerService, /offlineAccess: false/u, "Google refresh/server tokens must not be requested.");
assert.match(providerService, /googleIosClientId/u, "Manual iOS Google setup must pass the public iOS client ID.");
for (const forbidden of ["contacts", "calendar", "drive.file", "accessToken:", "refreshToken:"]) {
  assert.equal(providerService.toLowerCase().includes(forbidden.toLowerCase()), false, `Provider service must not request or persist ${forbidden}.`);
}

const profileService = read("services", "authProfileService.ts");
assert.match(profileService, /runTransaction/u);
assert.match(profileService, /if \(existing\.exists\(\)\) return \{ created: false \}/u, "Provider profile creation must be idempotent.");
assert.match(profileService, /accountOnboardingCompleted: false/u);
assert.match(profileService, /modeOnboardingCompleted: false/u);
assert.equal(profileService.includes("photoURL"), false, "Provider photos must not be copied silently.");

const auth = read("context", "AuthContext.tsx");
assert.match(auth, /auth\/account-exists-with-different-credential/u);
assert.match(auth, /rememberPendingProviderConflict/u);
assert.match(auth, /linkWithCredential/u);
assert.match(auth, /canUnlinkSignInMethod/u);
assert.match(auth, /auth\/cannot-unlink-last-provider/u);
assert.match(auth, /assertRecentAuthentication/u);
assert.match(auth, /ensureFederatedUserProfile/u);
assert.match(auth, /return \{ exists: true, profile: undefined \}/u, "A transient profile read failure must not force an existing account into new-account onboarding.");

const signIn = read("app", "(auth)", "sign-in.tsx");
assert.match(signIn, /Platform\.OS === "ios" \? appleButton : googleButton/u);
assert.match(signIn, /Platform\.OS === "ios" \? googleButton : appleButton/u);
assert.match(signIn, /AppleAuthenticationButton/u);
assert.match(signIn, /accessibilityLiveRegion="assertive"/u);

const methods = read("app", "settings", "sign-in-methods.tsx");
assert.match(methods, /reauthenticateWithPassword/u);
assert.match(methods, /reauthenticateWithProvider/u);
assert.match(methods, /unlinkProvider/u);
assert.match(methods, /appleConsentBody/u);

const deletion = read("app", "settings", "delete-account.tsx");
assert.match(deletion, /signInMethods\.includes\("google"\)/u);
assert.match(deletion, /signInMethods\.includes\("apple"\)/u);
assert.match(deletion, /deleteOwnAccount\(\)/u);
assert.match(read("functions", "src", "accountDeletion.ts"), /token\.auth_time/u);

const appConfig = read("app.config.js");
assert.match(appConfig, /usesAppleSignIn: true/u);
assert.match(appConfig, /"expo-apple-authentication"/u);
assert.match(appConfig, /GOOGLE_SIGN_IN_PLUGIN/u);
assert.match(appConfig, /EXPO_PUBLIC_GOOGLE_AUTH_ENABLED/u);
assert.match(appConfig, /EXPO_PUBLIC_APPLE_AUTH_ENABLED/u);

const translations = read("i18n", "index.ts");
for (const key of ["continueWithEmail", "completeAccountTitle", "legalAcceptance", "adultEligibility", "providerErrors", "signInMethods"]) {
  assert.equal((translations.match(new RegExp(`\\b${key}:`, "gu")) ?? []).length, 2, `${key} must have English and Spanish translations.`);
}

console.log("Federated authentication policy, provider adapters, onboarding, linking, deletion, native config, and localization checks passed.");
