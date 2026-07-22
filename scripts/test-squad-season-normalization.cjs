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

const season = require(path.join(process.cwd(), "utils", "squadSeasonDate.ts"));

const callableSerializedFall2026 = {
  seasonId: "fall-2026",
  squadId: "fixture-squad",
  name: "Fall 2026",
  startAt: { _seconds: Date.parse("2026-09-12T04:00:00.000Z") / 1000, _nanoseconds: 0 },
  endAt: { _seconds: Date.parse("2026-11-21T05:00:00.000Z") / 1000, _nanoseconds: 0 },
  timeZone: "America/New_York",
  status: "upcoming",
  isCurrent: false,
  createdAt: null,
  updatedAt: null,
};

assert.equal(callableSerializedFall2026.startAt.toDate, undefined, "callable JSON strips Timestamp prototype methods");
assert.throws(() => callableSerializedFall2026.startAt.toDate(), /not a function/, "the former Squad render path is reproduced");

const normalized = season.normalizeSquadSeason(callableSerializedFall2026);
assert.equal(normalized.name, "Fall 2026");
assert.equal(normalized.startDateKey, "2026-09-12");
assert.equal(normalized.endDateKey, "2026-11-20");
assert.equal(normalized.timeZone, "America/New_York");
assert.equal(normalized.detailsAvailable, true);
assert.equal(season.formatSeasonDateRange(normalized), "09/12/2026 – 11/20/2026");
assert.equal(normalized.createdAt, null, "null server timestamps remain safe");
assert.equal(normalized.updatedAt, null, "missing optional timestamps remain safe");

let toDateCalls = 0;
const firestoreTimestamp = {
  toDate() {
    toDateCalls += 1;
    return new Date("2026-09-12T04:00:00.000Z");
  },
};
assert.equal(season.toSafeDate(firestoreTimestamp).toISOString(), "2026-09-12T04:00:00.000Z");
assert.equal(toDateCalls, 1);
assert.equal(season.toSafeDate({ toDate: "not-a-function" }), null, ".toDate is never invoked without a function guard");
assert.equal(season.toSafeDate(new Date("invalid")), null);
assert.equal(season.toSafeDate("2026-09-12").getDate(), 12, "date-only values use local calendar construction");
assert.equal(season.toSafeDate("2026-09-12T04:00:00.000Z").toISOString(), "2026-09-12T04:00:00.000Z");
assert.equal(season.toSafeDate(Date.parse("2026-09-12T04:00:00.000Z")).toISOString(), "2026-09-12T04:00:00.000Z");

const legacy = season.normalizeSquadSeason({
  id: "legacy",
  name: "Legacy Season",
  startsAt: "2026-09-12T04:00:00.000Z",
  endsAt: "2026-11-21T05:00:00.000Z",
  timezone: "America/New_York",
  status: "scheduled",
});
assert.equal(legacy.startDateKey, "2026-09-12");
assert.equal(legacy.endDateKey, "2026-11-20");
assert.equal(legacy.status, "upcoming");
assert.equal(legacy.detailsAvailable, true);

for (const malformed of [
  { seasonId: "missing-start", name: "Missing", endDateKey: "2026-11-20", timeZone: "America/New_York", status: "upcoming" },
  { seasonId: "missing-end", name: "Missing", startDateKey: "2026-09-12", timeZone: "America/New_York", status: "upcoming" },
  { seasonId: "invalid-zone", name: "Invalid", startDateKey: "2026-09-12", endDateKey: "2026-11-20", timeZone: "Phone/Local", status: "upcoming" },
  { seasonId: "missing-status", name: "Invalid", startDateKey: "2026-09-12", endDateKey: "2026-11-20", timeZone: "America/New_York" },
  null,
]) {
  assert.doesNotThrow(() => season.normalizeSquadSeason(malformed));
  assert.equal(season.normalizeSquadSeason(malformed).detailsAvailable, false);
}

assert.equal(season.formatUsDateKey("2026-01-05"), "01/05/2026");
assert.equal(season.formatUsDateKey("2026-09-12"), "09/12/2026");
assert.equal(season.formatUsDateKey("2026-11-20"), "11/20/2026");
assert.equal(season.formatUsDateKey("05/01/2026"), "", "ambiguous display strings are never parsed as backend date keys");
assert.equal(season.localDateToDateKey(new Date(2026, 8, 12)), "2026-09-12");
assert.equal(season.dateKeyToLocalDate("2026-09-12").getDate(), 12);

const sorted = season.sortSquadSeasons([
  season.normalizeSquadSeason({ seasonId: "invalid", name: "Bad", status: "upcoming" }),
  normalized,
  season.normalizeSquadSeason({ seasonId: "newer", name: "Newer", startDateKey: "2027-01-01", endDateKey: "2027-01-02", timeZone: "America/New_York", status: "upcoming" }),
]);
assert.deepEqual(sorted.map((item) => item.seasonId), ["newer", "fall-2026", "invalid"], "invalid records do not break ordering");

console.log("Squad season callable Timestamp reproduction, normalization, legacy compatibility, fallback, and MM/DD/YYYY tests passed.");
