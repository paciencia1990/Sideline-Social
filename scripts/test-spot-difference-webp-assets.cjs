const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const assetDirectory = path.join(root, "assets", "games", "spot-the-difference");
const registryPath = path.join(root, "src", "game", "spotDifference", "spotDifferenceScenes.ts");
const screenPath = path.join(root, "src", "game", "spotDifference", "SpotDifferenceScreen.tsx");
const triviaBankPath = path.join(root, "functions", "src", "triviaQuestions.json");
const sceneAssetPattern = /^scene_(\d{3})_([AB])\.webp$/u;
const expectedSceneCount = 21;
const expectedAssetCount = expectedSceneCount * 2;
const expectedDimension = 1024;
const privateTriviaMarkers = JSON.parse(fs.readFileSync(triviaBankPath, "utf8"))
  .slice(0, 5)
  .map((question) => question.question_en)
  .filter((question) => typeof question === "string" && question.length >= 20);

const assetNames = fs.readdirSync(assetDirectory)
  .filter((name) => sceneAssetPattern.test(name))
  .sort();
const metadataNames = fs.readdirSync(assetDirectory)
  .filter((name) => /^scene_\d{3}\.json$/u.test(name))
  .sort();

assert.equal(assetNames.length, expectedAssetCount, "Exactly 42 WebP scene assets must be present.");
assert.equal(metadataNames.length, expectedSceneCount, "Exactly 21 scene metadata files must be present.");
assert.equal(
  fs.readdirSync(assetDirectory).some((name) => /^scene_\d{3}_[AB]\.png$/u.test(name)),
  false,
  "Obsolete Spot-the-Difference PNGs must not remain in the bundled asset directory.",
);

const registrySource = fs.readFileSync(registryPath, "utf8");
const screenSource = fs.readFileSync(screenPath, "utf8");
const sceneIds = registrySource.match(/id: "scene_\d{3}"/gu) ?? [];
const requiredAssets = [...registrySource.matchAll(/require\("([^"]+scene_\d{3}_[AB]\.webp)"\)/gu)]
  .map((match) => match[1]);

assert.equal(sceneIds.length, expectedSceneCount, "Exactly 21 scene definitions must remain registered.");
assert.equal(requiredAssets.length, expectedAssetCount, "Every scene definition must statically require A and B WebP assets.");
assert.equal(
  /spot-the-difference\/scene_\d{3}_[AB]\.png/gu.test(registrySource),
  false,
  "The scene registry must not reference obsolete PNG assets.",
);
assert.match(screenSource, /AppState,\s+Image,/su, "The renderer must preserve React Native Image gesture behavior.");
assert.match(screenSource, /resizeMode="contain"/u, "The renderer must preserve contain sizing.");
assert.doesNotMatch(screenSource, /from "expo-image"/u, "The regressing Expo Image renderer must not be restored.");

const metroConfig = require(path.join(root, "metro.config.js"));
assert.ok(metroConfig.resolver.assetExts.includes("webp"), "Metro must recognize WebP as a static asset.");

const sourceAssetHashes = new Set();
for (let sceneNumber = 1; sceneNumber <= expectedSceneCount; sceneNumber += 1) {
  const sceneId = String(sceneNumber).padStart(3, "0");
  const metadataName = `scene_${sceneId}.json`;
  const imageAName = `scene_${sceneId}_A.webp`;
  const imageBName = `scene_${sceneId}_B.webp`;
  const imageAPath = path.join(assetDirectory, imageAName);
  const imageBPath = path.join(assetDirectory, imageBName);
  const metadataPath = path.join(assetDirectory, metadataName);

  assert.ok(assetNames.includes(imageAName), `${imageAName} must exist.`);
  assert.ok(assetNames.includes(imageBName), `${imageBName} must exist.`);
  assert.ok(metadataNames.includes(metadataName), `${metadataName} must exist.`);
  assert.ok(
    registrySource.includes(`spot-the-difference/${imageAName}`) &&
      registrySource.includes(`spot-the-difference/${imageBName}`),
    `scene_${sceneId} must explicitly require both WebP assets.`,
  );

  const imageABuffer = fs.readFileSync(imageAPath);
  const imageBBuffer = fs.readFileSync(imageBPath);
  const imageASize = readWebPDimensions(imageABuffer, imageAName);
  const imageBSize = readWebPDimensions(imageBBuffer, imageBName);
  assert.deepEqual(imageASize, imageBSize, `scene_${sceneId} A/B dimensions must match.`);
  assert.deepEqual(
    imageASize,
    { width: expectedDimension, height: expectedDimension },
    `scene_${sceneId} must remain 1024x1024.`,
  );
  sourceAssetHashes.add(hash(imageABuffer));
  sourceAssetHashes.add(hash(imageBBuffer));

  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const differences = Array.isArray(metadata) ? metadata : metadata.differences;
  assert.ok(Array.isArray(differences), `${metadataName} must contain a differences array.`);
  assert.equal(differences.length, 10, `${metadataName} must retain all 10 differences.`);
  differences.forEach((difference, index) => {
    assertNormalized(difference.x, `${metadataName} difference ${index + 1} x`);
    assertNormalized(difference.y, `${metadataName} difference ${index + 1} y`);
    assert.ok(
      Number.isFinite(difference.radius) && difference.radius > 0 && difference.radius <= 1,
      `${metadataName} difference ${index + 1} radius must be normalized.`,
    );
  });
}

for (const exportDirectoryArgument of process.argv.slice(2)) {
  const exportDirectory = path.resolve(root, exportDirectoryArgument);
  validateProductionExport(exportDirectory, sourceAssetHashes);
  assertPrivateTriviaBankAbsent(exportDirectory);
}

console.log(
  `Spot-the-Difference WebP assets passed: ${expectedSceneCount} scenes, ` +
    `${expectedAssetCount} images, matching ${expectedDimension}x${expectedDimension} pairs, ` +
    `${process.argv.length - 2} production export(s) verified.`,
);

function assertNormalized(value, label) {
  assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `${label} must be between 0 and 1.`);
}

