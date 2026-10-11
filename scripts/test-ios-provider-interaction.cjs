"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");

function load(relativePath, dependencies) {
  const loaded = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("require", "module", "exports", output)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

function providerFixture(platform, responses = {}) {
  const calls = [];
  const success = { type: "success", data: { idToken: "synthetic-id-token", user: {
    email: "synthetic@example.invalid", givenName: "Synthetic", familyName: "Tester",
  } } };
  const google = {
    GoogleOneTapSignIn: {
      configure: (config) => calls.push(["configure", config]),
      checkPlayServices: async () => calls.push(["playServices"]),
      ...Object.fromEntries(["signIn", "createAccount", "presentExplicitSignIn"].map((method) => [method, async () => {
        calls.push([method]);
        const result = responses[method] ?? success;
        if (result instanceof Error) throw result;
        return result;
      }])),
    },
    isNoSavedCredentialFoundResponse: (response) => response.type === "noSavedCredentialFound",
    isCancelledResponse: (response) => response.type === "cancelled",
    isSuccessResponse: (response) => response.type === "success",
  };
  let appleResponse = (input) => ({ state: input.state, identityToken: "synthetic-apple-token", authorizationCode: "synthetic-code", fullName: {} });
  let available = true;
  const service = load("services/federatedAuthService.ts", {
    "react-native": { Platform: { OS: platform } },
    "@/config/authProviders": { AUTH_PROVIDER_CONFIG: { googleEnabled: true, appleEnabled: true, googleWebClientId: "synthetic-web", googleIosClientId: "synthetic-ios" } },
    "firebase/auth": {
      GoogleAuthProvider: { credential: (idToken) => ({ idToken }) },
      OAuthProvider: class { credential(input) { calls.push(["appleCredential", input]); return input; } },
    },
    "react-native-nitro-google-signin": google,
    "expo-apple-authentication": {
      isAvailableAsync: async () => available,
      AppleAuthenticationScope: { FULL_NAME: "FULL_NAME", EMAIL: "EMAIL" },
      signInAsync: async (input) => { calls.push(["appleSignIn", input]); return appleResponse(input); },
    },
    "expo-crypto": {
      getRandomBytesAsync: async (count) => crypto.randomBytes(count),
      CryptoDigestAlgorithm: { SHA256: "sha256" },
      digestStringAsync: async (_, value) => crypto.createHash("sha256").update(value).digest("hex"),
    },
  });
  return { service, calls, setAppleResponse: (value) => { appleResponse = value; }, setAppleAvailable: (value) => { available = value; } };
}

function expand(node) {
  if (!node || typeof node !== "object") return node;
  if (typeof node.type === "function") return expand(node.type(node.props));
  return { ...node, props: { ...node.props, children: [node.props?.children].flat(Infinity).map(expand) } };
}
function find(node, predicate) {
  if (!node || typeof node !== "object") return undefined;
  if (predicate(node)) return node;
  return node.props.children.map((child) => find(child, predicate)).find(Boolean);
}

(async () => {
  const ios = providerFixture("ios", { signIn: new Error("A button tap must never start silent iOS restoration") });
  assert.equal((await ios.service.requestFederatedCredential("google")).credential.idToken, "synthetic-id-token");
  assert.deepEqual(ios.calls.map(([method]) => method), ["configure", "presentExplicitSignIn"]);
  await ios.service.requestFederatedCredential("google");
  assert.equal(ios.calls.filter(([method]) => method === "configure").length, 1);
  assert.equal(ios.calls.filter(([method]) => method === "presentExplicitSignIn").length, 2);
  assert.equal(ios.calls[0][1].offlineAccess, false);
  assert.equal(ios.calls[0][1].scopes, null);

  for (const [response, expected] of [
    [{ type: "cancelled" }, "cancelled"],
    [{ type: "success", data: { idToken: "" } }, "missing_credential"],
    [Object.assign(new Error("private provider payload"), { code: "NETWORK_ERROR" }), "network"],
    [Object.assign(new Error("private provider payload"), { code: "CONFIGURATION_ERROR" }), "configuration"],
  ]) {
    const fixture = providerFixture("ios", { presentExplicitSignIn: response });
    await assert.rejects(fixture.service.requestFederatedCredential("google"), (error) => error.code === expected && !error.message.includes("private provider payload"));
  }
  const android = providerFixture("android", { signIn: { type: "noSavedCredentialFound" }, createAccount: { type: "noSavedCredentialFound" } });
  await android.service.requestFederatedCredential("google");
  assert.deepEqual(android.calls.map(([method]) => method), ["configure", "playServices", "signIn", "createAccount", "presentExplicitSignIn"]);
  const androidSaved = providerFixture("android");
  await androidSaved.service.requestFederatedCredential("google");
  assert.deepEqual(androidSaved.calls.map(([method]) => method), ["configure", "playServices", "signIn"]);

  const apple = providerFixture("ios");
  const result = await apple.service.requestFederatedCredential("apple");
  const input = apple.calls.find(([method]) => method === "appleSignIn")[1];
  assert.equal(input.nonce, crypto.createHash("sha256").update(result.credential.rawNonce).digest("hex"));
  assert.equal(input.state.length, 32);
  apple.setAppleResponse(() => ({ state: "wrong-state", identityToken: "synthetic-token" }));
  await assert.rejects(apple.service.requestFederatedCredential("apple"), (error) => error.code === "interrupted");
  apple.setAppleResponse((value) => ({ state: value.state, identityToken: null }));
  await assert.rejects(apple.service.requestFederatedCredential("apple"), (error) => error.code === "missing_credential");
  apple.setAppleAvailable(false);
  await assert.rejects(apple.service.requestFederatedCredential("apple"), (error) => error.code === "configuration");

  const presses = [];
  const jsx = (type, props) => ({ type, props });
  const { FederatedAuthButtons } = load("components/FederatedAuthButtons.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { ActivityIndicator: "ActivityIndicator", Image: "Image", Pressable: "Pressable", Text: "Text", View: "View", Keyboard: { dismiss: () => presses.push("dismiss") }, StyleSheet: { create: (styles) => styles, hairlineWidth: 1 } },
    "react-i18next": { useTranslation: () => ({ t: (key) => key }) },
    "@/constants/theme": { Colors: {}, Radius: {}, Spacing: {}, Typography: {} },
    "@/hooks/useAuthProviderAvailability": { useAuthProviderAvailability: () => ({ showGoogle: true, showApple: true }) },
    "../assets/auth/google-sign-in-light.png": 1,
    "../assets/auth/apple-sign-in-black.png": 2,
  });
  const view = expand(FederatedAuthButtons({ loadingProvider: null, onProviderPress: (provider) => presses.push(provider) }));
  find(view, (node) => node.props.accessibilityLabel === "auth.continueWithGoogle").props.onPress();
  find(view, (node) => node.props.accessibilityLabel === "auth.continueWithApple").props.onPress();
  assert.deepEqual(presses, ["dismiss", "google", "dismiss", "apple"]);
  const busy = expand(FederatedAuthButtons({ loadingProvider: "google", onProviderPress: () => assert.fail("Busy provider must stay disabled") }));
  assert.equal(find(busy, (node) => node.props.accessibilityLabel === "auth.continueWithApple").props.disabled, true);
  console.log("iOS interactive Google flow, Android fallbacks, Apple nonce/state checks, and keyboard/button behavior passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
