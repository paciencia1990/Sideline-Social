const fs = require("node:fs/promises");
const path = require("node:path");

const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require("@expo/config-plugins");

const BACKUP_DOMAINS = [
  "root",
  "file",
  "database",
  "sharedpref",
  "external",
  "device_root",
  "device_file",
  "device_database",
  "device_sharedpref",
];

const backupExclusions = BACKUP_DOMAINS
  .map((domain) => `  <exclude domain="${domain}" path="." />`)
  .join("\n");
const extractionExclusions = BACKUP_DOMAINS
  .map((domain) => `    <exclude domain="${domain}" path="." />`)
  .join("\n");

const BACKUP_RULES_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
${backupExclusions}
</full-backup-content>
`;

const DATA_EXTRACTION_RULES_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
${extractionExclusions}
  </cloud-backup>
  <device-transfer>
${extractionExclusions}
  </device-transfer>
</data-extraction-rules>
`;

function applyAndroidBackupProtection(androidManifest) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  application.$["android:allowBackup"] = "false";
  application.$["android:fullBackupContent"] = "@xml/backup_rules";
  application.$["android:dataExtractionRules"] = "@xml/data_extraction_rules";
  return androidManifest;
}

async function writeBackupRules(platformProjectRoot) {
  const xmlDirectory = path.join(platformProjectRoot, "app", "src", "main", "res", "xml");
  await fs.mkdir(xmlDirectory, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(xmlDirectory, "backup_rules.xml"), BACKUP_RULES_CONTENT, "utf8"),
    fs.writeFile(
      path.join(xmlDirectory, "data_extraction_rules.xml"),
      DATA_EXTRACTION_RULES_CONTENT,
      "utf8",
    ),
  ]);
}

function withAndroidBackupProtection(config) {
  config = withAndroidManifest(config, (nextConfig) => {
    nextConfig.modResults = applyAndroidBackupProtection(nextConfig.modResults);
    return nextConfig;
  });

  return withDangerousMod(config, [
    "android",
    async (nextConfig) => {
      await writeBackupRules(nextConfig.modRequest.platformProjectRoot);
      return nextConfig;
    },
  ]);
}

module.exports = withAndroidBackupProtection;
module.exports.applyAndroidBackupProtection = applyAndroidBackupProtection;
module.exports.BACKUP_DOMAINS = BACKUP_DOMAINS;
module.exports.BACKUP_RULES_CONTENT = BACKUP_RULES_CONTENT;
module.exports.DATA_EXTRACTION_RULES_CONTENT = DATA_EXTRACTION_RULES_CONTENT;
module.exports.writeBackupRules = writeBackupRules;
