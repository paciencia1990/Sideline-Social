"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AndroidConfig, XML } = require("@expo/config-plugins");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");
const backupRulesPath = path.join(root, "android", "app", "src", "main", "res", "xml", "backup_rules.xml");
const dataExtractionRulesPath = path.join(
  root,
  "android",
  "app",
  "src",
  "main",
  "res",
  "xml",
  "data_extraction_rules.xml",
);
const pluginPath = path.join(root, "plugins", "withAndroidBackupProtection.js");
const plugin = require(pluginPath);

function resolveConfig(variant) {
  const previousVariant = process.env.APP_VARIANT;
  process.env.APP_VARIANT = variant;
  delete require.cache[require.resolve(path.join(root, "app.config.js"))];
  const configure = require(path.join(root, "app.config.js"));
  const result = configure({ config: {} });
  if (previousVariant === undefined) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = previousVariant;
  return result;
}

function hasPlugin(config, expected) {
  return config.plugins.some((entry) => (Array.isArray(entry) ? entry[0] : entry) === expected);
}

function assertApplicationPolicy(application, label) {
  assert.equal(application.$["android:allowBackup"], "false", `${label} must disable Android backup.`);
  assert.equal(
    application.$["android:fullBackupContent"],
    "@xml/backup_rules",
    `${label} must protect Android 11 and earlier.`,
  );
  assert.equal(
    application.$["android:dataExtractionRules"],
    "@xml/data_extraction_rules",
    `${label} must protect Android 12+ cloud backup and device transfer.`,
  );
}

function excludedDomains(container) {
  return (container.exclude ?? []).map((entry) => {
    assert.equal(entry.$.path, ".", `Backup exclusion for ${entry.$.domain} must cover the complete domain.`);
    return entry.$.domain;
  }).sort();
}

function assertDenyAll(container, label) {
  assert.equal(container.include, undefined, `${label} must not opt any path into backup.`);
  assert.deepEqual(
    excludedDomains(container),
    [...plugin.BACKUP_DOMAINS].sort(),
    `${label} must exclude every application storage domain.`,
  );
}

async function run() {
  for (const variant of ["production", "development"]) {
    const config = resolveConfig(variant);
    assert.equal(config.android.allowBackup, false, `${variant} Expo config must disable Android backup.`);
    assert.equal(
      hasPlugin(config, "./plugins/withAndroidBackupProtection"),
      true,
      `${variant} Expo config must register the regeneration-safe backup plugin.`,
    );
  }

  const sourceManifest = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
  assertApplicationPolicy(
    AndroidConfig.Manifest.getMainApplicationOrThrow(sourceManifest),
    "Committed Android manifest",
  );

  const simulatedManifest = JSON.parse(JSON.stringify(sourceManifest));
  const simulatedApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(simulatedManifest);
  simulatedApplication.$["android:allowBackup"] = "true";
  delete simulatedApplication.$["android:fullBackupContent"];
  delete simulatedApplication.$["android:dataExtractionRules"];
  plugin.applyAndroidBackupProtection(simulatedManifest);
  plugin.applyAndroidBackupProtection(simulatedManifest);
  assertApplicationPolicy(simulatedApplication, "Expo config plugin");

  const backupRulesSource = fs.readFileSync(backupRulesPath, "utf8").replaceAll("\r\n", "\n");
  const dataExtractionRulesSource = fs.readFileSync(dataExtractionRulesPath, "utf8").replaceAll("\r\n", "\n");
  assert.equal(backupRulesSource, plugin.BACKUP_RULES_CONTENT);
  assert.equal(dataExtractionRulesSource, plugin.DATA_EXTRACTION_RULES_CONTENT);

  const backupRules = await XML.parseXMLAsync(backupRulesSource);
  assertDenyAll(backupRules["full-backup-content"], "Android 11-and-earlier backup rules");

  const extractionRules = await XML.parseXMLAsync(dataExtractionRulesSource);
  const extractionRoot = extractionRules["data-extraction-rules"];
  assert.equal(extractionRoot["cloud-backup"].length, 1);
  assert.equal(extractionRoot["device-transfer"].length, 1);
  assertDenyAll(extractionRoot["cloud-backup"][0], "Android 12+ cloud-backup rules");
  assertDenyAll(extractionRoot["device-transfer"][0], "Android 12+ device-transfer rules");

  const temporaryAndroidRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sideline-backup-plugin-"));
  try {
    await plugin.writeBackupRules(temporaryAndroidRoot);
    const generatedXmlRoot = path.join(temporaryAndroidRoot, "app", "src", "main", "res", "xml");
    assert.equal(
      fs.readFileSync(path.join(generatedXmlRoot, "backup_rules.xml"), "utf8"),
      plugin.BACKUP_RULES_CONTENT,
    );
    assert.equal(
      fs.readFileSync(path.join(generatedXmlRoot, "data_extraction_rules.xml"), "utf8"),
      plugin.DATA_EXTRACTION_RULES_CONTENT,
    );
  } finally {
    fs.rmSync(temporaryAndroidRoot, { force: true, recursive: true });
  }

  if (process.argv.includes("--merged")) {
    const mergedManifestPath = path.join(
      root,
      "android",
      "app",
      "build",
      "intermediates",
      "merged_manifest",
      "release",
      "processReleaseMainManifest",
      "AndroidManifest.xml",
    );
    assert.equal(fs.existsSync(mergedManifestPath), true, "The merged release manifest was not generated.");
    const mergedManifest = await AndroidConfig.Manifest.readAndroidManifestAsync(mergedManifestPath);
    assert.equal(mergedManifest.manifest.$.package, "com.sidelinesquad.app");
    assertApplicationPolicy(
      AndroidConfig.Manifest.getMainApplicationOrThrow(mergedManifest),
      "Merged release manifest",
    );
  }

  console.log(
    process.argv.includes("--merged")
      ? "Android source, regenerated, and merged release backup protections passed."
      : "Android source and regeneration-safe backup protections passed.",
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
