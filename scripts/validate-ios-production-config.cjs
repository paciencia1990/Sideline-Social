const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const expectedBundleIdentifier = "com.sidelinesocial.app";
const failures = [];
const warnings = [];

function read(file) {
  return fs.readFileSync(path.join(root, file));
}

const icon = read("assets/images/icon-ios.png");
if (icon.toString("ascii", 1, 4) !== "PNG") failures.push("The iOS icon is not a PNG file.");
const width = icon.readUInt32BE(16);
const height = icon.readUInt32BE(20);
const colorType = icon[25];
if (width !== 1024 || height !== 1024) failures.push(`The iOS icon must be 1024x1024; found ${width}x${height}.`);
if (colorType === 4 || colorType === 6) failures.push("The iOS icon contains an alpha channel.");

const source = read("app.config.js").toString("utf8");
if (!source.includes(`const IOS_BUNDLE_IDENTIFIER = "${expectedBundleIdentifier}"`)) {
  failures.push(`Expected iOS bundle identifier ${expectedBundleIdentifier}.`);
}
if (!source.includes("supportsTablet: false")) failures.push("The first release must remain iPhone-only.");
if (!source.includes('buildNumber: "1"')) failures.push("The initial iOS build number is not configured as 1.");

const nativeFirebaseFile = process.env.GOOGLE_SERVICES_INFO_PLIST;
if (nativeFirebaseFile) {
  const resolved = path.resolve(root, nativeFirebaseFile);
  if (!fs.existsSync(resolved)) {
    failures.push("GOOGLE_SERVICES_INFO_PLIST points to a missing file.");
  } else {
    const plist = fs.readFileSync(resolved, "utf8");
    const bundleMatch = /<key>BUNDLE_ID<\/key>\s*<string>([^<]+)<\/string>/u.exec(plist);
    if (bundleMatch?.[1] !== expectedBundleIdentifier) {
      failures.push(`The iOS Firebase plist bundle ID must be ${expectedBundleIdentifier}.`);
    }
  }
} else {
  const message = "No GOOGLE_SERVICES_INFO_PLIST was supplied. Firebase JS services can build, but the native iOS Firebase app remains externally unverified.";
  if (process.env.APP_STORE_SUBMISSION_READY === "true") failures.push(message);
  else warnings.push(message);
}

const requiredOwnerValues = [
  "EXPO_PUBLIC_PRIVACY_POLICY_URL",
  "EXPO_PUBLIC_TERMS_OF_USE_URL",
  "EXPO_PUBLIC_SUPPORT_URL",
  "EXPO_PUBLIC_SUPPORT_EMAIL",
];
const missingOwnerValues = requiredOwnerValues.filter((name) => !process.env[name]?.trim());
if (process.env.APP_STORE_SUBMISSION_READY === "true" && missingOwnerValues.length) {
  failures.push(`App Store submission is locked: configure ${missingOwnerValues.join(", ")}.`);
} else if (missingOwnerValues.length) {
  warnings.push(`Owner-supplied release values remain: ${missingOwnerValues.join(", ")}. Set APP_STORE_SUBMISSION_READY=true to enforce the submission gate.`);
}

if (process.env.APP_STORE_SUBMISSION_READY === "true") {
  for (const name of requiredOwnerValues.slice(0, 3)) {
    const value = process.env[name]?.trim() ?? "";
    if (value && !value.startsWith("https://")) failures.push(`${name} must use a public HTTPS URL.`);
  }
  const email = process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() ?? "";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    failures.push("EXPO_PUBLIC_SUPPORT_EMAIL must be a valid monitored email address.");
  }
}

for (const warning of warnings) console.warn(`WARNING: ${warning}`);
if (failures.length) {
  failures.forEach((failure) => console.error(`ERROR: ${failure}`));
  process.exitCode = 1;
} else {
  console.log("iOS production configuration validation passed.");
}
