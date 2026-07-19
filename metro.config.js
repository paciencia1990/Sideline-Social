const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Firebase 10's React Native Auth entry is CommonJS while firebase/app's
// package export is ESM. Resolving both export conditions can create separate
// component registries, so use Metro's React Native/main-field resolution
// until Firebase is migrated to a version with consistent RN exports.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
