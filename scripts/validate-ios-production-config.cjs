const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  SUPPORT_EMAIL,
  validateProductionLegalConfig,
} = require("../config/legalConfig");

const root = path.resolve(__dirname, "..");
const expectedBundleIdentifier = "com.sidelinesocial.app";
const expectedMarketingVersion = "1.0.0";
const expectedLocationUsage = "Sideline Social uses your location when you choose Find Nearby to discover sports communities near your current venue. Your precise location is not shown to other users.";
const expectedMicrophoneUsage = "Sideline Social uses your microphone only when you choose to record a voice message in a chat or team conversation.";
const expectedMotionUsage = "Sideline Social may use motion activity to support location features when you choose Find Nearby. Motion data is not displayed to other users.";
const expectedPhotoLibraryUsage = "Sideline Social lets you choose a photo when you send an image message in a private friend chat. Photo metadata is stripped before upload.";
const expectedSpanishMotionUsage = "Sideline Social puede usar la actividad de movimiento para admitir las funciones de ubicación cuando eliges Buscar cerca. Los datos de movimiento no se muestran a otros usuarios.";
const expectedSpanishPhotoLibraryUsage = "Sideline Social te permite elegir una foto cuando envías un mensaje con imagen en un chat privado de amistades. Los metadatos de la foto se eliminan antes de subirla.";
const failures = [];
const warnings = [];

function read(file) {
  return fs.readFileSync(path.join(root, file));
}

function readJson(file) {
  return JSON.parse(read(file).toString("utf8"));
}

