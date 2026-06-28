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
import { getStorage } from "firebase/storage";

const firebaseConfig: FirebaseOptions = {
  apiKey: "AIzaSyCG4ym5jJQPG724Pp_Da7yBj3wBdPEOdOs",
  authDomain: "sideline-squad.firebaseapp.com",
  projectId: "sideline-squad",
  storageBucket: "sideline-squad.firebasestorage.app",
  messagingSenderId: "903830626771",
  appId: "1:903830626771:android:01ec28e1c555059bdfcf26",
  databaseURL: "https://sideline-squad-default-rtdb.firebaseio.com",
};

export const firebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);
export const app = firebaseApp;

export const auth = initializeReactNativeAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
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
