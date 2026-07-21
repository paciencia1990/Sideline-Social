const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const admin = require("firebase-admin");

function loadPublicProfileCore() {
  const source = fs.readFileSync(path.join(process.cwd(), "functions", "src", "publicUserProfileCore.ts"), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", output)(loaded, loaded.exports);
  return loaded.exports;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const projectId = argumentValue("--project");
const apply = process.argv.includes("--apply");
if (!projectId || !/^[a-z0-9:-]{3,100}$/u.test(projectId)) {
  console.error("Usage: node .\\scripts\\audit-public-user-profiles.cjs --project <project-id> [--apply]");
  process.exit(1);
}

admin.initializeApp({ projectId });
const firestore = admin.firestore();
const { isCanonicalPublicProfile, resolveCanonicalPublicProfile, toMinimalPublicUserProfile } = loadPublicProfileCore();
const counts = {
  scanned: 0,
  valid: 0,
  missing: 0,
  malformed: 0,
  sourceWithoutValidName: 0,
  created: 0,
  repaired: 0,
  removedMalformed: 0,
};

async function run() {
  let cursor;
  do {
    let query = firestore.collection("users")
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(300);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    const projections = await firestore.getAll(...page.docs.map((document) => (
      firestore.collection("publicUserProfiles").doc(document.id)
    )));
    const batch = firestore.batch();
    let writes = 0;

    page.docs.forEach((privateDocument, index) => {
      counts.scanned += 1;
      const projection = projections[index];
      const canonical = resolveCanonicalPublicProfile(privateDocument.id, privateDocument.data());
      const expected = canonical ? toMinimalPublicUserProfile(canonical) : null;
      const projectionValid = projection.exists && isCanonicalPublicProfile(projection.data(), privateDocument.id);
      if (!expected) {
        counts.sourceWithoutValidName += 1;
        if (projection.exists && !projectionValid) {
          counts.malformed += 1;
          if (apply) {
            batch.delete(projection.ref);
            counts.removedMalformed += 1;
            writes += 1;
          }
        }
        return;
      }
      if (!projection.exists) counts.missing += 1;
      else if (!projectionValid || ["firstName", "lastName", "displayName", "photoURL"]
        .some((field) => projection.data()?.[field] !== expected[field])) counts.malformed += 1;
      else {
        counts.valid += 1;
        return;
      }
      if (apply) {
        batch.set(projection.ref, { ...expected, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        if (projection.exists) counts.repaired += 1;
        else counts.created += 1;
        writes += 1;
      }
    });
    if (writes > 0) await batch.commit();
    cursor = page.docs.at(-1);
    if (page.size < 300) break;
  } while (cursor);

  console.info("Public user profile audit complete", { mode: apply ? "apply" : "dry-run", ...counts });
}

run().catch((error) => {
  console.error("Public user profile audit failed", {
    code: typeof error === "object" && error && "code" in error ? String(error.code) : "unknown",
  });
  process.exit(1);
});
