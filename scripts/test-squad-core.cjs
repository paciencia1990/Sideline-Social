const assert = require("node:assert/strict");
const path = require("node:path");

const core = require(path.join(process.cwd(), "functions", "lib", "squadCore.js"));

const venueA = core.canonicalVenueId("Dr. Phillips Little League", 28.48123, -81.50321);
const spellingVariant = core.canonicalVenueId("Dr Phillips LL", 28.48123, -81.50321);
assert.equal(venueA, spellingVariant, "canonical spelling variants must resolve to one venue");
assert.equal(
  core.venueSportKeyFor(venueA, "baseball"),
  core.venueSportKeyFor(spellingVariant, "baseball"),
  "same venue and sport must have one identity",
);
assert.notEqual(
  core.venueSportKeyFor(venueA, "baseball"),
  core.venueSportKeyFor(venueA, "softball"),
  "the same venue must support separate sports",
);
const venueB = core.canonicalVenueId("YMCA", 28.58123, -81.50321);
assert.notEqual(core.venueSportKeyFor(venueA, "baseball"), core.venueSportKeyFor(venueB, "baseball"));
const key = core.venueSportKeyFor(venueA, "baseball");
assert.equal(core.deterministicSquadId(key), key, "deterministic ID must prevent concurrent duplicates");
assert.equal(core.normalizeSportId("Baseball"), "baseball");
assert.equal(core.normalizeSportId("made-up-sport"), null);
assert.throws(() => core.canonicalVenueId("Venue", 91, 0), /INVALID_LATITUDE/);
assert.throws(() => core.canonicalVenueId("Venue", 0, -181), /INVALID_LONGITUDE/);
const firstJoin = core.resolveJoinProjection([], "parent-a", false);
assert.deepEqual(firstJoin, { alreadyMember: false, memberIds: ["parent-a"] });
const duplicateJoin = core.resolveJoinProjection(["parent-a"], "parent-a", true);
assert.deepEqual(duplicateJoin, { alreadyMember: true, memberIds: ["parent-a"] }, "duplicate join must be idempotent");
const repairedProjection = core.resolveJoinProjection([], "parent-a", true);
assert.deepEqual(repairedProjection, { alreadyMember: true, memberIds: ["parent-a"] }, "legacy membership must repair the Squad projection");
assert.deepEqual(
  core.resolveSelectionAfterLeave(["baseball", "softball"], "baseball", "baseball"),
  { squadIds: ["softball"], selectedSquadId: "softball" },
  "leaving the selected Squad must fall back safely",
);
assert.deepEqual(core.resolveSelectionAfterLeave([], null, "missing"), { squadIds: [], selectedSquadId: null });
assert.deepEqual(core.resolveSelectionAfterLeave(["baseball"], null, "missing"), { squadIds: ["baseball"], selectedSquadId: "baseball" });
assert.deepEqual(
  core.resolveSelectionAfterLeave(["baseball", "softball"], "softball", "missing"),
  { squadIds: ["baseball", "softball"], selectedSquadId: "softball" },
  "multiple memberships must retain an explicit selection",
);
console.log("Squad canonical identity tests passed.");
