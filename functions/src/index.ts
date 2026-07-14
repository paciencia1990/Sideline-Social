/**
 * Sideline Squad — Firebase Cloud Functions
 *
 * Deploy: cd functions && npm install && npm run build && firebase deploy --only functions
 *
 * Functions:
 *  1. updateActiveMemberCount — triggered on squadMemberships writes
 *  2. deactivateInactiveMembers — scheduled daily at 02:00 UTC
 */
import { createHash, randomInt } from 'node:crypto';

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {
  WEEKLY_CHALLENGES,
  getPreviousWeekKey,
  getWeekInfo,
  resolveTimeZone,
  selectWeeklyChallenge,
} from './weeklyChallengeCore';
import {
  activeLinkReferencesChild,
  allChildProfilesExist,
  canManageTeamRoles,
  hasParentRole,
  isTeamActive,
  isEligibleStaffRoleTarget,
  legacyRoleForMergedMembership,
  mergeChildIds,
  mergeParentRole,
  normalizeChildIds,
  removeParentRole,
  removeChildReference,
  setStaffRole,
} from './teamMembershipCore';

admin.initializeApp();

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const TEAM_INVITE_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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
// ---------------------------------------------------------------------------
// Weekly parent challenges
// Assignment and reward processing stay server-side so clients cannot choose
// challenge rewards or add Sideline Stars directly.
// ---------------------------------------------------------------------------

export const getCurrentWeeklyChallenge = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to view your weekly challenge.');

  const firestore = admin.firestore();
  const userRef = firestore.collection('users').doc(uid);
  const userSnapshot = await userRef.get();
  if (!userSnapshot.exists) throw new functions.https.HttpsError('failed-precondition', 'User profile not found.');

  const storedTimezone = userSnapshot.data()?.timezone;
  const requestedTimezone = typeof data?.timezone === 'string' ? data.timezone : null;
  const timezone = resolveTimeZone(typeof storedTimezone === 'string' ? storedTimezone : null, requestedTimezone);
  const { weekKey, nextWeekKey } = getWeekInfo(timezone);
  const assignmentRef = userRef.collection('weeklyChallenges').doc(weekKey);
  const previousRef = userRef.collection('weeklyChallenges').doc(getPreviousWeekKey(weekKey));

  const assignment = await firestore.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(assignmentRef);
    if (currentSnapshot.exists) return currentSnapshot.data()!;

    const previousSnapshot = await transaction.get(previousRef);
    const previousChallengeId = previousSnapshot.exists ? previousSnapshot.data()?.challengeId : null;
    const challenge = selectWeeklyChallenge(uid, weekKey, previousChallengeId);
    const record = {
      weekKey,
      challengeId: challenge.id,
      title: challenge.title,
      description: challenge.description,
      points: challenge.points,
      category: challenge.category,
      isActive: challenge.isActive,
      assignedAt: admin.firestore.FieldValue.serverTimestamp(),
      completed: false,
      completedAt: null,
      pointsAwarded: false,
      timezone,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    transaction.create(assignmentRef, record);
    return record;
  });

  return { challenge: serializeWeeklyChallenge(assignment, nextWeekKey) };
});

