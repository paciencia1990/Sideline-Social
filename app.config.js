module.exports = ({ config }) => ({
  ...config,

  owner: "paciencia1990",
  slug: "sideline-squad",
  name: "Sideline Social",
  version: "1.0.0",

  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "sidelinesquad",
  userInterfaceStyle: "automatic",
  newArchEnabled: false,

  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.sidelinesquad.app",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    package: "com.sidelinesquad.app",
    googleServicesFile: "./google-services.json",
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
    "expo-font",
    "expo-notifications",
    [
      "expo-location",
      {
        locationWhenInUsePermission: "Sideline Social uses your current location to find nearby sports communities. Your precise location is not shown to other parents.",
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
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
