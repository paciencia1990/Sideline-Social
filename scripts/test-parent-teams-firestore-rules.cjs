const fs = require("node:fs");
const path = require("node:path");
const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { Timestamp, collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } = require("firebase/firestore");

const projectId = "sideline-parent-teams-rules-test";
const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");
const now = () => Timestamp.now();

async function seed(testEnv) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "teams", "team-1"), {
      name: "Tigers", createdBy: "coach", coachIds: ["coach", "multi-role", "staff"],
      parentIds: ["parent-a", "parent-b", "multi-role", "removed-parent"],
    });
    const members = [
      { uid: "coach", role: "coach", roles: { parent: false, coach: true, staff: false }, status: "active" },
      { uid: "staff", role: "teamParent", roles: { parent: false, coach: false, staff: true }, status: "active" },
      { uid: "multi-role", role: "coach", roles: { parent: true, coach: true, staff: false }, status: "active" },
      { uid: "parent-a", role: "parent", roles: { parent: true, coach: false, staff: false }, status: "active" },
      { uid: "parent-b", role: "parent", roles: undefined, status: "active" },
      { uid: "removed-parent", role: "parent", roles: { parent: true, coach: false, staff: false }, status: "removed" },
    ];
    for (const member of members) {
      const data = { userId: member.uid, teamId: "team-1", displayName: member.uid, role: member.role, status: member.status, createdAt: now(), updatedAt: now() };
      if (member.roles) data.roles = member.roles;
      await setDoc(doc(db, "teams", "team-1", "members", member.uid), data);
    }
    for (const uid of ["parent-a", "parent-b", "coach", "multi-role", "staff", "outsider"]) {
      await setDoc(doc(db, "users", uid), { displayName: uid });
    }
    await setDoc(doc(db, "users", "parent-a", "children", "child-a"), {
      displayName: "Sam", createdAt: now(), updatedAt: now(),
    });
    await setDoc(doc(db, "users", "parent-b", "children", "child-b"), {
      displayName: "Sam", createdAt: now(), updatedAt: now(),
    });
    await setDoc(doc(db, "squads", "outsider-squad"), {
      createdBy: "outsider", memberIds: ["outsider"], name: "Outsider Squad",
    });
    await setDoc(doc(db, "users", "parent-a", "teamChildLinks", "team-1"), {
      teamId: "team-1", childIds: ["child-a"], status: "active", createdAt: now(), updatedAt: now(),
    });
    const announcement = (audience, allowReplies = true) => ({
      title: "Update", body: "Team update", createdBy: "coach", createdByName: "Coach",
      audience, allowReplies, createdAt: now(), updatedAt: now(),
    });
    await setDoc(doc(db, "teams", "team-1", "announcements", "parents-open"), announcement("parents"));
    await setDoc(doc(db, "teams", "team-1", "announcements", "staff-only"), announcement("staff"));
    await setDoc(doc(db, "teams", "team-1", "announcements", "parents-closed"), announcement("parents", false));
    await setDoc(doc(db, "teams", "team-1", "announcements", "parents-open", "replies", "private-reply"), {
      userId: "coach", displayName: "coach", body: "Private", replyType: "privateToCoach", createdAt: now(),
    });
  });
}

