import assert from "node:assert/strict";

import { resolveCoachAiAccess } from "../utils/coachAiAccess";
import { classifyCoachAiRequestError } from "../utils/coachAiErrors";

(globalThis as typeof globalThis & { __DEV__: boolean }).__DEV__ = false;
void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function run() {
  const { resolveFeatureFlags } = await import("../config/featureFlags");

  assert.equal(resolveFeatureFlags({ isDevelopment: true }).coachAiEnabled, false);
  assert.equal(resolveFeatureFlags({ isDevelopment: true, coachAiTestingValue: "false" }).coachAiEnabled, false);
  assert.equal(resolveFeatureFlags({ isDevelopment: true, coachAiTestingValue: "TRUE" }).coachAiEnabled, false);
  assert.equal(resolveFeatureFlags({ isDevelopment: true, coachAiTestingValue: " true " }).coachAiEnabled, false);
  assert.equal(resolveFeatureFlags({ isDevelopment: true, coachAiTestingValue: "true" }).coachAiEnabled, true);
  assert.equal(resolveFeatureFlags({ isDevelopment: false, coachAiTestingValue: "true" }).coachAiEnabled, false);
  assert.equal(classifyCoachAiRequestError({ code: "functions/failed-precondition", details: { reason: "provider_unavailable" } }).kind, "configuration");
  assert.equal(classifyCoachAiRequestError({ code: "functions/resource-exhausted", details: { reason: "rate_limited" } }).kind, "rate_limit");
  assert.equal(classifyCoachAiRequestError({ code: "functions/deadline-exceeded" }).kind, "timeout");
  assert.equal(classifyCoachAiRequestError({ code: "functions/unavailable", details: { reason: "provider_error" } }).kind, "provider");
  assert.equal(classifyCoachAiRequestError({ code: "functions/unavailable" }).kind, "offline");
  assert.equal(classifyCoachAiRequestError({ code: "functions/permission-denied" }).kind, "access");

  const allowed = resolveCoachAiAccess({
  buildAvailable: true,
  developmentTestingEntitled: true,
  paidEntitled: false,
  signedIn: true,
  adultEligible: true,
  activeMode: "coach",
  accountStanding: "active",
  });
  assert.equal(allowed.canView, true);
  assert.equal(allowed.entitlementSource, "development-testing");

  for (const denied of [
  { signedIn: false },
  { adultEligible: false },
  { activeMode: "parent" as const },
  { accountStanding: "messagingRestricted" as const },
  { accountStanding: "suspended" as const },
  { accountStanding: "banned" as const },
  { developmentTestingEntitled: false },
  { buildAvailable: false },
  ]) {
    assert.equal(resolveCoachAiAccess({
      buildAvailable: true,
      developmentTestingEntitled: true,
      paidEntitled: false,
      signedIn: true,
      adultEligible: true,
      activeMode: "coach",
      accountStanding: "active",
      ...denied,
    }).canRequest, false);
  }

  console.log("AI Coach development flag and access-context tests passed.");
}
