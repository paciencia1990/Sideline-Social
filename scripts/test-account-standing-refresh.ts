import assert from "node:assert/strict";

import {
  createAccountRefreshCoordinator,
  needsAppealEligibilityRefresh,
  startBoundedAppealEligibilityRefresh,
} from "../context/accountStandingRefreshCore";
import type { AccountStanding } from "../types/accountStanding";

function standing(available: boolean, status: AccountStanding["appeal"]["status"] = "none"): AccountStanding {
  return {
    appeal: { available, status },
    effectiveAt: "2026-09-19T20:17:00.000Z",
    expiresAt: "2026-09-19T21:11:00.000Z",
    publicReasonCode: "harassment",
    revision: 7,
    status: "messagingRestricted",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function fakeScheduler() {
  const callbacks: Array<() => void> = [];
  const delays: number[] = [];
  return {
    callbacks,
    delays,
    schedule(callback: () => void, delay: number) {
      callbacks.push(callback);
      delays.push(delay);
      return callbacks.length as unknown as ReturnType<typeof setTimeout>;
    },
    cancelScheduled() {},
    async runNext() {
      const callback = callbacks.shift();
      assert.ok(callback, "expected a scheduled refresh");
      callback();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

async function testBoundedDelayedEligibility() {
  const scheduler = fakeScheduler();
  let calls = 0;
  const results = [standing(false), standing(true)];
  const cancel = startBoundedAppealEligibilityRefresh({
    currentIdentity: () => "account:messagingRestricted:7",
    delays: [10, 20, 30],
    identity: "account:messagingRestricted:7",
    refresh: async () => results[calls++] ?? standing(true),
    schedule: scheduler.schedule,
    cancelScheduled: scheduler.cancelScheduled,
  });

  assert.deepEqual(scheduler.delays, [10]);
  await scheduler.runNext();
  assert.deepEqual(scheduler.delays, [10, 20]);
  await scheduler.runNext();
  assert.equal(calls, 2);
  assert.equal(scheduler.callbacks.length, 0, "eligibility stops polling immediately");
  cancel();
}

async function testBoundedUnavailableAndFailure() {
  const scheduler = fakeScheduler();
  let calls = 0;
  startBoundedAppealEligibilityRefresh({
    currentIdentity: () => "account:messagingRestricted:7",
    delays: [10, 20, 30],
    identity: "account:messagingRestricted:7",
    refresh: async () => {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error("synthetic"), { code: "functions/unavailable" });
      return standing(false);
    },
    schedule: scheduler.schedule,
    cancelScheduled: scheduler.cancelScheduled,
  });

  await scheduler.runNext();
  await scheduler.runNext();
  await scheduler.runNext();
  assert.equal(calls, 3);
  assert.equal(scheduler.callbacks.length, 0, "refresh attempts remain finite after failure");
}

async function testIdentityChangeCancelsSequence() {
  const scheduler = fakeScheduler();
  let identity = "first:messagingRestricted:7";
  let calls = 0;
  startBoundedAppealEligibilityRefresh({
    currentIdentity: () => identity,
    delays: [10, 20, 30],
    identity,
    refresh: async () => {
      calls += 1;
      return standing(false);
    },
    schedule: scheduler.schedule,
    cancelScheduled: scheduler.cancelScheduled,
  });
  identity = "second:messagingRestricted:7";
  await scheduler.runNext();
  assert.equal(calls, 0, "account changes prevent a scheduled request");
  assert.equal(scheduler.callbacks.length, 0);
}

async function testCoordinatorNoOverlapAndStaleResponse() {
  let identity: string | null = "first:1";
  let fetches = 0;
  const first = deferred<AccountStanding>();
  const applied: string[] = [];
  const failures: string[] = [];
  const settled: string[] = [];
  const coordinator = createAccountRefreshCoordinator<AccountStanding>({
    currentIdentity: () => identity,
    fetch: async () => {
      fetches += 1;
      return first.promise;
    },
    onApply: (_value, requestIdentity) => applied.push(requestIdentity),
    onFailure: (_error, requestIdentity) => failures.push(requestIdentity),
    onSettled: (requestIdentity) => settled.push(requestIdentity),
    onStart() {},
  });

  const requestA = coordinator.run("first:1");
  const requestB = coordinator.run("first:1");
  assert.strictEqual(requestA, requestB, "overlapping refreshes share one request");
  assert.equal(fetches, 1);
  identity = "second:2";
  first.resolve(standing(true));
  assert.equal(await requestA, null);
  assert.deepEqual(applied, [], "a response for the prior account is discarded");
  assert.deepEqual(failures, []);
  assert.deepEqual(settled, [], "stale completion cannot update pending UI state");
}

async function testCoordinatorCurrentFailure() {
  let identity: string | null = "current:3";
  const request = deferred<AccountStanding>();
  const failures: string[] = [];
  const settled: string[] = [];
  const coordinator = createAccountRefreshCoordinator<AccountStanding>({
    currentIdentity: () => identity,
    fetch: async () => request.promise,
    onApply() {},
    onFailure: (_error, requestIdentity) => failures.push(requestIdentity),
    onSettled: (requestIdentity) => settled.push(requestIdentity),
    onStart() {},
  });
  const result = coordinator.run(identity);
  request.reject(Object.assign(new Error("synthetic"), { code: "functions/unavailable" }));
  assert.equal(await result, null);
  assert.deepEqual(failures, ["current:3"]);
  assert.deepEqual(settled, ["current:3"]);
  identity = null;
}

async function main() {
  assert.equal(needsAppealEligibilityRefresh(standing(false)), true);
  assert.equal(needsAppealEligibilityRefresh(standing(true)), false);
  assert.equal(needsAppealEligibilityRefresh(standing(false, "submitted")), false);
  assert.equal(needsAppealEligibilityRefresh({ ...standing(false), status: "active" }), false);
  await testBoundedDelayedEligibility();
  await testBoundedUnavailableAndFailure();
  await testIdentityChangeCancelsSequence();
  await testCoordinatorNoOverlapAndStaleResponse();
  await testCoordinatorCurrentFailure();
  console.log("account-standing refresh tests passed");
}

void main();
