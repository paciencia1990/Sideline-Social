'use strict';
const assert = require('node:assert/strict');
const admin = require('../functions/node_modules/firebase-admin');
const projectId = process.env.GCLOUD_PROJECT;
assert.ok(projectId?.startsWith('demo-') && process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Isolated demo Firestore and Auth required');
admin.initializeApp({ projectId });
const db = admin.firestore();
const { getSquadAdministration } = require('../functions/lib/squadAdmin');
const squadId = 'synthetic-large-squad';
const context = (uid) => ({ auth: { uid, token: { firebase: { sign_in_provider: 'password' } } } });
const timeout = setTimeout(() => { console.error('Large Squad member regression timed out'); process.exit(1); }, 55000);
(async () => {
  const userIds = Array.from({ length: 360 }, (_, index) => `synthetic-member-${String(index).padStart(3, '0')}`);
  await db.doc(`squads/${squadId}`).set({ isActive: true, createdBy: userIds[0], venueName: 'Synthetic Multi-admin Venue' });
  // Keep each setup batch below Firestore's normal write limit.
  for (let offset = 0; offset < userIds.length; offset += 100) {
    const batch = db.batch();
    userIds.slice(offset, offset + 100).forEach((userId, localIndex) => {
      const index = offset + localIndex;
      batch.set(db.doc(`squadMemberships/${squadId}__${userId}`), { squadId, userId, membershipStatus: 'active', squadRole: index < 2 ? 'admin' : 'member' });
      const name = index === 359 ? 'José Rivera' : `Synthetic Parent${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + index % 26)}`;
      // Exercise both public projection and legacy private-profile fallback batches.
      batch.set(db.doc(`${index % 2 ? 'publicUserProfiles' : 'users'}/${userId}`), { userId, firstName: name.split(' ')[0], lastName: name.split(' ').slice(1).join(' '), displayName: name, email: 'not-returned@example.test', childIds: ['private-synthetic-child'] });
    });
    await batch.commit();
  }
  const view = await getSquadAdministration.run({ squadId }, context(userIds[0]));
  assert.equal(view.activeAdminCount, 2, 'Multiple active admins remain supported');
  assert.equal(view.admins.length, 2);
  assert.equal(view.members.length, 360);
  assert.equal(view.eligibleMembers.length, 358);
  assert.equal(view.eligibleMembers.find((member) => member.userId === userIds[359]).displayName, 'José Rivera', 'Names beyond the former 250-member cutoff remain searchable');
  assert.equal(view.eligibleMembers.find((member) => member.userId === userIds[358]).displayName, 'Synthetic ParentNU', 'Legacy fallback also covers later batches');
  for (const member of view.members) {
    assert.equal(Object.hasOwn(member, 'email'), false); assert.equal(Object.hasOwn(member, 'childIds'), false);
  }
  const ordinary = await getSquadAdministration.run({ squadId }, context(userIds[359]));
  assert.equal(ordinary.callerIsAdmin, false); assert.deepEqual(ordinary.eligibleMembers, []); assert.equal(ordinary.members.length, 2);
  await assert.rejects(getSquadAdministration.run({ squadId }, context('outsider')), (error) => error.code === 'permission-denied');
  console.log('Large Squad local emulator passed: 360 member names, two admins, complete legacy/public profile batches, and existing privacy/authorization.');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { clearTimeout(timeout); });