function hash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readWebPDimensions(buffer, filename) {
  assert.ok(buffer.length >= 30, `${filename} is too small to be a valid WebP image.`);
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF", `${filename} must have a RIFF header.`);
  assert.equal(buffer.toString("ascii", 8, 12), "WEBP", `${filename} must have a WebP header.`);

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString("ascii", offset, offset + 4);
    const chunkLength = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;

    if (chunkType === "VP8X" && dataOffset + 10 <= buffer.length) {
      return {
        width: 1 + buffer.readUIntLE(dataOffset + 4, 3),
        height: 1 + buffer.readUIntLE(dataOffset + 7, 3),
      };
    }
    if (chunkType === "VP8 " && dataOffset + 10 <= buffer.length) {
      assert.equal(
        buffer.subarray(dataOffset + 3, dataOffset + 6).toString("hex"),
        "9d012a",
        `${filename} has an invalid VP8 frame header.`,
      );
      return {
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    }
    if (chunkType === "VP8L" && dataOffset + 5 <= buffer.length) {
      assert.equal(buffer[dataOffset], 0x2f, `${filename} has an invalid VP8L frame header.`);
      const dimensions = buffer.readUInt32LE(dataOffset + 1);
      return {
        width: (dimensions & 0x3fff) + 1,
        height: ((dimensions >>> 14) & 0x3fff) + 1,
      };
    }

    offset = dataOffset + chunkLength + (chunkLength % 2);
  }

  assert.fail(`${filename} does not contain a supported WebP image chunk.`);
}

function validateProductionExport(exportDirectory, expectedHashes) {
  const metadataPath = path.join(exportDirectory, "metadata.json");
  assert.ok(fs.existsSync(metadataPath), `${exportDirectory} must contain production export metadata.`);
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const platformMetadata = Object.values(metadata.fileMetadata ?? {});
  assert.equal(platformMetadata.length, 1, `${exportDirectory} must describe exactly one platform export.`);
  const exportedAssets = platformMetadata[0].assets ?? [];
  const webpAssets = exportedAssets.filter((asset) => asset.ext === "webp");
  assert.equal(webpAssets.length, expectedAssetCount, `${exportDirectory} must contain all 42 WebP scene assets.`);

  const exportedHashes = new Set(webpAssets.map((asset) => {
    const exportedPath = path.join(exportDirectory, asset.path);
    assert.ok(fs.existsSync(exportedPath), `Exported WebP asset ${asset.path} must exist.`);
    return hash(fs.readFileSync(exportedPath));
  }));
  assert.deepEqual(exportedHashes, expectedHashes, `${exportDirectory} must contain the exact source WebP images.`);
}

function assertPrivateTriviaBankAbsent(exportDirectory) {
  assert.equal(privateTriviaMarkers.length, 5, "The server Trivia bank must provide stable export-scan markers.");
  const searchableExtensions = new Set([".bundle", ".hbc", ".js", ".json", ".map", ".txt"]);
  const exposedFiles = walkFiles(exportDirectory).filter((filename) => {
    if (!searchableExtensions.has(path.extname(filename).toLowerCase())) return false;
    const content = fs.readFileSync(filename);
    return privateTriviaMarkers.filter((marker) => content.includes(Buffer.from(marker, "utf8"))).length >= 2;
  });
  assert.equal(
    exposedFiles.length,
    0,
    `${exportDirectory} must not contain the private server-side Trivia answer bank.`,
  );
}

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(resolved) : [resolved];
  });
}
