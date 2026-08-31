import type { FirebaseClientEnvironment } from "@/config/firebaseEnvironment";

export type FirebaseEmulatorSettings = Readonly<{
  host: string;
  authPort: number;
  firestorePort: number;
  databasePort: number;
  functionsPort: number;
}>;

type PublicFirebaseEmulatorEnvironment = Readonly<Record<string, string | undefined>>;

type FirebaseEmulatorRuntime = Readonly<{
  firebaseEnvironment: FirebaseClientEnvironment;
  isDevelopmentBuild: boolean;
}>;

const ENABLED_KEY = "EXPO_PUBLIC_FIREBASE_EMULATOR_ENABLED";
const HOST_KEY = "EXPO_PUBLIC_FIREBASE_EMULATOR_HOST";
const PORT_KEYS = Object.freeze({
  authPort: "EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT",
  firestorePort: "EXPO_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_PORT",
  databasePort: "EXPO_PUBLIC_FIREBASE_DATABASE_EMULATOR_PORT",
  functionsPort: "EXPO_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT",
});
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function resolveFirebaseEmulatorSettings(
  environment: PublicFirebaseEmulatorEnvironment,
  runtime: FirebaseEmulatorRuntime,
): FirebaseEmulatorSettings | null {
  const enabledValue = environment[ENABLED_KEY]?.trim();
  if (!enabledValue || enabledValue === "false") return null;
  if (enabledValue !== "true") {
    throw new Error(`${ENABLED_KEY} must be either true or false.`);
  }
  if (!runtime.isDevelopmentBuild) {
    throw new Error("Firebase emulators cannot be enabled in a production JavaScript build.");
  }
  if (runtime.firebaseEnvironment !== "development") {
    throw new Error("Firebase emulators require EXPO_PUBLIC_FIREBASE_ENVIRONMENT=development.");
  }

  const host = required(environment[HOST_KEY], HOST_KEY).toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`${HOST_KEY} must be a loopback host.`);
  }

  return Object.freeze({
    host,
    authPort: readPort(environment[PORT_KEYS.authPort], PORT_KEYS.authPort),
    firestorePort: readPort(environment[PORT_KEYS.firestorePort], PORT_KEYS.firestorePort),
    databasePort: readPort(environment[PORT_KEYS.databasePort], PORT_KEYS.databasePort),
    functionsPort: readPort(environment[PORT_KEYS.functionsPort], PORT_KEYS.functionsPort),
  });
}

export function parseSerializedFirebaseDefaults(value: string | undefined): unknown {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  try {
    return JSON.parse(normalized);
  } catch {
    throw new Error("Firebase defaults are invalid and emulator isolation cannot be verified.");
  }
}

export function assertNoImplicitFirebaseEmulatorDefaults(...defaults: unknown[]) {
  for (const value of defaults) {
    if (!isRecord(value) || !isRecord(value.emulatorHosts)) continue;
    if (Object.keys(value.emulatorHosts).length > 0) {
      throw new Error(
        "Implicit Firebase emulator defaults are not allowed; use the explicit development emulator configuration.",
      );
    }
  }
}

function readPort(value: string | undefined, name: string) {
  const normalized = required(value, name);
  if (!/^\d+$/u.test(normalized)) {
    throw new Error(`${name} must be an integer port.`);
  }
  const port = Number(normalized);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be between 1 and 65535.`);
  }
  return port;
}

function required(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required when Firebase emulators are enabled.`);
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
