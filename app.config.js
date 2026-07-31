const {
  SUPPORT_EMAIL,
  assertProductionLegalConfig,
} = require("./config/legalConfig");

const IOS_BUNDLE_IDENTIFIER = "com.sidelinesocial.app";
const APP_VARIANT = process.env.APP_VARIANT === "development" ? "development" : "production";
const IS_DEVELOPMENT = APP_VARIANT === "development";
const ANDROID_PACKAGE = IS_DEVELOPMENT ? "com.sidelinesquad.app.dev" : "com.sidelinesquad.app";
const APP_NAME = IS_DEVELOPMENT ? "Sideline Social Dev" : "Sideline Social";
const APP_SCHEME = IS_DEVELOPMENT ? "sidelinesquad-dev" : "sidelinesquad";
const IOS_LOCATION_WHEN_IN_USE_USAGE_DESCRIPTION = "Sideline Social uses your location when you choose Find Nearby to discover sports communities near your current venue. Your precise location is not shown to other users.";
const IOS_MICROPHONE_USAGE_DESCRIPTION = "Sideline Social uses your microphone only when you choose to record a voice message in a chat or team conversation.";
const IOS_MOTION_USAGE_DESCRIPTION = "Sideline Social may use motion activity to support location features when you choose Find Nearby. Motion data is not displayed to other users.";

if (!IS_DEVELOPMENT && process.env.REQUIRE_PRODUCTION_LEGAL_CONFIG === "true") {
  assertProductionLegalConfig({
    privacyPolicyUrl: process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL,
    termsOfUseUrl: process.env.EXPO_PUBLIC_TERMS_OF_USE_URL,
    supportUrl: process.env.EXPO_PUBLIC_SUPPORT_URL,
    supportEmail: SUPPORT_EMAIL,
  });
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
    icon: "./assets/images/icon-ios.png",
    ...(process.env.GOOGLE_SERVICES_INFO_PLIST
      ? { googleServicesFile: process.env.GOOGLE_SERVICES_INFO_PLIST }
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
    },
  },

  android: {
    package: ANDROID_PACKAGE,
    allowBackup: false,
    versionCode: 5,
    softwareKeyboardLayoutMode: "resize",
    ...(IS_DEVELOPMENT
      ? (process.env.GOOGLE_SERVICES_JSON_ANDROID_DEVELOPMENT
        ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON_ANDROID_DEVELOPMENT }
        : {})
      : { googleServicesFile: "./google-services.json" }),
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
    "@react-native-community/datetimepicker",
    "expo-web-browser",
    "expo-asset",
    "expo-image",
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
    eas: {
      ...((config.extra && config.extra.eas) || {}),
      projectId: "7ea7aaf2-355d-4aec-a175-82898c8cc0c7",
    },
  },
});
