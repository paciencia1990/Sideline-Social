const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const admin = require('../functions/node_modules/firebase-admin');
const { assertFails, assertSucceeds, initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { equalTo, get, orderByChild, query, ref, set, update } = require('firebase/database');

const projectId = 'sideline-game-join-code-rtdb-rules-test';
const rules = fs.readFileSync(path.join(process.cwd(), 'database.rules.json'), 'utf8');
assert.match(rules, /"\.indexOn"\s*:\s*\["squadId"\]/, 'the trusted active-session query keeps its Squad index');
if (!admin.apps.length) admin.initializeApp({ projectId, databaseURL: `https://${projectId}.firebaseio.com` });

async function run() {
  const testEnv = await initializeTestEnvironment({ projectId, database: { rules } });
  try {
    await testEnv.clearDatabase();
    const now = Date.now();
    await Promise.all([
      admin.database().ref('gameSessions/session-a').set({
        sessionId: 'session-a', gameType: 'bomb_defusal', squadId: 'squad-a', hostUserId: 'host',
        players: {
          host: { displayName: 'Host', isReady: false },
          player: { displayName: 'Player', isReady: false },
          restricted: { displayName: 'Restricted', isReady: false },
          suspended: { displayName: 'Suspended', isReady: false },
        },
        status: 'lobby',
        expiresAt: Date.now() + 60_000,
      }),
      admin.database().ref('gameSessions/session-expired').set({
        sessionId: 'session-expired', gameType: 'bomb_defusal', squadId: 'squad-a', hostUserId: 'host',
        players: { host: { displayName: 'Host', isReady: true }, player: { displayName: 'Player', isReady: true } },
        status: 'lobby',
        expiresAt: Date.now() - 1_000,
      }),
      admin.database().ref('gameSessionSecrets/session-a').set({
        expiresAt: Date.now() + 60_000,
        bombSteps: [{ type: 'cut_wire', color: 'blue' }],
      }),
      admin.database().ref('gameSessions/session-legacy-sequence').set({
        sessionId: 'session-legacy-sequence', gameType: 'bomb_defusal', hostUserId: 'host',
        players: { host: { displayName: 'Host' }, player: { displayName: 'Player' } },
        status: 'active',
        expiresAt: now + 600_000,
        gameState: { bombSteps: [{ type: 'cut_wire', color: 'blue' }] },
      }),
      admin.database().ref('gameSessions/session-results-grace').set({
        sessionId: 'session-results-grace', gameType: 'bomb_defusal', hostUserId: 'host',
        players: { host: { displayName: 'Host' }, player: { displayName: 'Player' } },
        status: 'completed',
        completedAt: now - 1000,
        expiresAt: now + 600_000,
      }),
      admin.database().ref('gameSessions/session-results-stale').set({
        sessionId: 'session-results-stale', gameType: 'bomb_defusal', hostUserId: 'host',
        players: { host: { displayName: 'Host' }, player: { displayName: 'Player' } },
        status: 'completed',
        completedAt: now - 301_000,
        expiresAt: now + 600_000,
      }),
      admin.database().ref('gameSessions/spot-team-session').set({
        sessionId: 'spot-team-session', gameType: 'spot_difference', squadId: 'squad-a', hostUserId: 'host',
        players: {
          host: { displayName: 'Host', isReady: true, teamId: 'A' },
          player: { displayName: 'Player', isReady: true, teamId: 'B' },
        },
        status: 'active',
        expiresAt: now + 600_000,
      }),
      admin.database().ref('gameSessionTeamState/spot-team-session/A').set({
        teamId: 'A',
        foundDifferenceIds: ['difference_01'],
        foundCount: 1,
        expiresAt: now + 600_000,
      }),
      admin.database().ref('gameSessionTeamState/spot-team-session/B').set({
        teamId: 'B',
        foundDifferenceIds: ['difference_02'],
        foundCount: 1,
        expiresAt: now + 600_000,
      }),
      admin.database().ref('gameSessions/spot-results-session').set({
        sessionId: 'spot-results-session', gameType: 'spot_difference', squadId: 'squad-a', hostUserId: 'host',
        players: {
          host: { displayName: 'Host', isReady: true, teamId: 'A' },
          player: { displayName: 'Player', isReady: true, teamId: 'B' },
        },
        status: 'completed',
        completedAt: now - 1000,
        expiresAt: now + 600_000,
      }),
      admin.database().ref('gameSessionTeamState/spot-results-session/B').set({
        teamId: 'B',
        foundDifferenceIds: ['difference_02'],
        foundCount: 1,
        expiresAt: now + 600_000,
      }),
      admin.database().ref('sessions/legacy').set({ joinCode: 'LOCAL' }),
      admin.database().ref('accountStanding/suspended').set({
        status: 'suspended',
        expiresAt: now + 60_000,
        revision: 1,
      }),
      admin.database().ref('accountStanding/restricted').set({
        status: 'messagingRestricted',
        expiresAt: null,
        revision: 1,
      }),
    ]);
    const permanentClaims = { firebase: { sign_in_provider: 'password' } };
    const anonymousClaims = { firebase: { sign_in_provider: 'anonymous' } };
    const hostDb = testEnv.authenticatedContext('host', permanentClaims).database();
    const playerDb = testEnv.authenticatedContext('player', permanentClaims).database();
    const outsiderDb = testEnv.authenticatedContext('outsider', permanentClaims).database();
    const anonymousDb = testEnv.authenticatedContext('anonymous-player', anonymousClaims).database();
    const suspendedDb = testEnv.authenticatedContext('suspended', permanentClaims).database();
    const restrictedDb = testEnv.authenticatedContext('restricted', permanentClaims).database();
    const signedOutDb = testEnv.unauthenticatedContext().database();

    await assertSucceeds(get(ref(hostDb, 'gameSessions/session-a')));
    await assertSucceeds(get(ref(playerDb, 'gameSessions/session-a')));
    await assertFails(get(ref(outsiderDb, 'gameSessions/session-a')));
    await assertFails(get(ref(anonymousDb, 'gameSessions/session-a')));
    await assertFails(get(ref(signedOutDb, 'gameSessions/session-a')));
    await assertFails(get(ref(suspendedDb, 'gameSessions/session-a')));
    await assertFails(get(ref(restrictedDb, 'gameSessions/session-a')));
    await assertFails(get(ref(hostDb, 'gameSessions/session-expired')));
    await assertFails(get(ref(playerDb, 'gameSessions/session-expired/players/player')));
    await assertFails(get(ref(hostDb, 'gameSessions/session-legacy-sequence')));
    await assertFails(get(ref(playerDb, 'gameSessions/session-legacy-sequence')));
    await assertSucceeds(get(ref(hostDb, 'gameSessions/session-results-grace')));
    await assertSucceeds(get(ref(playerDb, 'gameSessions/session-results-grace')));
    await assertFails(get(ref(hostDb, 'gameSessions/session-results-stale')));
    await assertFails(get(ref(playerDb, 'gameSessions/session-results-stale')));
    await assertSucceeds(get(ref(hostDb, 'gameSessionTeamState/spot-team-session/A')));
    await assertFails(get(ref(hostDb, 'gameSessionTeamState/spot-team-session/B')));
    await assertSucceeds(get(ref(playerDb, 'gameSessionTeamState/spot-team-session/B')));
    await assertFails(get(ref(playerDb, 'gameSessionTeamState/spot-team-session/A')));
    await assertFails(get(ref(outsiderDb, 'gameSessionTeamState/spot-team-session/A')));
    await assertSucceeds(get(ref(hostDb, 'gameSessionTeamState/spot-results-session/B')));
    await assertFails(get(ref(signedOutDb, 'gameSessionTeamState/spot-results-session/B')));
    await assertFails(get(ref(hostDb, 'gameSessionSecrets/session-a')));
    await assertFails(get(ref(playerDb, 'gameSessionSecrets/session-a')));
    await assertFails(get(query(ref(hostDb, 'gameSessions'), orderByChild('squadId'), equalTo('squad-a'))));
    await assertFails(get(query(ref(outsiderDb, 'gameSessions'), orderByChild('joinCode'), equalTo('7KPM'))));
    await assertFails(get(ref(outsiderDb, 'gameSessions')));
    await assertFails(set(ref(outsiderDb, 'gameSessions/session-a/players/outsider'), { displayName: 'Outsider' }));
    await assertFails(update(ref(playerDb, 'gameSessions/session-a/players/player'), { isReady: true }));
    await assertFails(update(ref(hostDb, 'gameSessions/session-a'), { status: 'active' }));
    await assertFails(update(ref(anonymousDb, 'gameSessions/session-a/players/anonymous-player'), { isReady: true }));
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
