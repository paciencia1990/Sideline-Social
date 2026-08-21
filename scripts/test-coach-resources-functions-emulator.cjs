const assert = require("node:assert/strict");
const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } = require("firebase/auth");
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require("firebase/functions");

const projectId = process.env.GCLOUD_PROJECT || "sideline-coach-resources-functions-test";
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();

async function callableClient(label, authenticated = true) {
  const app = initializeApp({ apiKey: "demo-key", projectId }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const callableFunctions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(callableFunctions, "127.0.0.1", 5001);
  if (!authenticated) return { uid: null, user: null, call: httpsCallable(callableFunctions, "generateCoachResourceHelp") };
  const credential = await createUserWithEmailAndPassword(auth, `${label}@example.test`, "ValidPass123!");
  return { uid: credential.user.uid, user: credential.user, call: httpsCallable(callableFunctions, "generateCoachResourceHelp") };
}

async function authorizeTester(client, { adult = true, mode = "coach" } = {}) {
  await admin.auth().setCustomUserClaims(client.uid, { aiCoachTester: true });
  await db.collection("users").doc(client.uid).set({ adultEligibilityConfirmed: adult, activeMode: mode });
  await client.user.getIdToken(true);
}

function request(clientRequestId, situation = "There is immediate danger and the league safety process is needed.") {
  return { category: "other", situation, clientRequestId, locale: "en", tone: "warm" };
}

function hasReason(reason) {
  return (error) => error?.details?.reason === reason || String(error?.message).includes(reason);
}

async function expectStandingDenied(label, standing, reason) {
  const client = await callableClient(label);
  await authorizeTester(client);
  await db.collection("accountStanding").doc(client.uid).set(standing);
  await assert.rejects(() => client.call(request(`${label}_request`)), hasReason(reason));
}

async function run() {
  const anonymous = await callableClient("coach-help-anonymous", false);
  await assert.rejects(() => anonymous.call({}), hasReason("auth_required"));

  const unentitled = await callableClient("coach-help-unentitled");
  await db.collection("users").doc(unentitled.uid).set({ adultEligibilityConfirmed: true, activeMode: "coach" });
  await assert.rejects(() => unentitled.call(request("unentitled_request")), hasReason("tester_entitlement_required"));

  const underage = await callableClient("coach-help-not-adult");
  await authorizeTester(underage, { adult: false });
  await assert.rejects(() => underage.call(request("not_adult_request")), hasReason("adult_coach_mode_required"));

  const parentMode = await callableClient("coach-help-parent-mode");
  await authorizeTester(parentMode, { mode: "parent" });
  await assert.rejects(() => parentMode.call(request("parent_mode_request")), hasReason("adult_coach_mode_required"));

  await expectStandingDenied("coach-help-restricted", { status: "active", messagingRestricted: true, revision: 1 }, "messaging_restricted");
  await expectStandingDenied("coach-help-suspended", { status: "suspended", revision: 1 }, "account_suspended");
  await expectStandingDenied("coach-help-banned", { status: "banned", revision: 1 }, "account_banned");

  const coach = await callableClient("coach-help-authorized");
  await authorizeTester(coach);
  const first = (await coach.call(request("authorized_request"))).data;
  assert.equal(first.canSendAsAnnouncement, false);
  assert.equal((await coach.call(request("authorized_request"))).data.title, first.title, "same request ID and payload must return the stored result");
  assert.equal((await db.collection("coachAiRateLimits").doc(coach.uid).get()).data().count, 1, "idempotent replay must not consume a second request");
  await assert.rejects(() => coach.call(request("authorized_request", "There is a different emergency situation to review.")), hasReason("request_id_conflict"));

  const missingProvider = await callableClient("coach-help-provider-missing");
  await authorizeTester(missingProvider);
  await assert.rejects(
    () => missingProvider.call(request("provider_missing_request", "Help me structure a calm and inclusive practice plan.")),
    hasReason("provider_unavailable"),
  );
  const failedRecord = (await db.collection("coachAiRequests").doc(`${missingProvider.uid}_provider_missing_request`).get()).data();
  assert.equal(failedRecord.status, "failed");
  assert.equal(failedRecord.lastFailureReason, "provider_unavailable");
  assert.equal(JSON.stringify(failedRecord).includes("Help me structure"), false, "request records must not store prompt text");

  const concurrent = await callableClient("coach-help-concurrent");
  await authorizeTester(concurrent);
  const simultaneous = await Promise.allSettled([
    concurrent.call(request("concurrent_request")),
    concurrent.call(request("concurrent_request")),
  ]);
  assert.equal(simultaneous.some((result) => result.status === "fulfilled"), true);
  assert.equal((await db.collection("coachAiRateLimits").doc(concurrent.uid).get()).data().count, 1, "simultaneous duplicate requests must consume only one request");

  const limited = await callableClient("coach-help-rate-limit");
  await authorizeTester(limited);
  for (let index = 0; index < 10; index += 1) {
    await limited.call(request(`rate_request_${index}`));
  }
  await assert.rejects(() => limited.call(request("rate_request_10")), hasReason("rate_limited"));
  assert.equal((await db.collection("coachAiRateLimits").doc(limited.uid).get()).data().count, 10);

  console.log("AI Coach tester authorization, account standing, idempotency, provider failure, and 10-per-day limit emulator tests passed.");
}

run().catch((error) => { console.error(error); process.exit(1); });
