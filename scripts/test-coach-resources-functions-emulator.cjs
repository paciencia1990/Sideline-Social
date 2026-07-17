const assert = require("node:assert/strict");
const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } = require("firebase/auth");
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require("firebase/functions");

const projectId = process.env.GCLOUD_PROJECT || "sideline-coach-resources-functions-test";
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();

function callableClient(label, authenticated) {
  const app = initializeApp({ apiKey: "demo-key", projectId }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const callableFunctions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(callableFunctions, "127.0.0.1", 5001);
  return Promise.resolve(authenticated
    ? createUserWithEmailAndPassword(auth, `${label}@example.test`, "ValidPass123!").then((credential) => ({ uid: credential.user.uid, call: httpsCallable(callableFunctions, "generateCoachResourceHelp") }))
    : { uid: null, call: httpsCallable(callableFunctions, "generateCoachResourceHelp") });
}

function hasReason(reason) {
  return (error) => error?.details?.reason === reason || String(error?.message).includes(reason);
}

function safetyRequest(clientRequestId, situation = "There is immediate danger and the league emergency process is needed.") {
  return {
    category: "player_behavior",
    situation,
    desiredOutcome: "Follow the appropriate safety procedure.",
    tone: "neutral",
    clientRequestId,
    locale: "en",
  };
}

async function run() {
  const anonymous = await callableClient("coach-help-anonymous", false);
  await assert.rejects(() => anonymous.call(safetyRequest("anonymous_01")), hasReason("auth_required"));

  const coach = await callableClient("coach-help-coach", true);
  await assert.rejects(() => coach.call({ ...safetyRequest("invalid_01"), situation: "x".repeat(1501) }), hasReason("value_too_long"));

  const first = (await coach.call(safetyRequest("safety_01"))).data;
  assert.equal(first.canSendAsAnnouncement, false);
  assert.equal(first.resultType, "step_by_step");
  assert.match(first.safetyNotice, /emergency services/i);

  const retry = (await coach.call(safetyRequest("safety_01"))).data;
  assert.deepEqual(retry, first, "same request ID and payload returns the stored result");
  await assert.rejects(
    () => coach.call(safetyRequest("safety_01", "There is an immediate threat and the approved process is needed.")),
    hasReason("request_id_conflict"),
  );

  const stored = (await db.collection("coachAiRequests").doc(`${coach.uid}_safety_01`).get()).data();
  assert.equal(stored.userId, coach.uid);
  assert.equal(stored.category, "player_behavior");
  assert.equal("situation" in stored, false, "raw situation text is not stored");
  assert.equal("desiredOutcome" in stored, false, "raw desired outcome is not stored");

  for (let index = 2; index <= 10; index += 1) {
    const result = (await coach.call(safetyRequest(`safety_${String(index).padStart(2, "0")}`))).data;
    assert.equal(result.canSendAsAnnouncement, false);
  }
  await assert.rejects(() => coach.call(safetyRequest("safety_11")), hasReason("rate_limited"));

  console.log("Coach Resources callable authentication, validation, safety, privacy, idempotency, and rate-limit emulator tests passed.");
}

run().catch((error) => { console.error(error); process.exit(1); });
