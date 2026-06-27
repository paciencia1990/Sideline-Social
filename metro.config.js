const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

module.exports = (() => {
  const config = getDefaultConfig(__dirname);

  // Required for Expo SDK 54
  config.resolver.unstable_enablePackageExports = true;
  config.resolver.sourceExts.push("cjs");

  // Required for NativeWind
  const withNW = withNativeWind(config, { input: "./global.css" });

  return withNW;
})();