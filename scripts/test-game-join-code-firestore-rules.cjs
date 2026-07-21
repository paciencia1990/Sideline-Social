const fs = require('node:fs');
const path = require('node:path');
const { assertFails, initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { collection, doc, getDoc, getDocs, setDoc, updateDoc } = require('firebase/firestore');

const projectId = 'sideline-game-join-code-rules-test';
const rules = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');

async function run() {
  const testEnv = await initializeTestEnvironment({ projectId, firestore: { rules } });
  try {
    await testEnv.clearFirestore();
    const authDb = testEnv.authenticatedContext('user-a').firestore();
    const anonDb = testEnv.unauthenticatedContext().firestore();
    for (const collectionName of ['gameJoinCodes', 'gameJoinSessionLinks', 'gameJoinRequests', 'gameJoinRateLimits']) {
      await assertFails(getDoc(doc(authDb, collectionName, collectionName === 'gameJoinCodes' ? '7KPM' : `private-${collectionName === 'gameJoinSessionLinks' ? 'link' : collectionName === 'gameJoinRequests' ? 'request' : 'rate'}`)));
      await assertFails(getDocs(collection(authDb, collectionName)));
      await assertFails(setDoc(doc(authDb, collectionName, 'client-write'), { code: 'R4GX' }));
      await assertFails(updateDoc(doc(authDb, collectionName, collectionName === 'gameJoinCodes' ? '7KPM' : 'private-link'), { code: '9TWB' }));
      await assertFails(getDocs(collection(anonDb, collectionName)));
    }
    console.log('Game Join Code Firestore registry deny rules tests passed.');
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
