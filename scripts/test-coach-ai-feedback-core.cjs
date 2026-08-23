const assert = require("node:assert/strict");
const { validateCoachAiFeedback } = require("../functions/lib/coachAiFeedbackCore");

assert.deepEqual(validateCoachAiFeedback({ requestId: "request_12345", rating: "up" }), {
  requestId: "request_12345", rating: "up",
});
assert.deepEqual(validateCoachAiFeedback({
  requestId: "request_12345", rating: "down", reason: "unsafe", comment: "  Please   review.  ",
}), { requestId: "request_12345", rating: "down", reason: "unsafe", comment: "Please review." });
for (const value of [
  null,
  { requestId: "short", rating: "up" },
  { requestId: "request_12345", rating: "sideways" },
  { requestId: "request_12345", rating: "down" },
  { requestId: "request_12345", rating: "up", reason: "unsafe" },
  { requestId: "request_12345", rating: "down", reason: "invented" },
  { requestId: "request_12345", rating: "down", reason: "other", comment: "x".repeat(501) },
  { requestId: "request_12345", rating: "up", hidden: "content" },
]) assert.throws(() => validateCoachAiFeedback(value));

console.log("Coach AI feedback validation and data-minimization tests passed.");
