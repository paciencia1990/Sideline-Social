const {
  SUPPORT_EMAIL,
  assertProductionLegalConfig,
} = require("./config/legalConfig");

const IOS_BUNDLE_IDENTIFIER = "com.sidelinesocial.app";
const APP_VARIANT = process.env.APP_VARIANT === "development" ? "development" : "production";
const IS_DEVELOPMENT = APP_VARIANT === "development";
const ANDROID_PACKAGE = IS_DEVELOPMENT ? "com.sidelinesquad.app.dev" : "com.sidelinesquad.app";
const ANDROID_GOOGLE_SERVICES_FILE = IS_DEVELOPMENT
  ? process.env.GOOGLE_SERVICES_JSON_ANDROID_DEVELOPMENT
  : "./google-services.json";
const IOS_GOOGLE_SERVICES_FILE = process.env.GOOGLE_SERVICES_INFO_PLIST;
const GOOGLE_IOS_URL_SCHEME = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const GOOGLE_AUTH_ENABLED = process.env.EXPO_PUBLIC_GOOGLE_AUTH_ENABLED === "true";
const APPLE_AUTH_ENABLED = process.env.EXPO_PUBLIC_APPLE_AUTH_ENABLED === "true";
const GOOGLE_SIGN_IN_PLUGIN = IOS_GOOGLE_SERVICES_FILE
  ? [
      "react-native-nitro-google-signin",
      {
        iosGoogleServicesFile: IOS_GOOGLE_SERVICES_FILE,
        ...(ANDROID_GOOGLE_SERVICES_FILE
          ? { androidGoogleServicesFile: ANDROID_GOOGLE_SERVICES_FILE }
          : {}),
      },
    ]
  : GOOGLE_IOS_URL_SCHEME
    ? ["react-native-nitro-google-signin", { iosUrlScheme: GOOGLE_IOS_URL_SCHEME }]
    : null;
const APP_NAME = IS_DEVELOPMENT ? "Sideline Social Dev" : "Sideline Social";
const APP_SCHEME = IS_DEVELOPMENT ? "sidelinesquad-dev" : "sidelinesquad";
const IOS_LOCATION_WHEN_IN_USE_USAGE_DESCRIPTION = "Sideline Social uses your location when you choose Find Nearby to discover sports communities near your current venue. Your precise location is not shown to other users.";
const IOS_MICROPHONE_USAGE_DESCRIPTION = "Sideline Social uses your microphone only when you choose to record a voice message in a chat or team conversation.";
const IOS_MOTION_USAGE_DESCRIPTION = "Sideline Social may use motion activity to support location features when you choose Find Nearby. Motion data is not displayed to other users.";
const IOS_PHOTO_LIBRARY_USAGE_DESCRIPTION = "Sideline Social lets you choose a photo when you send an image message in a private friend chat. Photo metadata is stripped before upload.";
const IOS_PHOTO_LIBRARY_ADD_USAGE_DESCRIPTION = "Sideline Social saves a photo to your photo library only when you choose Save Photo.";
const IOS_CALENDAR_USAGE_DESCRIPTION = "Sideline Social adds a Team event to your calendar only when you choose Add to Calendar. It does not read or upload your other calendar events.";

if (!IS_DEVELOPMENT && process.env.REQUIRE_PRODUCTION_LEGAL_CONFIG === "true") {
  assertProductionLegalConfig({
    privacyPolicyUrl: process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL,
    termsOfUseUrl: process.env.EXPO_PUBLIC_TERMS_OF_USE_URL,
    supportUrl: process.env.EXPO_PUBLIC_SUPPORT_URL,
    supportEmail: SUPPORT_EMAIL,
  });
}

if (GOOGLE_AUTH_ENABLED && !GOOGLE_SIGN_IN_PLUGIN) {
  throw new Error(
    "Google authentication is enabled, but no verified iOS Google services file or URL scheme was supplied.",
  );
}
if (
  GOOGLE_AUTH_ENABLED &&
  !IOS_GOOGLE_SERVICES_FILE &&
  (!GOOGLE_IOS_CLIENT_ID || !GOOGLE_WEB_CLIENT_ID)
) {
  throw new Error(
    "Google authentication without an iOS Google services file requires public iOS and Web OAuth client IDs.",
  );
}

