#!/usr/bin/env node
/*
 * Explicit, forward-only repair helper. --after is mandatory so this cannot
 * silently backfill rewards from before seasonal leaderboard support.
 *
 * node scripts/repair-squad-season-projections.cjs --project sideline-squad --after 2026-08-01T00:00:00Z
 * node scripts/repair-squad-season-projections.cjs --project sideline-squad --after 2026-08-01T00:00:00Z --apply
 */
const path = require("node:path");
const admin = require(path.join(process.cwd(), "functions", "node_modules", "firebase-admin"));

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
};
const projectId = valueAfter("--project") ?? process.env.GCLOUD_PROJECT;
const afterValue = valueAfter("--after");
const after = afterValue ? new Date(afterValue) : null;
if (!projectId || !after || Number.isNaN(after.getTime())) {
  console.error("Pass --project <firebase-project-id> and --after <ISO timestamp>.");
  process.exit(1);
}

admin.initializeApp({ projectId });
const { projectRewardRecord } = require(path.join(process.cwd(), "functions", "lib", "squadSeason.js"));
const db = admin.firestore();

async function run() {
  const rewards = await db.collectionGroup("rewardTransactions")
    .where("awardedAt", ">=", admin.firestore.Timestamp.fromDate(after))
    .orderBy("awardedAt", "asc")
    .get();
  const candidates = rewards.docs.filter((document) => {
    const data = document.data();
    return Array.isArray(data.seasonEligibleSquadIds) && data.seasonEligibleSquadIds.length > 0;
  });
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    after: after.toISOString(),
    scannedRewards: rewards.size,
    qualifyingRewards: candidates.length,
  }, null, 2));
  if (!apply) return;

  let processed = 0;
  let projectedContributions = 0;
  let ignored = 0;
  for (const document of candidates) {
    const userDocument = document.ref.parent.parent;
    if (!userDocument) {
      ignored += 1;
      continue;
    }
    const result = await projectRewardRecord(userDocument.id, document.id, document.data());
    processed += 1;
    projectedContributions += result.projectedCount;
    if (result.status === "ignored") ignored += 1;
  }
  console.log(JSON.stringify({ processedRewards: processed, projectedContributions, ignoredRewards: ignored }, null, 2));
}

run().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "Season projection repair failed.");
  process.exit(1);
});
