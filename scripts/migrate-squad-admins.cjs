#!/usr/bin/env node
/*
 * Dry-run by default. This script never creates a Squad, season, membership,
 * or arbitrary administrator.
 *
 * node scripts/migrate-squad-admins.cjs --project sideline-squad
 * node scripts/migrate-squad-admins.cjs --project sideline-squad --apply
 */
const path = require("node:path");
const admin = require(path.join(process.cwd(), "functions", "node_modules", "firebase-admin"));

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const projectIndex = process.argv.indexOf("--project");
const projectId = projectIndex >= 0 ? process.argv[projectIndex + 1] : process.env.GCLOUD_PROJECT;
if (!projectId) {
  console.error("Pass --project <firebase-project-id>.");
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

async function run() {
  const squads = await db.collection("squads").get();
  const updates = [];
  const missingCreator = [];
  const inactiveOrMissingMembership = [];

  for (const squadDocument of squads.docs) {
    const squad = squadDocument.data();
    const creatorId = typeof squad.createdBy === "string" && squad.createdBy
      ? squad.createdBy
      : typeof squad.creatorId === "string" && squad.creatorId ? squad.creatorId : null;
    if (!creatorId) {
      missingCreator.push(squadDocument.id);
      continue;
    }

    const canonical = await db.collection("squadMemberships").doc(`${squadDocument.id}__${creatorId}`).get();
    let membership = canonical.exists && canonical.data().membershipStatus === "active" ? canonical : null;
    if (!membership) {
      const legacy = await db.collection("squadMemberships")
        .where("squadId", "==", squadDocument.id)
        .where("userId", "==", creatorId)
        .get();
      membership = legacy.docs.find((document) => {
        const data = document.data();
        return data.membershipStatus === "active" || (data.membershipStatus == null && data.isActive === true);
      }) ?? null;
    }
    if (!membership) {
      inactiveOrMissingMembership.push(squadDocument.id);
      continue;
    }
    if (membership.data().squadRole !== "admin") {
      updates.push({ squadId: squadDocument.id, membershipRef: membership.ref });
    }
  }

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    scannedSquads: squads.size,
    creatorAdminUpdates: updates.length,
    squadsWithoutRecordedCreator: missingCreator,
    squadsWithoutActiveCreatorMembership: inactiveOrMissingMembership,
  }, null, 2));
  if (!apply) return;

  let batch = db.batch();
  let writes = 0;
  for (const update of updates) {
    batch.set(update.membershipRef, {
      squadRole: "admin",
      squadRoleUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      squadRoleUpdatedBy: "migration:recorded-creator",
    }, { merge: true });
    writes += 1;
    if (writes === 400) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes > 0) await batch.commit();
  console.log(JSON.stringify({ appliedCreatorAdminUpdates: updates.length }, null, 2));
}

run().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "Squad Admin migration failed.");
  process.exit(1);
});
