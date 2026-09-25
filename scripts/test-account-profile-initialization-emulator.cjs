"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const projectId = "demo-account-profile-initialization";
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^(?:127\.0\.0\.1|localhost):\d+$/u);

require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    fileName: filename,
  }).outputText, filename);
};

const admin = require("../functions/node_modules/firebase-admin");
const {
  buildFederatedAccountProfile,
  initializeAccountProfileIfMissing,
} = require(path.join(process.cwd(), "utils", "accountProfileCore.ts"));

admin.initializeApp({ projectId });
const db = admin.firestore();

function fields(uid, marker) {
  return buildFederatedAccountProfile({
    email: `${marker}@example.test`,
    firstName: marker,
    lastName: "Tester",
    phoneNumber: null,
    preferredLanguage: "en",
    userId: uid,
  }, { createdAt: marker, updatedAt: marker });
}

async function ensure(uid, marker, interrupt = false) {
  const ref = db.collection("users").doc(uid);
  return db.runTransaction(async (transaction) => initializeAccountProfileIfMissing({
    createFields: () => fields(uid, marker),
    readExists: async () => (await transaction.get(ref)).exists,
    write: (profile) => {
      transaction.set(ref, profile);
      if (interrupt) throw new Error("synthetic_interruption");
    },
  }));
}

(async () => {
  assert.deepEqual(await ensure("first-sign-in", "first"), { created: true });
  const first = (await db.collection("users").doc("first-sign-in").get()).data();
  assert.equal(first.accountOnboardingCompleted, false);
  assert.equal(first.modeOnboardingCompleted, false);

  assert.deepEqual(await ensure("first-sign-in", "returning"), { created: false });
  const returning = (await db.collection("users").doc("first-sign-in").get()).data();
  assert.equal(returning.firstName, "first", "returning initialization must preserve the original profile");

  await assert.rejects(() => ensure("interrupted", "interrupted", true), /synthetic_interruption/u);
  assert.equal((await db.collection("users").doc("interrupted").get()).exists, false,
    "an interrupted transaction must not leave a partial profile");
  assert.deepEqual(await ensure("interrupted", "recovered"), { created: true });

  const concurrent = await Promise.all([
    ensure("concurrent", "one"),
    ensure("concurrent", "two"),
  ]);
  assert.equal(concurrent.filter((result) => result.created).length, 1,
    "concurrent repeated initialization must create exactly once");
  assert.equal((await db.collection("users").doc("concurrent").get()).exists, true);

  console.log("PASS: emulator first sign-in, missing-profile recovery, returning-account no-op, interrupted transaction, and concurrent idempotency.");
})().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
