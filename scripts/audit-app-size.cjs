#!/usr/bin/env node

const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  compareWithPreviousAab,
  selectAabArtifact,
  summarizeSpotBundleEntries,
} = require("./app-size-audit-core.cjs");

const root = path.resolve(__dirname, "..");
const outputDirectory = path.join(root, "build", "app-size-audit");
const excludedDirectories = new Set([
  ".expo",
  ".git",
  "build",
  "dist",
  "node_modules",
]);
const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".json", ".mjs", ".ts", ".tsx"]);
const assetExtensions = new Map([
  [".avif", "image"],
  [".gif", "image"],
  [".jpeg", "image"],
  [".jpg", "image"],
  [".png", "image"],
  [".svg", "image"],
  [".webp", "image"],
  [".otf", "font"],
  [".ttf", "font"],
  [".woff", "font"],
  [".woff2", "font"],
  [".aac", "audio"],
  [".m4a", "audio"],
  [".mp3", "audio"],
  [".wav", "audio"],
  [".mp4", "video"],
  [".mov", "video"],
  [".webm", "video"],
  [".json", "data"],
]);

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function walk(directory, options = {}) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isDirectory() && (excludedDirectories.has(entry.name) || options.exclude?.has(entry.name))) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolutePath, options));
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function bytesLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
}

function comparisonLabel(comparison) {
  if (comparison.reductionBytes >= 0) {
    return `${bytesLabel(comparison.reductionBytes)} smaller (${comparison.reductionPercent.toFixed(2)}% reduction)`;
  }
  return `${bytesLabel(Math.abs(comparison.reductionBytes))} larger (${Math.abs(comparison.reductionPercent).toFixed(2)}% increase)`;
}

function dependencyName(specifier) {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("@/")) return null;
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

function readZipCentralDirectory(filePath) {
  const buffer = fs.readFileSync(filePath);
  const minimumEndOffset = Math.max(0, buffer.length - 65_557);
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= minimumEndOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error(`ZIP central directory not found: ${filePath}`);

  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`Invalid ZIP directory entry ${index}: ${filePath}`);
    const compressedBytes = buffer.readUInt32LE(offset + 20);
    const uncompressedBytes = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
    entries.push({ compressedBytes, name, uncompressedBytes });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function bundleContributionGroup(name) {
  if (name.startsWith("BUNDLE-METADATA/com.android.tools.build.debugsymbols/")) return "BUNDLE-METADATA/native-debug-symbols";
  if (name.startsWith("BUNDLE-METADATA/")) return "BUNDLE-METADATA/other";
  if (name.startsWith("base/lib/")) return name.split("/").slice(0, 3).join("/");
  if (name.startsWith("base/assets/")) return "base/assets";
  if (name.startsWith("base/dex/")) return "base/dex";
  if (name.startsWith("base/res/")) return "base/res";
  if (name.startsWith("base/root/")) return "base/root";
  if (name.startsWith("base/")) return "base/other";
  return "bundle/other";
}

const assetRoot = path.join(root, "assets");
const assets = walk(assetRoot)
  .filter((filePath) => assetExtensions.has(path.extname(filePath).toLowerCase()))
  .map((filePath) => {
    const extension = path.extname(filePath).toLowerCase();
    const relativePath = toPosix(path.relative(root, filePath));
    return {
      category: assetExtensions.get(extension),
      extension,
      hash: sha256(filePath),
      path: relativePath,
      sizeBytes: fs.statSync(filePath).size,
    };
  });

const sourceFiles = walk(root)
  .filter((filePath) => sourceExtensions.has(path.extname(filePath).toLowerCase()))
  .filter((filePath) => !toPosix(path.relative(root, filePath)).startsWith("functions/"));
const sourceText = sourceFiles.map((filePath) => {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}).join("\n");

