const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const core = require(path.join(process.cwd(), "functions", "lib", "squadSeasonCore.js"));

assert.equal(core.normalizeSeasonName("  Spring   2027  "), "Spring 2027");
assert.throws(() => core.normalizeSeasonName(" "), /INVALID_SEASON_NAME/);
assert.equal(core.normalizeIanaTimeZone("America/New_York"), "America/New_York");
assert.throws(() => core.normalizeIanaTimeZone("Parent/Phone"), /INVALID_TIME_ZONE/);

const spring = core.resolveSeasonBoundaries({
  startDate: "2027-03-01",
  endDate: "2027-05-31",
  timeZone: "America/New_York",
  startNow: false,
  nowMs: Date.parse("2027-02-01T12:00:00Z"),
});
assert.equal(new Date(spring.startAtMs).toISOString(), "2027-03-01T05:00:00.000Z");
assert.equal(new Date(spring.endAtMs).toISOString(), "2027-06-01T04:00:00.000Z");
assert.throws(() => core.resolveSeasonBoundaries({
  startDate: "2027-03-01",
  endDate: "2027-05-31",
  timeZone: "America/New_York",
  startNow: false,
  nowMs: Date.parse("2027-03-02T00:00:00Z"),
}), /START_IN_PAST/);
const trustedNow = Date.parse("2027-03-02T12:34:56Z");
assert.equal(core.resolveSeasonBoundaries({
  startDate: "2027-03-01",
  endDate: "2027-05-31",
  timeZone: "America/New_York",
  startNow: true,
  nowMs: trustedNow,
}).startAtMs, trustedNow, "Start Now must use trusted server time");
assert.throws(() => core.resolveSeasonBoundaries({
  startDate: "2027-03-03",
  endDate: "2027-03-01",
  timeZone: "America/New_York",
  startNow: false,
  nowMs: Date.parse("2027-02-01T00:00:00Z"),
}), /END_NOT_AFTER_START/);

assert.equal(core.seasonRangesOverlap({ startAtMs: 0, endAtMs: 10 }, { startAtMs: 9, endAtMs: 20 }), true);
assert.equal(core.seasonRangesOverlap({ startAtMs: 0, endAtMs: 10 }, { startAtMs: 10, endAtMs: 20 }), false);
assert.equal(core.seasonContainsTimestamp({ startAtMs: 10, endAtMs: 20 }, 10), true, "startAt is inclusive");
assert.equal(core.seasonContainsTimestamp({ startAtMs: 10, endAtMs: 20 }, 20), false, "endAt is exclusive");
assert.equal(core.seasonContainsTimestamp({ startAtMs: 10, endAtMs: 20 }, 9), false);

const transition = core.planSeasonStateSynchronization([
  { seasonId: "spring", status: "active", startAtMs: 0, endAtMs: 100 },
  { seasonId: "summer", status: "upcoming", startAtMs: 100, endAtMs: 200 },
], 100, "spring");
assert.deepEqual(transition, {
  changes: [
    { seasonId: "spring", status: "closed", closedAtMs: 100, closeReason: "scheduledEnd" },
    { seasonId: "summer", status: "active", activatedAtMs: 100 },
  ],
  currentSeasonId: "summer",
});
const idempotent = core.planSeasonStateSynchronization([
  { seasonId: "spring", status: "closed", startAtMs: 0, endAtMs: 100 },
  { seasonId: "summer", status: "active", startAtMs: 100, endAtMs: 200 },
], 100, "summer");
assert.deepEqual(idempotent, { changes: [], currentSeasonId: "summer" });
assert.throws(() => core.planSeasonStateSynchronization([
  { seasonId: "one", status: "active", startAtMs: 0, endAtMs: 100 },
  { seasonId: "two", status: "active", startAtMs: 0, endAtMs: 100 },
], 50, "one"), /MULTIPLE_ACTIVE_SEASONS/);

assert.equal(core.isAuthorizedSeasonManager({
  userId: "creator", isPlatformAdmin: false, membershipStatus: "active", squadRole: "member", squadCreatorId: "creator",
}), true, "legacy creator fallback is an admin");
assert.equal(core.isAuthorizedSeasonManager({
  userId: "admin", isPlatformAdmin: false, membershipStatus: "active", squadRole: "admin", squadCreatorId: "creator",
}), true);
assert.equal(core.isAuthorizedSeasonManager({
  userId: "coach", isPlatformAdmin: false, membershipStatus: "active", squadRole: "member", squadCreatorId: "creator",
}), false, "coach identity alone cannot grant Squad season access");
assert.equal(core.isAuthorizedSeasonManager({
  userId: "admin", isPlatformAdmin: false, membershipStatus: "left", squadRole: "admin", squadCreatorId: "creator",
}), false, "Squad admins must retain active durable membership");
assert.equal(core.isAuthorizedSeasonManager({
  userId: "platform", isPlatformAdmin: true, membershipStatus: null, squadRole: null, squadCreatorId: null,
}), true);

const ranked = core.rankSeasonLeaderboardEntries([
  { userId: "d", displayName: "Delta D.", seasonStars: 10 },
  { userId: "b", displayName: "Beta B.", seasonStars: 20 },
  { userId: "c", displayName: "Charlie C.", seasonStars: 20 },
  { userId: "a", displayName: "Alpha A.", seasonStars: 30 },
]);
assert.deepEqual(ranked.map((entry) => entry.rank), [1, 2, 2, 4]);
assert.deepEqual(ranked.map((entry) => entry.userId), ["a", "b", "c", "d"]);

const functionsSource = fs.readFileSync(path.join(process.cwd(), "functions", "src", "index.ts"), "utf8");
const seasonSource = fs.readFileSync(path.join(process.cwd(), "functions", "src", "squadSeason.ts"), "utf8");
const leaderboardSource = fs.readFileSync(path.join(process.cwd(), "app", "leaderboard.tsx"), "utf8");
assert.match(functionsSource, /seasonEligibleSquadIds\s*=\s*await readSeasonEligibleSquadIds/g);
assert.match(seasonSource, /users\/\{uid\}\/rewardTransactions\/\{rewardId\}/);
assert.match(seasonSource, /contributions'\)\.doc\(reward\.rewardId\)/, "contribution IDs must be deterministic");
assert.match(seasonSource, /FieldValue\.increment\(reward\.amount\)/);
assert.doesNotMatch(seasonSource, /data\?\.amount|data\.amount[^;\n]*transaction\.(create|update)/, "callable input cannot set a reward amount");
assert.match(leaderboardSource, /seasonStars/);
assert.match(leaderboardSource, /currentUserLifetimeStars/);
assert.match(leaderboardSource, /Past Seasons|pastSeasons/);

console.log("Squad season lifecycle, authorization, boundary, and ranking tests passed.");
