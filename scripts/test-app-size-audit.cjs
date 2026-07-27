"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  PREVIOUS_AAB_BASELINE,
  compareWithPreviousAab,
  selectAabArtifact,
  summarizeSpotBundleEntries,
} = require("./app-size-audit-core.cjs");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sideline-app-size-audit-"));

try {
  const legacyDirectory = path.join(temporaryRoot, "build", "google-play-release");
  const currentDirectory = path.join(temporaryRoot, "build", "production");
  fs.mkdirSync(legacyDirectory, { recursive: true });
  fs.mkdirSync(currentDirectory, { recursive: true });

  const legacyAab = path.join(legacyDirectory, "sideline-social-code5.aab");
  const currentAab = path.join(currentDirectory, "sideline-social-current.aab");
  const apkPath = path.join(currentDirectory, "sideline-social.apk");
  const directoryWithAabExtension = path.join(currentDirectory, "not-a-file.aab");
  fs.writeFileSync(legacyAab, "legacy");
  fs.writeFileSync(currentAab, "current-aab");
  fs.writeFileSync(apkPath, "apk");
  fs.mkdirSync(directoryWithAabExtension);

  const artifactCandidates = [
    {
      absolutePath: legacyAab,
      modifiedAtMs: 1_000,
      path: "build/google-play-release/sideline-social-code5.aab",
      sizeBytes: fs.statSync(legacyAab).size,
    },
    {
      absolutePath: currentAab,
      modifiedAtMs: 2_000,
      path: "build/production/sideline-social-current.aab",
      sizeBytes: fs.statSync(currentAab).size,
    },
    {
      absolutePath: apkPath,
      modifiedAtMs: 3_000,
      path: "build/production/sideline-social.apk",
      sizeBytes: fs.statSync(apkPath).size,
    },
  ];

  const newestSelection = selectAabArtifact({
    artifactCandidates,
    explicitPath: undefined,
    root: temporaryRoot,
  });
  assert.equal(
    newestSelection.path,
    "build/production/sideline-social-current.aab",
    "Automatic selection must use the newest AAB, not the historical code-5 artifact or a newer APK.",
  );
  assert.equal(newestSelection.selectionSource, "newest-local-aab");

  const explicitSelection = selectAabArtifact({
    artifactCandidates,
    explicitPath: path.relative(temporaryRoot, legacyAab),
    root: temporaryRoot,
  });
  assert.equal(explicitSelection.path, "build/google-play-release/sideline-social-code5.aab");
  assert.equal(explicitSelection.selectionSource, "APP_SIZE_AAB_PATH");
  assert.equal(explicitSelection.sizeBytes, Buffer.byteLength("legacy"));

  assert.throws(
    () => selectAabArtifact({
      artifactCandidates,
      explicitPath: "build/production/missing.aab",
      root: temporaryRoot,
    }),
    /APP_SIZE_AAB_PATH does not exist/u,
  );
  assert.throws(
    () => selectAabArtifact({
      artifactCandidates,
      explicitPath: path.relative(temporaryRoot, apkPath),
      root: temporaryRoot,
    }),
    /APP_SIZE_AAB_PATH must identify an \.aab file/u,
  );
  assert.throws(
    () => selectAabArtifact({
      artifactCandidates,
      explicitPath: path.relative(temporaryRoot, directoryWithAabExtension),
      root: temporaryRoot,
    }),
    /APP_SIZE_AAB_PATH must identify a file/u,
  );
  assert.equal(
    selectAabArtifact({ artifactCandidates: [], explicitPath: "", root: temporaryRoot }),
    null,
  );

  const spotEntries = summarizeSpotBundleEntries([
    {
      compressedBytes: 101,
      name: "base/res/drawable-mdpi-v4/assets_games_spotthedifference_scene_001_a.webp",
      uncompressedBytes: 111,
    },
    {
      compressedBytes: 202,
      name: "base/assets/assets/games/spot-the-difference/scene_001_B.WEBP",
      uncompressedBytes: 222,
    },
    {
      compressedBytes: 303,
      name: "base/res/drawable-mdpi-v4/assets_games_spotthedifference_scene_002_a.png",
      uncompressedBytes: 333,
    },
    {
      compressedBytes: 404,
      name: "base/res/drawable-mdpi-v4/other_scene_002_b.png",
      uncompressedBytes: 444,
    },
  ]);
  assert.deepEqual(spotEntries, {
    obsoletePngCompressedBytes: 303,
    obsoletePngEntryCount: 1,
    obsoletePngUncompressedBytes: 333,
    obsoletePngAbsent: false,
    webpCompressedBytes: 303,
    webpEntryCount: 2,
    webpUncompressedBytes: 333,
  });
  assert.equal(
    summarizeSpotBundleEntries([]).obsoletePngAbsent,
    true,
  );

  const comparison = compareWithPreviousAab(PREVIOUS_AAB_BASELINE.sizeBytes - 10_000);
  assert.equal(comparison.reductionBytes, 10_000);
  assert.equal(comparison.changeBytes, -10_000);
  assert.ok(comparison.reductionPercent > 0);

  const auditSource = fs.readFileSync(path.join(__dirname, "audit-app-size.cjs"), "utf8");
  assert.match(auditSource, /process\.env\.APP_SIZE_AAB_PATH/u);
  assert.match(auditSource, /summarizeSpotBundleEntries\(entries\)/u);
  assert.match(auditSource, /compareWithPreviousAab\(analyzedBundle\.sizeBytes\)/u);

  console.log("App-size AAB selection, baseline comparison, and Spot bundle-entry tests passed.");
} finally {
  fs.rmSync(temporaryRoot, { force: true, recursive: true });
}
