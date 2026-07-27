"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PREVIOUS_AAB_BASELINE = Object.freeze({
  label: "Previous production AAB (version code 5)",
  sizeBytes: 156_488_103,
});

function displayPath(root, absolutePath) {
  const relativePath = path.relative(root, absolutePath);
  if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return relativePath.split(path.sep).join("/");
  }
  return absolutePath.split(path.sep).join("/");
}

function explicitArtifact(root, requestedPath) {
  const absolutePath = path.resolve(root, requestedPath);
  if (path.extname(absolutePath).toLowerCase() !== ".aab") {
    throw new Error(`APP_SIZE_AAB_PATH must identify an .aab file: ${requestedPath}`);
  }

  let stats;
  try {
    stats = fs.statSync(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`APP_SIZE_AAB_PATH does not exist: ${requestedPath}`);
    }
    throw error;
  }
  if (!stats.isFile()) {
    throw new Error(`APP_SIZE_AAB_PATH must identify a file: ${requestedPath}`);
  }

  return {
    absolutePath,
    modifiedAtMs: stats.mtimeMs,
    path: displayPath(root, absolutePath),
    selectionSource: "APP_SIZE_AAB_PATH",
    sizeBytes: stats.size,
  };
}

function selectAabArtifact({ artifactCandidates, explicitPath, root }) {
  const requestedPath = typeof explicitPath === "string" ? explicitPath.trim() : "";
  if (requestedPath) return explicitArtifact(root, requestedPath);

  const candidates = artifactCandidates
    .filter((artifact) => path.extname(artifact.absolutePath).toLowerCase() === ".aab")
    .sort((left, right) => (
      right.modifiedAtMs - left.modifiedAtMs
      || left.path.localeCompare(right.path)
    ));
  if (candidates.length === 0) return null;

  return {
    ...candidates[0],
    selectionSource: "newest-local-aab",
  };
}

function summarizeSpotBundleEntries(entries) {
  const totals = {
    obsoletePngCompressedBytes: 0,
    obsoletePngEntryCount: 0,
    obsoletePngUncompressedBytes: 0,
    obsoletePngAbsent: true,
    webpCompressedBytes: 0,
    webpEntryCount: 0,
    webpUncompressedBytes: 0,
  };

  for (const entry of entries) {
    const normalizedName = entry.name.toLowerCase();
    if (!normalizedName.includes("spotthedifference") && !normalizedName.includes("spot-the-difference")) {
      continue;
    }
    const sceneMatch = normalizedName.match(/scene_\d{3}_[ab]\.(webp|png)$/u);
    if (!sceneMatch) continue;

    if (sceneMatch[1] === "webp") {
      totals.webpEntryCount += 1;
      totals.webpCompressedBytes += entry.compressedBytes;
      totals.webpUncompressedBytes += entry.uncompressedBytes;
    } else {
      totals.obsoletePngEntryCount += 1;
      totals.obsoletePngCompressedBytes += entry.compressedBytes;
      totals.obsoletePngUncompressedBytes += entry.uncompressedBytes;
    }
  }
  totals.obsoletePngAbsent = totals.obsoletePngEntryCount === 0;
  return totals;
}

function compareWithPreviousAab(sizeBytes) {
  const reductionBytes = PREVIOUS_AAB_BASELINE.sizeBytes - sizeBytes;
  return {
    baselineLabel: PREVIOUS_AAB_BASELINE.label,
    baselineSizeBytes: PREVIOUS_AAB_BASELINE.sizeBytes,
    changeBytes: sizeBytes - PREVIOUS_AAB_BASELINE.sizeBytes,
    reductionBytes,
    reductionPercent: (reductionBytes / PREVIOUS_AAB_BASELINE.sizeBytes) * 100,
  };
}

module.exports = {
  PREVIOUS_AAB_BASELINE,
  compareWithPreviousAab,
  selectAabArtifact,
  summarizeSpotBundleEntries,
};
