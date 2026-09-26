import assert from "node:assert/strict";

import { accountStandingGate } from "../context/accountStandingGate";
import type { AccountStanding } from "../types/accountStanding";

function standing(overrides: Partial<AccountStanding> = {}): AccountStanding {
  return {
    status: "active",
    effectiveAt: null,
    expiresAt: null,
    publicReasonCode: "communityGuidelines",
    revision: 1,
    warning: null,
    appeal: { available: false, status: "none" },
    ...overrides,
  };
}

const warning = {
  pending: true as const,
  id: "warning_001",
  publicReasonCode: "harassment",
  effectiveAt: "2026-09-25T12:00:00.000Z",
};

assert.equal(accountStandingGate(standing({ warning }), null), "warning");
assert.equal(accountStandingGate(standing({ warning: null }), null), null);
assert.equal(
  accountStandingGate(standing({ status: "suspended", warning }), null),
  "suspended",
  "a stronger access consequence must take precedence over a warning",
);
assert.equal(
  accountStandingGate(standing({ status: "banned", warning }), null),
  "banned",
);
assert.equal(
  accountStandingGate(standing({ status: "messagingRestricted", revision: 8 }), null),
  "messagingRestricted",
);
assert.equal(
  accountStandingGate(standing({ status: "messagingRestricted", revision: 8 }), 8),
  null,
);

console.log("Account-standing warning gate tests passed.");
