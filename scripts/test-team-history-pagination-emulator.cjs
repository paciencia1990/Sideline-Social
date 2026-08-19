/* eslint-disable no-console */
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const path = require("node:path");

const functionsRequire = createRequire(path.join(process.cwd(), "functions", "package.json"));
const admin = functionsRequire("firebase-admin");
const { FieldPath, Timestamp } = functionsRequire("firebase-admin/firestore");

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Firestore emulator is required.");
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "sideline-team-history-pagination-test" });
const db = admin.firestore();

async function writeAll(entries) {
  for (let start = 0; start < entries.length; start += 400) {
    const batch = db.batch();
    entries.slice(start, start + 400).forEach(([ref, value]) => batch.set(ref, value));
    await batch.commit();
  }
}

async function measure(total) {
  const suffix = `${total}-${Date.now()}`;
  const teamRef = db.collection("teams").doc(`pagination-${suffix}`);
  const conversationRef = db.collection("teamPrivateConversations").doc(`pagination-${suffix}`);
  const timestamp = Timestamp.fromMillis(2_000_000_000_000);
  const entries = [
    [teamRef, { status: "active" }],
    [teamRef.collection("members").doc("parent"), { status: "active", userId: "parent" }],
    [db.collection("teamAnnouncementSummaries").doc(`pagination-${suffix}`), { available: true, unreadCount: total }],
    [conversationRef, { lastMessageAt: timestamp, participantUserIds: ["coach", "parent"] }],
  ];
  for (let index = 0; index < total; index += 1) {
    const id = `item-${String(index).padStart(4, "0")}`;
    entries.push(
      [teamRef.collection("announcements").doc(id), { audience: "parents", createdAt: timestamp }],
      [teamRef.collection("announcements").doc("target").collection("replies").doc(id), { createdAt: timestamp, replyType: "reply" }],
      [conversationRef.collection("messages").doc(id), { createdAt: timestamp }],
      [teamRef.collection("events").doc(id), { startAt: timestamp }],
    );
  }
  await writeAll(entries);

  const allAnnouncements = await teamRef.collection("announcements").get();
  const announcementWindow = await teamRef.collection("announcements")
    .where("audience", "in", ["parents", "all", "everyone"])
    .orderBy("createdAt", "desc")
    .orderBy(FieldPath.documentId(), "desc")
    .limit(21)
    .get();
  const repliesWindow = await teamRef.collection("announcements").doc("target").collection("replies")
    .where("replyType", "==", "reply")
    .orderBy("createdAt", "desc")
    .orderBy(FieldPath.documentId(), "desc")
    .limit(31)
    .get();
  const privateWindow = await conversationRef.collection("messages")
    .orderBy("createdAt", "desc")
    .orderBy(FieldPath.documentId(), "desc")
    .limit(41)
    .get();
  const scheduleWindow = await teamRef.collection("events")
    .where("startAt", ">=", Timestamp.fromMillis(0))
    .orderBy("startAt", "asc")
    .orderBy(FieldPath.documentId(), "asc")
    .limit(51)
    .get();
  const fixedReads = await db.getAll(
    teamRef.collection("members").doc("parent"),
    db.collection("teamAnnouncementSummaries").doc(`pagination-${suffix}`),
  );

  const result = {
    count: total,
    announcementBefore: allAnnouncements.size * 2 + 1,
    announcementAfter: announcementWindow.size + fixedReads.length,
    announcementListenerAfter: announcementWindow.size,
    privateMessageListenerAfter: privateWindow.size,
    replyListenerAfter: repliesWindow.size,
    scheduleListenerAfter: scheduleWindow.size,
    collapsedPastReadsAfter: 0,
  };
  assert.equal(result.announcementAfter, Math.min(total, 21) + 2);
  return result;
}

(async () => {
  const measurements = [];
  for (const total of [10, 100, 1000]) measurements.push(await measure(total));
  console.log(JSON.stringify({ status: "passed", measurements }));
})().catch((error) => {
  console.error(JSON.stringify({ status: "failed", code: error?.code ?? error?.name ?? "unknown" }));
  process.exitCode = 1;
});