function resolveProductionExpoConfig() {
  const expoCli = path.join(root, "node_modules", "expo", "bin", "cli");
  const output = execFileSync(
    process.execPath,
    [expoCli, "config", "--type", "introspect", "--json"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        APP_VARIANT: "production",
        REQUIRE_PRODUCTION_LEGAL_CONFIG: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const jsonStart = output.indexOf("{");
  if (jsonStart < 0) throw new Error("Expo config did not return JSON.");
  return JSON.parse(output.slice(jsonStart));
}

const icon = read("assets/images/icon-ios.png");
if (icon.toString("ascii", 1, 4) !== "PNG") failures.push("The iOS icon is not a PNG file.");
const width = icon.readUInt32BE(16);
const height = icon.readUInt32BE(20);
const colorType = icon[25];
if (width !== 1024 || height !== 1024) failures.push(`The iOS icon must be 1024x1024; found ${width}x${height}.`);
if (colorType === 4 || colorType === 6) failures.push("The iOS icon contains an alpha channel.");

const source = read("app.config.js").toString("utf8");
if (!source.includes(`const IOS_BUNDLE_IDENTIFIER = "${expectedBundleIdentifier}"`)) {
  failures.push(`Expected iOS bundle identifier ${expectedBundleIdentifier}.`);
}
if (!source.includes("supportsTablet: false")) failures.push("The first release must remain iPhone-only.");
if (!source.includes(`version: "${expectedMarketingVersion}"`)) {
  failures.push(`Expected marketing version ${expectedMarketingVersion}.`);
}
if (/buildNumber\s*:/u.test(source)) {
  failures.push("Local ios.buildNumber must remain unset because EAS remote app-version management is authoritative.");
}
if (source.includes("motionUsagePermission: false")) {
  failures.push("expo-location motionUsagePermission must not be false for the iOS production build.");
}

let resolvedConfig = null;
try {
  resolvedConfig = resolveProductionExpoConfig();
} catch (error) {
  failures.push(`Could not resolve the production Expo config: ${error instanceof Error ? error.message : String(error)}`);
}

if (resolvedConfig) {
  const infoPlist = resolvedConfig.ios?.infoPlist ?? {};
  if (resolvedConfig.version !== expectedMarketingVersion) {
    failures.push(`Resolved Expo config must keep marketing version ${expectedMarketingVersion}.`);
  }
  if (resolvedConfig.ios?.bundleIdentifier !== expectedBundleIdentifier) {
    failures.push(`Resolved Expo config must use bundle identifier ${expectedBundleIdentifier}.`);
  }
  if (infoPlist.NSLocationWhenInUseUsageDescription !== expectedLocationUsage) {
    failures.push("Resolved iOS Info.plist is missing the production location usage description.");
  }
  if (infoPlist.NSMicrophoneUsageDescription !== expectedMicrophoneUsage) {
    failures.push("Resolved iOS Info.plist is missing the production microphone usage description.");
  }
  if (infoPlist.NSMotionUsageDescription !== expectedMotionUsage) {
    failures.push("Resolved iOS Info.plist is missing the production motion usage description required by App Store Connect.");
  }
  if (infoPlist.NSPhotoLibraryUsageDescription !== expectedPhotoLibraryUsage) {
    failures.push("Resolved iOS Info.plist is missing the production photo-library usage description required for image messages.");
  }
  if (infoPlist.ITSAppUsesNonExemptEncryption !== false) {
    failures.push("Resolved iOS Info.plist must set ITSAppUsesNonExemptEncryption to false.");
  }
}

const englishLocale = readJson("config/locales/en.json");
const spanishLocale = readJson("config/locales/es.json");
const easConfig = readJson("eas.json");
if (englishLocale.ios?.NSMotionUsageDescription !== expectedMotionUsage) {
  failures.push("English localized iOS resources must include NSMotionUsageDescription.");
}
if (spanishLocale.ios?.NSMotionUsageDescription !== expectedSpanishMotionUsage) {
  failures.push("Spanish localized iOS resources must include NSMotionUsageDescription.");
}
if (englishLocale.ios?.NSPhotoLibraryUsageDescription !== expectedPhotoLibraryUsage) {
  failures.push("English localized iOS resources must include NSPhotoLibraryUsageDescription.");
}
if (spanishLocale.ios?.NSPhotoLibraryUsageDescription !== expectedSpanishPhotoLibraryUsage) {
  failures.push("Spanish localized iOS resources must include NSPhotoLibraryUsageDescription.");
}
if (easConfig.cli?.appVersionSource !== "remote") {
  failures.push("EAS must use remote app-version management for iOS production builds.");
}
if (easConfig.build?.production?.autoIncrement !== true) {
  failures.push("The EAS production profile must auto-increment the remote build number.");
}
if (easConfig.build?.production?.env?.APP_VARIANT !== "production") {
  failures.push("The EAS production profile must resolve the production Expo config.");
}

const nativeFirebaseFile = process.env.GOOGLE_SERVICES_INFO_PLIST;
if (nativeFirebaseFile) {
  const resolved = path.resolve(root, nativeFirebaseFile);
  if (!fs.existsSync(resolved)) {
    failures.push("GOOGLE_SERVICES_INFO_PLIST points to a missing file.");
  } else {
    const plist = fs.readFileSync(resolved, "utf8");
    const bundleMatch = /<key>BUNDLE_ID<\/key>\s*<string>([^<]+)<\/string>/u.exec(plist);
    if (bundleMatch?.[1] !== expectedBundleIdentifier) {
      failures.push(`The iOS Firebase plist bundle ID must be ${expectedBundleIdentifier}.`);
    }
  }
} else {
  const message = "No GOOGLE_SERVICES_INFO_PLIST was supplied. Firebase JS services can build, but the native iOS Firebase app remains externally unverified.";
  if (process.env.APP_STORE_SUBMISSION_READY === "true") failures.push(message);
  else warnings.push(message);
}

const legalConfig = validateProductionLegalConfig({
  privacyPolicyUrl: process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL,
  termsOfUseUrl: process.env.EXPO_PUBLIC_TERMS_OF_USE_URL,
  supportUrl: process.env.EXPO_PUBLIC_SUPPORT_URL,
  supportEmail: SUPPORT_EMAIL,
});
if (!legalConfig.valid) {
  if (process.env.APP_STORE_SUBMISSION_READY === "true") {
    failures.push(...legalConfig.errors);
  } else {
    warnings.push(
      `Production legal configuration remains incomplete. ${legalConfig.errors.join(" ")} Set APP_STORE_SUBMISSION_READY=true to enforce the submission gate.`,
    );
  }
}

for (const warning of warnings) console.warn(`WARNING: ${warning}`);
if (failures.length) {
  failures.forEach((failure) => console.error(`ERROR: ${failure}`));
  process.exitCode = 1;
} else {
  console.log("iOS production configuration validation passed.");
}
