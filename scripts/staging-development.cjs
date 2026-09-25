"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const PROJECT = "sideline-social-staging-2026";
const PACKAGE = "com.sidelinesquad.app.dev";
const SHA256 = "dcaeb844f874b548fe0f49eadc07438ff9d58ffb3a4ed3b475f955817dc89116";
const SHA1 = "81eab57c24356385d1565575c904ec403b7023ce";
const { assertStagingNativeFirebaseConfig } = require("../config/firebaseNativeConfig");

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw new Error("A required private configuration file is missing or invalid."); }
}
function makeEnvironment(config, native, parent = process.env) {
  const client = native.client?.filter(c => c.client_info?.android_client_info?.package_name === PACKAGE);
  requireValue(client?.length === 1, "Firebase file must contain exactly one staging development Android app.");
  requireValue(native.project_info?.project_id === PROJECT &&
    String(native.project_info.project_number) === "3090643405" &&
    native.project_info.storage_bucket === PROJECT + ".firebasestorage.app",
    "Firebase project, project number, or bucket does not match staging.");
  const androidClient = client[0];
  const web = androidClient.oauth_client?.filter(c => c.client_type === 3);
  requireValue(web?.length === 1, "Expected one staging web OAuth client.");
  requireValue(/^AIza[\w-]{20,}$/.test(config.mapsKey || ""), "The development Maps key is not configured.");
  // This receipt must come from a reviewed key-restriction check, not an assumed Play-key match.
  requireValue(config.mapsRestrictionsVerified === true &&
    config.mapsProject === PROJECT && config.mapsPackage === PACKAGE &&
    (config.mapsSha1 || "").replace(/:/g, "").toLowerCase() === SHA1,
    "The development Maps key needs a reviewed staging project/package/signing restriction check.");
  const env = { ...parent };
  for (const key of Object.keys(env)) {
    if (/^(EXPO_PUBLIC_|GOOGLE_SERVICES_|GOOGLE_MAPS_|EAS_BUILD|EAS_DEFER_|FIREBASE_|GCLOUD_PROJECT$|GOOGLE_CLOUD_PROJECT$|__FIREBASE_DEFAULTS__$)/.test(key)) delete env[key];
  }
  Object.assign(env, {
    APP_VARIANT: "development",
    EAS_BUILD_PROFILE: "staging-development",
    EAS_BUILD_PLATFORM: "android",
    EXPO_NO_DOTENV: "1",
    EXPO_PUBLIC_STAGING_DEVELOPMENT_BUILD: "true",
    EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "staging",
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: PROJECT,
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: PROJECT + ".firebaseapp.com",
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: native.project_info.storage_bucket,
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: String(native.project_info.project_number),
    EXPO_PUBLIC_FIREBASE_DATABASE_URL: native.project_info.firebase_url,
    EXPO_PUBLIC_FIREBASE_API_KEY: androidClient.api_key?.[0]?.current_key,
    EXPO_PUBLIC_FIREBASE_APP_ID_ANDROID: androidClient.client_info.mobilesdk_app_id,
    EXPO_PUBLIC_FIREBASE_APP_ID_IOS: "1:3090643405:ios:13e775e53da7c10f9dec84",
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: web[0].client_id,
    EXPO_PUBLIC_GOOGLE_AUTH_ENABLED: "true",
    EXPO_PUBLIC_AI_COACH_BETA_BUILD: "true",
    EXPO_PUBLIC_AI_COACH_TESTING_ENABLED: "true",
    EXPO_PUBLIC_PRIVACY_POLICY_URL: "https://www.joinsidelinesocial.com/privacy",
    EXPO_PUBLIC_TERMS_OF_USE_URL: "https://www.joinsidelinesocial.com/terms",
    EXPO_PUBLIC_SUPPORT_URL: "https://www.joinsidelinesocial.com/support",
    GOOGLE_SERVICES_JSON_ANDROID_STAGING: config.firebaseFile,
    GOOGLE_MAPS_API_KEY_ANDROID_STAGING_DEVELOPMENT: config.mapsKey,
  });
  requireValue(/^AIza[\w-]{20,}$/.test(env.EXPO_PUBLIC_FIREBASE_API_KEY || ""),
    "Firebase API configuration is missing.");
  requireValue(env.EXPO_PUBLIC_FIREBASE_DATABASE_URL === "https://" + PROJECT + "-default-rtdb.firebaseio.com",
    "The native Firebase file must identify the accepted staging Realtime Database.");
  assertStagingNativeFirebaseConfig({
    androidFile: config.firebaseFile, projectId: PROJECT,
    authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN, androidPackage: PACKAGE,
    androidAppId: env.EXPO_PUBLIC_FIREBASE_APP_ID_ANDROID, androidSha1: SHA1,
    webClientId: env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, targetPlatform: "android",
  });
  return env;
}
function captured(command, args, options = {}) {
  const result = spawnSync(command, args, { windowsHide: true, encoding: "utf8", ...options });
  requireValue(!result.error && result.status === 0, "A local tool check failed; no build or installation was continued.");
  return result.stdout;
}
function resolveAndroidSdk(config = {}, parent = process.env) {
  const candidate = config.androidSdk || parent.ANDROID_SDK_ROOT || parent.ANDROID_HOME ||
    (parent.LOCALAPPDATA ? path.join(parent.LOCALAPPDATA, "Android", "Sdk") : "");
  requireValue(path.isAbsolute(candidate || ""),
    "Android SDK location is unavailable. Set ANDROID_SDK_ROOT or configure androidSdk privately.");
  return path.resolve(candidate);
}
function resolveJavaHome(config = {}, parent = process.env, run = spawnSync) {
  const configured = config.javaHome || parent.JAVA_HOME;
  if (configured) {
    requireValue(path.isAbsolute(configured),
      "JAVA_HOME must be absolute when supplied through the environment or private configuration.");
    return path.resolve(configured);
  }
  const where = run("where.exe", ["keytool.exe"], { windowsHide: true, encoding: "utf8" });
  const keytool = where.error || where.status !== 0 ? "" : String(where.stdout || "").split(/\r?\n/u)[0].trim();
  requireValue(path.isAbsolute(keytool),
    "Java is unavailable. Set JAVA_HOME or configure javaHome privately.");
  return path.dirname(path.dirname(keytool));
}
function resolveAndroidSerial(config = {}, adb, run = spawnSync, parent = process.env) {
  const configured = config.deviceSerial || parent.ANDROID_SERIAL;
  if (configured) {
    requireValue(/^[A-Za-z0-9._:-]+$/u.test(configured),
      "The private Android device serial contains unsupported characters.");
    return configured;
  }
  const devices = run(adb, ["devices"], { windowsHide: true, encoding: "utf8" });
  requireValue(!devices.error && devices.status === 0,
    "Connected Android devices could not be inspected.");
  const connected = String(devices.stdout || "").split(/\r?\n/u)
    .map(line => line.match(/^([^\s]+)\s+device$/u)?.[1])
    .filter(Boolean);
  requireValue(connected.length === 1,
    "Connect exactly one authorized Android device or configure deviceSerial privately.");
  return connected[0];
}
function chooseShortBuildDrive(pathExists = fs.existsSync) {
  for (const letter of ["S", "T", "U", "V", "W", "X", "Y", "Z"]) {
    if (!pathExists(`${letter}:\\`)) return `${letter}:`;
  }
  throw new Error("No temporary drive letter is available for the Windows short-path build.");
}
function resolveGeneratedNativeCache(projectRoot = root) {
  const appRoot = path.resolve(projectRoot, "android", "app");
  const cache = path.resolve(appRoot, ".cxx");
  requireValue(cache.startsWith(appRoot + path.sep), "Generated native cache escaped the Android app directory.");
  return cache;
}
function createShortBuildRoot(projectRoot = root, { pathExists = fs.existsSync, run = spawnSync } = {}) {
  requireValue(path.isAbsolute(projectRoot), "The short-path project directory must be absolute.");
  const resolvedRoot = path.resolve(projectRoot);
  const parentRoot = path.dirname(resolvedRoot);
  requireValue(parentRoot !== resolvedRoot, "The project must not be a filesystem root.");
  const drive = chooseShortBuildDrive(pathExists);
  const subst = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "subst.exe");
  // Expo's package.json search stops before inspecting a drive root. Map the
  // parent so the project remains a child directory (for example S:\mobile).
  const result = run(subst, [drive, parentRoot], { windowsHide: true, encoding: "utf8" });
  requireValue(!result.error && result.status === 0, "The temporary Windows short-path mapping could not be created. No build started.");
  return {
    root: path.join(`${drive}\\`, path.basename(resolvedRoot)),
    release() {
      const cleanup = run(subst, [drive, "/D"], { windowsHide: true, encoding: "utf8" });
      if (cleanup.error || cleanup.status !== 0) {
        console.warn(`The build finished, but temporary drive ${drive} could not be removed automatically. Run: subst ${drive} /D`);
      }
    },
  };
}
function main(mode, configPath) {
  requireValue(["Check", "Build", "Start"].includes(mode), "Choose Check, Build, or Start.");
  requireValue(path.isAbsolute(configPath || ""), "Private configuration must use an absolute path.");
  const relativeConfig = path.relative(root, configPath);
  requireValue(relativeConfig === ".." || relativeConfig.startsWith(".." + path.sep) || path.isAbsolute(relativeConfig),
    "Keep private configuration outside the repository.");
  requireValue(fs.existsSync(configPath),
    "NOT READY: private staging-development configuration is missing. No build started. Existing staging Firebase, signing credentials, and a compatible Maps key must be prepared privately first.");
  const config = readJson(configPath);
  requireValue(path.isAbsolute(config.firebaseFile || ""), "Use an absolute Firebase file path.");
  const env = makeEnvironment(config, readJson(config.firebaseFile));
  const old = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env);
    const app = require("../app.config")({ config: {} });
    requireValue(app.android.package === PACKAGE && app.extra.eas.projectId === "7ea7aaf2-355d-4aec-a175-82898c8cc0c7",
      "Development app identity validation failed.");
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, old);
  }
  const sdk = resolveAndroidSdk(config, process.env);
  const javaHome = resolveJavaHome(config, process.env);
  env.JAVA_HOME = javaHome;
  env.ANDROID_HOME = sdk;
  env.ANDROID_SDK_ROOT = sdk;
  const inheritedPath = env.PATH || env.Path || "";
  delete env.Path;
  env.PATH = path.join(javaHome, "bin") + path.delimiter + inheritedPath;
  if (mode !== "Start") {
    requireValue(path.isAbsolute(config.signingCredentialsFile || ""), "Existing staging signing credentials must be supplied privately.");
    const signing = readJson(config.signingCredentialsFile).android?.keystore;
    requireValue(signing?.keystorePath && signing.keystorePassword && signing.keyAlias, "Incomplete staging signing credentials.");
    const keyFile = path.resolve(path.dirname(config.signingCredentialsFile), signing.keystorePath);
    const output = captured(path.join(javaHome, "bin", "keytool.exe"),
      ["-J-Duser.language=en", "-J-Duser.country=US", "-list", "-v", "-keystore", keyFile,
        "-alias", signing.keyAlias, "-storepass:env", "SIDELINE_CHECK_KEY_PASSWORD"],
      { env: { ...env, SIDELINE_CHECK_KEY_PASSWORD: signing.keystorePassword } });
    requireValue(output.match(/SHA256:\s*([A-Fa-f0-9:]+)/)?.[1]?.replace(/:/g, "").toLowerCase() === SHA256,
      "Signer mismatch. Do not uninstall staging or replace its data.");
    env.SIDELINE_STAGING_SIGNING_CREDENTIALS = config.signingCredentialsFile;
  }
  if (mode === "Check") {
    console.log("Local configuration and staging signer passed. No build, cloud request, installation, or device write occurred. Maps restrictions rely on the separately reviewed receipt.");
    return;
  }
  if (mode === "Build") {
    // Native codegen exceeds Win32's 260-character path limit from the task's long workspace.
    // Use one temporary drive mapping and discard only the generated CMake cache, which can
    // retain absolute paths from an older checkout. This does not clean source or dependencies.
    const shortBuild = createShortBuildRoot();
    let result;
    try {
      const nativeCache = resolveGeneratedNativeCache();
      if (fs.existsSync(nativeCache)) fs.rmSync(nativeCache, { recursive: true, force: true });
      result = spawnSync("gradlew.bat", [":app:assembleStagingDebug", "--no-daemon", "--console=plain"],
        { cwd: path.join(shortBuild.root, "android"), env, shell: true, stdio: "inherit", windowsHide: true });
    } finally {
      shortBuild.release();
    }
    requireValue(result?.status === 0, "Local development build failed. Nothing was installed.");
    console.log("Build completed. Have the APK independently checked for package, signer, version, and development launcher before installing it over staging. Do not uninstall either app.");
    return;
  }
  const adb = path.join(sdk, "platform-tools", "adb.exe");
  const deviceSerial = resolveAndroidSerial(config, adb);
  const packages = captured(adb, ["-s", deviceSerial, "shell", "dumpsys", "package", PACKAGE]);
  requireValue(packages.includes("DEBUGGABLE"), "A development client is not installed yet. Nothing was opened or installed.");
  captured(adb, ["-s", deviceSerial, "reverse", "tcp:8081", "tcp:8081"]);
  console.log("USB connection prepared. Open Sideline Social Staging Dev and connect to http://127.0.0.1:8081. Keep this terminal open; Ctrl+C stops Metro.");
  // On Windows, localhost can otherwise resolve to ::1 while ADB reverse
  // connects to host IPv4 localhost. Keep Metro localhost-only and make its
  // resolver choose 127.0.0.1 first.
  env.NODE_OPTIONS = [env.NODE_OPTIONS, "--dns-result-order=ipv4first"].filter(Boolean).join(" ");
  const result = spawnSync(process.execPath, [path.join(root, "node_modules", "expo", "bin", "cli"),
    "start", "--dev-client", "--localhost", "--port", "8081", "--clear"],
  { cwd: root, env, stdio: "inherit", windowsHide: true });
  captured(adb, ["-s", deviceSerial, "reverse", "--remove", "tcp:8081"]);
  process.exitCode = result.status || 0;
}
module.exports = {
  chooseShortBuildDrive,
  createShortBuildRoot,
  makeEnvironment,
  resolveAndroidSdk,
  resolveAndroidSerial,
  resolveGeneratedNativeCache,
  resolveJavaHome,
};
if (require.main === module) {
  try { main(process.argv[2] || "Check", process.argv[3]); }
  catch (error) {
    // Only locally constructed validation messages; do not print provider/credential bodies.
    console.error(error instanceof Error && !["SyntaxError", "TypeError"].includes(error.name)
      ? error.message : "Private development configuration validation failed.");
    process.exitCode = 1;
  }
}
