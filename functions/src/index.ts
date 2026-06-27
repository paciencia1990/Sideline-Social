/**
 * Sideline Squad — Firebase Cloud Functions
 *
 * Deploy: cd functions && npm install && npm run build && firebase deploy --only functions
 *
 * Functions:
 *  1. updateActiveMemberCount — triggered on squadMemberships writes
 *  2. deactivateInactiveMembers — scheduled daily at 02:00 UTC
 */

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

admin.initializeApp();

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// 1. updateActiveMemberCount
//    Triggered whenever a squadMemberships document is created or updated.
//    Counts members with lastActiveAt within the past 3 hours and updates
//    the parent squad's activeMemberCount + lastActivityAt.
// ---------------------------------------------------------------------------

export const updateActiveMemberCount = functions.firestore
  .document('squadMemberships/{membershipId}')
  .onWrite(async (change) => {
    // Determine squadId from the written document
    const afterData = change.after.exists ? change.after.data() : null;
    const beforeData = change.before.exists ? change.before.data() : null;
    const squadId: string | undefined = (afterData ?? beforeData)?.squadId;

    if (!squadId) {
      console.warn('[updateActiveMemberCount] No squadId found on document — skipping.');
      return null;
    }

    const threeHoursAgo = Date.now() - THREE_HOURS_MS;

    const snapshot = await admin
      .firestore()
      .collection('squadMemberships')
      .where('squadId', '==', squadId)
      .where('isActive', '==', true)
      .where('lastActiveAt', '>=', threeHoursAgo)
      .get();

    const activeMemberCount = snapshot.size;
    const lastActivityAt = activeMemberCount > 0 ? Date.now() : undefined;

    const update: Record<string, unknown> = { activeMemberCount };
    if (lastActivityAt) update.lastActivityAt = lastActivityAt;

    await admin.firestore().collection('squads').doc(squadId).update(update);

    console.log(
      `[updateActiveMemberCount] Squad ${squadId} — activeMemberCount set to ${activeMemberCount}`
    );
    return null;
  });

// ---------------------------------------------------------------------------
// 3. activateWeeklyChallenge
//    Scheduled Monday 12:00 AM ET — activate new weekly challenge.
// ---------------------------------------------------------------------------

export const activateWeeklyChallenge = functions.pubsub
  .schedule('0 5 * * 1') // 5 AM UTC = midnight ET
  .timeZone('America/New_York')
  .onRun(async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    const batch = db.batch();

    // Deactivate all currently active challenges
    const activeSnap = await db.collection('challenges').where('isActive', '==', true).get();
    activeSnap.docs.forEach((doc) => batch.update(doc.ref, { isActive: false }));

    // Activate challenge where weekStart <= now <= weekEnd
    const newChallengeSnap = await db
      .collection('challenges')
      .where('weekStart', '<=', now)
      .orderBy('weekStart', 'desc')
      .limit(5)
      .get();

    const toActivate = newChallengeSnap.docs.find((doc) => {
      const data = doc.data();
      return data.weekEnd.toDate() >= now.toDate();
    });

    if (toActivate) {
      batch.update(toActivate.ref, { isActive: true });
    }

    await batch.commit();
    console.log('Weekly challenge activated:', toActivate?.id ?? 'none found');
    return null;
  });

// ---------------------------------------------------------------------------
// 4. sendWeeklyChallengeNotification
//    Scheduled Monday 8:00 AM ET — notify all users of new challenge.
// ---------------------------------------------------------------------------

