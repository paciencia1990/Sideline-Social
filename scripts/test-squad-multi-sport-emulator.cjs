'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, updateDoc, setDoc } = require('firebase/firestore');
const admin = require('../functions/node_modules/firebase-admin');
const { geohashForLocation } = require('../functions/node_modules/geofire-common');
const projectId = process.env.GCLOUD_PROJECT;
assert.ok(projectId?.startsWith('demo-') && process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Isolated local demo Firestore and Auth required');
admin.initializeApp({ projectId });
const db = admin.firestore();
const { findOrCreateVenueSportSquad: create, updateSquadSports: update } = require('../functions/lib/venueSquad');
const { canonicalVenueId } = require('../functions/lib/squadCore');
const context = (uid, app = true, provider = 'password') => ({ auth: { uid, token: { firebase: { sign_in_provider: provider } } }, ...(app ? { app: { appId: 'demo-local' } } : {}) });
const input = { venueName: 'Synthetic Community YMCA', latitude: 28.12, longitude: -81.12, sportIds: ['swimming', 'basketball'] };
const make = (data = input, uid = 'manager-a') => create.run(data, context(uid));
const save = (squadId, sports, revision = 0, uid = 'manager-a') => update.run({ squadId, sportIds: sports, expectedRevision: revision }, context(uid));
const denied = (promise) => assert.rejects(promise, (error) => error.code === 'permission-denied');
const timeout = setTimeout(() => { console.error('Multi-sport emulator timed out'); process.exit(1); }, 55000);
(async () => {
  const simultaneous = await Promise.all([make(), make({ ...input, sportIds: ['tennis'] }, 'other-creator')]);
  assert.equal(simultaneous[0].squadId, simultaneous[1].squadId, 'Concurrent different sport selections create one venue community');
  assert.equal(simultaneous.filter((result) => result.status === 'created').length, 1);
  const id = simultaneous[0].squadId, ref = db.doc(`squads/${id}`);
  const original = (await ref.get()).data();
  const oldClient = await make({ ...input, sportIds: undefined, sportId: 'baseball' }, 'other-creator');
  assert.equal(oldClient.squadId, id);
  assert.deepEqual((await ref.get()).data(), original, 'Finding an existing venue never overwrites sports or member data');
  await Promise.all([
    db.doc(`squadMemberships/${id}__manager-a`).set({ squadId: id, userId: 'manager-a', membershipStatus: 'active', squadRole: 'admin' }),
    db.doc(`squadMemberships/${id}__manager-b`).set({ squadId: id, userId: 'manager-b', membershipStatus: 'active', squadRole: 'admin' }),
    db.doc(`squadMemberships/${id}__parent`).set({ squadId: id, userId: 'parent', membershipStatus: 'active', squadRole: 'member' }),
    ref.update({ memberIds: ['manager-a', 'manager-b', 'parent'], memberCount: 3, currentSeasonId: 'season-a' }),
    db.doc('teams/team-preserved').set({ squadId: id, sportId: 'baseball', childIds: ['synthetic-child'] }),
    db.doc(`squads/${id}/seasons/season-a`).set({ name: 'Existing Season', totalStars: 42 }),
  ]);
  const before = (await ref.get()).data();
  const unchanged = Object.fromEntries(Object.entries(before).filter(([key]) => !['sportIds', 'sportId', 'sport', 'sportDisplayName', 'sportsRevision', 'updatedAt', 'sportsUpdatedBy'].includes(key)));
  await denied(save(id, ['baseball'], 0, 'parent'));
  await denied(save(id, ['baseball'], 0, 'outsider'));
  await assert.rejects(save(id, []), (error) => error.code === 'invalid-argument');
  await assert.rejects(save(id, ['cricket']), (error) => error.code === 'invalid-argument');
  await assert.rejects(update.run({ squadId: id, sportIds: ['baseball'], expectedRevision: 0 }, context('manager-a', false)), (error) => error.code === 'failed-precondition');
  await denied(update.run({ squadId: id, sportIds: ['baseball'], expectedRevision: 0 }, context('manager-a', true, 'anonymous')));
  await db.doc('accountStanding/manager-a').set({ status: 'suspended' }); await denied(save(id, ['baseball'])); await db.doc('accountStanding/manager-a').delete();
  const result = await save(id, ['swimming', 'basketball', 'baseball']);
  assert.equal(result.sportsRevision, 1);
  assert.deepEqual(result.sportIds, ['baseball', 'basketball', 'swimming']);
  await assert.rejects(save(id, ['tennis'], 0, 'manager-b'), (error) => error.code === 'aborted');
  assert.equal((await save(id, result.sportIds, 1)).sportsRevision, 1, 'No-op save does not consume a revision');
  const after = (await ref.get()).data();
  assert.deepEqual(Object.fromEntries(Object.entries(after).filter(([key]) => Object.hasOwn(unchanged, key))), unchanged);
  assert.deepEqual((await db.doc('teams/team-preserved').get()).data(), { squadId: id, sportId: 'baseball', childIds: ['synthetic-child'] });
  assert.equal((await db.doc(`squads/${id}/seasons/season-a`).get()).data().totalStars, 42);
  const changed = await save(id, ['tennis'], 1);
  assert.equal(changed.sportId, 'tennis'); assert.equal(changed.sportsRevision, 2);
  const { getSquadAdministration } = require('../functions/lib/squadAdmin');
  const administration = await getSquadAdministration.run({ squadId: id }, context('manager-a'));
  assert.deepEqual(administration.sportIds, ['tennis']); assert.equal(administration.sportsRevision, 2);
  assert.equal(administration.callerIsAdmin, true);
  assert.equal((await getSquadAdministration.run({ squadId: id }, context('parent'))).callerIsAdmin, false);
  await db.doc(`squadMemberships/${id}__manager-a`).update({ membershipStatus: 'left' });
  await denied(save(id, ['soccer'], 2));
  await db.doc(`squadMemberships/${id}__manager-a`).update({ membershipStatus: 'active' });
  assert.equal((await make()).squadId, id, 'Removing the primary sport never changes community identity');

  const legacyInput = { ...input, venueName: 'Synthetic Legacy Venue', latitude: 29, longitude: -82 };
  const legacyId = `${canonicalVenueId(legacyInput.venueName, 29, -82)}__baseball`;
  const legacy = { venueId: canonicalVenueId(legacyInput.venueName, 29, -82), venueName: legacyInput.venueName, venueLocation: new admin.firestore.GeoPoint(29, -82), venueGeohash: geohashForLocation([29, -82]), isActive: true, sportId: 'baseball', createdBy: 'legacy-manager', memberIds: ['legacy-manager'], memberCount: 1 };
  await db.doc(`squads/${legacyId}`).set(legacy);
  assert.equal((await make(legacyInput)).squadId, legacyId, 'Single legacy Squad is adopted with its original ID');
  assert.deepEqual((await db.doc(`squads/${legacyId}`).get()).data(), legacy);
  await db.doc('squadMemberships/legacy-noncanonical').set({ userId: 'legacy-manager', squadId: legacyId, membershipStatus: 'active' });
  assert.equal((await save(legacyId, ['baseball', 'swimming'], 0, 'legacy-manager')).sportsRevision, 1);
  await db.doc('squadMemberships/legacy-noncanonical').update({ squadRole: 'member' });
  await denied(save(legacyId, ['baseball'], 1, 'legacy-manager'));
  await db.doc(`squads/another-legacy`).set({ ...legacy, sportId: 'soccer' });
  await assert.rejects(make(legacyInput), (error) => error.details?.reason === 'duplicate-candidates');
  await assert.rejects(make({ ...input, venueId: 'forged-venue' }), (error) => error.code === 'invalid-argument');
  const privateInput = { ...input, venueName: 'Synthetic Private Venue', latitude: 30, longitude: -83 };
  await db.doc('squads/private-existing').set({ ...legacy, venueId: canonicalVenueId(privateInput.venueName, 30, -83), venueName: privateInput.venueName, venueLocation: new admin.firestore.GeoPoint(30, -83), venueGeohash: geohashForLocation([30, -83]), visibility: 'private' });
  assert.notEqual((await make(privateInput)).squadId, 'private-existing', 'Public creation does not disclose or reuse private Squads');
  await denied(create.run(input, { auth: { uid: 'anonymous', token: { firebase: { sign_in_provider: 'anonymous' } } } }));
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const environment = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: fs.readFileSync('firestore.rules', 'utf8') } });
  try {
    const client = environment.authenticatedContext('manager-a', { firebase: { sign_in_provider: 'password' } }).firestore();
    await assertFails(getDoc(doc(client, `venueSquadDirectory/${canonicalVenueId(input.venueName, input.latitude, input.longitude)}`)));
    await assertFails(setDoc(doc(client, 'venueSquadDirectory/forged'), { squadId: id }));
    await assertFails(updateDoc(doc(client, `squads/${id}`), { sportIds: ['soccer'] }));
  } finally { await environment.cleanup(); }
  console.log('Multi-sport local emulator passed: concurrent creation, legacy compatibility, manager authorization, revision conflicts, private data, and member/team/score preservation.');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { clearTimeout(timeout); });
