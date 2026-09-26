const assert = require("node:assert/strict");

const {
  APPEALABLE_ACCOUNT_ACTIONS,
  completedAppealableAction,
  isAppealableAccountAction,
} = require("../functions/lib/accountStandingAppeal.js");

assert.deepEqual(
  APPEALABLE_ACCOUNT_ACTIONS,
  ["restrictMessaging", "temporarySuspend", "permanentBan"],
);

for (const type of APPEALABLE_ACCOUNT_ACTIONS) {
  assert.equal(isAppealableAccountAction(type), true);
  assert.equal(completedAppealableAction({ type, outcome: "completed" }), true);
  assert.equal(completedAppealableAction({ type, outcome: "pending" }), false);
  assert.equal(completedAppealableAction({ type, outcome: "failed" }), false);
}

for (const type of ["warnUser", "hideContent", "removeContent", "unknown", null]) {
  assert.equal(isAppealableAccountAction(type), false);
  assert.equal(completedAppealableAction({ type, outcome: "completed" }), false);
}

assert.equal(completedAppealableAction(null), false);
assert.equal(completedAppealableAction("restrictMessaging"), false);

console.log("Account-standing appeal action policy tests passed.");
