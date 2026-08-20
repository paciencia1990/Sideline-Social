const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } = require("firebase/auth");
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require("firebase/functions");

const projectId = process.env.GCLOUD_PROJECT || "sideline-team-schedule-functions-test";
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();

async function createClient(label) {
  const app = initializeApp({ apiKey: "demo-key", projectId }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const credential = await createUserWithEmailAndPassword(auth, `${label}@example.test`, "ValidPass123!");
  const callableFunctions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(callableFunctions, "127.0.0.1", 5001);
  return {
    uid: credential.user.uid,
    call: (name, data = {}) => httpsCallable(callableFunctions, name)(data).then((result) => result.data),
  };
}

function hasCode(code) {
  return (error) => String(error?.code).includes(code);
}

const practice = (overrides = {}) => ({
  type: "practice", title: "Synthetic practice", date: "2027-03-07", startTime: "10:00", endTime: "11:30",
  arrivalTime: "09:45", timezone: "America/New_York", isAllDay: false, opponentName: "", homeAway: "",
  venueName: "Community Field", field: "North", address: "100 Test Ave", status: "scheduled",
  teamScore: null, opponentScore: null, notes: "Synthetic emulator fixture", ...overrides,
});

async function seedTeam(teamId, status, coach, staff, parent, removed) {
  await db.collection("teams").doc(teamId).set({ name: `Synthetic ${teamId}`, createdBy: coach.uid, status });
  await Promise.all([
    db.collection("teams").doc(teamId).collection("members").doc(coach.uid).set({ userId: coach.uid, teamId, status: "active", role: "coach", roles: { coach: true, parent: false, staff: false } }),
    db.collection("teams").doc(teamId).collection("members").doc(staff.uid).set({ userId: staff.uid, teamId, status: "active", role: "teamParent", roles: { coach: false, parent: false, staff: true } }),
    db.collection("teams").doc(teamId).collection("members").doc(parent.uid).set({ userId: parent.uid, teamId, status: "active", role: "parent", roles: { coach: false, parent: true, staff: false } }),
    db.collection("teams").doc(teamId).collection("members").doc(removed.uid).set({ userId: removed.uid, teamId, status: "removed", role: "parent", roles: { coach: false, parent: true, staff: false } }),
  ]);
}

async function run() {
  const [coach, staff, parent, removed, outsider, suspended] = await Promise.all(
    ["schedule-coach", "schedule-staff", "schedule-parent", "schedule-removed", "schedule-outsider", "schedule-suspended"].map(createClient),
  );
  await seedTeam("team-active", "active", coach, staff, parent, removed);
  await seedTeam("team-archived", "archived", coach, staff, parent, removed);
  await db.collection("teams").doc("team-active").collection("members").doc(suspended.uid).set({
    userId: suspended.uid, teamId: "team-active", status: "active", role: "coach", roles: { coach: true, parent: false, staff: false },
  });
  await db.collection("accountStanding").doc(suspended.uid).set({ status: "suspended", expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 86400000) });

  const createPayload = {
    teamId: "team-active", event: practice(), recurrence: null, notifyTeam: false,
    editScope: "one", clientOperationId: "manual-create-1",
  };
  const created = await coach.call("saveTeamScheduleEvent", createPayload);
  assert.equal(created.eventIds.length, 1);
  const replayed = await coach.call("saveTeamScheduleEvent", createPayload);
  assert.deepEqual(replayed.eventIds, created.eventIds, "manual retries are idempotent");
  assert.equal((await db.collection("teams").doc("team-active").collection("events").get()).size, 1);

  await assert.rejects(() => parent.call("saveTeamScheduleEvent", { ...createPayload, clientOperationId: "parent-write" }), hasCode("permission-denied"));
  await assert.rejects(() => removed.call("saveTeamScheduleEvent", { ...createPayload, clientOperationId: "removed-write" }), hasCode("permission-denied"));
  await assert.rejects(() => outsider.call("saveTeamScheduleEvent", { ...createPayload, clientOperationId: "cross-team" }), hasCode("permission-denied"));
  await assert.rejects(() => suspended.call("saveTeamScheduleEvent", { ...createPayload, clientOperationId: "suspended-write" }), hasCode("permission-denied"));
  await assert.rejects(() => coach.call("saveTeamScheduleEvent", { ...createPayload, teamId: "team-archived", clientOperationId: "archived-write" }), hasCode("failed-precondition"));
  await assert.rejects(() => coach.call("saveTeamScheduleEvent", {
    ...createPayload, clientOperationId: "bad-score", event: practice({ type: "game", status: "scheduled", teamScore: 4 }),
  }), hasCode("invalid-argument"));

  const recurring = await staff.call("saveTeamScheduleEvent", {
    teamId: "team-active", event: practice({ date: "2027-03-07" }),
    recurrence: { weekdays: [0], endDate: "2027-03-21" }, notifyTeam: false, editScope: "one", clientOperationId: "recurrence-1",
  });
  assert.equal(recurring.eventIds.length, 3);
  assert.ok(recurring.recurrenceGroupId);
  const recurringDocs = await db.collection("teams").doc("team-active").collection("events").where("recurrenceGroupId", "==", recurring.recurrenceGroupId).get();
  assert.equal(recurringDocs.size, 3);
  assert.deepEqual(recurringDocs.docs.map((item) => item.data().localDate).sort(), ["2027-03-07", "2027-03-14", "2027-03-21"]);
  const offsets = recurringDocs.docs.sort((a, b) => a.data().startAt.toMillis() - b.data().startAt.toMillis()).map((item) => item.data().startAt.toMillis());
  assert.equal(offsets[1] - offsets[0], (7 * 24 - 1) * 60 * 60 * 1000, "recurrences preserve local time across DST");

  const eventId = created.eventIds[0];
  await coach.call("saveTeamScheduleEvent", { ...createPayload, eventId, event: practice({ status: "postponed" }), clientOperationId: "postpone-1" });
  await coach.call("saveTeamScheduleEvent", { ...createPayload, eventId, event: practice({ status: "cancelled" }), clientOperationId: "cancel-1" });
  const cancelled = (await db.collection("teams").doc("team-active").collection("events").doc(eventId).get()).data();
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.cancelledAt);
  assert.deepEqual(cancelled.statusHistory.map((entry) => entry.status), ["scheduled", "postponed", "cancelled"]);
  await coach.call("saveTeamScheduleEvent", {
    ...createPayload, eventId, clientOperationId: "complete-score-1",
    event: practice({ type: "game", title: "Synthetic final", opponentName: "Test Opponent", homeAway: "away", status: "completed", teamScore: 3, opponentScore: 2 }),
  });
  const completed = (await db.collection("teams").doc("team-active").collection("events").doc(eventId).get()).data();
  assert.equal(completed.teamScore, 3);
  assert.equal(completed.opponentScore, 2);

  const importDraft = practice({ title: "Synthetic CSV practice", date: "2027-05-01", timezone: "UTC" });
  const importPayload = {
    teamId: "team-active", notifyTeam: false, clientOperationId: "csv-import-1",
    rows: [{ rowNumber: 2, draft: importDraft }, { rowNumber: 3, draft: { ...importDraft } }],
  };
  const imported = await coach.call("importTeamScheduleEvents", importPayload);
  assert.deepEqual({ created: imported.createdCount, unchanged: imported.unchangedCount, duplicate: imported.duplicateCount }, { created: 1, unchanged: 0, duplicate: 1 });
  assert.deepEqual(await coach.call("importTeamScheduleEvents", importPayload), imported, "same import operation is idempotent");
  const retriedImport = await coach.call("importTeamScheduleEvents", { ...importPayload, clientOperationId: "csv-import-2", rows: [importPayload.rows[0]] });
  assert.deepEqual({ created: retriedImport.createdCount, unchanged: retriedImport.unchangedCount }, { created: 0, unchanged: 1 });

  const syntheticIcs = fs.readFileSync(path.join(process.cwd(), "scripts", "fixtures", "team-calendar-synthetic.ics"), "utf8");
  await assert.rejects(() => parent.call("previewTeamScheduleIcs", { teamId: "team-active", ics: syntheticIcs }), hasCode("permission-denied"));
  const icsPreview = await coach.call("previewTeamScheduleIcs", { teamId: "team-active", ics: syntheticIcs });
  assert.equal(icsPreview.events.length, 6);
  const icsImport = await coach.call("importTeamScheduleIcs", { teamId: "team-active", previewId: icsPreview.previewId, selectedKeys: icsPreview.events.map((event) => event.key), notifyTeam: true });
  assert.equal(icsImport.created, 6);
  const icsNotifications = await db.collection("userNotifications").doc(parent.uid).collection("notifications").where("type", "==", "teamScheduleEvent").get();
  assert.equal(icsNotifications.docs.filter((document) => document.data().bodyKey === "notifications.types.teamScheduleImportBody").length, 1, "ICS import sends at most one explicit summary notification");
  const repeatPreview = await coach.call("previewTeamScheduleIcs", { teamId: "team-active", ics: syntheticIcs });
  const repeatImport = await coach.call("importTeamScheduleIcs", { teamId: "team-active", previewId: repeatPreview.previewId, selectedKeys: repeatPreview.events.map((event) => event.key) });
  assert.equal(repeatImport.created, 0);
  assert.equal(repeatImport.unchanged, 6, "iCalendar retry must update or retain stable external identities without duplicates");

  const feedEventRef = db.collection("teams").doc("team-active").collection("events").doc("synthetic-feed-event");
  await feedEventRef.set({ ...practice(), teamId: "team-active", localDate: "2027-07-01", startAt: admin.firestore.Timestamp.fromDate(new Date("2027-07-01T14:00:00Z")), endAt: admin.firestore.Timestamp.fromDate(new Date("2027-07-01T15:00:00Z")), source: "ics-feed", sourceType: "ics-feed", sourceIntegrationId: "synthetic-integration", externalUid: "synthetic@example.invalid", externalKey: "synthetic@example.invalid|", createdBy: coach.uid, updatedBy: coach.uid, createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() });
  await assert.rejects(() => coach.call("saveTeamScheduleEvent", { ...createPayload, eventId: feedEventRef.id, clientOperationId: "feed-edit-blocked" }), hasCode("failed-precondition"));
  assert.equal((await coach.call("detachTeamScheduleEvent", { teamId: "team-active", eventId: feedEventRef.id })).detached, true);
  assert.equal((await feedEventRef.get()).data().sourceType, "manual");

  const subscription = await parent.call("createTeamCalendarSubscription", { teamId: "team-active" });
  assert.match(subscription.httpsUrl, /^https:\/\/us-central1-/);
  assert.doesNotMatch(JSON.stringify((await db.collection("teamCalendarSubscriptions").get()).docs.map((document) => document.data())), /[?&]token=/, "only a token hash may be stored");
  assert.equal((await parent.call("revokeTeamCalendarSubscription", { teamId: "team-active" })).revoked, true);
  await assert.rejects(() => removed.call("createTeamCalendarSubscription", { teamId: "team-active" }), hasCode("permission-denied"));

  const notificationCreate = await coach.call("saveTeamScheduleEvent", {
    ...createPayload, event: practice({ title: "Synthetic notified event", date: "2027-06-01" }), notifyTeam: true,
    clientOperationId: "notify-create-1",
  });
  const parentNotifications = await db.collection("userNotifications").doc(parent.uid).collection("notifications").where("eventId", "==", notificationCreate.eventIds[0]).get();
  assert.equal(parentNotifications.size, 1);
  assert.equal(parentNotifications.docs[0].data().type, "teamScheduleEvent");
  assert.equal(parentNotifications.docs[0].data().activeMode, "parent");

  assert.equal((await coach.call("deleteTeamScheduleEvent", { teamId: "team-active", eventId })).deleted, true);
  assert.equal((await db.collection("teams").doc("team-active").collection("events").doc(eventId).get()).exists, false);
  const audit = await db.collection("teamScheduleAudit").where("eventId", "==", eventId).get();
  assert.equal(audit.size, 1);
  assert.equal(audit.docs[0].data().eventSnapshot.title, "Synthetic final");
  await assert.rejects(() => parent.call("deleteTeamScheduleEvent", { teamId: "team-active", eventId: notificationCreate.eventIds[0] }), hasCode("permission-denied"));

  console.log("Team Schedule callable authorization, lifecycle, recurrence, import, notification, score, and audit emulator tests passed.");
}

run().catch((error) => { console.error(error); process.exit(1); });
