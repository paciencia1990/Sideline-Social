"use strict";

/**
 * The Android project is intentionally tracked and authoritative, while iOS is
 * intentionally generated from app.config.js. Expo Doctor's native-sync check
 * is disabled only because this test protects the mixed strategy. The exact
 * Google Sign-In directory exclusion is justified by the installed Nitro/JSI
 * implementation evidence below and must never broaden to the full check.
 */

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { AndroidConfig } = require("@expo/config-plugins");

const root = path.resolve(__dirname, "..");
const androidRoot = path.join(root, "android");
const androidResRoot = path.join(androidRoot, "app", "src", "main", "res");

const EXPECTED_ASSET_HASHES = {
  "assets/branding/sideline-social-logo.png": "bfd265dc427c7a7e58d3525cf73811abd964944b44350081ff1ce33b9fe9112a",
  "assets/images/adaptive-icon.png": "5f4c0a732b6325bf4071d9124d2ae67e037cb24fcc9c482ef82bea742109a3b8",
  "assets/images/icon.png": "74c64047eb557b1341bba7a2831eedde9ddb705e6451a9ad9f5552bf558f13de",
};
const EXPECTED_LAUNCHER_SET_HASH = "bfb797ab78a5092d94e35d7aebdab63cdeb4103a1e80e74646093cf0803ce19f";
const EXPECTED_SPLASH_SET_HASH = "7cacef8aee5872061d5d393a7d8d7bf307d8c866fb8440bf45f08e0589bfec90";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function digestFiles(baseDirectory, relativePaths) {
  const hash = crypto.createHash("sha256");
  for (const relativePath of [...relativePaths].sort()) {
    hash.update(relativePath.replaceAll("\\", "/"));
    hash.update(Buffer.from([0]));
    const contents = fs.readFileSync(path.join(baseDirectory, relativePath));
    hash.update(path.extname(relativePath) === ".xml"
      ? contents.toString("utf8").replace(/\r\n/g, "\n")
      : contents);
  }
  return hash.digest("hex");
}

function filesMatching(directory, predicate, baseDirectory = directory) {
  const matches = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...filesMatching(absolutePath, predicate, baseDirectory));
    } else if (predicate(absolutePath)) {
      matches.push(path.relative(baseDirectory, absolutePath));
    }
  }
  return matches;
}

