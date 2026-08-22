const assert = require("node:assert/strict");
const { claimsEqual, nextTesterClaims, parseTesterClaimArgs } = require("./coach-ai-tester-claims-core.cjs");

const existing = { admin: true, tier: "founder", nested: "unchanged" };
const granted = nextTesterClaims(existing, "grant");
assert.deepEqual(granted, { ...existing, aiCoachTester: true });
assert.deepEqual(existing, { admin: true, tier: "founder", nested: "unchanged" });
assert.deepEqual(nextTesterClaims(granted, "revoke"), existing);
assert.equal(claimsEqual(existing, { tier: "founder", nested: "unchanged", admin: true }), true);
assert.equal(claimsEqual(existing, { ...existing, aiCoachTester: false }), false);

assert.deepEqual(parseTesterClaimArgs(["status", "--project", "sideline-staging", "--uid", "user-1"]), {
  operation: "status", project: "sideline-staging", uid: "user-1", dryRun: false, ci: false, yes: false,
});
assert.equal(parseTesterClaimArgs(["grant", "--project", "sideline-staging", "--email", "coach@example.test", "--dry-run"]).dryRun, true);
assert.equal(parseTesterClaimArgs(["revoke", "--project", "sideline-staging", "--uid", "user-1", "--ci", "--yes"], { COACH_AI_CLAIMS_CI: "true" }).yes, true);
for (const args of [
  ["grant", "--uid", "user-1"],
  ["grant", "--project", "sideline-staging", "--uid", "a", "--email", "b@example.test"],
  ["grant", "--project", "sideline-staging", "--uid", "a", "--yes"],
  ["grant", "--project", "sideline-staging", "--uid", "a", "--ci"],
]) assert.throws(() => parseTesterClaimArgs(args));

console.log("Coach AI tester-claim argument safety and unrelated-claim preservation tests passed.");
