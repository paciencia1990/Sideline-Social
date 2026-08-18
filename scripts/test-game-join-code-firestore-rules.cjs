const fs = require('node:fs');
const path = require('node:path');
const { assertFails, assertSucceeds, initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { collection, doc, getDoc, getDocs, setDoc, updateDoc } = require('firebase/firestore');

const projectId = 'sideline-game-join-code-rules-test';
const rules = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');

async function run() {
  const testEnv = await initializeTestEnvironment({ projectId, firestore: { rules } });
  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const rulesDisabledDb = context.firestore();
      await setDoc(doc(rulesDisabledDb, 'gameStartStates', 'bombDefusal__session-a'), {
        schemaVersion: 1,
        gameType: 'bombDefusal',
        sessionId: 'session-a',
        startAttemptId: 'attempt-current',
        participantUserIds: ['user-a'],
      });
      await setDoc(doc(rulesDisabledDb, 'gameStartStates', 'bombDefusal__session-a', 'participants', 'user-a'), {
        uid: 'user-a',
        role: 'defuser',
        startAttemptId: 'attempt-current',
      });
    });
    const authDb = testEnv.authenticatedContext('user-a').firestore();
    const otherDb = testEnv.authenticatedContext('user-b').firestore();
    const anonDb = testEnv.unauthenticatedContext().firestore();
    for (const collectionName of [
      'gameJoinCodes',
      'gameJoinSessionLinks',
      'gameJoinRequests',
      'gameJoinRateLimits',
      'gameLobbyDirectories',
      'gameLobbyCreateRequests',
      'activeGameLobbyMemberships',
      'gameLobbyCreationRateLimits',
    ]) {
      await assertFails(getDoc(doc(authDb, collectionName, collectionName === 'gameJoinCodes' ? '7KPM' : `private-${collectionName === 'gameJoinSessionLinks' ? 'link' : collectionName === 'gameJoinRequests' ? 'request' : 'rate'}`)));
      await assertFails(getDocs(collection(authDb, collectionName)));
      await assertFails(setDoc(doc(authDb, collectionName, 'client-write'), { code: 'R4GX' }));
      await assertFails(updateDoc(doc(authDb, collectionName, collectionName === 'gameJoinCodes' ? '7KPM' : 'private-link'), { code: '9TWB' }));
      await assertFails(getDocs(collection(anonDb, collectionName)));
    }
    await assertSucceeds(getDoc(doc(authDb, 'gameStartStates', 'bombDefusal__session-a')));
    await assertFails(getDoc(doc(otherDb, 'gameStartStates', 'bombDefusal__session-a')));
    await assertFails(getDoc(doc(authDb, 'gameStartStates', 'bombDefusal__session-a', 'participants', 'user-a')));
    await assertFails(getDocs(collection(authDb, 'gameStartStates')));
    await assertFails(updateDoc(doc(authDb, 'gameStartStates', 'bombDefusal__session-a'), { phase: 'scheduled' }));
    await assertSucceeds(getDoc(doc(authDb, 'gameStartStates', 'bombDefusal__not-created')));
    await assertFails(getDoc(doc(anonDb, 'gameStartStates', 'bombDefusal__not-created')));
    console.log('Game Join Code Firestore registry deny rules tests passed.');
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