export const completeWeeklyChallenge = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to complete your weekly challenge.');
  const weekKey = typeof data?.weekKey === 'string' ? data.weekKey : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid weekly challenge key is required.');
  }

  const firestore = admin.firestore();
  const userRef = firestore.collection('users').doc(uid);
  const assignmentRef = userRef.collection('weeklyChallenges').doc(weekKey);
  const rewardId = `weeklyChallenge_${weekKey}`;
  const rewardRef = userRef.collection('rewardTransactions').doc(rewardId);
  const activityRef = firestore.collection('activity').doc(`${rewardId}_${uid}`);

  const result = await firestore.runTransaction(async (transaction) => {
    const assignmentSnapshot = await transaction.get(assignmentRef);
    const rewardSnapshot = await transaction.get(rewardRef);
    const userSnapshot = await transaction.get(userRef);
    if (!assignmentSnapshot.exists || !userSnapshot.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'Weekly challenge assignment not found.');
    }

    const assignment = assignmentSnapshot.data()!;
    const timezone = resolveTimeZone(typeof assignment.timezone === 'string' ? assignment.timezone : null);
    const currentWeek = getWeekInfo(timezone);
    if (currentWeek.weekKey !== weekKey) {
      throw new functions.https.HttpsError('failed-precondition', 'This weekly challenge is no longer active.');
    }

    const definition = WEEKLY_CHALLENGES.find((challenge) => challenge.id === assignment.challengeId && challenge.isActive);
    if (!definition) throw new functions.https.HttpsError('failed-precondition', 'Weekly challenge is not valid.');

    const currentStars = typeof userSnapshot.data()?.sidelineStars === 'number' ? userSnapshot.data()!.sidelineStars : 0;
    const alreadyCompleted = assignment.completed === true || assignment.pointsAwarded === true || rewardSnapshot.exists;
    if (alreadyCompleted) {
      if (assignment.completed !== true || assignment.pointsAwarded !== true) {
        transaction.update(assignmentRef, {
          completed: true,
          pointsAwarded: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      return {
        assignment: { ...assignment, completed: true, pointsAwarded: true },
        alreadyCompleted: true,
        pointsAwarded: 0,
        sidelineStars: currentStars,
        nextResetKey: currentWeek.nextWeekKey,
      };
    }

    const completedAt = admin.firestore.Timestamp.now();
    transaction.update(assignmentRef, {
      completed: true,
      completedAt,
      pointsAwarded: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.update(userRef, {
      sidelineStars: admin.firestore.FieldValue.increment(definition.points),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.create(rewardRef, {
      transactionId: rewardId,
      type: 'weekly_challenge',
      weekKey,
      challengeId: definition.id,
      points: definition.points,
      awardedAt: completedAt,
    });
    const displayName = userSnapshot.data()?.displayName || 'Sideline Parent';
    transaction.set(activityRef, {
      type: 'complete_challenge',
      userId: uid,
      displayName,
      avatarUrl: userSnapshot.data()?.photoURL ?? null,
      squadId: null,
      challengeId: definition.id,
      weekKey,
      message: `${displayName} completed this week's challenge!`,
      message_es: `¡${displayName} completó el reto de esta semana!`,
      createdAt: completedAt,
    });

    return {
      assignment: { ...assignment, completed: true, completedAt, pointsAwarded: true },
      alreadyCompleted: false,
      pointsAwarded: definition.points,
      sidelineStars: currentStars + definition.points,
      nextResetKey: currentWeek.nextWeekKey,
    };
  });

  return {
    challenge: serializeWeeklyChallenge(result.assignment, result.nextResetKey),
    alreadyCompleted: result.alreadyCompleted,
    pointsAwarded: result.pointsAwarded,
    sidelineStars: result.sidelineStars,
  };
});

// ---------------------------------------------------------------------------
// Private per-device notification tokens
// Tokens are never stored on broadly readable user profiles and are bound to
// the currently authenticated account by callable functions.
// ---------------------------------------------------------------------------

export const registerDeviceNotificationToken = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to register notifications.');

  const token = typeof data?.token === 'string' ? data.token.trim() : '';
  const platform = data?.platform;
  if (platform !== 'android' || token.length < 20 || token.length > 4096) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid Android notification token is required.');
  }

  const firestore = admin.firestore();
  const tokenId = createHash('sha256').update(token).digest('hex');
  await Promise.all([
    firestore.collection('notificationTokens').doc(tokenId).set({
      uid,
      token,
      platform,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }),
    // Remove the legacy profile fields if a development build ever wrote them.
    firestore.collection('users').doc(uid).set({
      fcmToken: admin.firestore.FieldValue.delete(),
      fcmTokenUpdatedAt: admin.firestore.FieldValue.delete(),
    }, { merge: true }),
  ]);

  return { registered: true };
});

export const unregisterDeviceNotificationToken = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to unregister notifications.');

  const token = typeof data?.token === 'string' ? data.token.trim() : '';
  if (token.length < 20 || token.length > 4096) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid notification token is required.');
  }

  const tokenId = createHash('sha256').update(token).digest('hex');
  const tokenRef = admin.firestore().collection('notificationTokens').doc(tokenId);
  const tokenSnapshot = await tokenRef.get();
  if (tokenSnapshot.exists && tokenSnapshot.data()?.uid === uid) {
    await tokenRef.delete();
    return { unregistered: true };
  }
  return { unregistered: false };
});

