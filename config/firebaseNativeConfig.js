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

function resolveStagingNativeFirebaseTarget({ stagingAcceptanceBuild, easBuildPlatform, easBuildProfile }) {
  if (!stagingAcceptanceBuild) return "all";
  const platform = easBuildPlatform || null;
  const profile = easBuildProfile || null;
  if (!platform && !profile) return "all";
  if (!platform || !profile) {
    throw new Error("Staging acceptance build platform context is incomplete.");
  }
  if (profile !== "staging-acceptance") {
    throw new Error("Staging acceptance build profile context is conflicting.");
  }
  if (platform !== "android") {
    throw new Error("The staging-acceptance profile is authorized only for Android native configuration.");
  }
  return "android";
}

function assertStagingNativeFirebaseConfig({
  androidFile,
  iosFile,
  projectId,
  authDomain,
  androidPackage,
  androidAppId,
  androidSha1,
  webClientId,
  iosBundleIdentifier,
  targetPlatform = "all",
}) {
  if (!new Set(["all", "android", "ios"]).has(targetPlatform)) {
    throw new Error("Staging Firebase target platform must be all, android, or ios.");
  }
  if (!projectId) {
    throw new Error("Staging Firebase requires a project ID.");
  }
  if (authDomain !== `${projectId}.firebaseapp.com`) {
    throw new Error("Staging Firebase authentication domain does not match the staging project.");
  }
  const requireAndroid = targetPlatform !== "ios";
  const requireIos = targetPlatform !== "android";
  if (requireAndroid && !androidFile) {
    throw new Error("Android staging Firebase configuration is required.");
  }
  if (requireIos && !iosFile) {
    throw new Error("iOS staging Firebase configuration is required.");
  }

  if (requireAndroid) {
    if (!androidAppId || !androidSha1) {
      throw new Error("Android staging Firebase app identity and signing SHA-1 are required.");
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
    const client = matchingAndroidClients[0];
    if (client?.client_info?.mobilesdk_app_id !== androidAppId) {
      throw new Error("Android staging Firebase app identity does not match EXPO_PUBLIC_FIREBASE_APP_ID_ANDROID.");
    }
    const oauthClients = Array.isArray(client.oauth_client) ? client.oauth_client : [];
    const normalizedSha1 = normalizeFingerprint(androidSha1);
    const matchingAndroidOauthClients = oauthClients.filter((oauthClient) =>
      oauthClient?.client_type === 1 &&
      oauthClient?.android_info?.package_name === androidPackage &&
      normalizeFingerprint(oauthClient?.android_info?.certificate_hash) === normalizedSha1
    );
    if (matchingAndroidOauthClients.length !== 1) {
      throw new Error("Android staging Firebase configuration must contain exactly one approved package and SHA-1 OAuth client.");
    }
    const webOauthClients = oauthClients.filter((oauthClient) =>
      oauthClient?.client_type === 3 && typeof oauthClient?.client_id === "string" && oauthClient.client_id.length > 0
    );
    if (webOauthClients.length !== 1) {
      throw new Error("Android staging Firebase configuration must contain exactly one web OAuth client.");
    }
    if (webClientId && webOauthClients[0].client_id !== webClientId) {
      throw new Error("Android staging Firebase configuration does not match the explicit web OAuth client.");
    }
  }

  if (requireIos) {
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
}

function normalizeFingerprint(value) {
  return typeof value === "string" ? value.replace(/:/gu, "").trim().toLowerCase() : "";
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
  resolveStagingNativeFirebaseTarget,
  shouldDeferStagingNativeFirebaseValidation,
};
