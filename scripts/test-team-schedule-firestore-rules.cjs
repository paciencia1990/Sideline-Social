const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } = require("firebase/firestore");

const projectId = "sideline-team-schedule-rules-test";
const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");
const now = () => Timestamp.now();

const event = (teamId) => ({
  teamId, type: "practice", title: "Synthetic practice", startAt: now(), endAt: now(),
  timezone: "America/New_York", isAllDay: false, status: "scheduled",
  createdBy: "coach", updatedBy: "coach", createdAt: now(), updatedAt: now(),
});

async function seed(testEnv) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [teamId, status] of [["team-active", "active"], ["team-archived", "archived"], ["team-other", "active"]]) {
      await setDoc(doc(db, "teams", teamId), { name: `Synthetic ${teamId}`, createdBy: "coach", status });
      await setDoc(doc(db, "teams", teamId, "events", "event-1"), event(teamId));
    }
    const members = [
      ["coach", { coach: true, parent: false, staff: false }, "coach", "active"],
      ["staff", { coach: false, parent: false, staff: true }, "teamParent", "active"],
      ["parent", { coach: false, parent: true, staff: false }, "parent", "active"],
      ["removed", { coach: false, parent: true, staff: false }, "parent", "removed"],
      ["suspended", { coach: false, parent: true, staff: false }, "parent", "active"],
      ["banned", { coach: true, parent: false, staff: false }, "coach", "active"],
    ];
    for (const teamId of ["team-active", "team-archived"]) {
      for (const [uid, roles, role, status] of members) {
        await setDoc(doc(db, "teams", teamId, "members", uid), { userId: uid, teamId, roles, role, status });
      }
    }
    await setDoc(doc(db, "teams", "team-other", "members", "other-parent"), {
      userId: "other-parent", teamId: "team-other", roles: { parent: true }, role: "parent", status: "active",
    });
    await setDoc(doc(db, "accountStanding", "suspended"), { status: "suspended", expiresAt: Timestamp.fromMillis(Date.now() + 86400000) });
    await setDoc(doc(db, "accountStanding", "banned"), { status: "banned" });
  });
}

async function run() {
  const testEnv = await initializeTestEnvironment({ projectId, firestore: { rules } });
  try {
    await testEnv.clearFirestore();
    await seed(testEnv);
    const dbFor = (uid) => testEnv.authenticatedContext(uid).firestore();
    const activeEvent = (db) => doc(db, "teams", "team-active", "events", "event-1");
    for (const uid of ["coach", "staff", "parent"]) {
      const db = dbFor(uid);
      await assertSucceeds(getDoc(activeEvent(db)));
      await assertSucceeds(getDocs(collection(db, "teams", "team-active", "events")));
      await assertSucceeds(getDoc(doc(db, "teams", "team-archived", "events", "event-1")));
      await assertSucceeds(getDocs(collection(db, "teams", "team-archived", "events")));
      await assertFails(setDoc(doc(db, "teams", "team-active", "events", `direct-${uid}`), event("team-active")));
      await assertFails(updateDoc(activeEvent(db), { title: "Unauthorized direct change" }));
      await assertFails(deleteDoc(activeEvent(db)));
      await assertFails(setDoc(doc(db, "teams", "team-archived", "events", `direct-${uid}`), event("team-archived")));
    }

    await assertFails(getDoc(activeEvent(dbFor("removed"))));
    await assertFails(getDoc(activeEvent(dbFor("outsider"))));
    await assertFails(getDoc(activeEvent(dbFor("other-parent"))));
    await assertFails(getDoc(activeEvent(dbFor("suspended"))));
    await assertFails(getDoc(activeEvent(dbFor("banned"))));
    await assertFails(getDoc(activeEvent(testEnv.unauthenticatedContext().firestore())));
    await assertFails(getDoc(doc(dbFor("coach"), "teamScheduleOperations", "private")));
    await assertFails(getDoc(doc(dbFor("coach"), "teamScheduleAudit", "private")));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      assert.equal((await getDoc(doc(db, "teams", "team-active", "events", "event-1"))).exists(), true);
      assert.equal((await getDoc(doc(db, "teams", "team-archived", "events", "event-1"))).exists(), true);
    });

    console.log("Team Schedule active/archived reads, standing enforcement, isolation, and callable-only write rules tests passed.");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
