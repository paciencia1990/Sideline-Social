const assert = require("node:assert/strict");
const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } = require("firebase/auth");
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require("firebase/functions");

const projectId = process.env.GCLOUD_PROJECT || "sideline-squad-admin-functions-test";
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

function hasReason(reason) {
  return (error) => error?.details?.reason === reason || String(error?.message).includes(reason);
}

function member(squadId, userId, squadRole = "member", membershipStatus = "active", extra = {}) {
  return {
    membershipId: `${squadId}__${userId}`,
    squadId,
    userId,
    membershipStatus,
    squadRole,
    presenceStatus: "away",
    isActive: membershipStatus === "active",
    joinedAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
    ...extra,
  };
}

async function setUser(client, firstName, lastName, squadIds = []) {
  await Promise.all([
    db.collection("users").doc(client.uid).set({ firstName, lastName, displayName: `${firstName} ${lastName}`, squadIds, selectedSquadId: squadIds[0] ?? null }),
    db.collection("publicUserProfiles").doc(client.uid).set({ userId: client.uid, firstName, lastName, displayName: `${firstName} ${lastName}`, photoURL: null }),
  ]);
}

async function run() {
  const [creator, maria, taylor, coach, outsider] = await Promise.all(
    ["admin-creator", "admin-maria", "admin-taylor", "admin-coach", "admin-outsider"].map(createClient),
  );
  const squadId = "admin-succession-squad";
  await Promise.all([
    setUser(creator, "Joann", "Pollard", [squadId]),
    setUser(maria, "Maria", "Santos", [squadId]),
    setUser(taylor, "Taylor", "Reed", [squadId]),
    setUser(coach, "Casey", "Coach", [squadId]),
    setUser(outsider, "Outside", "Person", []),
  ]);
  await db.collection("squads").doc(squadId).set({
    squadId,
    venueName: "Dr. Phillips Little League",
    sportId: "baseball",
    sportDisplayName: "Baseball",
    createdBy: creator.uid,
    creatorId: creator.uid,
    isActive: true,
    memberIds: [creator.uid, maria.uid, taylor.uid, coach.uid],
    memberCount: 4,
    currentSeasonId: null,
  });
  const legacyCreatorMembership = member(squadId, creator.uid);
  delete legacyCreatorMembership.squadRole;
  await Promise.all([
    db.collection("squadMemberships").doc(`${squadId}__${creator.uid}`).set(legacyCreatorMembership),
    db.collection("squadMemberships").doc(`${squadId}__${maria.uid}`).set(member(squadId, maria.uid)),
    db.collection("squadMemberships").doc(`${squadId}__${taylor.uid}`).set(member(squadId, taylor.uid)),
    db.collection("squadMemberships").doc(`${squadId}__${coach.uid}`).set(member(squadId, coach.uid, "member", "active", { coachRole: "coach", staff: true })),
  ]);

  const initial = await creator.call("getSquadAdministration", { squadId });
  assert.equal(initial.callerIsAdmin, true, "active legacy creator is recognized");
  assert.equal((await db.collection("squadMemberships").doc(`${squadId}__${creator.uid}`).get()).data().squadRole, "admin", "legacy creator self-heals");
  assert.equal(initial.members.every((entry) => !("email" in entry) && !("children" in entry) && !("location" in entry)), true);
  assert.equal((await coach.call("getSquadAdministration", { squadId })).callerIsAdmin, false, "coach/staff status does not grant Squad admin");
  await assert.rejects(() => creator.call("leaveVenueSportSquad", { squadId }), hasReason("last_active_admin"));
  await assert.rejects(() => creator.call("removeSquadAdmin", { squadId, targetUserId: creator.uid }), hasReason("last_active_admin"));
  await assert.rejects(() => maria.call("inviteSquadAdmin", { squadId, targetUserId: taylor.uid }), hasReason("not_squad_admin"));
  await assert.rejects(() => coach.call("inviteSquadAdmin", { squadId, targetUserId: taylor.uid }), hasReason("not_squad_admin"));
  await assert.rejects(() => creator.call("inviteSquadAdmin", { squadId, targetUserId: outsider.uid }), hasReason("target_not_active_member"));
  await assert.rejects(() => creator.call("inviteSquadAdmin", { squadId, targetUserId: creator.uid }), hasReason("cannot_invite_self"));

  const firstInvite = await creator.call("inviteSquadAdmin", { squadId, targetUserId: maria.uid });
  assert.equal(firstInvite.status, "pending");
  await assert.rejects(() => creator.call("inviteSquadAdmin", { squadId, targetUserId: maria.uid }), hasReason("invitation_already_pending"));
  await assert.rejects(() => taylor.call("respondToSquadAdminInvitation", { squadId, decision: "accept" }), hasReason("invitation_not_found"));
  assert.equal((await maria.call("respondToSquadAdminInvitation", { squadId, decision: "decline" })).status, "declined");
  assert.equal((await maria.call("respondToSquadAdminInvitation", { squadId, decision: "decline" })).status, "declined", "decline retry is idempotent");
  assert.equal((await db.collection("squadMemberships").doc(`${squadId}__${maria.uid}`).get()).data().squadRole, "member");
  let invitation = (await db.collection("squadAdminInvitations").doc(firstInvite.invitationId).get()).data();
  assert.equal((await db.collection("userNotifications").doc(maria.uid).collection("notifications").doc(invitation.notificationId).get()).data().dismissReason, "resolved");

  await creator.call("inviteSquadAdmin", { squadId, targetUserId: maria.uid });
  await db.collection("squadAdminInvitations").doc(firstInvite.invitationId).update({ expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1) });
  await assert.rejects(() => maria.call("respondToSquadAdminInvitation", { squadId, decision: "accept" }), hasReason("invitation_expired"));
  await creator.call("inviteSquadAdmin", { squadId, targetUserId: maria.uid });
  await creator.call("cancelSquadAdminInvitation", { squadId, targetUserId: maria.uid });
  await assert.rejects(() => maria.call("respondToSquadAdminInvitation", { squadId, decision: "accept" }), hasReason("invitation_canceled"));

  await creator.call("inviteSquadAdmin", { squadId, targetUserId: maria.uid });
  await db.collection("squadMemberships").doc(`${squadId}__${maria.uid}`).update({ membershipStatus: "left", isActive: false });
  await assert.rejects(() => maria.call("respondToSquadAdminInvitation", { squadId, decision: "accept" }), hasReason("target_not_active_member"));
  await db.collection("squadMemberships").doc(`${squadId}__${maria.uid}`).update({ membershipStatus: "active", isActive: true });
  await creator.call("inviteSquadAdmin", { squadId, targetUserId: maria.uid });
  assert.equal((await maria.call("respondToSquadAdminInvitation", { squadId, decision: "accept" })).status, "accepted");
  assert.equal((await maria.call("respondToSquadAdminInvitation", { squadId, decision: "accept" })).status, "accepted", "accept retry is idempotent");
  assert.equal((await db.collection("squadMemberships").doc(`${squadId}__${maria.uid}`).get()).data().squadRole, "admin");
  await assert.rejects(() => creator.call("inviteSquadAdmin", { squadId, targetUserId: maria.uid }), hasReason("target_already_admin"));

  await creator.call("leaveVenueSportSquad", { squadId });
  assert.equal((await db.collection("squadMemberships").doc(`${squadId}__${creator.uid}`).get()).data().membershipStatus, "left");
  assert.equal((await db.collection("squads").doc(squadId).get()).data().createdBy, creator.uid, "historical creator metadata remains unchanged");
  assert.equal((await maria.call("getSquadSeasons", { squadId })).canManageSeasons, true, "remaining non-creator admin manages seasons");
  await assert.rejects(() => creator.call("getSquadSeasons", { squadId }), (error) => String(error?.code).includes("permission-denied"));
  const startDate = calendarDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const endDate = calendarDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
  await maria.call("createSquadSeason", { squadId, name: "Succession Season", startDate, endDate, timeZone: "America/New_York" });

  await creator.call("joinVenueSportSquad", { squadId });
  const rejoinedCreatorMembership = (await db.collection("squadMemberships").doc(`${squadId}__${creator.uid}`).get()).data();
  assert.equal(rejoinedCreatorMembership.squadRole, "member", "departed creator rejoins as an ordinary member");
  assert.equal((await creator.call("getSquadAdministration", { squadId })).callerIsAdmin, false, "historical creator metadata cannot restore authority");

  await maria.call("inviteSquadAdmin", { squadId, targetUserId: taylor.uid });
  await taylor.call("respondToSquadAdminInvitation", { squadId, decision: "accept" });
  const concurrent = await Promise.allSettled([
    maria.call("leaveVenueSportSquad", { squadId }),
    taylor.call("leaveVenueSportSquad", { squadId }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1, "only one concurrent admin leave succeeds");
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
  const activeAfterRace = await db.collection("squadMemberships").where("squadId", "==", squadId).where("membershipStatus", "==", "active").get();
  assert.equal(activeAfterRace.docs.some((document) => document.data().squadRole === "admin"), true, "concurrent leave cannot orphan Squad");

  const remainingAdminId = activeAfterRace.docs.find((document) => document.data().squadRole === "admin").data().userId;
  const remainingAdmin = remainingAdminId === maria.uid ? maria : taylor;
  await remainingAdmin.call("inviteSquadAdmin", { squadId, targetUserId: coach.uid });
  await coach.call("respondToSquadAdminInvitation", { squadId, decision: "accept" });
  await remainingAdmin.call("removeSquadAdmin", { squadId, targetUserId: coach.uid });
  const coachMembership = (await db.collection("squadMemberships").doc(`${squadId}__${coach.uid}`).get()).data();
  assert.equal(coachMembership.squadRole, "member");
  assert.equal(coachMembership.membershipStatus, "active", "demotion preserves ordinary membership");
  await assert.rejects(() => remainingAdmin.call("removeSquadAdmin", { squadId, targetUserId: remainingAdmin.uid }), hasReason("last_active_admin"));

  const orphanId = "legacy-orphan-squad";
  await db.collection("squads").doc(orphanId).set({ squadId: orphanId, createdBy: outsider.uid, isActive: true, memberIds: [taylor.uid], memberCount: 1 });
  await db.collection("squadMemberships").doc(`${orphanId}__${taylor.uid}`).set(member(orphanId, taylor.uid));
  await db.collection("users").doc(taylor.uid).update({ squadIds: admin.firestore.FieldValue.arrayUnion(orphanId) });
  assert.equal((await taylor.call("requestSquadAdminAccess", { squadId: orphanId })).status, "pending");
  assert.equal((await db.collection("squadMemberships").doc(`${orphanId}__${taylor.uid}`).get()).data().squadRole, "member", "recovery request never grants authority");
  await assert.rejects(() => taylor.call("requestSquadAdminAccess", { squadId: orphanId }), hasReason("recovery_request_already_pending"));
  await db.collection("squadMemberships").doc(`${orphanId}__${coach.uid}`).set(member(orphanId, coach.uid, "admin"));
  await assert.rejects(() => taylor.call("requestSquadAdminAccess", { squadId: orphanId }), hasReason("squad_has_active_admin"));

  const acceptedNotifications = await db.collection("userNotifications").doc(creator.uid).collection("notifications")
    .where("type", "==", "squadAdminInvitationAccepted").get();
  assert.equal(acceptedNotifications.size, 1, "acceptance retries do not duplicate notifications");
  console.log("Squad admin invitation, last-admin, concurrency, creator succession, recovery, notification, and season authorization emulator tests passed.");
}

function calendarDate(date) {
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("-");
}

run().catch((error) => { console.error(error); process.exit(1); });
