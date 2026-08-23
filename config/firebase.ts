import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp } from "firebase/app";
import type { FirebaseOptions } from "firebase/app";
import {
  getAuth,
  initializeAuth,
  type Auth,
  type Persistence,
} from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";
import { Platform } from "react-native";

import { resolveFirebaseClientConfig } from "@/config/firebaseEnvironment";

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
const firebaseConfig: FirebaseOptions = resolveFirebaseClientConfig(
  firebaseClientEnvironment,
  firebasePlatform,
  coachAiBetaBuildValue,
  coachAiProductionBetaBuildValue,
).options;

export const firebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);
export const app = firebaseApp;

export const auth = initializeReactNativeAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const functions = getFunctions(firebaseApp, "us-central1");
export const storage = getStorage(firebaseApp);
export const rtdb = getDatabase(firebaseApp);

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