function resolveConfig(environment) {
  const keys = Object.keys(environment);
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const configPath = path.join(root, "app.config.js");
    delete require.cache[require.resolve(configPath)];
    return require(configPath)({ config: {} });
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function resolveIntrospectedConfig(variant) {
  const expoCli = path.join(root, "node_modules", "expo", "bin", "cli");
  const output = execFileSync(
    process.execPath,
    [expoCli, "config", "--type", "introspect", "--json"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        APP_VARIANT: variant,
        EXPO_PUBLIC_APPLE_AUTH_ENABLED: "false",
        EXPO_PUBLIC_GOOGLE_AUTH_ENABLED: "false",
        GOOGLE_SERVICES_INFO_PLIST: "",
        GOOGLE_SERVICES_JSON_ANDROID_DEVELOPMENT: "",
        REQUIRE_PRODUCTION_LEGAL_CONFIG: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const jsonStart = output.indexOf("{");
  assert.notEqual(jsonStart, -1, `${variant} Expo config introspection must return JSON.`);
  return JSON.parse(output.slice(jsonStart));
}

function pluginNames(config) {
  return config.plugins.map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
}

function findPlugin(config, name) {
  return config.plugins.find((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === name);
}

function assertConfigStrategy(packageJson) {
  assert.equal(fs.existsSync(androidRoot), true, "The authoritative Android project must remain checked in.");
  assert.equal(fs.existsSync(path.join(root, "ios")), false, "iOS must remain CNG-managed and absent from source control.");

  const rootGitignore = read(".gitignore");
  assert.doesNotMatch(rootGitignore, /^\/?android\/?$/mu, "The authoritative Android project must not be ignored.");
  assert.match(rootGitignore, /android\/app\/src\/debug\/google-services\.json/u);

  assert.deepEqual(packageJson.expo?.doctor?.appConfigFieldsNotSyncedCheck, { enabled: false });
  assert.deepEqual(packageJson.expo?.doctor?.reactNativeDirectoryCheck, {
    enabled: true,
    exclude: ["react-native-nitro-google-signin"],
    listUnknownPackages: true,
  });
}

function assertResolvedConfig() {
  const production = resolveConfig({
    APP_VARIANT: "production",
    EXPO_PUBLIC_APPLE_AUTH_ENABLED: "true",
    EXPO_PUBLIC_GOOGLE_AUTH_ENABLED: "true",
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: "parity-ios-client",
    EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME: "com.googleusercontent.apps.parity",
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "parity-web-client",
    GOOGLE_SERVICES_INFO_PLIST: undefined,
    REQUIRE_PRODUCTION_LEGAL_CONFIG: "false",
  });
  const development = resolveConfig({
    APP_VARIANT: "development",
    EXPO_PUBLIC_APPLE_AUTH_ENABLED: "false",
    EXPO_PUBLIC_GOOGLE_AUTH_ENABLED: "false",
    GOOGLE_SERVICES_INFO_PLIST: undefined,
  });

  assert.equal(production.name, "Sideline Social");
  assert.equal(production.android.package, "com.sidelinesquad.app");
  assert.equal(production.ios.bundleIdentifier, "com.sidelinesocial.app");
  assert.equal(production.scheme, "sidelinesquad");
  assert.equal(development.name, "Sideline Social Dev");
  assert.equal(development.android.package, "com.sidelinesquad.app.dev");
  assert.equal(development.ios.bundleIdentifier, "com.sidelinesocial.app");
  assert.equal(development.scheme, "sidelinesquad-dev");

  for (const config of [production, development]) {
    assert.equal(config.orientation, "portrait");
    assert.equal(config.userInterfaceStyle, "light");
    assert.equal(config.newArchEnabled, true);
    assert.equal(config.android.allowBackup, false);
    assert.equal(config.android.softwareKeyboardLayoutMode, "resize");
    assert.equal(config.android.adaptiveIcon.foregroundImage, "./assets/images/adaptive-icon.png");
    assert.equal(config.android.adaptiveIcon.backgroundColor, "#ffffff");
    assert.equal(config.ios.supportsTablet, false);
    assert.equal(config.ios.usesAppleSignIn, true);
  }

  const expectedPlugins = [
    "./plugins/withAndroidBackupProtection",
    "@react-native-community/datetimepicker",
    "expo-apple-authentication",
    "expo-asset",
    "expo-audio",
    "expo-calendar",
    "expo-font",
    "expo-image",
    "expo-image-picker",
    "expo-location",
    "expo-notifications",
    "expo-router",
    "expo-splash-screen",
    "expo-status-bar",
    "expo-web-browser",
  ];
  const productionPlugins = pluginNames(production);
  for (const plugin of expectedPlugins) assert.equal(productionPlugins.includes(plugin), true, `${plugin} must remain configured.`);

  const googlePlugin = findPlugin(production, "react-native-nitro-google-signin");
  assert.deepEqual(googlePlugin, [
    "react-native-nitro-google-signin",
    { iosUrlScheme: "com.googleusercontent.apps.parity" },
  ]);
  assert.equal(production.android.googleServicesFile, "./google-services.json");

  const splashPlugin = findPlugin(production, "expo-splash-screen");
  assert.deepEqual(splashPlugin, [
    "expo-splash-screen",
    {
      image: "./assets/branding/sideline-social-logo.png",
      imageWidth: 220,
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },
  ]);

  const requiredIosDescriptions = [
    "NSCalendarsUsageDescription",
    "NSCalendarsWriteOnlyAccessUsageDescription",
    "NSLocationWhenInUseUsageDescription",
    "NSMicrophoneUsageDescription",
    "NSMotionUsageDescription",
    "NSPhotoLibraryAddUsageDescription",
    "NSPhotoLibraryUsageDescription",
  ];
  for (const key of requiredIosDescriptions) assert.equal(typeof production.ios.infoPlist[key], "string", `${key} must be configured.`);
  for (const locale of [readJson("config/locales/en.json"), readJson("config/locales/es.json")]) {
    assert.equal(locale.android.app_name, "Sideline Social");
    for (const key of requiredIosDescriptions) assert.equal(typeof locale.ios[key], "string", `${key} must be localized.`);
  }

  const introspectedProduction = resolveIntrospectedConfig("production");
  const introspectedDevelopment = resolveIntrospectedConfig("development");
  assert.equal(introspectedProduction.android.package, "com.sidelinesquad.app");
  assert.equal(introspectedDevelopment.android.package, "com.sidelinesquad.app.dev");
  assert.equal(introspectedProduction.ios.bundleIdentifier, "com.sidelinesocial.app");
  assert.equal(introspectedDevelopment.ios.bundleIdentifier, "com.sidelinesocial.app");
  assert.deepEqual(
    introspectedProduction.ios.entitlements?.["com.apple.developer.applesignin"],
    ["Default"],
  );
  assert.deepEqual(
    introspectedDevelopment.ios.entitlements?.["com.apple.developer.applesignin"],
    ["Default"],
  );
  for (const resolved of [introspectedProduction, introspectedDevelopment]) {
    const resolvedPermissions = resolved._internal?.modResults?.android?.manifest?.manifest?.["uses-permission"] ?? [];
    const calendarPermissions = resolvedPermissions.filter((permission) =>
      permission?.$?.["android:name"]?.includes("CALENDAR"),
    );
    assert.deepEqual(
      calendarPermissions.map((permission) => permission.$["android:name"]).sort(),
      ["android.permission.READ_CALENDAR", "android.permission.WRITE_CALENDAR"],
    );
    assert.equal(calendarPermissions.every((permission) => permission.$["tools:node"] === "remove"), true);
  }
}

async function assertAndroidNativeParity() {
  const manifestPath = path.join(androidRoot, "app", "src", "main", "AndroidManifest.xml");
  const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
  const applicationAttributes = application.$;
  const activityAttributes = activity.$;

  assert.equal(applicationAttributes["android:allowBackup"], "false");
  assert.equal(applicationAttributes["android:fullBackupContent"], "@xml/backup_rules");
  assert.equal(applicationAttributes["android:dataExtractionRules"], "@xml/data_extraction_rules");
  assert.equal(applicationAttributes["android:icon"], "@mipmap/ic_launcher");
  assert.equal(applicationAttributes["android:roundIcon"], "@mipmap/ic_launcher_round");
  assert.equal(activityAttributes["android:screenOrientation"], "portrait");
  assert.equal(activityAttributes["android:windowSoftInputMode"], "adjustResize");

  const permissions = new Map(
    (manifest.manifest["uses-permission"] ?? []).map((permission) => [permission.$["android:name"], permission.$]),
  );
  for (const permission of [
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.INTERNET",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.RECORD_AUDIO",
    "android.permission.VIBRATE",
  ]) assert.equal(permissions.has(permission), true, `${permission} must remain granted.`);
  for (const permission of [
    "android.permission.ACCESS_MEDIA_LOCATION",
    "android.permission.CAMERA",
    "android.permission.READ_CALENDAR",
    "android.permission.READ_MEDIA_AUDIO",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
    "android.permission.WRITE_CALENDAR",
  ]) {
    assert.equal(
      !permissions.has(permission) || permissions.get(permission)["tools:node"] === "remove",
      true,
      `${permission} must be absent or explicitly removed.`,
    );
  }

  const metadata = new Map((application["meta-data"] ?? []).map((entry) => [entry.$["android:name"], entry.$]));
  assert.equal(metadata.get("com.google.android.geo.API_KEY")?.["android:value"], "${GOOGLE_MAPS_API_KEY}");

  const deepLinkFilter = activity["intent-filter"].find((filter) =>
    filter.category?.some((category) => category.$["android:name"] === "android.intent.category.BROWSABLE"),
  );
  assert.deepEqual(
    deepLinkFilter.data.map((entry) => entry.$["android:scheme"]).sort(),
    ["${APP_SCHEME}", "${EXPO_SCHEME}", "${applicationId}"].sort(),
  );

  const gradle = read("android/app/build.gradle");
  assert.match(gradle, /namespace 'com\.sidelinesquad\.app'/u);
  assert.match(gradle, /applicationId 'com\.sidelinesquad\.app'/u);
  assert.match(gradle, /applicationIdSuffix "\.dev"/u);
  assert.match(gradle, /versionCode 5/u);
  assert.match(gradle, /versionName "1\.0\.0"/u);
  assert.match(gradle, /resValue "string", "app_name", "Sideline Social Dev"/u);
  assert.match(gradle, /manifestPlaceholders\.APP_SCHEME = "sidelinesquad-dev"/u);
  assert.match(gradle, /manifestPlaceholders\.APP_SCHEME = "sidelinesquad"/u);
  assert.match(gradle, /GOOGLE_SERVICES_JSON_ANDROID_DEVELOPMENT/u);
  assert.match(gradle, /apply plugin: 'com\.google\.gms\.google-services'/u);

  const gradleProperties = read("android/gradle.properties");
  assert.match(gradleProperties, /^newArchEnabled=true$/mu);
  assert.match(gradleProperties, /^hermesEnabled=true$/mu);
  assert.match(gradleProperties, /^android\.compileSdkVersion=36$/mu);
  assert.match(gradleProperties, /^android\.targetSdkVersion=36$/mu);

  const strings = read("android/app/src/main/res/values/strings.xml");
  assert.match(strings, /<string name="app_name">Sideline Social<\/string>/u);
  assert.match(strings, /<string name="expo_system_ui_user_interface_style" translatable="false">light<\/string>/u);
  assert.match(strings, /<string name="expo_splash_screen_resize_mode" translatable="false">contain<\/string>/u);
  const styles = read("android/app/src/main/res/values/styles.xml");
  assert.match(styles, /Theme\.AppCompat\.Light\.NoActionBar/u);
  assert.match(styles, /windowSplashScreenBackground">@color\/splashscreen_background/u);
  assert.match(styles, /windowSplashScreenAnimatedIcon">@drawable\/splashscreen_logo/u);
  const colors = read("android/app/src/main/res/values/colors.xml");
  assert.match(colors, /<color name="splashscreen_background">#ffffff<\/color>/u);
  assert.match(colors, /<color name="iconBackground">#ffffff<\/color>/u);

  const productionFirebaseConfig = readJson("google-services.json");
  const firebasePackages = productionFirebaseConfig.client
    .map((client) => client?.client_info?.android_client_info?.package_name)
    .filter(Boolean);
  assert.equal(firebasePackages.includes("com.sidelinesquad.app"), true, "The production Firebase resource must match the release package.");

  for (const [relativePath, expectedHash] of Object.entries(EXPECTED_ASSET_HASHES)) {
    assert.equal(sha256(path.join(root, relativePath)), expectedHash, `${relativePath} changed; regenerate and revalidate native artwork.`);
  }
  const launcherFiles = filesMatching(androidResRoot, (filePath) => path.basename(filePath).startsWith("ic_launcher"));
  assert.equal(digestFiles(androidResRoot, launcherFiles), EXPECTED_LAUNCHER_SET_HASH, "Android launcher resources drifted from the reviewed set.");
  const splashFiles = filesMatching(androidResRoot, (filePath) => path.basename(filePath) === "splashscreen_logo.png");
  assert.equal(splashFiles.length, 5, "Android must contain one splash logo for each density bucket.");
  assert.equal(digestFiles(androidResRoot, splashFiles), EXPECTED_SPLASH_SET_HASH, "Android splash resources drifted from app.config.js.");
}

function assertGoogleSignInCompatibility(packageJson) {
  const installed = readJson("node_modules/react-native-nitro-google-signin/package.json");
  const nitro = readJson("node_modules/react-native-nitro-modules/package.json");
  assert.equal(installed.version, "1.3.0");
  assert.equal(nitro.version, "0.36.5");
  assert.equal(packageJson.dependencies["react-native-nitro-google-signin"], "^1.3.0");
  assert.equal(packageJson.dependencies["react-native-nitro-modules"], "^0.36.5");
  assert.equal(packageJson.dependencies["react-native"], "0.86.2");
  assert.equal(installed.repository.url, "git+https://github.com/react-native-nitro-google-sign-in/google-signin.git");

  for (const relativePath of [
    "node_modules/react-native-nitro-google-signin/NitroGoogleSignin.podspec",
    "node_modules/react-native-nitro-google-signin/android/CMakeLists.txt",
    "node_modules/react-native-nitro-google-signin/android/src/main/java/com/nitrogooglesignin/HybridNitroGoogleSignin.kt",
    "node_modules/react-native-nitro-google-signin/ios/HybridNitroGoogleSignin.swift",
    "node_modules/react-native-nitro-google-signin/nitrogen/generated/android/kotlin/com/margelo/nitro/nitrogooglesignin/HybridNitroGoogleSigninSpec.kt",
    "node_modules/react-native-nitro-google-signin/nitrogen/generated/ios/c++/HybridNitroGoogleSigninSpecSwift.hpp",
  ]) assert.equal(fs.existsSync(path.join(root, relativePath)), true, `${relativePath} must remain packaged.`);

  assert.match(
    read("node_modules/react-native-nitro-google-signin/android/CMakeLists.txt"),
    /nitrogen\/generated\/android\/NitroGoogleSignin\+autolinking\.cmake/u,
  );
  assert.match(read("node_modules/react-native-nitro-google-signin/ios/HybridNitroGoogleSignin.swift"), /HybridNitroGoogleSigninSpec/u);
  assert.match(
    read("node_modules/react-native-nitro-google-signin/android/src/main/java/com/nitrogooglesignin/HybridNitroGoogleSignin.kt"),
    /HybridNitroGoogleSigninSpec/u,
  );
}

async function run() {
  const packageJson = readJson("package.json");
  assertConfigStrategy(packageJson);
  assertResolvedConfig();
  await assertAndroidNativeParity();
  assertGoogleSignInCompatibility(packageJson);
  console.log("Tracked Android, CNG iOS, Expo config, artwork, permissions, variants, and Nitro Google Sign-In parity checks passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
