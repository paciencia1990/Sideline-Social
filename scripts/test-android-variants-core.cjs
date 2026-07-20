const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");
const configure = require(path.join(root, "app.config.js"));

function resolvedConfig(variant, developmentGoogleServicesFile) {
  const previousVariant = process.env.APP_VARIANT;
  const previousGoogleServicesFile = process.env.GOOGLE_SERVICES_JSON_ANDROID_DEVELOPMENT;
  process.env.APP_VARIANT = variant;
  if (developmentGoogleServicesFile) {
    process.env.GOOGLE_SERVICES_JSON_ANDROID_DEVELOPMENT = developmentGoogleServicesFile;
  } else {
    delete process.env.GOOGLE_SERVICES_JSON_ANDROID_DEVELOPMENT;
  }
  delete require.cache[require.resolve(path.join(root, "app.config.js"))];
  const currentConfigure = require(path.join(root, "app.config.js"));
  const result = currentConfigure({ config: {} });
  if (previousVariant === undefined) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = previousVariant;
  if (previousGoogleServicesFile === undefined) delete process.env.GOOGLE_SERVICES_JSON_ANDROID_DEVELOPMENT;
  else process.env.GOOGLE_SERVICES_JSON_ANDROID_DEVELOPMENT = previousGoogleServicesFile;
  return result;
}

assert.equal(typeof configure, "function");
const production = resolvedConfig("production");
assert.equal(production.name, "Sideline Social");
assert.equal(production.android.package, "com.sidelinesquad.app");
assert.equal(production.android.googleServicesFile, "./google-services.json");
assert.equal(production.scheme, "sidelinesquad");

const development = resolvedConfig("development", "C:/secure/google-services.dev.json");
assert.equal(development.name, "Sideline Social Dev");
assert.equal(development.android.package, "com.sidelinesquad.app.dev");
assert.equal(development.android.googleServicesFile, "C:/secure/google-services.dev.json");
assert.equal(development.scheme, "sidelinesquad-dev");

const eas = JSON.parse(read("eas.json"));
const packageJson = JSON.parse(read("package.json"));
assert.equal(eas.build.development.developmentClient, true);
assert.equal(eas.build.development.android.buildType, "apk");
assert.equal(eas.build.development.env.APP_VARIANT, "development");
assert.equal(eas.build.development.autoIncrement, undefined);
assert.equal(eas.build.production.developmentClient, false);
assert.equal(eas.build.production.android.buildType, "app-bundle");
assert.equal(eas.build.production.env.APP_VARIANT, "production");
assert.equal(packageJson.scripts["start:dev-client"], "expo start --dev-client --scheme sidelinesquad-dev");

const gradle = read("android", "app", "build.gradle");
assert.equal(gradle.includes('applicationId \'com.sidelinesquad.app\''), true);
assert.equal(gradle.includes('applicationIdSuffix ".dev"'), true);
assert.equal(gradle.includes('resValue "string", "app_name", "Sideline Social Dev"'), true);
assert.equal(gradle.includes("GOOGLE_SERVICES_JSON_ANDROID_DEVELOPMENT"), true);

const manifest = read("android", "app", "src", "main", "AndroidManifest.xml");
assert.equal(manifest.includes('${applicationId}'), true);
assert.equal(manifest.includes('${APP_SCHEME}'), true);

const productionGoogleServices = JSON.parse(read("google-services.json"));
const productionPackages = productionGoogleServices.client
  .map((client) => client?.client_info?.android_client_info?.package_name)
  .filter(Boolean);
assert.equal(productionPackages.includes("com.sidelinesquad.app"), true);
assert.equal(productionPackages.includes("com.sidelinesquad.app.dev"), false);

console.log("Android production/development package, label, scheme, artifact, versioning, and Firebase separation checks passed.");
