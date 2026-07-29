const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (...segments) => fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");

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

assert.equal(config.includes('bundleIdentifier: IOS_BUNDLE_IDENTIFIER'), true);
assert.equal(config.includes('supportsTablet: false'), true);
assert.equal(config.includes('buildNumber: "1"'), true);
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
assert.equal(eas.build.production.env.REQUIRE_PRODUCTION_LEGAL_CONFIG, "true");
assert.match(firebaseConfig, /Platform\.OS === "ios"[\s\S]*1:903830626771:ios:548f99d119be8948dfcf26/);
assert.match(config, /NSAppTransportSecurity:[\s\S]*NSAllowsArbitraryLoads:\s*false[\s\S]*NSAllowsLocalNetworking:\s*false/);
assert.match(config, /locationAlwaysAndWhenInUsePermission:\s*false/);
assert.match(config, /locationAlwaysPermission:\s*false/);
assert.match(config, /motionUsagePermission:\s*false/);
assert.match(config, /record a voice message in a chat or team conversation/);
assert.equal(
  englishLocale.ios.NSMicrophoneUsageDescription,
  "Sideline Social uses your microphone only when you choose to record a voice message in a chat or team conversation.",
);
assert.equal(
  spanishLocale.ios.NSMicrophoneUsageDescription,
  "Sideline Social usa tu micrófono únicamente cuando eliges grabar un mensaje de voz en un chat o una conversación del equipo.",
);

console.log("iOS config, contextual permissions, account deletion, and legal/settings discoverability checks passed.");
