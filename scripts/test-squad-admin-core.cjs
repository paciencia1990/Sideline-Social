const assert = require("node:assert/strict");

const {
  SQUAD_ADMIN_INVITATION_MS,
  activeSquadAdminIds,
  isActiveSquadAdmin,
  isDurablyActiveSquadMembership,
  isPendingSquadAdminInvitation,
  squadAdminAccessRequestId,
  squadAdminInvitationId,
  usesLegacyCreatorAdminFallback,
} = require("../functions/lib/squadAdminCore.js");

const squad = { createdBy: "creator" };
const membership = (userId, membershipStatus = "active", squadRole) => ({
  userId,
  squadId: "squad-a",
  membershipStatus,
  squadRole,
  presenceStatus: "away",
});

assert.equal(isDurablyActiveSquadMembership({ squadId: "squad-a", userId: "admin", membership: membership("admin", "active", "admin") }), true);
assert.equal(isActiveSquadAdmin({ squad, squadId: "squad-a", userId: "admin", membership: membership("admin", "active", "admin") }), true);
assert.equal(isActiveSquadAdmin({ squad, squadId: "squad-a", userId: "coach", membership: { ...membership("coach", "active", "member"), coachRole: "coach", staff: true } }), false);
assert.equal(isActiveSquadAdmin({ squad, squadId: "squad-a", userId: "creator", membership: membership("creator", "left", "admin") }), false);
assert.equal(usesLegacyCreatorAdminFallback({ squad, squadId: "squad-a", userId: "creator", membership: membership("creator") }), true);
assert.equal(isActiveSquadAdmin({ squad, squadId: "squad-a", userId: "creator", membership: membership("creator", "active", "member") }), false, "explicit demotion prevents creator fallback");
assert.deepEqual(activeSquadAdminIds({
  squad,
  squadId: "squad-a",
  memberships: [membership("creator"), membership("admin", "active", "admin"), membership("member", "active", "member")],
}).sort(), ["admin", "creator"]);
assert.equal(squadAdminInvitationId("squad-a", "member"), "squad-a__member");
assert.equal(squadAdminAccessRequestId("squad-a", "member"), "squad-a__member");
assert.equal(isPendingSquadAdminInvitation({ status: "pending", expiresAtMillis: 101, nowMillis: 100 }), true);
assert.equal(isPendingSquadAdminInvitation({ status: "pending", expiresAtMillis: 100, nowMillis: 100 }), false);
assert.equal(SQUAD_ADMIN_INVITATION_MS, 7 * 24 * 60 * 60 * 1000);

console.log("Squad administrator authorization, legacy fallback, eligibility, and expiry core tests passed.");
