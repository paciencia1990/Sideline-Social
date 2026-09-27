import type { FirebaseApp } from "firebase/app";
import {
  CustomProvider,
  getToken as getJsAppCheckToken,
  initializeAppCheck as initializeJsAppCheck,
} from "firebase/app-check";
import { Platform } from "react-native";

import {
  APP_CHECK_BRIDGE_CACHE_MILLIS,
  assertMatchingFirebaseAppIdentity,
  type FirebaseAppCheckStatus,
  STORE_APP_CHECK_PROVIDERS,
} from "@/config/firebaseAppCheckCore";

type StatusListener = (status: FirebaseAppCheckStatus) => void;

let status: FirebaseAppCheckStatus = "initializing";
let readinessPromise: Promise<void> | null = null;
const listeners = new Set<StatusListener>();

export function startFirebaseAppCheck(firebaseApp: FirebaseApp) {
  if (!readinessPromise) {
    readinessPromise = initializeFirebaseAppCheck(firebaseApp)
      .then(() => setStatus("ready"))
      .catch(() => {
        setStatus("failed");
        throw new Error("app-check/unavailable");
      });
    readinessPromise.catch(() => undefined);
  }
  return readinessPromise;
}

export async function requireFirebaseAppCheckReady() {
  if (!readinessPromise) throw new Error("app-check/not-started");
  await readinessPromise;
  if (status !== "ready") throw new Error("app-check/unavailable");
}

export function getFirebaseAppCheckStatus() {
  return status;
}

export function subscribeToFirebaseAppCheckStatus(listener: StatusListener) {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

async function initializeFirebaseAppCheck(firebaseApp: FirebaseApp) {
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    throw new Error("app-check/unsupported-platform");
  }

  // These dynamic imports let an older development client fail closed without
  // crashing while the new native modules await the next reviewed build.
  const nativeAppModule = await import("@react-native-firebase/app");
  const nativeAppCheckModule = await import("@react-native-firebase/app-check");
  const nativeApp = nativeAppModule.getApp();

  assertMatchingFirebaseAppIdentity(
    { appId: firebaseApp.options.appId, projectId: firebaseApp.options.projectId },
    { appId: nativeApp.options.appId, projectId: nativeApp.options.projectId },
  );

  const nativeProvider = new nativeAppCheckModule.ReactNativeFirebaseAppCheckProvider();
  nativeProvider.configure({
    android: { provider: STORE_APP_CHECK_PROVIDERS.android },
    apple: { provider: STORE_APP_CHECK_PROVIDERS.apple },
  });
  const nativeAppCheck = nativeAppCheckModule.initializeAppCheck(nativeApp, {
    provider: nativeProvider,
    isTokenAutoRefreshEnabled: true,
  });

  const jsProvider = new CustomProvider({
    getToken: async () => {
      const result = await nativeAppCheckModule.getToken(nativeAppCheck, false);
      if (!result.token) throw new Error("app-check/token-unavailable");
      return {
        token: result.token,
        // The native SDK owns the real token lifetime and refresh. This shorter
        // bridge lifetime prevents the JS SDK from retaining a native token too long.
        expireTimeMillis: Date.now() + APP_CHECK_BRIDGE_CACHE_MILLIS,
      };
    },
  });
  const jsAppCheck = initializeJsAppCheck(firebaseApp, {
    provider: jsProvider,
    isTokenAutoRefreshEnabled: true,
  });

  // A ready state means attestation succeeded, not merely that modules loaded.
  await getJsAppCheckToken(jsAppCheck, false);
}

function setStatus(nextStatus: FirebaseAppCheckStatus) {
  status = nextStatus;
  for (const listener of listeners) listener(nextStatus);
}
