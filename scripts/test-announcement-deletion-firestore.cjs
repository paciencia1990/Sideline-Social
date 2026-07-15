const assert = require("node:assert/strict");
const path = require("node:path");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Announcement deletion integration tests require the Firestore emulator.");
}

const admin = require(path.join(process.cwd(), "functions", "node_modules", "firebase-admin"));
const {
  deleteTeamAnnouncementData,
  getAnnouncementNotificationId,
} = require(path.join(process.cwd(), "functions", "lib", "teamAnnouncementDeletionCore.js"));

const projectId = "sideline-announcement-deletion-test";
if (admin.apps.length === 0) admin.initializeApp({ projectId });
const firestore = admin.firestore();

async function run() {
  const teamId = "team-delete-test";
  const announcementId = "announcement-target";
  const notificationId = getAnnouncementNotificationId(teamId, announcementId);
  const teamRef = firestore.collection("teams").doc(teamId);
  const announcementRef = teamRef.collection("announcements").doc(announcementId);
  const otherAnnouncementRef = teamRef.collection("announcements").doc("announcement-keep");
  const memberUserIds = ["coach-a", "staff-a", "parent-a", "removed-parent-a"];

  const seed = firestore.batch();
  seed.set(teamRef, { name: "Deletion Test Team", status: "active" });
  memberUserIds.forEach((userId) => {
    seed.set(teamRef.collection("members").doc(userId), { userId, status: "active" });
    seed.set(
      firestore.collection("userNotifications").doc(userId).collection("notifications").doc(notificationId),
      { teamId, announcementId, status: "active" },
    );
    seed.set(
      firestore.collection("userNotifications").doc(userId).collection("notifications").doc("unrelated-event"),
      { teamId, announcementId: "announcement-keep", status: "active" },
    );
  });
  seed.set(announcementRef, { title: "Delete me", audience: "parents" });
  seed.set(announcementRef.collection("replies").doc("reply-a"), { body: "Reply" });
  seed.set(announcementRef.collection("reads").doc("parent-a"), { userId: "parent-a" });
  seed.set(announcementRef.collection("acknowledgments").doc("parent-a"), { userId: "parent-a" });
  seed.set(otherAnnouncementRef, { title: "Keep me", audience: "parents" });
  await seed.commit();

  const result = await deleteTeamAnnouncementData(firestore, announcementRef, memberUserIds);
  assert.equal(result.notificationCount, memberUserIds.length);

  for (const reference of [
    announcementRef,
    announcementRef.collection("replies").doc("reply-a"),
    announcementRef.collection("reads").doc("parent-a"),
    announcementRef.collection("acknowledgments").doc("parent-a"),
  ]) {
    assert.equal((await reference.get()).exists, false);
  }
  assert.equal((await otherAnnouncementRef.get()).exists, true);
  assert.equal((await teamRef.get()).exists, true);
  assert.equal((await teamRef.collection("members").doc("parent-a").get()).exists, true);

  for (const userId of memberUserIds) {
    const inbox = firestore.collection("userNotifications").doc(userId).collection("notifications");
    assert.equal((await inbox.doc(notificationId).get()).exists, false);
    assert.equal((await inbox.doc("unrelated-event").get()).exists, true);
  }

  // Retrying cleanup after the parent document is gone remains safe and does
  // not affect the neighboring announcement or unrelated notifications.
  await deleteTeamAnnouncementData(firestore, announcementRef, memberUserIds);
  assert.equal((await otherAnnouncementRef.get()).exists, true);
  assert.equal((await teamRef.get()).exists, true);

  console.log("Announcement recursive deletion, notification cleanup, isolation, and retry tests passed.");
}

run()
  .then(() => admin.app().delete())
  .catch(async (error) => {
    console.error(error);
    await admin.app().delete();
    process.exit(1);
  });