// ---------------------------------------------------------------------------
// Coach update notifications
// Delivery contains team and announcement identifiers only. Child identity
// stays in the parent's private Firestore area and is never sent through FCM.
// ---------------------------------------------------------------------------

export const notifyParentsOfTeamAnnouncement = functions.firestore
  .document('teams/{teamId}/announcements/{announcementId}')
  .onCreate(async (snapshot, context) => {
    const announcement = snapshot.data();
    if (announcement.audience !== 'parents' && announcement.audience !== 'all') return null;

    const teamId = context.params.teamId as string;
    const announcementId = context.params.announcementId as string;
    const firestore = admin.firestore();
    const teamSnapshot = await firestore.collection('teams').doc(teamId).get();
    if (!teamSnapshot.exists || !isTeamActive(teamSnapshot.data())) return null;
    const membersSnapshot = await firestore.collection('teams').doc(teamId).collection('members')
      .where('status', '==', 'active')
      .get();
    if (membersSnapshot.empty) return null;

    // Lock-screen copy is intentionally generic. The authenticated destination
    // reloads the team and announcement after membership rules are rechecked.
    const title = 'New team update';
    const body = 'Open Sideline Social to view it.';
    const deliveries = await Promise.allSettled(
      membersSnapshot.docs.map(async (memberSnapshot) => {
        const member = memberSnapshot.data();
        if (!hasParentRole(member)) return;
        const tokenSnapshot = await firestore.collection('notificationTokens')
          .where('uid', '==', memberSnapshot.id)
          .get();
        if (tokenSnapshot.empty) return;

        await Promise.all(tokenSnapshot.docs.map(async (tokenDocument) => {
          const token = tokenDocument.data()?.token;
          if (typeof token !== 'string' || !token) return;

          try {
            await admin.messaging().send({
              token,
              notification: { title, body },
              data: {
                type: 'coach_update',
                teamId,
                announcementId,
                route: '/teams/' + teamId + '/announcements/' + announcementId,
              },
              android: {
                notification: {
                  channelId: 'coach-updates',
                },
              },
            });
          } catch (error) {
            const code = typeof error === 'object' && error && 'code' in error
              ? String(error.code)
              : '';
            if (
              code === 'messaging/registration-token-not-registered' ||
              code === 'messaging/invalid-registration-token'
            ) {
              await tokenDocument.ref.delete();
            }
            throw error;
          }
        }));
      }),
    );

    const failures = deliveries.filter((delivery) => delivery.status === 'rejected');
    if (failures.length > 0) {
      console.warn('[notifyParentsOfTeamAnnouncement] delivery failures', {
        failures: failures.length,
        teamId,
        announcementId,
      });
    }
    return null;
  });
// ---------------------------------------------------------------------------
// Parent team invite joining
// Invite codes are resolved server-side because private team rules intentionally
// prohibit clients from listing or querying the teams collection.
// ---------------------------------------------------------------------------

