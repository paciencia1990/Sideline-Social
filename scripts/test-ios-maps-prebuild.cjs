"use strict";

// Generate the real installed Expo template with synthetic inputs. Never prebuild
// the working checkout: Android is an authoritative, checked-in native project.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sideline-ios-maps-prebuild-"));
const app = path.join(workspace, "app");
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const trackedAndroid = execFileSync("git", ["ls-files", "-z", "android"], { cwd: root, windowsHide: true }).toString().split("\0").filter(Boolean);
const androidHashes = () => Object.fromEntries(trackedAndroid.map((file) => [file, sha(fs.readFileSync(path.join(root, file)))]));
const beforeAndroid = androidHashes();
const lockBefore = sha(fs.readFileSync(path.join(root, "package-lock.json")));
const iosKey = "synthetic-ios-maps-key";
const androidKey = "synthetic-android-maps-key";
const profile = require(path.join(root, "eas.json")).build["external-testing"];
let completed = false;

function run(args, env) {
  const result = spawnSync(process.execPath, args, { cwd: app, env, encoding: "utf8", windowsHide: true, timeout: 180000, maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) {
    // This process receives only synthetic config. Retain its diagnostic in the
    // isolated workspace, never dump real environment/configuration on failure.
    fs.writeFileSync(path.join(workspace, "failure.txt"), `${result.stdout || ""}\n${result.stderr || ""}`);
    throw new Error(`Isolated command failed (exit ${result.status}); diagnostic: ${workspace}/failure.txt`);
  }
  return result.stdout;
}

function inspectGenerated() {
  const ios = path.join(app, "ios");
  const podfile = fs.readFileSync(path.join(ios, "Podfile"), "utf8");
  assert.doesNotMatch(podfile, /react-native-google-maps/u, "Obsolete podspec must never return.");
  assert.equal((podfile.match(/pod 'react-native-maps\/Google'/gu) || []).length, 1);
  assert(podfile.indexOf("pod 'react-native-maps/Google'") < podfile.indexOf("config = use_native_modules!"));
  assert.match(podfile, /require\.resolve\('react-native-maps\/package\.json'\)/u);
  assert.match(podfile, /use_expo_modules!/u);
  assert.match(podfile, /react-native-config/u);
  assert.match(podfile, /use_react_native!/u);
  assert.match(podfile, /pod 'AppCheckCore', :modular_headers => true/u);
  const projectDir = fs.readdirSync(ios).find((name) => fs.existsSync(path.join(ios, name, "AppDelegate.swift")));
  assert(projectDir, "Swift AppDelegate generated.");
  const native = path.join(ios, projectDir);
  const delegate = fs.readFileSync(path.join(native, "AppDelegate.swift"), "utf8");
  assert.match(delegate, /import GoogleMaps/u);
  assert.equal((delegate.match(/GMSServices\.provideAPIKey/gu) || []).length, 1);
  assert(delegate.includes(`GMSServices.provideAPIKey("${iosKey}")`));
  assert(delegate.indexOf("GMSServices.provideAPIKey") < delegate.indexOf("super.application"));
  const plist = require(path.join(root, "node_modules/@expo/plist")).default;
  const info = plist.parse(fs.readFileSync(path.join(native, "Info.plist"), "utf8"));
  assert(info.CFBundleURLTypes.some((row) => row.CFBundleURLSchemes.includes("com.googleusercontent.apps.synthetic-ios")));
  assert(info.NSLocationWhenInUseUsageDescription.includes("Find Nearby"));
  const copiedFirebase = fs.readFileSync(path.join(native, "GoogleService-Info.plist"));
  assert.equal(sha(copiedFirebase), sha(fs.readFileSync(path.join(workspace, "builder-firebase.plist"))));
  const entitlements = fs.readFileSync(path.join(native, `${projectDir}.entitlements`), "utf8");
  assert.match(entitlements, /com\.apple\.developer\.applesignin/u);
  const pbx = fs.readFileSync(path.join(ios, `${projectDir}.xcodeproj/project.pbxproj`), "utf8");
  assert(/PRODUCT_BUNDLE_IDENTIFIER = "?com\.sidelinesocial\.app"?;/u.test(pbx), "Generated bundle identifier matches.");
  assert.match(pbx, /GoogleService-Info.plist in Resources/u);
  const props = JSON.parse(fs.readFileSync(path.join(ios, "Podfile.properties.json")));
  const fallback = podfile.match(/platform :ios, podfile_properties\['ios.deploymentTarget'\] \|\| '([\d.]+)'/u)?.[1];
  const target = props["ios.deploymentTarget"] || fallback;
  assert(target && Number.parseFloat(target) >= 16.4, "Preserve the installed Expo template target, above Maps' iOS 15.1 minimum.");
  const podspec = fs.readFileSync(path.join(root, "node_modules/react-native-maps/react-native-maps.podspec"), "utf8");
  assert.match(podspec, /s\.subspec 'Google'/u);
  assert.match(podspec, /ss\.dependency 'GoogleMaps', '9\.4\.0'/u);
  assert.match(podspec, /ss\.dependency 'Google-Maps-iOS-Utils', '6\.1\.0'/u);
  assert.equal(fs.existsSync(path.join(root, "node_modules/react-native-maps/react-native-google-maps.podspec")), false);
  return { deploymentTarget: target, mapsPod: "react-native-maps/Google", firebaseCopied: true, googleSignIn: true, appleSignIn: true };
}

try {
  fs.mkdirSync(app);
  for (const name of ["app.config.js", "package.json", "package-lock.json", "eas.json", "config", "plugins", "assets"]) {
    fs.cpSync(path.join(root, name), path.join(app, name), { recursive: true });
  }
  fs.symlinkSync(fs.realpathSync(path.join(root, "node_modules")), path.join(app, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const firebaseFile = path.join(workspace, "builder-firebase.plist");
  fs.writeFileSync(firebaseFile, `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>PROJECT_ID</key><string>sideline-social-staging-2026</string>
<key>BUNDLE_ID</key><string>com.sidelinesocial.app</string>
<key>GOOGLE_APP_ID</key><string>1:3090643405:ios:synthetic</string>
<key>CLIENT_ID</key><string>synthetic-ios.apps.googleusercontent.com</string>
<key>REVERSED_CLIENT_ID</key><string>com.googleusercontent.apps.synthetic-ios</string>
</dict></plist>`);
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(EXPO_|GOOGLE_|EAS_|APP_VARIANT$|REQUIRE_PRODUCTION_|DEBUG$)/u.test(name)) delete env[name];
  Object.assign(env, profile.env, { CI: "1", EXPO_OFFLINE: "1", EXPO_NO_TELEMETRY: "1", EXPO_NO_DOTENV: "1", EAS_BUILD: "true", EAS_BUILD_PLATFORM: "ios", EAS_BUILD_PROFILE: "external-testing", EXPO_PUBLIC_FIREBASE_PROJECT_ID: "sideline-social-staging-2026", EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: "sideline-social-staging-2026.firebaseapp.com", GOOGLE_SERVICES_INFO_PLIST_STAGING: firebaseFile, GOOGLE_MAPS_API_KEY_IOS_STAGING: iosKey, GOOGLE_MAPS_API_KEY_ANDROID_STAGING: androidKey });
  const cli = path.join(root, "node_modules/expo/bin/cli");
  // Expo's CLI entry point refuses iOS on Windows. Invoke its actual template
  // and mod-compilation stages directly, without changing process.platform,
  // package implementations, or claiming CocoaPods/Xcode execution.
  const prebuild = ["-e", `
    const path = require('node:path');
    const projectRoot = process.cwd();
    const cliRoot = path.dirname(require.resolve('@expo/cli/package.json'));
    const { getConfig } = require('@expo/config');
    const { updateFromTemplateAsync } = require(path.join(cliRoot, 'build/src/prebuild/updateFromTemplate.js'));
    const { configureProjectAsync } = require(path.join(cliRoot, 'build/src/prebuild/configureProjectAsync.js'));
    (async () => {
      const { exp, pkg } = getConfig(projectRoot);
      const { templateChecksum } = await updateFromTemplateAsync(projectRoot, {
        exp, pkg, platforms: ['ios'], skipDependencyUpdate: ['react', 'react-native'],
        templateDirectory: path.join(projectRoot, '..', 'template'),
        template: { type: 'file', uri: path.join(path.dirname(require.resolve('expo/package.json')), 'template.tgz') },
      });
      await configureProjectAsync(projectRoot, { platforms: ['ios'], exp, templateChecksum });
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `];
  run(prebuild, env);
  const result = inspectGenerated();
  const introspected = JSON.parse(run([cli, "config", "--type", "introspect", "--json"], env));
  const mainApplication = introspected._internal.modResults.android.manifest.manifest.application[0];
  const mapsMetadata = mainApplication["meta-data"].filter((row) => row.$["android:name"] === "com.google.android.geo.API_KEY");
  assert.equal(mapsMetadata.length, 1);
  assert.equal(mapsMetadata[0].$["android:value"], androidKey, "Android plugin receives the unchanged selected key.");
  assert.equal(introspected.extra.eas.projectId, "7ea7aaf2-355d-4aec-a175-82898c8cc0c7");
  // Repeated generation must not duplicate Maps pods or initialization.
  run(prebuild, env);
  inspectGenerated();
  const autolink = JSON.parse(run([path.join(root, "node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js"), "react-native-config", "--platform", "ios", "--json"], env));
  assert(autolink.dependencies["react-native-maps"].platforms.ios.podspecPath.endsWith("react-native-maps.podspec"));
  assert(autolink.dependencies["react-native-nitro-google-signin"].platforms.ios);
  // Negative control: the real legacy plugin generates exactly the broken pod.
  const configFile = path.join(app, "app.config.js");
  const fixed = fs.readFileSync(configFile, "utf8");
  const legacy = fixed.replace(/    \[\s*"react-native-maps",\s*\{[\s\S]*?\},\s*\],/u, "").replace("    usesAppleSignIn: true,", "    usesAppleSignIn: true,\n    config: { googleMapsApiKey: IOS_MAPS_API_KEY },");
  assert.notEqual(legacy, fixed);
  fs.writeFileSync(configFile, legacy);
  run(prebuild, env);
  assert.match(fs.readFileSync(path.join(app, "ios/Podfile"), "utf8"), /pod 'react-native-google-maps'/u);
  assert.throws(inspectGenerated, /Obsolete podspec/u);
  fs.writeFileSync(configFile, fixed);
  // Verify the missing builder file is rejected instead of falling back to a
  // production plist from the source archive.
  const absent = spawnSync(process.execPath, [cli, "config", "--type", "public", "--json"], { cwd: app, env: { ...env, GOOGLE_SERVICES_INFO_PLIST_STAGING: path.join(workspace, "absent.plist") }, windowsHide: true, encoding: "utf8" });
  assert.notEqual(absent.status, 0);
  assert.match(`${absent.stderr}${absent.stdout}`, /iOS staging Firebase configuration/u);
  assert.deepEqual(androidHashes(), beforeAndroid);
  assert.equal(sha(fs.readFileSync(path.join(root, "package-lock.json"))), lockBefore);
  assert.equal(fs.existsSync(path.join(root, "ios")), false);
  console.log(JSON.stringify({ result: "PASS", ...result, autolinking: true, idempotent: true, legacyMismatchRejected: true, missingFirebaseFileRejected: true, androidUnchanged: true, podsInstalled: false, xcodeBuildRun: false }));
  completed = true;
} finally {
  // Remove only our resolved temporary workspace; unlink the node_modules
  // junction explicitly before recursive deletion.
  if (completed) {
    const resolved = fs.realpathSync(workspace);
    assert(path.dirname(resolved) === fs.realpathSync(os.tmpdir()) && path.basename(resolved).startsWith("sideline-ios-maps-prebuild-"));
    fs.unlinkSync(path.join(app, "node_modules"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
