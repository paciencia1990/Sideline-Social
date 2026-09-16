"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText, filename);
};

const { createAsyncStoragePersistence } = require(path.join(__dirname, "..", "utils", "firebaseAuthPersistence.ts"));

async function run() {
  const values = new Map();
  const storage = {
    async getItem(key) { return values.get(key) ?? null; },
    async removeItem(key) { values.delete(key); },
    async setItem(key, value) { values.set(key, value); },
  };
  const Persistence = createAsyncStoragePersistence(storage);
  const persistence = new Persistence();
  assert.equal(persistence.type, "LOCAL");
  assert.equal(await persistence._isAvailable(), true);
  await persistence._set("firebase-user", { uid: "user-a", tokenManager: { refreshToken: "synthetic" } });
  assert.deepEqual(await persistence._get("firebase-user"), { uid: "user-a", tokenManager: { refreshToken: "synthetic" } });
  await persistence._remove("firebase-user");
  assert.equal(await persistence._get("firebase-user"), null);
  values.set("invalid", "{");
  await assert.rejects(() => persistence._get("invalid"), SyntaxError);

  const UnavailablePersistence = createAsyncStoragePersistence({
    async getItem() { throw new Error("unavailable"); },
    async removeItem() { throw new Error("unavailable"); },
    async setItem() { throw new Error("unavailable"); },
  });
  const unavailable = new UnavailablePersistence();
  assert.equal(await unavailable._isAvailable(), false);
  console.log("Firebase Auth LOCAL AsyncStorage persistence round-trip, removal, corruption, and availability checks passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
