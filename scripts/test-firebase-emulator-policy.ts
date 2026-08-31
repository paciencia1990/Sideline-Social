import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  assertNoImplicitFirebaseEmulatorDefaults,
  parseSerializedFirebaseDefaults,
  resolveFirebaseEmulatorSettings,
} from "../config/firebaseEmulatorPolicy";

const completeEnvironment = {
  EXPO_PUBLIC_FIREBASE_EMULATOR_ENABLED: "true",
  EXPO_PUBLIC_FIREBASE_EMULATOR_HOST: "127.0.0.1",
  EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT: "9099",
  EXPO_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_PORT: "8080",
  EXPO_PUBLIC_FIREBASE_DATABASE_EMULATOR_PORT: "9000",
  EXPO_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT: "5001",
};

assert.deepEqual(
  resolveFirebaseEmulatorSettings(completeEnvironment, {
    firebaseEnvironment: "development",
    isDevelopmentBuild: true,
  }),
  {
    host: "127.0.0.1",
    authPort: 9099,
    firestorePort: 8080,
    databasePort: 9000,
    functionsPort: 5001,
  },
);

assert.equal(
  resolveFirebaseEmulatorSettings({}, {
    firebaseEnvironment: "production",
    isDevelopmentBuild: false,
  }),
  null,
);
assert.equal(
  resolveFirebaseEmulatorSettings({ EXPO_PUBLIC_FIREBASE_EMULATOR_ENABLED: "false" }, {
    firebaseEnvironment: "production",
    isDevelopmentBuild: false,
  }),
  null,
);
assert.throws(
  () => resolveFirebaseEmulatorSettings(completeEnvironment, {
    firebaseEnvironment: "development",
    isDevelopmentBuild: false,
  }),
  /cannot be enabled in a production JavaScript build/,
);
assert.throws(
  () => resolveFirebaseEmulatorSettings(completeEnvironment, {
    firebaseEnvironment: "production",
    isDevelopmentBuild: true,
  }),
  /require EXPO_PUBLIC_FIREBASE_ENVIRONMENT=development/,
);
assert.throws(
  () => resolveFirebaseEmulatorSettings({
    ...completeEnvironment,
    EXPO_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT: undefined,
  }, {
    firebaseEnvironment: "development",
    isDevelopmentBuild: true,
  }),
  /EXPO_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT is required/,
);
assert.throws(
  () => resolveFirebaseEmulatorSettings({
    ...completeEnvironment,
    EXPO_PUBLIC_FIREBASE_EMULATOR_HOST: "192.0.2.10",
  }, {
    firebaseEnvironment: "development",
    isDevelopmentBuild: true,
  }),
  /must be a loopback host/,
);
assert.throws(
  () => resolveFirebaseEmulatorSettings({
    ...completeEnvironment,
    EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT: "0",
  }, {
    firebaseEnvironment: "development",
    isDevelopmentBuild: true,
  }),
  /must be between 1 and 65535/,
);
assert.throws(
  () => resolveFirebaseEmulatorSettings({
    ...completeEnvironment,
    EXPO_PUBLIC_FIREBASE_EMULATOR_ENABLED: "yes",
  }, {
    firebaseEnvironment: "development",
    isDevelopmentBuild: true,
  }),
  /must be either true or false/,
);

assert.doesNotThrow(() => assertNoImplicitFirebaseEmulatorDefaults(undefined, {}));
assert.throws(
  () => assertNoImplicitFirebaseEmulatorDefaults({ emulatorHosts: { functions: "127.0.0.1:5001" } }),
  /Implicit Firebase emulator defaults are not allowed/,
);
assert.deepEqual(parseSerializedFirebaseDefaults('{"emulatorHosts":{}}'), { emulatorHosts: {} });
assert.throws(
  () => parseSerializedFirebaseDefaults("not-json"),
  /emulator isolation cannot be verified/,
);

const firebaseSource = fs.readFileSync(path.resolve(__dirname, "../config/firebase.ts"), "utf8");
for (const connector of [
  "connectAuthEmulator",
  "connectFirestoreEmulator",
  "connectDatabaseEmulator",
  "connectFunctionsEmulator",
]) {
  assert.match(firebaseSource, new RegExp(`\\b${connector}\\b`));
}
assert.ok(
  firebaseSource.indexOf("assertNoImplicitFirebaseEmulatorDefaults(")
    < firebaseSource.indexOf("initializeApp(firebaseConfig)"),
  "implicit emulator defaults must be rejected before Firebase initialization",
);
assert.ok(
  firebaseSource.indexOf("resolveFirebaseEmulatorSettings(")
    < firebaseSource.indexOf("initializeApp(firebaseConfig)"),
  "the explicit emulator policy must be resolved before Firebase initialization",
);
assert.match(firebaseSource, /isDevelopmentBuild:\s*__DEV__/u);

console.log("Development-only Firebase emulator policy and client wiring tests passed.");
