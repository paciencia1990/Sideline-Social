"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const manager = fs.readFileSync(path.join(process.cwd(), "components", "SquadSeasonManager.tsx"), "utf8");
const service = fs.readFileSync(path.join(process.cwd(), "services", "leaderboardService.ts"), "utf8");
const boundary = fs.readFileSync(path.join(process.cwd(), "components", "ErrorBoundary.tsx"), "utf8");
const config = fs.readFileSync(path.join(process.cwd(), "app.config.js"), "utf8");

assert.match(manager, /@react-native-community\/datetimepicker/);
assert.match(manager, /testID={`season-\$\{props\.field\}-button`}/, "both calendar fields use one accessible pressable implementation");
assert.match(manager, /accessibilityRole="button"/);
assert.match(manager, /display="calendar"/, "Android uses calendar presentation");
assert.match(manager, /display="inline"/, "iOS uses inline presentation with explicit actions");
assert.match(manager, /event\.type === "set"/, "Android dismiss preserves the previous selection");
assert.match(manager, /cancelIosPicker/);
assert.match(manager, /confirmIosPicker/);
assert.match(manager, /minimumDate={pickerMinimumDate}/);
assert.match(manager, /getFixedFooterBottomPadding\(insets\.bottom\)/, "modal and picker actions use the shared safe-area utility");
assert.match(manager, /KeyboardAvoidingView/);
assert.match(manager, /submittingRef\.current/, "duplicate Save taps are synchronously blocked");
assert.match(manager, /idempotencyKey: form\.idempotencyKey/);
assert.doesNotMatch(manager, /placeholder="YYYY-MM-DD"/);
assert.doesNotMatch(manager, /\.toDate\(\)|\.toMillis\(\)/, "rendering never calls Timestamp prototype methods");
assert.match(service, /normalizeSquadSeason/);
assert.match(boundary, /common\.genericError/);
assert.doesNotMatch(boundary, /this\.state\.error\.message/, "raw exceptions are not shown to users");
assert.match(config, /@react-native-community\/datetimepicker/);

console.log("Squad season calendar controls, accessibility, safe-area, duplicate-submit, and scoped-error contracts passed.");