const imports = new Set();
const importPattern = /(?:from\s+|require\s*\(|import\s*\()\s*["']([^"']+)["']/g;
for (const filePath of sourceFiles) {
  const text = fs.readFileSync(filePath, "utf8");
  for (const match of text.matchAll(importPattern)) {
    const name = dependencyName(match[1]);
    if (name) imports.add(name);
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const configurationText = ["app.config.js", "babel.config.js", "index.js", "metro.config.js"]
  .map((fileName) => path.join(root, fileName))
  .filter((filePath) => fs.existsSync(filePath))
  .map((filePath) => fs.readFileSync(filePath, "utf8"))
  .join("\n");
const dependencyReviewCandidates = Object.keys(packageJson.dependencies ?? {})
  .filter((name) => !imports.has(name) && !configurationText.includes(`"${name}"`) && !configurationText.includes(`'${name}'`))
  .sort();

const unreferencedAssetCandidates = assets
  .filter((asset) => {
    const relativeWithoutAssets = asset.path.replace(/^assets\//, "");
    return !sourceText.includes(asset.path)
      && !sourceText.includes(relativeWithoutAssets)
      && !sourceText.includes(path.posix.basename(asset.path));
  })
  .map((asset) => asset.path)
  .sort();
const unreferencedAssetSet = new Set(unreferencedAssetCandidates);
const staticallyReferencedAssets = assets.filter((asset) => !unreferencedAssetSet.has(asset.path));
const iconAndSplashAssets = assets.filter((asset) => /(?:^|\/)[^/]*(?:icon|splash)[^/]*$/i.test(asset.path));
const optimizationChanges = [];
for (const asset of assets) {
  try {
    const original = childProcess.execFileSync("git", ["show", `HEAD:${asset.path}`], {
      encoding: null,
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (original.length > asset.sizeBytes && sha256Buffer(original) !== asset.hash) {
      optimizationChanges.push({
        afterBytes: asset.sizeBytes,
        beforeBytes: original.length,
        path: asset.path,
        savedBytes: original.length - asset.sizeBytes,
      });
    }
  } catch {
    // Untracked assets have no Git baseline and remain covered by the current inventory.
  }
}

const assetsByHash = new Map();
for (const asset of assets) {
  const group = assetsByHash.get(asset.hash) ?? [];
  group.push(asset);
  assetsByHash.set(asset.hash, group);
}
const duplicateGroups = [...assetsByHash.values()]
  .filter((group) => group.length > 1)
  .map((group) => ({
    duplicateBytes: group[0].sizeBytes * (group.length - 1),
    hash: group[0].hash,
    paths: group.map((asset) => asset.path).sort(),
    sizeBytesEach: group[0].sizeBytes,
  }))
  .sort((left, right) => right.duplicateBytes - left.duplicateBytes || left.hash.localeCompare(right.hash));

const totalsByCategory = {};
for (const asset of assets) {
  totalsByCategory[asset.category] ??= { count: 0, sizeBytes: 0 };
  totalsByCategory[asset.category].count += 1;
  totalsByCategory[asset.category].sizeBytes += asset.sizeBytes;
}

const spotPattern = /^assets\/games\/spot-the-difference\/scene_(\d{3})_([AB])\.webp$/;
const spotSceneAssets = assets.filter((asset) => spotPattern.test(asset.path));
const spotScenes = new Map();
for (const asset of spotSceneAssets) {
  const [, sceneNumber, side] = asset.path.match(spotPattern);
  const scene = spotScenes.get(sceneNumber) ?? { A: null, B: null };
  scene[side] = asset;
  spotScenes.set(sceneNumber, scene);
}
const completeSpotPairs = [...spotScenes.values()].filter((scene) => scene.A && scene.B).length;
const spotTotalBytes = spotSceneAssets.reduce((sum, asset) => sum + asset.sizeBytes, 0);

const gradlePropertiesPath = path.join(root, "android", "gradle.properties");
const appGradlePath = path.join(root, "android", "app", "build.gradle");
const reactNativeVersionsPath = path.join(root, "node_modules", "react-native", "gradle", "libs.versions.toml");
const gradleProperties = fs.existsSync(gradlePropertiesPath) ? fs.readFileSync(gradlePropertiesPath, "utf8") : "";
const appGradle = fs.existsSync(appGradlePath) ? fs.readFileSync(appGradlePath, "utf8") : "";
const reactNativeVersions = fs.existsSync(reactNativeVersionsPath) ? fs.readFileSync(reactNativeVersionsPath, "utf8") : "";
const propertyValue = (name) => gradleProperties.match(new RegExp(`^${name.replaceAll(".", "\\.")}=(.+)$`, "m"))?.[1]?.trim() ?? null;
const versionCatalogValue = (name) => reactNativeVersions.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"$`, "m"))?.[1] ?? null;

const artifactRoots = [path.join(root, "build"), path.join(root, "android", "app", "build", "outputs")];
const artifactCandidates = [...new Set(artifactRoots.flatMap((directory) => walk(directory, { exclude: new Set() })))]
  .filter((filePath) => [".aab", ".apk"].includes(path.extname(filePath).toLowerCase()))
  .map((filePath) => {
    const stats = fs.statSync(filePath);
    return {
      absolutePath: filePath,
      modifiedAtMs: stats.mtimeMs,
      path: toPosix(path.relative(root, filePath)),
      sizeBytes: stats.size,
    };
  });
const artifactPaths = artifactCandidates
  .map(({ path: artifactPath, sizeBytes }) => ({ path: artifactPath, sizeBytes }))
  .sort((left, right) => left.path.localeCompare(right.path));
const analyzedBundle = selectAabArtifact({
  artifactCandidates,
  explicitPath: process.env.APP_SIZE_AAB_PATH,
  root,
});
let bundleAnalysis = null;
if (analyzedBundle) {
  const entries = readZipCentralDirectory(analyzedBundle.absolutePath);
  const contributionMap = new Map();
  for (const entry of entries) {
    const group = bundleContributionGroup(entry.name);
    const contribution = contributionMap.get(group) ?? { compressedBytes: 0, entryCount: 0, uncompressedBytes: 0 };
    contribution.compressedBytes += entry.compressedBytes;
    contribution.entryCount += 1;
    contribution.uncompressedBytes += entry.uncompressedBytes;
    contributionMap.set(group, contribution);
  }
  bundleAnalysis = {
    artifact: analyzedBundle.path,
    comparisonToPreviousAab: compareWithPreviousAab(analyzedBundle.sizeBytes),
    contributionGroups: [...contributionMap.entries()]
      .map(([group, contribution]) => ({ group, ...contribution }))
      .sort((left, right) => right.compressedBytes - left.compressedBytes || left.group.localeCompare(right.group)),
    selectionSource: analyzedBundle.selectionSource,
    sizeBytes: analyzedBundle.sizeBytes,
    spotTheDifference: summarizeSpotBundleEntries(entries),
    top30Entries: [...entries]
      .sort((left, right) => right.compressedBytes - left.compressedBytes || left.name.localeCompare(right.name))
      .slice(0, 30),
  };
}

const atlasPath = path.join(root, ".expo", "atlas.jsonl");
let atlasAnalysis = null;
if (fs.existsSync(atlasPath)) {
  const atlasText = fs.readFileSync(atlasPath, "utf8");
  const firstNewline = atlasText.indexOf("\n");
  const payload = JSON.parse(atlasText.slice(firstNewline + 1).trim());
  const modules = [...(payload[5] ?? []), ...(payload[6] ?? [])];
  const packageMap = new Map();
  for (const module of modules) {
    const packageName = module.package ?? "(application/virtual)";
    const packageTotal = packageMap.get(packageName) ?? { moduleCount: 0, sourceBytes: 0 };
    packageTotal.moduleCount += 1;
    packageTotal.sourceBytes += module.size ?? 0;
    packageMap.set(packageName, packageTotal);
  }
  atlasAnalysis = {
    moduleCount: modules.length,
    sourceBytes: modules.reduce((sum, module) => sum + (module.size ?? 0), 0),
    top30Modules: [...modules]
      .sort((left, right) => (right.size ?? 0) - (left.size ?? 0) || left.relativePath.localeCompare(right.relativePath))
      .slice(0, 30)
      .map((module) => ({ path: module.relativePath, sourceBytes: module.size ?? 0 })),
    top30Packages: [...packageMap.entries()]
      .map(([packageName, total]) => ({ packageName, ...total }))
      .sort((left, right) => right.sourceBytes - left.sourceBytes || left.packageName.localeCompare(right.packageName))
      .slice(0, 30),
  };
}
const atlasExportDirectory = path.join(outputDirectory, "atlas-export");
const atlasExportFiles = walk(atlasExportDirectory);
const atlasExport = atlasExportFiles.length > 0 ? {
  assetBytes: atlasExportFiles
    .filter((filePath) => toPosix(path.relative(atlasExportDirectory, filePath)).startsWith("assets/"))
    .reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0),
  assetCount: atlasExportFiles.filter((filePath) => toPosix(path.relative(atlasExportDirectory, filePath)).startsWith("assets/")).length,
  javascriptBytes: atlasExportFiles
    .filter((filePath) => path.extname(filePath).toLowerCase() === ".hbc")
    .reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0),
  totalBytes: atlasExportFiles.reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0),
} : null;

const report = {
  artifacts: artifactPaths,
  atlasAnalysis,
  atlasExport,
  bundleAnalysis,
  assets: {
    duplicateGroups,
    iconAndSplashAssets,
    optimizationChanges,
    staticallyReferencedBytes: staticallyReferencedAssets.reduce((sum, asset) => sum + asset.sizeBytes, 0),
    staticallyReferencedCount: staticallyReferencedAssets.length,
    top30: [...assets]
      .sort((left, right) => right.sizeBytes - left.sizeBytes || left.path.localeCompare(right.path))
      .slice(0, 30),
    totalBytes: assets.reduce((sum, asset) => sum + asset.sizeBytes, 0),
    totalCount: assets.length,
    totalsByCategory,
    unreferencedCandidates: unreferencedAssetCandidates,
  },
  dependencies: {
    declaredCount: Object.keys(packageJson.dependencies ?? {}).length,
    importedPackages: [...imports].sort(),
    reviewCandidates: dependencyReviewCandidates,
  },
  gradle: {
    androidGradlePlugin: versionCatalogValue("agp"),
    abiFilters: propertyValue("reactNativeArchitectures")?.split(",") ?? [],
    compileSdk: propertyValue("android.compileSdkVersion"),
    gifSupport: propertyValue("expo.gif.enabled"),
    hermesEnabled: propertyValue("hermesEnabled"),
    minifyReleaseDefault: appGradle.includes("android.enableMinifyInReleaseBuilds") ? "false unless overridden" : "not detected",
    ndkVersion: versionCatalogValue("ndkVersion"),
    newArchitectureEnabled: propertyValue("newArchEnabled"),
    resourceShrinkReleaseDefault: appGradle.includes("android.enableShrinkResourcesInReleaseBuilds") ? "false unless overridden" : "not detected",
    targetSdk: propertyValue("android.targetSdkVersion"),
    webpSupport: propertyValue("expo.webp.enabled"),
  },
  spotTheDifference: {
    completePairs: completeSpotPairs,
    imageCount: spotSceneAssets.length,
    totalBytes: spotTotalBytes,
  },
};

const markdown = [
  "# App Size Audit",
  "",
  "This report is generated deterministically by `npm run audit:app-size`. Candidate lists require human review before deletion.",
  "Set `APP_SIZE_AAB_PATH` to the current `.aab` to analyze that exact artifact; otherwise the newest local AAB is selected by modification time.",
  "",
  "## Asset inventory",
  "",
  `- ${report.assets.totalCount} assets total (${bytesLabel(report.assets.totalBytes)})`,
  `- ${report.assets.staticallyReferencedCount} statically referenced or conservatively retained (${bytesLabel(report.assets.staticallyReferencedBytes)})`,
  ...Object.entries(totalsByCategory).sort(([left], [right]) => left.localeCompare(right)).map(([category, total]) => `- ${category}: ${total.count} files (${bytesLabel(total.sizeBytes)})`),
  `- Spot the Differences: ${completeSpotPairs} complete A/B pairs, ${spotSceneAssets.length} images (${bytesLabel(spotTotalBytes)})`,
  `- Exact duplicate groups: ${duplicateGroups.length}`,
  `- Static-reference review candidates: ${unreferencedAssetCandidates.length}`,
  `- Icon/splash assets: ${iconAndSplashAssets.length} files (${bytesLabel(iconAndSplashAssets.reduce((sum, asset) => sum + asset.sizeBytes, 0))})`,
  "",
  "## Applied asset optimizations versus Git HEAD",
  "",
  ...(optimizationChanges.length > 0 ? [
    "| Asset | Before | After | Saved |",
    "| --- | ---: | ---: | ---: |",
    ...optimizationChanges.map((asset) => `| ${asset.path} | ${bytesLabel(asset.beforeBytes)} | ${bytesLabel(asset.afterBytes)} | ${bytesLabel(asset.savedBytes)} |`),
    "",
    `Total saved: ${bytesLabel(optimizationChanges.reduce((sum, asset) => sum + asset.savedBytes, 0))}.`,
  ] : ["No checked-in asset byte changes were detected."]),
  "",
  "## Largest 30 assets",
  "",
  "| Asset | Size |",
  "| --- | ---: |",
  ...report.assets.top30.map((asset) => `| ${asset.path} | ${bytesLabel(asset.sizeBytes)} |`),
  "",
  "## Exact duplicate groups",
  "",
  ...(duplicateGroups.length > 0
    ? duplicateGroups.flatMap((group) => [`- ${bytesLabel(group.sizeBytesEach)} each; reclaimable duplicate bytes ${bytesLabel(group.duplicateBytes)}`, ...group.paths.map((assetPath) => `  - ${assetPath}`)])
    : ["No byte-identical asset duplicates were found."]),
  "",
  "## Static-reference review candidates",
  "",
  ...(unreferencedAssetCandidates.length > 0 ? unreferencedAssetCandidates.map((assetPath) => `- ${assetPath}`) : ["No unreferenced candidates were found by the conservative filename/path scan."]),
  "",
  "## Dependency review candidates",
  "",
  "These declared packages were not found in static imports or configuration strings. Dynamic resolution and native configuration can produce false positives.",
  "",
  ...(dependencyReviewCandidates.length > 0 ? dependencyReviewCandidates.map((name) => `- ${name}`) : ["No candidates found."]),
  "",
  "## Android packaging configuration",
  "",
  `- compile SDK: ${report.gradle.compileSdk ?? "not detected"}`,
  `- target SDK: ${report.gradle.targetSdk ?? "not detected"}`,
  `- Android Gradle Plugin: ${report.gradle.androidGradlePlugin ?? "not detected"}`,
  `- NDK: ${report.gradle.ndkVersion ?? "not detected"}`,
  `- ABIs: ${report.gradle.abiFilters.join(", ") || "not detected"}`,
  `- Hermes: ${report.gradle.hermesEnabled ?? "not detected"}`,
  `- New Architecture: ${report.gradle.newArchitectureEnabled ?? "not detected"}`,
  `- Release code minification: ${report.gradle.minifyReleaseDefault}`,
  `- Release resource shrinking: ${report.gradle.resourceShrinkReleaseDefault}`,
  "",
  "## Existing local artifacts (read-only inventory)",
  "",
  ...(artifactPaths.length > 0 ? artifactPaths.map((artifact) => `- ${artifact.path}: ${bytesLabel(artifact.sizeBytes)}`) : ["No local APK/AAB artifacts found."]),
  "",
  "## Existing AAB compressed contribution analysis",
  "",
  ...(bundleAnalysis ? [
    `Analyzed read-only: ${bundleAnalysis.artifact}`,
    `Selection: ${bundleAnalysis.selectionSource === "APP_SIZE_AAB_PATH" ? "explicit APP_SIZE_AAB_PATH" : "newest local AAB by modification time"}`,
    `AAB upload size: ${bytesLabel(bundleAnalysis.sizeBytes)}`,
    `Compared with ${bundleAnalysis.comparisonToPreviousAab.baselineLabel} (${bytesLabel(bundleAnalysis.comparisonToPreviousAab.baselineSizeBytes)}): ${comparisonLabel(bundleAnalysis.comparisonToPreviousAab)}`,
    `Spot-the-Difference WebP bundle entries: ${bundleAnalysis.spotTheDifference.webpEntryCount} (${bytesLabel(bundleAnalysis.spotTheDifference.webpCompressedBytes)} compressed; ${bytesLabel(bundleAnalysis.spotTheDifference.webpUncompressedBytes)} raw)`,
    `Obsolete Spot-the-Difference PNG bundle entries: ${bundleAnalysis.spotTheDifference.obsoletePngEntryCount} (${bundleAnalysis.spotTheDifference.obsoletePngAbsent ? "absent" : "present"})`,
    "The analysis reflects the selected local artifact; source or JavaScript changes made after that artifact was built are not included.",
    "",
    "| Bundle area | ZIP-compressed size | Uncompressed size | Entries |",
    "| --- | ---: | ---: | ---: |",
    ...bundleAnalysis.contributionGroups.map((group) => `| ${group.group} | ${bytesLabel(group.compressedBytes)} | ${bytesLabel(group.uncompressedBytes)} | ${group.entryCount} |`),
    "",
    "Largest compressed entries:",
    "",
    ...bundleAnalysis.top30Entries.map((entry) => `- ${entry.name}: ${bytesLabel(entry.compressedBytes)} compressed (${bytesLabel(entry.uncompressedBytes)} raw)`),
  ] : ["No AAB was available for read-only contribution analysis."]),
  "",
  "## Expo Atlas production JavaScript analysis",
  "",
  ...(atlasExport ? [
    `Production export: ${atlasExport.assetCount} emitted assets (${bytesLabel(atlasExport.assetBytes)}), Hermes JavaScript ${bytesLabel(atlasExport.javascriptBytes)}, ${bytesLabel(atlasExport.totalBytes)} total before AAB packaging.`,
    "",
  ] : []),
  ...(atlasAnalysis ? [
    `${atlasAnalysis.moduleCount} modules; ${bytesLabel(atlasAnalysis.sourceBytes)} of module source represented in the Atlas graph. The exported Hermes bundle is reported by the export command separately.`,
    "",
    "Largest package source contributions:",
    "",
    ...atlasAnalysis.top30Packages.map((item) => `- ${item.packageName}: ${bytesLabel(item.sourceBytes)} across ${item.moduleCount} modules`),
    "",
    "Largest individual module sources:",
    "",
    ...atlasAnalysis.top30Modules.map((item) => `- ${item.path}: ${bytesLabel(item.sourceBytes)}`),
  ] : ["No `.expo/atlas.jsonl` file was available. Run the production Android export with `EXPO_ATLAS=true` first."]),
  "",
].join("\n");

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, "app-size-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outputDirectory, "app-size-audit.md"), `${markdown}\n`);

console.log(`App size audit: ${assets.length} assets, ${bytesLabel(report.assets.totalBytes)} total.`);
console.log(`Spot the Differences: ${completeSpotPairs} pairs, ${bytesLabel(spotTotalBytes)}.`);
if (bundleAnalysis) {
  console.log(`AAB analyzed: ${bundleAnalysis.artifact} (${bytesLabel(bundleAnalysis.sizeBytes)}).`);
}
console.log(`Reports: ${path.relative(root, outputDirectory)}`);
