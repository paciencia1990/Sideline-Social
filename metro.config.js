const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);

// Firebase 10's React Native Auth entry is CommonJS while firebase/app's
// package export is ESM. Resolving both export conditions can create separate
// component registries, so use Metro's React Native/main-field resolution
// until Firebase is migrated to a version with consistent RN exports.
config.resolver.unstable_enablePackageExports = false;

const previousResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "decode-uri-component") {
    return {
      type: "sourceFile",
      filePath: path.join(__dirname, "config", "safeUriDecoder.cjs"),
    };
  }
  return previousResolveRequest
    ? previousResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
