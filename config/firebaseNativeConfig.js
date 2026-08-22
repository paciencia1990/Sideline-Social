const fs = require("node:fs");

function shouldDeferStagingNativeFirebaseValidation({
  requested,
  isEasBuild,
  coachAiBetaBuild,
  coachAiTestingBuild,
  firebaseEnvironment,
}) {
  return Boolean(
    requested &&
    !isEasBuild &&
    coachAiBetaBuild &&
    coachAiTestingBuild &&
    firebaseEnvironment === "staging"
  );
}

function assertStagingNativeFirebaseConfig({ androidFile, iosFile, projectId, androidPackage, iosBundleIdentifier }) {
  if (!projectId || !androidFile || !iosFile) {
    throw new Error("Staging Firebase requires a project ID and both native service configuration files.");
  }
  const android = readJson(androidFile, "Android staging Firebase configuration");
  if (android?.project_info?.project_id !== projectId) {
    throw new Error("Android staging Firebase project ID does not match EXPO_PUBLIC_FIREBASE_PROJECT_ID.");
  }
  const matchingAndroidClients = Array.isArray(android.client)
    ? android.client.filter((client) => client?.client_info?.android_client_info?.package_name === androidPackage)
    : [];
  if (matchingAndroidClients.length !== 1) {
    throw new Error(`Android staging Firebase configuration must contain exactly one ${androidPackage} client.`);
  }

  const plist = readText(iosFile, "iOS staging Firebase configuration");
  if (readPlistString(plist, "PROJECT_ID") !== projectId) {
    throw new Error("iOS staging Firebase project ID does not match EXPO_PUBLIC_FIREBASE_PROJECT_ID.");
  }
  if (readPlistString(plist, "BUNDLE_ID") !== iosBundleIdentifier) {
    throw new Error(`iOS staging Firebase configuration must target ${iosBundleIdentifier}.`);
  }
  if (!readPlistString(plist, "GOOGLE_APP_ID")) {
    throw new Error("iOS staging Firebase configuration is missing GOOGLE_APP_ID.");
  }
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${label} is missing or invalid.`);
  }
}

function readText(file, label) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(`${label} is missing or invalid.`);
  }
}

function readPlistString(plist, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`<key>\\s*${escaped}\\s*</key>\\s*<string>([^<]+)</string>`, "u").exec(plist)?.[1]?.trim() || null;
}

module.exports = {
  assertStagingNativeFirebaseConfig,
  readPlistString,
  shouldDeferStagingNativeFirebaseValidation,
};
