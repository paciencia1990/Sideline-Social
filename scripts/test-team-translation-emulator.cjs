'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const admin = require('../functions/node_modules/firebase-admin');
const projectId = process.env.GCLOUD_PROJECT;
assert.ok(projectId?.startsWith('demo-') && process.env.FIRESTORE_EMULATOR_HOST, 'Local isolated Firestore emulator required');
admin.initializeApp({ projectId });
const { loadAuthorizedTranslationText: load, reserveTranslationCharacters: reserve, translateTeamMessage: callable } = require('../functions/lib/teamTranslation');
const { createTranslationEngine } = require('../functions/lib/teamTranslationCore');
const db = admin.firestore();
const request = { kind: 'announcement', teamId: 'team-a', messageId: 'notice', targetLanguage: 'es', consentVersion: 1 };
const team = db.doc('teams/team-a');
const message = team.collection('announcements').doc('notice');
const member = team.collection('members').doc('parent-a');
const conversation = db.doc('teamPrivateConversations/conversation-a');
const privateMessage = conversation.collection('messages').doc('coach-message');
const privateRequest = { kind: 'privateMessage', conversationId: 'conversation-a', messageId: 'coach-message', targetLanguage: 'es', consentVersion: 1 };
const denied = (promise) => assert.rejects(promise, (error) => error.code === 'permission-denied');
const timeout = setTimeout(() => { console.error('Local translation emulator timed out.'); process.exit(1); }, 45000);
(async () => {
  await Promise.all([
    team.set({ status: 'active', inviteCode: 'SCYTYR' }),
    member.set({ status: 'active', roles: { parent: true } }),
    message.set({ title: ' Practice ', body: ' Meet at 6 PM. Code SCYTYR. ', audience: 'parents', createdBy: 'coach-a' }),
    conversation.set({ teamId: 'team-a', participantUserIds: ['coach-a', 'parent-a'], coachUserId: 'coach-a', parentUserId: 'parent-a' }),
    privateMessage.set({ teamId: 'team-a', senderUserId: 'coach-a', senderRole: 'coach', contentType: 'text', text: 'Please bring water.' }),
  ]);
  assert.equal((await load('parent-a', request)).text, 'Practice\n\nMeet at 6 PM. Code SCYTYR.');
  await denied(load('outsider', request));
  await message.update({ audience: 'staff' }); await denied(load('parent-a', request)); await message.update({ audience: 'parents' });
  await message.update({ moderationState: 'hidden' }); await denied(load('parent-a', request)); await message.update({ moderationState: 'visible' });
  await message.update({ isDeleted: true }); await denied(load('parent-a', request)); await message.update({ isDeleted: false });
  await member.update({ status: 'inactive' }); await denied(load('parent-a', request)); await member.update({ status: 'active' });
  await team.update({ status: 'archived' }); await denied(load('parent-a', request)); await team.update({ status: 'active' });
  await db.doc('accountStanding/parent-a').set({ status: 'suspended' }); await denied(load('parent-a', request));
  await db.doc('accountStanding/parent-a').set({ status: 'active', messagingRestricted: true });
  assert.ok((await load('parent-a', request)).text, 'Read translation remains available during messaging restriction');
  await db.doc('accountStanding/parent-a').delete();
  assert.equal((await load('parent-a', privateRequest)).text, 'Please bring water.');
  await denied(load('coach-a', privateRequest)); await denied(load('outsider', privateRequest));
  const hidden = conversation.collection('members').doc('parent-a').collection('hiddenMessages').doc('coach-message');
  await hidden.set({ hidden: true }); await denied(load('parent-a', privateRequest)); await hidden.delete();
  await privateMessage.update({ moderationState: 'removed' }); await denied(load('parent-a', privateRequest));
  await privateMessage.update({ moderationState: 'visible', contentType: 'voice', caption: ' Meet by the gate. ', text: null });
  assert.equal((await load('parent-a', privateRequest)).text, 'Meet by the gate.');
  await privateMessage.update({ caption: '' }); await denied(load('parent-a', privateRequest));
  await privateMessage.update({ caption: 'Meet by the gate.' });
  const engine = createTranslationEngine({ load, reserve: async () => {}, translate: async (texts) => { await message.update({ moderationState: 'hidden' }); return texts; } });
  await denied(engine('parent-a', request));
  process.env.TEAM_TRANSLATION_MONTHLY_CHAR_LIMIT = '90';
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, (_value, index) => reserve(`quota-user-${index}`, 30)));
  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 3, 'Concurrent reservations never exceed monthly cap');
  assert.equal((await db.doc('teamTranslationUsage/current').get()).data().characters, 90);
  assert.ok(outcomes.filter((item) => item.status === 'rejected').every((item) => item.reason.code === 'resource-exhausted'));
  await db.doc('teamTranslationUsage/current').delete(); process.env.TEAM_TRANSLATION_MONTHLY_CHAR_LIMIT = '500000';
  await reserve('daily-user', 20_000); await assert.rejects(reserve('daily-user', 1), (error) => error.code === 'resource-exhausted');
  for (let count = 0; count < 10; count++) await reserve('minute-user', 1);
  await assert.rejects(reserve('minute-user', 1), (error) => error.code === 'resource-exhausted');
  const counter = db.doc('users/minute-user/translationUsage/current');
  assert.deepEqual(Object.keys((await counter.get()).data()).sort(), ['characters', 'day', 'minute', 'requests']);
  await db.recursiveDelete(db.doc('users/minute-user')); assert.equal((await counter.get()).exists, false);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const environment = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: fs.readFileSync('firestore.rules', 'utf8') } });
  try {
    const parentDb = environment.authenticatedContext('parent-a').firestore();
    await assertFails(getDoc(doc(parentDb, 'users/parent-a/translationUsage/current')));
    await assertFails(setDoc(doc(parentDb, 'users/parent-a/translationUsage/current'), { characters: 0 }));
    await assertFails(getDoc(doc(parentDb, 'teamTranslationUsage/current')));
    await assertFails(setDoc(doc(parentDb, 'teamTranslationUsage/current'), { characters: 0 }));
  } finally { await environment.cleanup(); }
  await assert.rejects(callable.run(request, { auth: { uid: 'parent-a', token: {} } }), (error) => error.code === 'failed-precondition');
  await assert.rejects(callable.run(request, { app: { appId: 'demo-app' }, auth: null }), (error) => error.code === 'unauthenticated');
  await assert.rejects(callable.run(request, {
    app: { appId: 'demo-app' },
    auth: { uid: 'parent-a', token: { firebase: { sign_in_provider: 'anonymous' } } },
  }), (error) => error.code === 'permission-denied' && error.details?.reason === 'permanent_account_required', 'Verified app context cannot grant translation to an anonymous account');
  await assert.rejects(callable.run(request, { app: { appId: 'demo-app' }, auth: { uid: 'parent-a', token: {} } }), (error) => error.code === 'unavailable');
  console.log('Translation emulator: authorized received text/captions, audience, membership, standing, takedown, hidden messages, concurrent budget and account-counter deletion passed. No provider calls.');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { clearTimeout(timeout); await admin.app().delete(); });
