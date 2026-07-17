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
  let missingCreatorCount = 0;
  let inactiveOrMissingCreatorMembershipCount = 0;
  let orphanedSquadCount = 0;
  let explicitAdminSquadCount = 0;

  for (const squadDocument of squads.docs) {
    const squad = squadDocument.data();
    const creatorId = typeof squad.createdBy === "string" && squad.createdBy
      ? squad.createdBy
      : typeof squad.creatorId === "string" && squad.creatorId ? squad.creatorId : null;
    if (!creatorId) missingCreatorCount += 1;
    const activeMemberships = await db.collection("squadMemberships")
      .where("squadId", "==", squadDocument.id)
      .where("membershipStatus", "==", "active")
      .get();
    const explicitAdmins = activeMemberships.docs.filter((document) => document.data().squadRole === "admin");
    if (explicitAdmins.length > 0) explicitAdminSquadCount += 1;
    const activeCreator = creatorId
      ? activeMemberships.docs.find((document) => document.data().userId === creatorId) ?? null
      : null;
    if (creatorId && !activeCreator) inactiveOrMissingCreatorMembershipCount += 1;
    const creatorNeedsSelfHeal = Boolean(
      activeCreator &&
      activeCreator.data().squadRole !== "admin" &&
      activeCreator.data().squadRole !== "member",
    );
    if (creatorNeedsSelfHeal) updates.push({ membershipRef: activeCreator.ref });
    if (explicitAdmins.length === 0 && !creatorNeedsSelfHeal) orphanedSquadCount += 1;
  }

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    scannedSquads: squads.size,
    squadsWithExplicitAdmin: explicitAdminSquadCount,
    creatorAdminUpdates: updates.length,
    squadsWithoutRecordedCreator: missingCreatorCount,
    squadsWithoutActiveCreatorMembership: inactiveOrMissingCreatorMembershipCount,
    orphanedSquadsRequiringManualReview: orphanedSquadCount,
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
