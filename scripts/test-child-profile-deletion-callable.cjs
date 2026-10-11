"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "functions/src/index.ts"), "utf8");
const handlerSource = source.slice(source.indexOf("export const deleteChildProfile"), source.indexOf("async function generateAvailableTeamInviteCode"));
const coreModule = { exports: {} };
new Function("module", "exports", ts.transpileModule(fs.readFileSync(path.join(root, "functions/src/teamMembershipCore.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(coreModule, coreModule.exports);
const { activeLinkReferencesChild, removeChildReference } = coreModule.exports;
class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function fixture({ exists = true, links = [] } = {}) {
  const reads = [];
  const writes = [];
  function ref(parts) {
    return { path: parts.join("/"), collection: (id) => ref([...parts, id]), doc: (id) => ref([...parts, id]) };
  }
  const transaction = {
    get: async (reference) => {
      reads.push(reference.path);
      if (reference.path.endsWith("/teamChildLinks")) {
        return { docs: links.map((data, index) => ({ ref: { path: `${reference.path}/team-${index}` }, data: () => data })) };
      }
      return { exists };
    },
    update: (reference, data) => writes.push(["update", reference.path, data]),
    delete: (reference) => writes.push(["delete", reference.path]),
  };
  const firestore = { collection: (id) => ref([id]), runTransaction: async (callback) => callback(transaction) };
  const loaded = { exports: {} };
  new Function("exports", "functions", "admin", "FieldValue", "activeLinkReferencesChild", "removeChildReference", ts.transpileModule(handlerSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(loaded.exports, { https: { onCall: (callback) => callback, HttpsError } }, { firestore: () => firestore }, { serverTimestamp: () => "SERVER_TIME" }, activeLinkReferencesChild, removeChildReference);
  return { invoke: loaded.exports.deleteChildProfile, reads, writes };
}

(async () => {
  const owned = fixture({ links: [{ status: "inactive", childIds: ["child-a", "child-b"] }, { status: "active", childIds: ["child-b"] }] });
  assert.deepEqual(await owned.invoke({ childId: "child-a", parentUid: "another-parent" }, { auth: { uid: "synthetic-parent" } }), { deleted: true });
  assert.deepEqual(owned.reads, ["users/synthetic-parent/children/child-a", "users/synthetic-parent/teamChildLinks"]);
  assert.deepEqual(owned.writes, [
    ["update", "users/synthetic-parent/teamChildLinks/team-0", { childIds: ["child-b"], updatedAt: "SERVER_TIME" }],
    ["delete", "users/synthetic-parent/children/child-a"],
  ]);
  const linked = fixture({ links: [{ status: "active", childIds: ["child-a"] }] });
  await assert.rejects(linked.invoke({ childId: "child-a" }, { auth: { uid: "synthetic-parent" } }), (error) => error.code === "failed-precondition");
  assert.deepEqual(linked.writes, []);
  const missing = fixture({ exists: false });
  await assert.rejects(missing.invoke({ childId: "child-a" }, { auth: { uid: "synthetic-parent" } }), (error) => error.code === "permission-denied");
  assert.deepEqual(missing.writes, []);
  const unauthenticated = fixture();
  await assert.rejects(unauthenticated.invoke({ childId: "child-a" }, {}), (error) => error.code === "unauthenticated");
  assert.deepEqual(unauthenticated.reads, []);
  for (const childId of ["", "../other", "child/name", "x".repeat(129)]) {
    const invalid = fixture();
    await assert.rejects(invalid.invoke({ childId }, { auth: { uid: "synthetic-parent" } }), (error) => error.code === "permission-denied");
    assert.deepEqual(invalid.reads, []);
    assert.deepEqual(invalid.writes, []);
  }
  console.log("Existing child-deletion callable: owner scope, active-team protection, inactive-link cleanup, invalid IDs, and unauthenticated rejection passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
