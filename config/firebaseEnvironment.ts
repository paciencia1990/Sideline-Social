import type { FirebaseOptions } from "firebase/app";

export type FirebaseClientEnvironment = "development" | "staging" | "production";
export type FirebaseClientPlatform = "ios" | "android" | "web";
export const COACH_AI_STAGING_FIREBASE_PROJECT_ID = "sideline-social-staging-2026";

const PRODUCTION_CONFIG = Object.freeze({
  apiKey: "AIzaSyCG4ym5jJQPG724Pp_Da7yBj3wBdPEOdOs",
  authDomain: "sideline-squad.firebaseapp.com",
  projectId: "sideline-squad",
  storageBucket: "sideline-squad.firebasestorage.app",
  messagingSenderId: "903830626771",
  appIdIos: "1:903830626771:ios:548f99d119be8948dfcf26",
  appIdAndroid: "1:903830626771:android:01ec28e1c555059bdfcf26",
  databaseURL: "https://sideline-squad-default-rtdb.firebaseio.com",
});

type PublicFirebaseEnvironment = Readonly<Record<string, string | undefined>>;
type FirebaseSource = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  databaseURL: string;
  appIdIos: string;
  appIdAndroid: string;
};
const FIREBASE_VALUE_KEYS = [
  "EXPO_PUBLIC_FIREBASE_API_KEY",
  "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
  "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "EXPO_PUBLIC_FIREBASE_DATABASE_URL",
  "EXPO_PUBLIC_FIREBASE_APP_ID_IOS",
  "EXPO_PUBLIC_FIREBASE_APP_ID_ANDROID",
] as const;

export function resolveFirebaseClientConfig(
  environment: PublicFirebaseEnvironment,
  platform: FirebaseClientPlatform,
  coachAiBetaBuildValue?: string,
): { environment: FirebaseClientEnvironment; options: FirebaseOptions } {
  const target = readTarget(environment.EXPO_PUBLIC_FIREBASE_ENVIRONMENT);
  const suppliedValues = readSuppliedValues(environment);
  const usesBundledProduction = target === "production" && suppliedValues.length === 0;
  const source = usesBundledProduction
    ? PRODUCTION_CONFIG
    : {
        apiKey: required(environment.EXPO_PUBLIC_FIREBASE_API_KEY, "EXPO_PUBLIC_FIREBASE_API_KEY"),
        authDomain: required(environment.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN, "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN"),
        projectId: required(environment.EXPO_PUBLIC_FIREBASE_PROJECT_ID, "EXPO_PUBLIC_FIREBASE_PROJECT_ID"),
        storageBucket: required(environment.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET, "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET"),
        messagingSenderId: required(environment.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID, "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"),
        databaseURL: required(environment.EXPO_PUBLIC_FIREBASE_DATABASE_URL, "EXPO_PUBLIC_FIREBASE_DATABASE_URL"),
        appIdIos: required(environment.EXPO_PUBLIC_FIREBASE_APP_ID_IOS, "EXPO_PUBLIC_FIREBASE_APP_ID_IOS"),
        appIdAndroid: required(environment.EXPO_PUBLIC_FIREBASE_APP_ID_ANDROID, "EXPO_PUBLIC_FIREBASE_APP_ID_ANDROID"),
      };
  validateFirebaseSource(source, target);
  const appId = platform === "ios" ? source.appIdIos : source.appIdAndroid;
  const resolved = {
    environment: target,
    options: {
      apiKey: source.apiKey,
      authDomain: source.authDomain,
      projectId: source.projectId,
      storageBucket: source.storageBucket,
      messagingSenderId: source.messagingSenderId,
      appId,
      databaseURL: source.databaseURL,
    },
  };
  assertCoachAiBetaFirebaseIsolation(coachAiBetaBuildValue, resolved);
  return resolved;
}

export function assertCoachAiBetaFirebaseIsolation(
  coachAiBetaBuildValue: string | undefined,
  resolved: { environment: FirebaseClientEnvironment; options: FirebaseOptions },
) {
  if (coachAiBetaBuildValue !== "true") return;
  if (
    resolved.environment !== "staging"
    || resolved.options.projectId !== COACH_AI_STAGING_FIREBASE_PROJECT_ID
  ) {
    throw new Error(
      `Coach AI beta Firebase configuration must resolve to staging project ${COACH_AI_STAGING_FIREBASE_PROJECT_ID}.`,
    );
  }
}

function readTarget(value?: string): FirebaseClientEnvironment {
  const target = value?.trim() || "production";
  if (target !== "development" && target !== "staging" && target !== "production") {
    throw new Error("EXPO_PUBLIC_FIREBASE_ENVIRONMENT must be development, staging, or production.");
  }
  return target;
}

function readSuppliedValues(environment: PublicFirebaseEnvironment) {
  return FIREBASE_VALUE_KEYS.filter((key) => Boolean(environment[key]?.trim()));
}

function required(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required for the selected Firebase environment.`);
  return normalized;
}

function validateFirebaseSource(source: FirebaseSource, target: FirebaseClientEnvironment) {
  if (!/^[a-z][a-z0-9-]{4,29}$/i.test(source.projectId)) throw new Error("Firebase project ID is invalid.");
  if (!/^AIza[\w-]{20,}$/u.test(source.apiKey)) throw new Error("Firebase API key shape is invalid.");
  if (!/^\d{6,}$/u.test(source.messagingSenderId)) throw new Error("Firebase messaging sender ID is invalid.");
  if (!source.authDomain.endsWith(".firebaseapp.com") && !source.authDomain.endsWith(".web.app")) {
    throw new Error("Firebase auth domain is inconsistent.");
  }
  if (!source.storageBucket.startsWith(`${source.projectId}.`)) throw new Error("Firebase storage bucket does not match the project ID.");
  const databaseUrl = new URL(source.databaseURL);
  if (databaseUrl.protocol !== "https:" || !databaseUrl.hostname.startsWith(source.projectId)) {
    throw new Error("Firebase Realtime Database URL does not match the project ID.");
  }
  const appIdPattern = new RegExp(`^1:${source.messagingSenderId}:(?:ios|android):[a-z0-9]+$`, "i");
  if (!appIdPattern.test(source.appIdIos) || !source.appIdIos.includes(":ios:")) throw new Error("Firebase iOS app ID is inconsistent.");
  if (!appIdPattern.test(source.appIdAndroid) || !source.appIdAndroid.includes(":android:")) throw new Error("Firebase Android app ID is inconsistent.");
  if (target !== "production" && source.projectId === PRODUCTION_CONFIG.projectId) {
    throw new Error("A non-production Firebase environment cannot target the production project.");
  }
}