export const sendWeeklyChallengeNotification = functions.pubsub
  .schedule('0 13 * * 1') // 1 PM UTC = 8 AM ET
  .timeZone('America/New_York')
  .onRun(async () => {
    const db = admin.firestore();
    const messaging = admin.messaging();

    // Get active challenge
    const challengeSnap = await db.collection('challenges').where('isActive', '==', true).limit(1).get();
    if (challengeSnap.empty) return null;
    const challenge = challengeSnap.docs[0].data();

    // Get all users with FCM tokens
    const usersSnap = await db.collection('users').where('fcmToken', '!=', null).get();
    const tokens = usersSnap.docs.map((d) => d.data().fcmToken).filter(Boolean) as string[];

    if (tokens.length === 0) return null;

    // Send in batches of 500 (FCM limit)
    for (let i = 0; i < tokens.length; i += 500) {
      const batchTokens = tokens.slice(i, i + 500);
      await messaging.sendEachForMulticast({
        tokens: batchTokens,
        notification: {
          title: 'New Weekly Challenge! 🌟',
          body: (challenge.title as string) || 'A new challenge is available',
        },
        data: { type: 'new_challenge', challengeId: challengeSnap.docs[0].id },
      });
    }
    return null;
  });

// ---------------------------------------------------------------------------
// 5. FCM Triggers
// ---------------------------------------------------------------------------

export const onFriendRequestCreated = functions.firestore
  .document('friendRequests/{requestId}')
  .onCreate(async (snap) => {
    const request = snap.data();
    const db = admin.firestore();
    const messaging = admin.messaging();

    const targetUserDoc = await db.collection('users').doc(request.toUserId).get();
    const fcmToken = targetUserDoc.data()?.fcmToken;
    if (!fcmToken) return null;

    await messaging.send({
      token: fcmToken,
      notification: {
        title: 'New Friend Request 👋',
        body: `${request.fromDisplayName} wants to connect on Sideline Squad`,
      },
      data: { type: 'friend_request', fromUserId: request.fromUserId },
    });
    return null;
  });

export const onFriendRequestAccepted = functions.firestore
  .document('friendRequests/{requestId}')
  .onUpdate(async (change) => {
    const before = change.before.data();
    const after = change.after.data();
    if (before.status !== 'pending' || after.status !== 'accepted') return null;

    const db = admin.firestore();
    const messaging = admin.messaging();

    const requesterDoc = await db.collection('users').doc(after.fromUserId).get();
    const fcmToken = requesterDoc.data()?.fcmToken;
    if (!fcmToken) return null;

    await messaging.send({
      token: fcmToken,
      notification: {
        title: 'Friend Request Accepted! 🎉',
        body: `${after.toDisplayName} is now your Sideline Squad friend`,
      },
      data: { type: 'friend_accepted', fromUserId: after.toUserId },
    });
    return null;
  });

export const onSquadMemberJoined = functions.firestore
  .document('squadMemberships/{membershipId}')
  .onCreate(async (snap) => {
    const membership = snap.data();
    if (!membership.isActive) return null;

    const db = admin.firestore();
    const messaging = admin.messaging();

    // Get squad
    const squadDoc = await db.collection('squads').doc(membership.squadId).get();
    const squad = squadDoc.data();
    if (!squad) return null;

    // Get other member FCM tokens
    const memberIds: string[] = (squad.memberIds || []).filter((id: string) => id !== membership.userId);
    if (memberIds.length === 0) return null;

    const tokenPromises = memberIds.slice(0, 50).map((uid: string) => db.collection('users').doc(uid).get());
    const memberDocs = await Promise.all(tokenPromises);
    const tokens = memberDocs.map((d) => d.data()?.fcmToken).filter(Boolean) as string[];

    if (tokens.length === 0) return null;

    await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: `New member in ${squad.name}! 👥`,
        body: `Someone just joined your squad`,
      },
      data: { type: 'squad_member_joined', squadId: membership.squadId },
    });
    return null;
  });

// ---------------------------------------------------------------------------
// 2. deactivateInactiveMembers
//    Runs daily at 02:00 UTC.
//    Finds squadMembership records where lastActiveAt is older than 24 hours
//    and sets isActive = false (batch writes in chunks of 500).
// ---------------------------------------------------------------------------

