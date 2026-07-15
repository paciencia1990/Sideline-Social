const assert = require("node:assert/strict");
const {
  DEFAULT_TIME_ZONE,
  WEEKLY_CHALLENGES,
  getCurrentWeekKey,
  getPreviousWeekKey,
  resolveTimeZone,
  selectWeeklyChallenge,
} = require("../functions/lib/weeklyChallengeCore");

function run() {
  assert.equal(
    getCurrentWeekKey("America/New_York", new Date("2026-07-06T03:59:59Z")),
    "2026-06-29",
    "Sunday night remains in the previous week",
  );
  assert.equal(
    getCurrentWeekKey("America/New_York", new Date("2026-07-06T04:00:00Z")),
    "2026-07-06",
    "Monday midnight starts a new week",
  );

  const weekKey = "2026-07-06";
  const first = selectWeeklyChallenge("parent-a", weekKey);
  assert.equal(selectWeeklyChallenge("parent-a", weekKey).id, first.id, "assignment is stable within a week");

  const assignedIds = new Set(
    Array.from({ length: 50 }, (_, index) => selectWeeklyChallenge("parent-" + index, weekKey).id),
  );
  assert.ok(assignedIds.size > 1, "different parents can receive different challenges");

  const nextWeek = "2026-07-13";
  assert.notEqual(weekKey, nextWeek, "Monday rollover creates a new weekly key");
  const naturalNext = selectWeeklyChallenge("parent-a", nextWeek);
  const deDuplicatedNext = selectWeeklyChallenge("parent-a", nextWeek, naturalNext.id);
  assert.notEqual(deDuplicatedNext.id, naturalNext.id, "consecutive duplicates advance to another active challenge");

  const catalogWithInactive = [
    { ...WEEKLY_CHALLENGES[0], isActive: false },
    { ...WEEKLY_CHALLENGES[1], isActive: true },
  ];
  assert.equal(
    selectWeeklyChallenge("parent-a", weekKey, null, catalogWithInactive).id,
    WEEKLY_CHALLENGES[1].id,
    "inactive challenges are excluded",
  );

  assert.equal(getPreviousWeekKey("2026-01-05"), "2025-12-29", "previous week handles year boundaries");
  assert.equal(resolveTimeZone("Not/A_Timezone", undefined), DEFAULT_TIME_ZONE, "invalid timezone falls back");
  assert.equal(resolveTimeZone("America/Chicago"), "America/Chicago", "valid stored timezone is retained");
  assert.ok(WEEKLY_CHALLENGES.every((challenge) => challenge.points === 5), "all challenge difficulty levels award exactly five Stars");

  console.log("Weekly Challenge core tests passed.");
}

run();