module.exports = ({ config }) => ({
  ...config,

  owner: "paciencia1990",
  slug: "sideline-squad",
  name: APP_NAME,
  version: "1.0.0",

  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: APP_SCHEME,
  userInterfaceStyle: "light",
  newArchEnabled: true,

  locales: {
    en: "./config/locales/en.json",
    es: "./config/locales/es.json",
  },

  ios: {
    supportsTablet: false,
    bundleIdentifier: IOS_BUNDLE_IDENTIFIER,
    usesAppleSignIn: true,
    icon: "./assets/images/icon-ios.png",
    ...(IOS_GOOGLE_SERVICES_FILE
      ? { googleServicesFile: IOS_GOOGLE_SERVICES_FILE }
      : {}),
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
      CFBundleDevelopmentRegion: "en",
      ITSAppUsesNonExemptEncryption: false,
      ...(!IS_DEVELOPMENT
        ? {
            NSAppTransportSecurity: {
              NSAllowsArbitraryLoads: false,
              NSAllowsLocalNetworking: false,
            },
          }
        : {}),
      NSLocationWhenInUseUsageDescription: IOS_LOCATION_WHEN_IN_USE_USAGE_DESCRIPTION,
      NSMicrophoneUsageDescription: IOS_MICROPHONE_USAGE_DESCRIPTION,
      NSMotionUsageDescription: IOS_MOTION_USAGE_DESCRIPTION,
      NSPhotoLibraryUsageDescription: IOS_PHOTO_LIBRARY_USAGE_DESCRIPTION,
      NSPhotoLibraryAddUsageDescription: IOS_PHOTO_LIBRARY_ADD_USAGE_DESCRIPTION,
      NSCalendarsUsageDescription: IOS_CALENDAR_USAGE_DESCRIPTION,
      NSCalendarsWriteOnlyAccessUsageDescription: IOS_CALENDAR_USAGE_DESCRIPTION,
    },
  },

  android: {
    package: ANDROID_PACKAGE,
    allowBackup: false,
    blockedPermissions: [
      "android.permission.ACCESS_MEDIA_LOCATION",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.READ_MEDIA_AUDIO",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
      "android.permission.READ_CALENDAR",
      "android.permission.WRITE_CALENDAR",
    ],
    versionCode: 5,
    softwareKeyboardLayoutMode: "resize",
    ...(ANDROID_GOOGLE_SERVICES_FILE
      ? { googleServicesFile: ANDROID_GOOGLE_SERVICES_FILE }
      : {}),
    permissions: ["android.permission.RECORD_AUDIO"],
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY,
      },
    },
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      backgroundColor: "#ffffff",
    },
  },

  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },

  plugins: [
    "./plugins/withAndroidBackupProtection",
    "expo-router",
    "expo-apple-authentication",
    ...(GOOGLE_SIGN_IN_PLUGIN ? [GOOGLE_SIGN_IN_PLUGIN] : []),
    "@react-native-community/datetimepicker",
    "expo-web-browser",
    "expo-asset",
    "expo-image",
    [
      "expo-image-picker",
      {
        cameraPermission: false,
        photosPermission: IOS_PHOTO_LIBRARY_USAGE_DESCRIPTION,
      },
    ],
    "expo-font",
    "expo-status-bar",
    "expo-notifications",
    [
      "expo-audio",
      {
        microphonePermission: "Sideline Social uses your microphone only when you choose to record a voice message in a chat or team conversation.",
        recordAudioAndroid: true,
        enableBackgroundRecording: false,
        enableBackgroundPlayback: false,
      },
    ],
    [
      "expo-location",
      {
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        locationWhenInUsePermission: IOS_LOCATION_WHEN_IN_USE_USAGE_DESCRIPTION,
        motionUsagePermission: IOS_MOTION_USAGE_DESCRIPTION,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/branding/sideline-social-logo.png",
        imageWidth: 220,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
      },
    ],
  ],

  experiments: {
    typedRoutes: false,
  },

  extra: {
    ...(config.extra || {}),
    authProviders: {
      appleEnabled: APPLE_AUTH_ENABLED,
      googleEnabled: GOOGLE_AUTH_ENABLED,
      googleIosClientId: GOOGLE_IOS_CLIENT_ID || null,
      googleWebClientId: GOOGLE_WEB_CLIENT_ID || "autoDetect",
    },
    eas: {
      ...((config.extra && config.extra.eas) || {}),
      projectId: "7ea7aaf2-355d-4aec-a175-82898c8cc0c7",
    },
  },
});