export const deactivateInactiveMembers = functions.pubsub
  .schedule('0 2 * * *') // cron: every day at 02:00 UTC
  .timeZone('UTC')
  .onRun(async () => {
    const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;

    const snapshot = await admin
      .firestore()
      .collection('squadMemberships')
      .where('isActive', '==', true)
      .where('lastActiveAt', '<', cutoff)
      .get();

    if (snapshot.empty) {
      console.log('[deactivateInactiveMembers] No inactive memberships found.');
      return null;
    }

    // Firestore batch is limited to 500 ops — chunk it
    const BATCH_LIMIT = 499;
    const docs = snapshot.docs;
    let processed = 0;

    for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
      const chunk = docs.slice(i, i + BATCH_LIMIT);
      const batch = admin.firestore().batch();
      chunk.forEach((doc) => batch.update(doc.ref, { isActive: false }));
      await batch.commit();
      processed += chunk.length;
    }

    console.log(`[deactivateInactiveMembers] Deactivated ${processed} memberships.`);
    return null;
  });

// ---------------------------------------------------------------------------
// 6. awardGameStars
//    Firestore trigger — when a gameSessions document status changes to
//    'completed', award Sideline Stars to all winning players in Firestore.
//    Note: gameSessions live in Realtime DB, so we use an HTTPS callable
//    function that game clients invoke on completion instead.
// ---------------------------------------------------------------------------

export const awardGameStars = functions.https.onCall(async (data) => {
  const { sessionId, gameType, players } = data as {
    sessionId: string;
    gameType: string;
    players: Record<string, { score: number; displayName: string }>;
  };

  if (!sessionId || !gameType || !players) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing required fields.');
  }

  const STARS_PER_GAME: Record<string, number> = {
    bomb_defusal: 300,
    spot_difference: 200,
    trivia_blitz: 150,
  };

  const starsBase = STARS_PER_GAME[gameType] ?? 150;
  const db = admin.firestore();
  const batch = db.batch();

  await Promise.all(
    Object.entries(players).map(async ([userId, playerData]) => {
      const userRef = db.collection('users').doc(userId);
      const snap = await userRef.get();
      if (!snap.exists) return;
      const current = (snap.data()?.sidelineStars as number) ?? 0;
      batch.update(userRef, {
        sidelineStars: current + starsBase,
        [`gameStats.${gameType}.gamesPlayed`]: admin.firestore.FieldValue.increment(1),
        [`gameStats.${gameType}.totalScore`]: admin.firestore.FieldValue.increment(playerData.score),
      });

      // Write activity entry
      const activityRef = db.collection('activity').doc();
      batch.set(activityRef, {
        type: 'play_game',
        userId,
        displayName: playerData.displayName,
        avatarUrl: null,
        squadId: null,
        message: `${playerData.displayName} played ${gameType.replace('_', ' ')}!`,
        message_es: `${playerData.displayName} jugó ${gameType.replace('_', ' ')}!`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    })
  );

  await batch.commit();
  console.log(`[awardGameStars] Stars awarded for session ${sessionId}`);
  return { success: true, starsAwarded: starsBase };
});

// ---------------------------------------------------------------------------
// 7. cleanupExpiredGameSessions
//    Scheduled every 10 minutes — removes Realtime DB game sessions that
//    have been completed/failed for more than 5 minutes.
// ---------------------------------------------------------------------------

export const cleanupExpiredGameSessions = functions.pubsub
  .schedule('every 10 minutes')
  .onRun(async () => {
    const rtdb = admin.database();
    const cutoff = Date.now() - 5 * 60 * 1000; // 5 minutes ago

    const snap = await rtdb.ref('/gameSessions').once('value');
    if (!snap.exists()) return null;

    const sessions = snap.val() as Record<string, { status: string; completedAt: number | null }>;
    const toDelete: string[] = [];

    Object.entries(sessions).forEach(([id, session]) => {
      if (
        (session.status === 'completed' || session.status === 'failed') &&
        session.completedAt &&
        session.completedAt < cutoff
      ) {
        toDelete.push(id);
      }
    });

    await Promise.all(toDelete.map((id) => rtdb.ref(`/gameSessions/${id}`).remove()));
    console.log(`[cleanupExpiredGameSessions] Removed ${toDelete.length} expired sessions.`);
    return null;
  });