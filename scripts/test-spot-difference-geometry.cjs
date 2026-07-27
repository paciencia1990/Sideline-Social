"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText;
  module._compile(compiled, filename);
};

const root = path.resolve(__dirname, "..");
const geometryPath = path.join(root, "src", "game", "spotDifference", "geometry.ts");
const geometry = require(geometryPath);
const transformedSource = require("@babel/core").transformFileSync(geometryPath, {
  configFile: path.join(root, "babel.config.js"),
}).code;
const transformedModule = { exports: {} };
new Function("exports", "module", "require", transformedSource)(
  transformedModule.exports,
  transformedModule,
  require,
);

runGeometryContract(geometry, "TypeScript");
runGeometryContract(transformedModule.exports, "Babel worklet");

console.log("Spot-the-Difference geometry passed for direct TypeScript and Babel-transformed worklets.");

function runGeometryContract(subject, label) {
  const {
    calculateContainedImageLayout,
    clampSpotDifferenceTranslation,
    createSpotDifferenceResetTransform,
    getSpotDifferenceTranslationBounds,
    normalizedPointToScreenPoint,
    scaleSpotDifferenceTransformAroundFocalPoint,
    screenPointToSourcePoint,
  } = subject;

  assert.deepEqual(
    calculateContainedImageLayout({ width: 300, height: 200 }, { width: 100, height: 100 }),
    { width: 200, height: 200, offsetX: 50, offsetY: 0 },
    `${label}: square content must preserve horizontal letterboxing.`,
  );
  assert.deepEqual(
    calculateContainedImageLayout({ width: 200, height: 300 }, { width: 200, height: 100 }),
    { width: 200, height: 100, offsetX: 0, offsetY: 100 },
    `${label}: landscape content must preserve vertical letterboxing.`,
  );
  assert.deepEqual(
    calculateContainedImageLayout({ width: 300, height: 200 }, { width: 100, height: 200 }),
    { width: 100, height: 200, offsetX: 100, offsetY: 0 },
    `${label}: portrait content must preserve horizontal letterboxing.`,
  );
  assert.equal(
    calculateContainedImageLayout({ width: 0, height: 200 }, { width: 100, height: 100 }),
    null,
    `${label}: invalid viewports must not produce geometry.`,
  );

  const viewport = { width: 200, height: 100 };
  const fullRect = { width: 200, height: 100, offsetX: 0, offsetY: 0 };
  assert.deepEqual(
    scaleSpotDifferenceTransformAroundFocalPoint(
      createSpotDifferenceResetTransform(),
      { x: 50, y: 25 },
      viewport,
      2,
      1,
      4,
    ),
    { scale: 2, translateX: 50, translateY: 25 },
    `${label}: pinch scaling must retain the touched source point under the focal point.`,
  );
  assert.deepEqual(
    scaleSpotDifferenceTransformAroundFocalPoint(
      { scale: 2, translateX: 50, translateY: 25 },
      { x: 50, y: 25 },
      viewport,
      8,
      1,
      4,
    ),
    { scale: 4, translateX: 150, translateY: 75 },
    `${label}: a new pinch must start from the committed transform and respect maximum zoom.`,
  );

  assert.deepEqual(
    getSpotDifferenceTranslationBounds(viewport, fullRect, 1),
    { minimumX: 0, maximumX: 0, minimumY: 0, maximumY: 0 },
    `${label}: scale-one pan bounds must remain centered.`,
  );
  assert.deepEqual(
    getSpotDifferenceTranslationBounds(viewport, fullRect, 4),
    { minimumX: -300, maximumX: 300, minimumY: -150, maximumY: 150 },
    `${label}: maximum-zoom pan bounds must derive from rendered dimensions.`,
  );
  assert.deepEqual(
    clampSpotDifferenceTranslation(
      { scale: 1, translateX: 30, translateY: -20 },
      viewport,
      fullRect,
      1,
      4,
      0.01,
    ),
    createSpotDifferenceResetTransform(),
    `${label}: returning to scale one must reset translation.`,
  );
  assert.deepEqual(
    clampSpotDifferenceTranslation(
      { scale: 4, translateX: 500, translateY: -500 },
      viewport,
      fullRect,
      1,
      4,
      0.01,
    ),
    { scale: 4, translateX: 300, translateY: -150 },
    `${label}: released transforms must clamp into valid bounds.`,
  );

  const letterboxedViewport = { width: 300, height: 200 };
  const letterboxedRect = { width: 200, height: 200, offsetX: 50, offsetY: 0 };
  assert.deepEqual(
    getSpotDifferenceTranslationBounds(letterboxedViewport, letterboxedRect, 2),
    { minimumX: -50, maximumX: 50, minimumY: -100, maximumY: 100 },
    `${label}: letterboxed bounds must use the displayed image rectangle.`,
  );
  assert.deepEqual(
    getSpotDifferenceTranslationBounds(letterboxedViewport, letterboxedRect, 1.25),
    { minimumX: 0, maximumX: 0, minimumY: -25, maximumY: 25 },
    `${label}: a still-letterboxed axis must remain centered while the filled axis can pan.`,
  );
  assert.deepEqual(
    getSpotDifferenceTranslationBounds(
      letterboxedViewport,
      { width: 200, height: 200, offsetX: 25, offsetY: 0 },
      2,
    ),
    { minimumX: 0, maximumX: 100, minimumY: -100, maximumY: 100 },
    `${label}: non-centered contain rectangles must retain their measured offset in pan bounds.`,
  );

  const transform = { scale: 2, translateX: 40, translateY: -20 };
  const normalized = { x: 0.25, y: 0.75 };
  const screen = normalizedPointToScreenPoint(
    normalized,
    letterboxedViewport,
    letterboxedRect,
    transform,
  );
  assert.deepEqual(
    screen,
    { x: 90, y: 180 },
    `${label}: normalized hotspots must map through contain offsets, scale, and translation.`,
  );
  assert.deepEqual(
    screenPointToSourcePoint(
      screen.x,
      screen.y,
      letterboxedViewport,
      letterboxedRect,
      transform,
    ),
    normalized,
    `${label}: screen and hotspot conversion must round-trip after zoom and pan.`,
  );
  assert.equal(
    screenPointToSourcePoint(
      25,
      100,
      letterboxedViewport,
      letterboxedRect,
      createSpotDifferenceResetTransform(),
    ),
    null,
    `${label}: taps in contain letterboxing must not select a hotspot.`,
  );

  for (const safeAreaAdjustedViewport of [
    { width: 342, height: 240 },
    { width: 390, height: 260 },
  ]) {
    const imageRect = calculateContainedImageLayout(
      safeAreaAdjustedViewport,
      { width: 1024, height: 1024 },
    );
    const centerPoint = normalizedPointToScreenPoint(
      { x: 0.5, y: 0.5 },
      safeAreaAdjustedViewport,
      imageRect,
      createSpotDifferenceResetTransform(),
    );
    assert.deepEqual(
      centerPoint,
      {
        x: safeAreaAdjustedViewport.width / 2,
        y: safeAreaAdjustedViewport.height / 2,
      },
      `${label}: safe-area-adjusted viewports must retain local center coordinates.`,
    );
  }
}