async function run() {
  const testEnv = await initializeTestEnvironment({ projectId, firestore: { rules } });
  try {
    await testEnv.clearFirestore();
    await seed(testEnv);
    const dbFor = (uid) => testEnv.authenticatedContext(uid).firestore();
    const coachDb = dbFor("coach");
    const staffDb = dbFor("staff");
    const multiDb = dbFor("multi-role");
    const parentDb = dbFor("parent-a");
    const otherParentDb = dbFor("parent-b");
    const removedDb = dbFor("removed-parent");
    const outsiderDb = dbFor("outsider");

    await assertSucceeds(getDoc(doc(parentDb, "teams", "team-1")));
    await assertFails(getDoc(doc(outsiderDb, "teams", "team-1")));
    await assertFails(getDoc(doc(removedDb, "teams", "team-1")));
    await assertFails(getDoc(doc(removedDb, "teams", "team-1", "announcements", "parents-open")));
    await assertSucceeds(getDocs(collection(coachDb, "teams", "team-1", "members")));
    await assertSucceeds(getDocs(collection(staffDb, "teams", "team-1", "members")));
    await assertFails(getDocs(collection(parentDb, "teams", "team-1", "members")));
    await assertFails(getDoc(doc(parentDb, "teams", "team-1", "members", "multi-role")));
    await assertFails(getDoc(doc(parentDb, "teams", "team-1", "members", "parent-b")));

    await assertSucceeds(getDoc(doc(parentDb, "teams", "team-1", "announcements", "parents-open")));
    await assertFails(getDoc(doc(parentDb, "teams", "team-1", "announcements", "staff-only")));
    await assertSucceeds(getDoc(doc(multiDb, "teams", "team-1", "announcements", "staff-only")));
    await assertSucceeds(getDoc(doc(multiDb, "teams", "team-1", "announcements", "parents-open")));
    await assertSucceeds(getDocs(query(collection(parentDb, "teams", "team-1", "announcements"), where("audience", "in", ["parents", "all"]))));

    await assertSucceeds(getDoc(doc(parentDb, "users", "parent-a", "children", "child-a")));
    await assertSucceeds(getDocs(collection(parentDb, "users", "parent-a", "children")));
    await assertFails(getDoc(doc(otherParentDb, "users", "parent-a", "children", "child-a")));
    await assertFails(getDoc(doc(coachDb, "users", "parent-a", "children", "child-a")));
    await assertSucceeds(setDoc(doc(parentDb, "users", "parent-a", "children", "child-new"), {
      displayName: "Alex", createdAt: now(), updatedAt: now(),
    }));
    await assertSucceeds(updateDoc(doc(parentDb, "users", "parent-a", "children", "child-a"), {
      displayName: "Samuel", updatedAt: now(),
    }));
    await assertFails(setDoc(doc(parentDb, "users", "parent-a", "children", "normalized-name"), {
      displayName: "Alex", normalizedName: "alex", createdAt: now(), updatedAt: now(),
    }));
    await assertFails(setDoc(doc(parentDb, "users", "parent-a", "children", "invalid"), {
      displayName: "", createdAt: now(), updatedAt: now(), privateNote: "secret",
    }));
    await assertFails(updateDoc(doc(otherParentDb, "users", "parent-a", "children", "child-a"), {
      displayName: "Not mine", updatedAt: now(),
    }));
    await assertFails(deleteDoc(doc(otherParentDb, "users", "parent-a", "children", "child-a")));
    // Direct deletion is denied for everyone; the owner uses the checked callable.
    await assertFails(deleteDoc(doc(parentDb, "users", "parent-a", "children", "child-a")));
    await assertFails(getDocs(collectionGroup(parentDb, "children")));
    await assertFails(getDocs(collectionGroup(outsiderDb, "children")));
    await assertFails(getDoc(doc(outsiderDb, "users", "parent-a", "children", "child-a")));

    await assertSucceeds(getDoc(doc(parentDb, "users", "parent-a", "teamChildLinks", "team-1")));
    await assertFails(getDoc(doc(otherParentDb, "users", "parent-a", "teamChildLinks", "team-1")));
    await assertFails(setDoc(doc(parentDb, "users", "parent-a", "teamChildLinks", "team-2"), {
      teamId: "team-2", childIds: ["child-a"], status: "active", createdAt: now(), updatedAt: now(),
    }));

    await assertFails(updateDoc(doc(parentDb, "teams", "team-1", "members", "parent-a"), { roles: { parent: true, coach: true, staff: false }, updatedAt: now() }));
    await assertFails(updateDoc(doc(parentDb, "teams", "team-1", "members", "parent-a"), { childName: "Leaked", updatedAt: now() }));
    await assertSucceeds(updateDoc(doc(coachDb, "teams", "team-1", "members", "parent-a"), { roles: { parent: true, coach: false, staff: true }, updatedAt: now() }));

    const newAnnouncement = { title: "New", body: "Body", createdBy: "multi-role", createdByName: "Multi", audience: "parents", allowReplies: true, createdAt: now(), updatedAt: now() };
    await assertFails(setDoc(doc(parentDb, "teams", "team-1", "announcements", "parent-created"), newAnnouncement));
    await assertSucceeds(setDoc(doc(multiDb, "teams", "team-1", "announcements", "multi-created"), newAnnouncement));
    await assertFails(getDoc(doc(otherParentDb, "teams", "team-1", "announcements", "parents-open", "replies", "private-reply")));
    await assertSucceeds(getDoc(doc(coachDb, "teams", "team-1", "announcements", "parents-open", "replies", "private-reply")));
    await assertFails(getDoc(doc(parentDb, "notificationTokens", "private-token")));

    console.log("Parent Teams Firestore multi-role and child-privacy rules tests passed (40 assertions).");
  } finally {
    await testEnv.cleanup();
  }
}
run().catch((error) => { console.error(error); process.exit(1); });