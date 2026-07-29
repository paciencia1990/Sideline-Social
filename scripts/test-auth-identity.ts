import assert from "node:assert/strict";

import {
  isPermanentFirebaseUser,
  resolveClientGameAuthority,
  resolveFirebaseIdentityKind,
} from "../utils/authIdentity.ts";

const anonymousUser = { isAnonymous: true, uid: "anonymous-uid" };
const permanentUser = { isAnonymous: false, uid: "permanent-uid" };

assert.equal(resolveFirebaseIdentityKind(null), "unauthenticated");
assert.equal(resolveFirebaseIdentityKind(anonymousUser), "anonymous");
assert.equal(resolveFirebaseIdentityKind(permanentUser), "permanent");
assert.equal(isPermanentFirebaseUser(null), false);
assert.equal(isPermanentFirebaseUser(anonymousUser), false);
assert.equal(isPermanentFirebaseUser(permanentUser), true);

assert.deepEqual(
  resolveClientGameAuthority({
    hostUserId: "permanent-uid",
    participantUserIds: ["permanent-uid", "player-uid"],
    user: permanentUser,
  }),
  {
    identityKind: "permanent",
    isHost: true,
    isParticipant: true,
    isPermanentAccount: true,
  },
);

assert.deepEqual(
  resolveClientGameAuthority({
    hostUserId: "host-uid",
    participantUserIds: ["player-uid"],
    user: { isAnonymous: false, uid: "player-uid" },
  }),
  {
    identityKind: "permanent",
    isHost: false,
    isParticipant: true,
    isPermanentAccount: true,
  },
);

assert.deepEqual(
  resolveClientGameAuthority({
    hostUserId: "anonymous-uid",
    participantUserIds: ["anonymous-uid"],
    user: anonymousUser,
  }),
  {
    identityKind: "anonymous",
    isHost: false,
    isParticipant: false,
    isPermanentAccount: false,
  },
);

console.log("Firebase identity and client game-authority tests passed.");
