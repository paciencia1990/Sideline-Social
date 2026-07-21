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

async function run() {
  const anonymous = await callableClient("coach-help-anonymous", false);
  await assert.rejects(() => anonymous.call({}), hasReason("auth_required"));

  const coach = await callableClient("coach-help-coach", true);
  await assert.rejects(() => coach.call({ situation: "This payload must not be processed or logged." }), hasReason("feature_disabled"));

  assert.equal((await db.collection("coachAiRequests").limit(1).get()).empty, true, "disabled callable must not store AI requests");
  assert.equal((await db.collection("coachAiRateLimits").limit(1).get()).empty, true, "disabled callable must not store AI rate limits");

  console.log("Coach Resources callable authentication, predictable disabled response, and no-write isolation emulator tests passed.");
}

run().catch((error) => { console.error(error); process.exit(1); });
