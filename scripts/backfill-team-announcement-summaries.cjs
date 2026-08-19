/* eslint-disable no-console */
const { createHash } = require("node:crypto");
const path = require("node:path");

const admin = require(path.join(process.cwd(), "functions", "node_modules", "firebase-admin"));

const apply = process.argv.includes("--apply");
const projectArgument = process.argv.find((value) => value.startsWith("--project="));
const projectId = projectArgument ? projectArgument.slice("--project=".length) : process.env.GCLOUD_PROJECT;
const maximumTeamsArgument = process.argv.find((value) => value.startsWith("--max-teams="));
const maximumTeams = Math.max(1, Math.min(1000, Number(maximumTeamsArgument?.slice("--max-teams=".length) ?? 100)));
const startAfterTeamArgument = process.argv.find((value) => value.startsWith("--start-after-team="));
const startAfterTeamId = startAfterTeamArgument?.slice("--start-after-team=".length) ?? null;
if (startAfterTeamId !== null && !/^[A-Za-z0-9_-]{1,128}$/u.test(startAfterTeamId)) {
  throw new Error("Invalid --start-after-team value.");
}

admin.initializeApp(projectId ? { projectId } : undefined);
const firestore = admin.firestore();

function summaryReference(userId, teamId) {
  const id = createHash("sha256").update(`${userId}|${teamId}`).digest("hex");
  return firestore.collection("teamAnnouncementSummaries").doc(id);
}

function visibleRecipients(data) {
  if (!data || data.isDeleted === true || data.moderationState === "hidden" || data.moderationState === "removed") return [];
  return Array.isArray(data.recipientUserIds)
    ? Array.from(new Set(data.recipientUserIds.filter((value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value))))
    : [];
}

async function commitOperations(operations) {
  if (!apply || operations.length === 0) return;
  for (let start = 0; start < operations.length; start += 400) {
    const batch = firestore.batch();
    operations.slice(start, start + 400).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

async function rebuildTeam(teamDocument) {
  const announcements = await teamDocument.ref.collection("announcements").orderBy("createdAt", "asc").get();
  const unreadByUser = new Map();
  const recipientUsers = new Set();
  let readChecks = 0;
  for (const announcement of announcements.docs) {
    const recipients = visibleRecipients(announcement.data());
    if (recipients.length === 0) continue;
    const reads = await firestore.getAll(...recipients.map((userId) => announcement.ref.collection("reads").doc(userId)));
    readChecks += reads.length;
    recipients.forEach((userId, index) => {
      recipientUsers.add(userId);
      if (reads[index].exists) return;
      const current = unreadByUser.get(userId) ?? [];
      current.push(announcement);
      unreadByUser.set(userId, current);
    });
  }

  const operations = [];
  for (const userId of recipientUsers) {
    const unreadAnnouncements = unreadByUser.get(userId) ?? [];
    const summaryRef = summaryReference(userId, teamDocument.id);
    if (apply) {
      const staleMarkers = await summaryRef.collection("unreadAnnouncements").get();
      staleMarkers.docs.forEach((marker) => operations.push((batch) => batch.delete(marker.ref)));
    }
    unreadAnnouncements.forEach((announcement) => operations.push((batch) => batch.set(
      summaryRef.collection("unreadAnnouncements").doc(announcement.id),
      {
        announcementId: announcement.id,
        createdAt: announcement.data().createdAt ?? admin.firestore.FieldValue.serverTimestamp(),
        schemaVersion: 1,
        teamId: teamDocument.id,
        userId,
      },
    )));
    const recentUnreadAnnouncements = unreadAnnouncements.slice(-20).reverse().map((announcement) => ({
      announcementId: announcement.id,
      timestampMillis: announcement.data().createdAt?.toMillis?.() ?? 0,
    }));
    operations.push((batch) => batch.set(summaryRef, {
      available: true,
      rebuiltAt: admin.firestore.FieldValue.serverTimestamp(),
      schemaVersion: 1,
      recentUnreadAnnouncements,
      recentUnreadAnnouncementIds: recentUnreadAnnouncements.map((entry) => entry.announcementId),
      teamId: teamDocument.id,
      unreadCount: unreadAnnouncements.length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      userId,
    }, { merge: true })));
  }
  await commitOperations(operations);
  return { announcements: announcements.size, readChecks, summaries: recipientUsers.size, writes: operations.length };
}

async function main() {
  let teamsQuery = firestore.collection("teams").orderBy(admin.firestore.FieldPath.documentId()).limit(maximumTeams + 1);
  if (startAfterTeamId) teamsQuery = teamsQuery.startAfter(startAfterTeamId);
  const teamsSnapshot = await teamsQuery.get();
  const hasMore = teamsSnapshot.size > maximumTeams;
  const teams = teamsSnapshot.docs.slice(0, maximumTeams);
  const totals = { announcements: 0, readChecks: 0, summaries: 0, teams: 0, writes: 0 };
  for (const team of teams) {
    const result = await rebuildTeam(team);
    totals.teams += 1;
    Object.keys(result).forEach((key) => { totals[key] += result[key]; });
  }
  console.log(JSON.stringify({ hasMore, mode: apply ? "apply" : "dry-run", ...totals }));
  if (!apply) console.log("Dry run only. Re-run with --apply after reviewing counts and deployment readiness.");
  if (hasMore) console.log("More teams remain. Resume with --start-after-team using the last processed team ID from an operator-only checkpoint; IDs are intentionally not logged.");
}

main().catch((error) => {
  console.error(JSON.stringify({ mode: apply ? "apply" : "dry-run", status: "failed", code: error?.code ?? error?.name ?? "unknown" }));
  process.exitCode = 1;
});
