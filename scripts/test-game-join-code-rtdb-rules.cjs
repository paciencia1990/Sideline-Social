const fs = require('node:fs');
const path = require('node:path');
const admin = require('../functions/node_modules/firebase-admin');
const { assertFails, assertSucceeds, initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { equalTo, get, orderByChild, query, ref, set, update } = require('firebase/database');

const projectId = 'sideline-game-join-code-rtdb-rules-test';
const rules = fs.readFileSync(path.join(process.cwd(), 'database.rules.json'), 'utf8');
if (!admin.apps.length) admin.initializeApp({ projectId, databaseURL: `https://${projectId}.firebaseio.com` });

async function run() {
  const testEnv = await initializeTestEnvironment({ projectId, database: { rules } });
  try {
    await testEnv.clearDatabase();
    await Promise.all([
      admin.database().ref('gameSessions/session-a').set({
        sessionId: 'session-a', gameType: 'bomb_defusal', squadId: 'squad-a', hostUserId: 'host',
        players: { host: { displayName: 'Host', isReady: false }, player: { displayName: 'Player', isReady: false } },
        status: 'lobby',
      }),
      admin.database().ref('sessions/legacy').set({ joinCode: 'LOCAL' }),
    ]);
    const hostDb = testEnv.authenticatedContext('host').database();
    const playerDb = testEnv.authenticatedContext('player').database();
    const outsiderDb = testEnv.authenticatedContext('outsider').database();
    const anonDb = testEnv.unauthenticatedContext().database();

    await assertSucceeds(get(ref(hostDb, 'gameSessions/session-a')));
    await assertSucceeds(get(ref(playerDb, 'gameSessions/session-a')));
    await assertFails(get(ref(outsiderDb, 'gameSessions/session-a')));
    await assertFails(get(ref(anonDb, 'gameSessions/session-a')));
    await assertFails(get(query(ref(outsiderDb, 'gameSessions'), orderByChild('joinCode'), equalTo('7KPM'))));
    await assertFails(get(ref(outsiderDb, 'gameSessions')));
    await assertFails(set(ref(outsiderDb, 'gameSessions/session-a/players/outsider'), { displayName: 'Outsider' }));
    await assertSucceeds(update(ref(playerDb, 'gameSessions/session-a/players/player'), { isReady: true }));
    await assertFails(get(ref(hostDb, 'sessions/legacy')));
    await assertFails(set(ref(hostDb, 'sessions/new/joinCode'), '7KPM'));

    console.log('Game Join Code Realtime Database authorization and legacy-session deny rules tests passed.');
  } finally {
    await testEnv.cleanup();
    await admin.app().delete();
  }
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