export const joinParentTeamByInviteCode = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to join a team.');

  const inviteCode = typeof data?.inviteCode === 'string' ? data.inviteCode.trim().toUpperCase() : '';
  let childIds: string[];
  try {
    childIds = normalizeChildIds(data?.childIds);
  } catch (error) {
    throw new functions.https.HttpsError('invalid-argument', error instanceof Error ? error.message : 'Valid child profiles are required.');
  }
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(inviteCode)) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid team code is required.');
  }

  const firestore = admin.firestore();
  const teamQuery = await firestore.collection('teams').where('inviteCode', '==', inviteCode).limit(2).get();
  const teamSnapshot = teamQuery.docs[0];
  if (!teamSnapshot) throw new functions.https.HttpsError('not-found', 'Team invite code was not found.');
  if (teamQuery.size > 1) {
    throw new functions.https.HttpsError('failed-precondition', 'This team code is not unique. Ask the coach for a new code.');
  }
  if (!isTeamActive(teamSnapshot.data())) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'This team is no longer active.',
      { reason: 'team-archived' },
    );
  }

  const teamRef = teamSnapshot.ref;
  const memberRef = teamRef.collection('members').doc(uid);
  const userRef = firestore.collection('users').doc(uid);
  const linkRef = userRef.collection('teamChildLinks').doc(teamRef.id);
  const childRefs = childIds.map((childId) => userRef.collection('children').doc(childId));

  await firestore.runTransaction(async (transaction) => {
    const [transactionTeamSnapshot, memberSnapshot, userSnapshot, linkSnapshot, ...childSnapshots] = await transaction.getAll(
      teamRef,
      memberRef,
      userRef,
      linkRef,
      ...childRefs,
    );
    if (!transactionTeamSnapshot.exists || !isTeamActive(transactionTeamSnapshot.data())) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'This team is no longer active.',
        { reason: 'team-archived' },
      );
    }
    if (!userSnapshot.exists) throw new functions.https.HttpsError('failed-precondition', 'User profile not found.');
    if (!allChildProfilesExist(childIds, childSnapshots.map((childSnapshot) => childSnapshot.exists))) {
      throw new functions.https.HttpsError('permission-denied', 'Every selected child profile must belong to this account.');
    }
    const member = memberSnapshot.exists ? memberSnapshot.data() : undefined;
    if (member?.status === 'removed') {
      throw new functions.https.HttpsError('permission-denied', 'A coach must restore this removed membership.');
    }

    const roles = mergeParentRole(member?.roles, member?.role);
    const linkedChildIds = mergeChildIds(linkSnapshot.data()?.childIds, childIds);
    const displayName = userSnapshot.data()?.displayName
      || context.auth?.token?.name
      || context.auth?.token?.email
      || 'Sideline Parent';
    transaction.set(memberRef, {
      userId: uid,
      teamId: teamRef.id,
      displayName,
      roles,
      role: legacyRoleForMergedMembership(member?.role, roles),
      status: 'active',
      createdAt: memberSnapshot.exists
        ? member?.createdAt ?? admin.firestore.FieldValue.serverTimestamp()
        : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(linkRef, {
      teamId: teamRef.id,
      childIds: linkedChildIds,
      status: 'active',
      createdAt: linkSnapshot.exists
        ? linkSnapshot.data()?.createdAt ?? admin.firestore.FieldValue.serverTimestamp()
        : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.update(teamRef, {
      parentIds: admin.firestore.FieldValue.arrayUnion(uid),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.set(userRef, {
      activeTeamId: teamRef.id,
      parentTeamIds: admin.firestore.FieldValue.arrayUnion(teamRef.id),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  const team = teamSnapshot.data();
  return {
    team: {
      id: teamRef.id,
      name: team.name ?? '',
      sport: team.sport ?? '',
      ageRange: team.ageRange ?? '',
      division: team.division ?? '',
      season: team.season ?? '',
      leagueId: team.leagueId ?? null,
      squadId: team.squadId ?? null,
      createdBy: team.createdBy ?? '',
      inviteCode: team.inviteCode ?? '',
      coachIds: team.coachIds ?? [],
      parentIds: Array.from(new Set([...(team.parentIds ?? []), uid])),
      status: team.status ?? 'active',
    },
  };
});

// Staff access is a team-scoped secondary role. The authenticated caller is
// always taken from context.auth; requester identity is never client supplied.
export const setTeamStaffRole = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to manage team staff.');

  const teamId = typeof data?.teamId === 'string' ? data.teamId.trim() : '';
  const targetUserId = typeof data?.targetUserId === 'string' ? data.targetUserId.trim() : '';
  const isStaff = data?.isStaff;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(teamId)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(targetUserId)
    || typeof isStaff !== 'boolean') {
    throw new functions.https.HttpsError('invalid-argument', 'A valid team, member, and staff role are required.');
  }
  if (uid === targetUserId) {
    throw new functions.https.HttpsError('permission-denied', 'You cannot manage your own team role.');
  }

  const firestore = admin.firestore();
  const teamRef = firestore.collection('teams').doc(teamId);
  const requesterRef = teamRef.collection('members').doc(uid);
  const targetRef = teamRef.collection('members').doc(targetUserId);

  return firestore.runTransaction(async (transaction) => {
    const [teamSnapshot, requesterSnapshot, targetSnapshot] = await transaction.getAll(
      teamRef,
      requesterRef,
      targetRef,
    );
    if (!teamSnapshot.exists) {
      throw new functions.https.HttpsError('not-found', 'Team not found.');
    }

    const team = teamSnapshot.data()!;
    const requester = requesterSnapshot.exists ? requesterSnapshot.data() : undefined;
    if (!isTeamActive(team)) {
      throw new functions.https.HttpsError('failed-precondition', 'Archived teams cannot be changed.');
    }
    if (!canManageTeamRoles(requester, team.createdBy === uid)) {
      throw new functions.https.HttpsError('permission-denied', 'Only an active coach or team owner can manage staff roles.');
    }

    const target = targetSnapshot.exists ? targetSnapshot.data() : undefined;
    if (!target
      || !isEligibleStaffRoleTarget(target)
      || target.userId !== targetUserId
      || target.teamId !== teamId
      || team.createdBy === targetUserId) {
      throw new functions.https.HttpsError('failed-precondition', 'The selected member is not eligible for a staff role change.');
    }

    const roles = setStaffRole(target.roles, target.role, isStaff);
    transaction.update(targetRef, {
      roles,
      // Parent remains the primary legacy role. Explicit role flags retain the
      // additional staff permission without weakening older client behavior.
      role: 'parent',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      staffRoleUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      staffRoleUpdatedBy: uid,
    });

    return {
      roles: {
        parent: roles.parent === true,
        coach: roles.coach === true,
        staff: roles.staff === true,
      },
      role: 'parent',
    };
  });
});

export const setParentTeamChildLinks = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to update team children.');
  const teamId = typeof data?.teamId === 'string' ? data.teamId.trim() : '';
  let childIds: string[];
  try {
    childIds = normalizeChildIds(data?.childIds, { allowEmpty: true });
  } catch (error) {
    throw new functions.https.HttpsError('invalid-argument', error instanceof Error ? error.message : 'Valid child profiles are required.');
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(teamId)) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid team is required.');
  }

  const firestore = admin.firestore();
  const teamRef = firestore.collection('teams').doc(teamId);
  const userRef = firestore.collection('users').doc(uid);
  const memberRef = teamRef.collection('members').doc(uid);
  const linkRef = userRef.collection('teamChildLinks').doc(teamId);
  const childRefs = childIds.map((childId) => userRef.collection('children').doc(childId));
  await firestore.runTransaction(async (transaction) => {
    const [teamSnapshot, memberSnapshot, linkSnapshot, ...childSnapshots] = await transaction.getAll(
      teamRef,
      memberRef,
      linkRef,
      ...childRefs,
    );
    if (!teamSnapshot.exists) {
      throw new functions.https.HttpsError('not-found', 'Team not found.');
    }
    if (!isTeamActive(teamSnapshot.data())) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'This team is no longer active.',
        { reason: 'team-archived' },
      );
    }
    const member = memberSnapshot.exists ? memberSnapshot.data() : undefined;
    if (!member || member.status !== 'active' || !hasParentRole(member)) {
      throw new functions.https.HttpsError('permission-denied', 'An active parent role is required.');
    }
    if (!allChildProfilesExist(childIds, childSnapshots.map((childSnapshot) => childSnapshot.exists))) {
      throw new functions.https.HttpsError('permission-denied', 'Every selected child profile must belong to this account.');
    }
    transaction.update(memberRef, {
      childId: admin.firestore.FieldValue.delete(),
      childName: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.set(linkRef, {
      teamId,
      childIds,
      status: childIds.length > 0 ? 'active' : 'inactive',
      createdAt: linkSnapshot.exists
        ? linkSnapshot.data()?.createdAt ?? admin.firestore.FieldValue.serverTimestamp()
        : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  return { childIds };
});

export const leaveParentTeam = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to leave a team.');
  const teamId = typeof data?.teamId === 'string' ? data.teamId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(teamId)) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid team is required.');
  }

  const firestore = admin.firestore();
  const teamRef = firestore.collection('teams').doc(teamId);
  const memberRef = teamRef.collection('members').doc(uid);
  const userRef = firestore.collection('users').doc(uid);
  const linkRef = userRef.collection('teamChildLinks').doc(teamId);

  return firestore.runTransaction(async (transaction) => {
    const [teamSnapshot, memberSnapshot, userSnapshot, linkSnapshot] = await transaction.getAll(
      teamRef,
      memberRef,
      userRef,
      linkRef,
    );
    if (!teamSnapshot.exists) {
      throw new functions.https.HttpsError('not-found', 'Team not found.');
    }
    const member = memberSnapshot.exists ? memberSnapshot.data() : undefined;
    if (!member || member.status !== 'active' || !hasParentRole(member)) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'The parent membership is no longer active.',
        { reason: 'parent-membership-inactive' },
      );
    }

    const nextMembership = removeParentRole(member.roles, member.role);
    transaction.update(memberRef, {
      roles: nextMembership.roles,
      role: nextMembership.role,
      status: nextMembership.status,
      childId: admin.firestore.FieldValue.delete(),
      childName: admin.firestore.FieldValue.delete(),
      parentLeftAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.set(linkRef, {
      teamId,
      childIds: [],
      status: 'inactive',
      createdAt: linkSnapshot.exists
        ? linkSnapshot.data()?.createdAt ?? admin.firestore.FieldValue.serverTimestamp()
        : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.update(teamRef, {
      parentIds: admin.firestore.FieldValue.arrayRemove(uid),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const userUpdate: Record<string, unknown> = {
      parentTeamIds: admin.firestore.FieldValue.arrayRemove(teamId),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (nextMembership.status === 'active') {
      userUpdate.coachTeamIds = admin.firestore.FieldValue.arrayUnion(teamId);
    } else if (userSnapshot.data()?.activeTeamId === teamId) {
      userUpdate.activeTeamId = admin.firestore.FieldValue.delete();
    }
    transaction.set(userRef, userUpdate, { merge: true });

    return {
      roles: {
        parent: false,
        coach: nextMembership.roles.coach === true,
        staff: nextMembership.roles.staff === true,
      },
      status: nextMembership.status,
    };
  });
});

export const setTeamArchived = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to manage a team.');
  const teamId = typeof data?.teamId === 'string' ? data.teamId.trim() : '';
  const archived = data?.archived;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(teamId) || typeof archived !== 'boolean') {
    throw new functions.https.HttpsError('invalid-argument', 'A valid team and archive state are required.');
  }

  const firestore = admin.firestore();
  const teamRef = firestore.collection('teams').doc(teamId);
  const requesterRef = teamRef.collection('members').doc(uid);
  const replacementInviteCode = archived ? null : await generateAvailableTeamInviteCode(firestore, teamId);

  return firestore.runTransaction(async (transaction) => {
    const [teamSnapshot, requesterSnapshot] = await transaction.getAll(teamRef, requesterRef);
    if (!teamSnapshot.exists) {
      throw new functions.https.HttpsError('not-found', 'Team not found.');
    }
    const team = teamSnapshot.data()!;
    const requester = requesterSnapshot.exists ? requesterSnapshot.data() : undefined;
    if (!canManageTeamRoles(requester, team.createdBy === uid)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Only an active team owner or coach can archive this team.',
      );
    }

    const currentlyActive = isTeamActive(team);
    if (archived && !currentlyActive) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Team is already archived.',
        { reason: 'team-already-archived' },
      );
    }
    if (!archived && currentlyActive) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Team is already active.',
        { reason: 'team-already-active' },
      );
    }

    if (archived) {
      transaction.update(teamRef, {
        status: 'archived',
        archivedAt: admin.firestore.FieldValue.serverTimestamp(),
        archivedBy: uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      transaction.update(teamRef, {
        status: 'active',
        inviteCode: replacementInviteCode,
        restoredAt: admin.firestore.FieldValue.serverTimestamp(),
        restoredBy: uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return {
      status: archived ? 'archived' : 'active',
      inviteCode: archived ? null : replacementInviteCode,
    };
  });
});

export const deleteChildProfile = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to manage child profiles.');
  const childId = typeof data?.childId === 'string' ? data.childId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(childId)) {
    throw new functions.https.HttpsError('permission-denied', 'Child profile reference is invalid or unavailable.');
  }

  const firestore = admin.firestore();
  const userRef = firestore.collection('users').doc(uid);
  const childRef = userRef.collection('children').doc(childId);
  const linksQuery = userRef.collection('teamChildLinks');
  await firestore.runTransaction(async (transaction) => {
    const [childSnapshot, linksSnapshot] = await Promise.all([
      transaction.get(childRef),
      transaction.get(linksQuery),
    ]);
    if (!childSnapshot.exists) {
      throw new functions.https.HttpsError('permission-denied', 'Child profile reference is invalid or unavailable.');
    }
    const links = linksSnapshot.docs.map((linkDocument) => linkDocument.data());
    if (activeLinkReferencesChild(childId, links)) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Remove this child from active teams before deleting the profile.',
      );
    }

    linksSnapshot.docs.forEach((linkDocument) => {
      const nextChildIds = removeChildReference(childId, linkDocument.data().childIds);
      if (nextChildIds.length !== (Array.isArray(linkDocument.data().childIds)
        ? linkDocument.data().childIds.length
        : 0)) {
        transaction.update(linkDocument.ref, {
          childIds: nextChildIds,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    });
    transaction.delete(childRef);
  });

  return { deleted: true };
});

async function generateAvailableTeamInviteCode(
  firestore: FirebaseFirestore.Firestore,
  excludedTeamId: string,
): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    let code = '';
    for (let index = 0; index < 6; index += 1) {
      code += TEAM_INVITE_CHARACTERS[randomInt(TEAM_INVITE_CHARACTERS.length)];
    }
    const matches = await firestore.collection('teams').where('inviteCode', '==', code).limit(2).get();
    if (matches.empty || matches.docs.every((teamDocument) => teamDocument.id === excludedTeamId)) {
      return code;
    }
  }
  throw new functions.https.HttpsError('unavailable', 'A new invite code could not be generated. Please try again.');
}

function serializeWeeklyChallenge(data: FirebaseFirestore.DocumentData, nextResetKey: string) {
  const completedAt = data.completedAt instanceof admin.firestore.Timestamp
    ? data.completedAt.toDate().toISOString()
    : null;
  return {
    weekKey: data.weekKey,
    challengeId: data.challengeId,
    title: data.title,
    description: data.description,
    points: data.points,
    category: data.category,
    completed: data.completed === true,
    completedAt,
    pointsAwarded: data.pointsAwarded === true,
    timezone: data.timezone,
    nextResetKey,
  };
}
