const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const read = (...segments) => fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
const IOS_LOCATION_WHEN_IN_USE_USAGE_DESCRIPTION = "Sideline Social uses your location when you choose Find Nearby to discover sports communities near your current venue. Your precise location is not shown to other users.";
const IOS_MICROPHONE_USAGE_DESCRIPTION = "Sideline Social uses your microphone only when you choose to record a voice message in a chat or team conversation.";
const IOS_MOTION_USAGE_DESCRIPTION = "Sideline Social may use motion activity to support location features when you choose Find Nearby. Motion data is not displayed to other users.";
const IOS_MOTION_USAGE_DESCRIPTION_ES = "Sideline Social puede usar la actividad de movimiento para admitir las funciones de ubicación cuando eliges Buscar cerca. Los datos de movimiento no se muestran a otros usuarios.";
const IOS_PHOTO_LIBRARY_USAGE_DESCRIPTION = "Sideline Social lets you choose a photo when you send an image message in a private friend chat. Photo metadata is stripped before upload.";
const IOS_PHOTO_LIBRARY_USAGE_DESCRIPTION_ES = "Sideline Social te permite elegir una foto cuando envías un mensaje con imagen en un chat privado de amistades. Los metadatos de la foto se eliminan antes de subirla.";

function resolveProductionExpoConfig() {
  const expoCli = path.join(process.cwd(), "node_modules", "expo", "bin", "cli");
  const output = execFileSync(
    process.execPath,
    [expoCli, "config", "--type", "introspect", "--json"],
    {
      cwd: process.cwd(),
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
  assert.notEqual(jsonStart, -1, "Expo config introspection must return JSON.");
  return JSON.parse(output.slice(jsonStart));
}

const config = read("app.config.js");
const profile = read("app", "(tabs)", "profile.tsx");
const settings = read("app", "settings", "index.tsx");
const deleteScreen = read("app", "settings", "delete-account.tsx");
const accountService = read("services", "accountService.ts");
const deletionFunction = read("functions", "src", "accountDeletion.ts");
const notifications = read("components", "NotificationCoordinator.tsx");
const pushService = read("services", "notificationService.ts");
const validator = read("scripts", "validate-ios-production-config.cjs");
const legalValidator = read("config", "legalConfig.js");
const firebaseConfig = read("config", "firebase.ts");
const englishLocale = JSON.parse(read("config", "locales", "en.json"));
const spanishLocale = JSON.parse(read("config", "locales", "es.json"));
const eas = JSON.parse(read("eas.json"));
const resolvedConfig = resolveProductionExpoConfig();
const resolvedInfoPlist = resolvedConfig.ios?.infoPlist ?? {};

assert.equal(config.includes('bundleIdentifier: IOS_BUNDLE_IDENTIFIER'), true);
assert.equal(config.includes('supportsTablet: false'), true);
assert.equal(config.includes('version: "1.0.0"'), true);
assert.equal(/buildNumber\s*:/u.test(config), false);
assert.equal(profile.includes('router.push("/settings"'), true);
assert.equal(settings.includes("requestNotificationPermissionAndRegister"), true);
assert.equal(deleteScreen.includes('confirmation.trim().toUpperCase() === "DELETE"'), true);
assert.equal(deleteScreen.includes("Alert.alert"), true);
assert.equal(accountService.includes("reauthenticateWithCredential"), true);
assert.equal(accountService.includes('"deleteOwnAccount"'), true);
assert.equal(deletionFunction.includes("admin.auth().deleteUser(uid)"), true);
assert.equal(deletionFunction.includes("deleteRealtimeGameParticipation"), true);
assert.equal(deletionFunction.includes("anonymizeModerationReports"), true);
assert.equal(deletionFunction.includes("removeFriendRelationships"), true);
assert.equal(deletionFunction.includes("deleteVoiceUploadReservations"), true);
assert.equal(deletionFunction.includes("removeTriviaParticipation"), true);
assert.equal(deletionFunction.includes("anonymizeNotificationReferences"), true);
assert.equal(deletionFunction.indexOf("admin.auth().deleteUser(uid)") > deletionFunction.indexOf("deleteRealtimeGameParticipation(uid)"), true);
assert.equal(notifications.includes("Notifications.requestPermissionsAsync()"), false, "root coordinator must not prompt automatically");
assert.equal(pushService.includes("getExpoPushTokenAsync"), true);
const moderation = read("functions", "src", "contentModeration.ts");
const contentSafety = read("functions", "src", "contentSafety.ts");
assert.equal(moderation.includes("contentModerationReports"), true);
assert.equal(moderation.includes("alreadyReported"), true);
assert.equal(contentSafety.includes("content_not_allowed"), true);
assert.equal(validator.includes('APP_STORE_SUBMISSION_READY === "true"'), true);
assert.equal(validator.includes("GOOGLE_SERVICES_INFO_PLIST"), true);
assert.equal(validator.includes("validateProductionLegalConfig"), true);
assert.equal(legalValidator.includes("must be a valid public HTTPS URL"), true);
assert.equal(eas.cli.appVersionSource, "remote");
assert.equal(eas.build.production.autoIncrement, true);
assert.equal(eas.build.production.env.REQUIRE_PRODUCTION_LEGAL_CONFIG, "true");
assert.match(firebaseConfig, /Platform\.OS === "ios"[\s\S]*1:903830626771:ios:548f99d119be8948dfcf26/);
assert.match(config, /NSAppTransportSecurity:[\s\S]*NSAllowsArbitraryLoads:\s*false[\s\S]*NSAllowsLocalNetworking:\s*false/);
assert.match(config, /locationAlwaysAndWhenInUsePermission:\s*false/);
assert.match(config, /locationAlwaysPermission:\s*false/);
assert.equal(config.includes("motionUsagePermission: IOS_MOTION_USAGE_DESCRIPTION"), true);
assert.equal(config.includes("motionUsagePermission: false"), false);
assert.match(config, /record a voice message in a chat or team conversation/);
assert.equal(resolvedConfig.version, "1.0.0");
assert.equal(resolvedConfig.ios?.bundleIdentifier, "com.sidelinesocial.app");
assert.equal(resolvedInfoPlist.NSLocationWhenInUseUsageDescription, IOS_LOCATION_WHEN_IN_USE_USAGE_DESCRIPTION);
assert.equal(resolvedInfoPlist.NSMicrophoneUsageDescription, IOS_MICROPHONE_USAGE_DESCRIPTION);
assert.equal(resolvedInfoPlist.NSMotionUsageDescription, IOS_MOTION_USAGE_DESCRIPTION);
assert.equal(resolvedInfoPlist.NSPhotoLibraryUsageDescription, IOS_PHOTO_LIBRARY_USAGE_DESCRIPTION);
assert.equal(resolvedInfoPlist.ITSAppUsesNonExemptEncryption, false);
assert.equal(
  englishLocale.ios.NSMicrophoneUsageDescription,
  IOS_MICROPHONE_USAGE_DESCRIPTION,
);
assert.equal(
  englishLocale.ios.NSMotionUsageDescription,
  IOS_MOTION_USAGE_DESCRIPTION,
);
assert.equal(
  englishLocale.ios.NSPhotoLibraryUsageDescription,
  IOS_PHOTO_LIBRARY_USAGE_DESCRIPTION,
);
assert.equal(
  spanishLocale.ios.NSMicrophoneUsageDescription,
  "Sideline Social usa tu micrófono únicamente cuando eliges grabar un mensaje de voz en un chat o una conversación del equipo.",
);
assert.equal(
  spanishLocale.ios.NSMotionUsageDescription,
  IOS_MOTION_USAGE_DESCRIPTION_ES,
);
assert.equal(
  spanishLocale.ios.NSPhotoLibraryUsageDescription,
  IOS_PHOTO_LIBRARY_USAGE_DESCRIPTION_ES,
);

console.log("iOS config, contextual permissions, account deletion, and legal/settings discoverability checks passed.");
