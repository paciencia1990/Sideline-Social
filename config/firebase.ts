import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp } from "firebase/app";
import type { FirebaseOptions } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  initializeAuth,
  type Auth,
  type Persistence,
} from "firebase/auth";
import { connectDatabaseEmulator, getDatabase } from "firebase/database";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";
import { Platform } from "react-native";

import { resolveFirebaseClientConfig } from "@/config/firebaseEnvironment";
import {
  assertNoImplicitFirebaseEmulatorDefaults,
  parseSerializedFirebaseDefaults,
  resolveFirebaseEmulatorSettings,
} from "@/config/firebaseEmulatorPolicy";

const firebasePlatform = Platform.OS === "ios" ? "ios" : Platform.OS === "web" ? "web" : "android";
const firebaseClientEnvironment = {
  EXPO_PUBLIC_FIREBASE_ENVIRONMENT: process.env.EXPO_PUBLIC_FIREBASE_ENVIRONMENT,
  EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  EXPO_PUBLIC_FIREBASE_DATABASE_URL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
  EXPO_PUBLIC_FIREBASE_APP_ID_IOS: process.env.EXPO_PUBLIC_FIREBASE_APP_ID_IOS,
  EXPO_PUBLIC_FIREBASE_APP_ID_ANDROID: process.env.EXPO_PUBLIC_FIREBASE_APP_ID_ANDROID,
};
const coachAiBetaBuildValue = process.env.EXPO_PUBLIC_AI_COACH_BETA_BUILD;
const coachAiProductionBetaBuildValue = process.env.EXPO_PUBLIC_AI_COACH_PRODUCTION_BETA_BUILD;
const resolvedFirebaseClientConfig = resolveFirebaseClientConfig(
  firebaseClientEnvironment,
  firebasePlatform,
  coachAiBetaBuildValue,
  coachAiProductionBetaBuildValue,
);
const firebaseConfig: FirebaseOptions = resolvedFirebaseClientConfig.options;
const firebaseEmulatorEnvironment = {
  EXPO_PUBLIC_FIREBASE_EMULATOR_ENABLED: process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_ENABLED,
  EXPO_PUBLIC_FIREBASE_EMULATOR_HOST: process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST,
  EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT: process.env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT,
  EXPO_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_PORT: process.env.EXPO_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_PORT,
  EXPO_PUBLIC_FIREBASE_DATABASE_EMULATOR_PORT: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_EMULATOR_PORT,
  EXPO_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT: process.env.EXPO_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT,
};
const firebaseRuntimeGlobal = globalThis as typeof globalThis & {
  __FIREBASE_DEFAULTS__?: unknown;
  __SIDELINE_FIREBASE_EMULATOR_SIGNATURE__?: string;
};

assertNoImplicitFirebaseEmulatorDefaults(
  firebaseRuntimeGlobal.__FIREBASE_DEFAULTS__,
  parseSerializedFirebaseDefaults(process.env.__FIREBASE_DEFAULTS__),
);

const firebaseEmulatorSettings = resolveFirebaseEmulatorSettings(
  firebaseEmulatorEnvironment,
  {
    firebaseEnvironment: resolvedFirebaseClientConfig.environment,
    isDevelopmentBuild: __DEV__,
  },
);

export const firebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);
export const app = firebaseApp;

const firebaseAuth = initializeReactNativeAuth(firebaseApp);
const firebaseDb = getFirestore(firebaseApp);
const firebaseFunctions = getFunctions(firebaseApp, "us-central1");
const firebaseRtdb = getDatabase(firebaseApp);

connectConfiguredFirebaseEmulators();

export const auth = firebaseAuth;
export const db = firebaseDb;
export const functions = firebaseFunctions;
export const storage = getStorage(firebaseApp);
export const rtdb = firebaseRtdb;

function connectConfiguredFirebaseEmulators() {
  const existingSignature = firebaseRuntimeGlobal.__SIDELINE_FIREBASE_EMULATOR_SIGNATURE__;
  if (!firebaseEmulatorSettings) {
    if (existingSignature) {
      throw new Error("Firebase emulator state cannot be disabled without a full application reload.");
    }
    return;
  }

  const signature = JSON.stringify(firebaseEmulatorSettings);
  if (existingSignature) {
    if (existingSignature !== signature) {
      throw new Error("Firebase emulator configuration changed without a full application reload.");
    }
    return;
  }

  const { host, authPort, firestorePort, databasePort, functionsPort } = firebaseEmulatorSettings;
  connectAuthEmulator(firebaseAuth, `http://${host}:${authPort}`, { disableWarnings: true });
  connectFirestoreEmulator(firebaseDb, host, firestorePort);
  connectDatabaseEmulator(firebaseRtdb, host, databasePort);
  connectFunctionsEmulator(firebaseFunctions, host, functionsPort);
  firebaseRuntimeGlobal.__SIDELINE_FIREBASE_EMULATOR_SIGNATURE__ = signature;
}

function initializeReactNativeAuth(firebaseAppInstance: typeof firebaseApp): Auth {
  try {
    return initializeAuth(firebaseAppInstance, {
      persistence: getAsyncStoragePersistence(ReactNativeAsyncStorage),
    });
  } catch {
    return getAuth(firebaseAppInstance);
  }
}

function getAsyncStoragePersistence(storage: typeof ReactNativeAsyncStorage): Persistence {
  class AsyncStoragePersistence {
    static type = "LOCAL";
    readonly type = "LOCAL";

    async _isAvailable() {
      try {
        if (!storage) {
          return false;
        }

        const testKey = "firebase:auth:storageTest";
        await storage.setItem(testKey, "1");
        await storage.removeItem(testKey);
        return true;
      } catch {
        return false;
      }
    }

    _set(key: string, value: unknown) {
      return storage.setItem(key, JSON.stringify(value));
    }

    async _get(key: string) {
      const value = await storage.getItem(key);
      return value ? JSON.parse(value) : null;
    }

    _remove(key: string) {
      return storage.removeItem(key);
    }

    _addListener() {}

    _removeListener() {}
  }

  return AsyncStoragePersistence as unknown as Persistence;
}
