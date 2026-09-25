const assert = require("node:assert/strict");
const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } = require("firebase/auth");
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require("firebase/functions");

const projectId = process.env.GCLOUD_PROJECT || "sideline-team-archive-functions-test";
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

async function run() {
  const [owner, coach, parent, staff, removed, outsider] = await Promise.all(
    ["archive-owner", "archive-coach", "archive-parent", "archive-staff", "archive-removed", "archive-outsider"].map(createClient),
  );
  const teamId = "archive-team";
  const teamRef = db.collection("teams").doc(teamId);
  const originalInviteCode = "TEAM24";
  const users = [owner, coach, parent, staff, removed, outsider];
  await Promise.all(users.map((client) => db.collection("users").doc(client.uid).set({
    displayName: `Member ${client.uid.slice(0, 4)}`,
    coachTeamIds: [owner.uid, coach.uid, staff.uid].includes(client.uid) ? [teamId] : [],
    parentTeamIds: [parent.uid, staff.uid].includes(client.uid) ? [teamId] : [],
    archivedCoachTeamIds: [],
    archivedParentTeamIds: [],
    activeTeamId: client.uid === outsider.uid || client.uid === removed.uid ? null : teamId,
  })));
  await teamRef.set({
    status: "active",
    createdBy: owner.uid,
    inviteCode: originalInviteCode,
    coachIds: [owner.uid, coach.uid],
    parentIds: [parent.uid, staff.uid],
    name: "Disposable Archive Team",
  });
  await Promise.all([
    teamRef.collection("members").doc(owner.uid).set({ userId: owner.uid, teamId, status: "active", role: "coach", roles: { coach: true, parent: false, staff: false } }),
    teamRef.collection("members").doc(coach.uid).set({ userId: coach.uid, teamId, status: "active", role: "coach", roles: { coach: true, parent: false, staff: false } }),
    teamRef.collection("members").doc(parent.uid).set({ userId: parent.uid, teamId, status: "active", role: "parent", roles: { coach: false, parent: true, staff: false } }),
    teamRef.collection("members").doc(staff.uid).set({ userId: staff.uid, teamId, status: "active", role: "parent", roles: { coach: false, parent: true, staff: true } }),
    teamRef.collection("members").doc(removed.uid).set({ userId: removed.uid, teamId, status: "removed", role: "coach", roles: { coach: true, parent: false, staff: false } }),
    db.collection("users").doc(parent.uid).collection("teamChildLinks").doc(teamId).set({ teamId, status: "active", childIds: ["child-a"] }),
    db.collection("users").doc(staff.uid).collection("teamChildLinks").doc(teamId).set({ teamId, status: "active", childIds: ["child-b"] }),
    teamRef.collection("events").doc("preserved-event").set({ title: "Preserved schedule", teamId }),
    teamRef.collection("announcements").doc("preserved-announcement").set({ title: "Preserved announcement", teamId }),
    db.collection("moderationCases").doc("preserved-team-case").set({ targetType: "team", targetId: teamId }),
  ]);

  const activeConversation = db.collection("teamPrivateConversations").doc("archive-conversation-active");
  const blockedConversation = db.collection("teamPrivateConversations").doc("archive-conversation-blocked");
  const preexistingReadOnlyConversation = db.collection("teamPrivateConversations").doc("archive-conversation-preexisting-readonly");
  await Promise.all([
    activeConversation.set({ teamId, status: "active", coachUserId: owner.uid, parentUserId: parent.uid, participantUserIds: [owner.uid, parent.uid], lastMessageAt: admin.firestore.Timestamp.now() }),
    blockedConversation.set({ teamId, status: "active", coachUserId: owner.uid, parentUserId: staff.uid, participantUserIds: [owner.uid, staff.uid], lastMessageAt: admin.firestore.Timestamp.now() }),
    preexistingReadOnlyConversation.set({ teamId, status: "readOnly", coachUserId: owner.uid, parentUserId: parent.uid, participantUserIds: [owner.uid, parent.uid], lastMessageAt: admin.firestore.Timestamp.now() }),
    activeConversation.collection("messages").doc("preserved-message").set({ text: "preserved", teamId }),
    db.collection("userBlocks").doc(owner.uid).collection("blockedUsers").doc(staff.uid).set({ status: "active" }),
  ]);

  for (const denied of [parent, staff, removed, outsider]) {
    await assert.rejects(
      () => denied.call("setTeamArchived", { teamId, archived: true }),
      hasCode("permission-denied"),
      "parent-only, staff-only, removed, and outsider accounts cannot archive",
    );
  }

  assert.equal((await owner.call("setTeamArchived", { teamId, archived: true })).status, "archived");
  const archived = (await teamRef.get()).data();
  assert.equal(archived.status, "archived");
  assert.equal(archived.inviteCode, null);
  assert.equal((await teamRef.collection("events").doc("preserved-event").get()).exists, true);
  assert.equal((await teamRef.collection("announcements").doc("preserved-announcement").get()).exists, true);
  assert.equal((await activeConversation.collection("messages").doc("preserved-message").get()).exists, true);
  assert.equal((await db.collection("moderationCases").doc("preserved-team-case").get()).exists, true);
  assert.equal((await activeConversation.get()).data().status, "readOnly");
  assert.equal((await activeConversation.get()).data().teamLifecycleArchived, true);
  assert.equal((await blockedConversation.get()).data().status, "readOnly");
  assert.equal((await preexistingReadOnlyConversation.get()).data().status, "readOnly");
  assert.equal((await preexistingReadOnlyConversation.get()).data().teamLifecycleArchived, undefined, "archive does not claim an unrelated preexisting read-only state");
  assert.equal((await db.collection("users").doc(parent.uid).get()).data().archivedParentTeamIds.includes(teamId), true);
  assert.equal((await db.collection("users").doc(owner.uid).get()).data().archivedCoachTeamIds.includes(teamId), true);
  await assert.rejects(
    () => outsider.call("joinParentTeamByInviteCode", { inviteCode: originalInviteCode, childIds: ["child-x"] }),
    hasCode("not-found"),
    "an archived team's retired invite code cannot be used",
  );
  await assert.rejects(
    () => owner.call("setTeamStaffRole", { teamId, targetUserId: parent.uid, isStaff: true }),
    hasCode("failed-precondition"),
    "prohibited archived-team writes stay blocked",
  );
  assert.equal((await owner.call("setTeamArchived", { teamId, archived: true })).status, "archived", "repeat archive is safe");

  const restoredResult = await coach.call("setTeamArchived", { teamId, archived: false });
  assert.equal(restoredResult.status, "active");
  assert.match(restoredResult.inviteCode, /^[A-HJ-NP-Z2-9]{6}$/u);
  assert.notEqual(restoredResult.inviteCode, originalInviteCode);
  const restored = (await teamRef.get()).data();
  assert.equal(restored.status, "active");
  assert.equal((await activeConversation.get()).data().status, "active", "eligible archive-marked conversations reactivate");
  assert.equal((await activeConversation.get()).data().teamLifecycleArchived, undefined);
  assert.equal((await blockedConversation.get()).data().status, "readOnly", "a blocked conversation is not reactivated");
  assert.equal((await blockedConversation.get()).data().teamLifecycleArchived, true, "skipped conversation remains eligible for a later guarded reconciliation");
  assert.equal((await preexistingReadOnlyConversation.get()).data().status, "readOnly", "restore preserves unrelated read-only conversation state");
  assert.equal((await db.collection("users").doc(parent.uid).get()).data().parentTeamIds.includes(teamId), true);
  assert.equal((await db.collection("users").doc(owner.uid).get()).data().coachTeamIds.includes(teamId), true);
  const repeatedRestore = await coach.call("setTeamArchived", { teamId, archived: false });
  assert.equal(repeatedRestore.status, "active");
  assert.equal(repeatedRestore.inviteCode, restoredResult.inviteCode, "repeat restore does not rotate the invite code again");

  console.log("Team archive/restore authorization, preservation, indexes, conversation lifecycle, and idempotency emulator tests passed.");
}

run().catch((error) => { console.error(error); process.exit(1); });
