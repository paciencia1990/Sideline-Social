import { createHash, randomUUID } from 'node:crypto';

import * as admin from 'firebase-admin';
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as firebaseFunctions from 'firebase-functions';

import { activeSquadAdminIds, isActiveSquadAdmin } from './squadAdminCore';
import { hasCoachAccess, isTeamActive } from './teamMembershipCore';
import { deleteTeamAnnouncementData } from './teamAnnouncementDeletionCore';
import { permanentAccountFunctions } from './permanentAuth';
import {
  APPLE_REVOCATION_SECRET_NAMES,
  AppleDeletionAuthorizationError,
  AppleRevocationError,
  readAppleRevocationSecrets,
  resolveAppleDeletionAuthorization,
  revokeAppleAuthorizationCode,
} from './appleAuthorizationRevocation';

const functions = permanentAccountFunctions(firebaseFunctions, "safety");

type DeletionSummary = {
  deletedDocuments: number;
  deletedStorageObjects: number;
  anonymizedDocuments: number;
};

const deletionFunctions = functions
  .region('us-central1')
  .runWith({
    timeoutSeconds: 540,
    memory: '1GB',
    secrets: [...APPLE_REVOCATION_SECRET_NAMES],
  });

/**
 * Permanently deletes the authenticated account and its associated data.
 *
 * Authentication is deleted last. Every preceding operation is idempotent so
 * an interrupted caller can safely reauthenticate and retry. Moderation
 * reports are retained without user identifiers; the final retention policy
 * still requires privacy/legal approval before release.
 */
export const deleteOwnAccount = deletionFunctions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in again before deleting your account.');
  }
  const authenticatedAt = Number(context.auth?.token.auth_time ?? 0);
  if (!Number.isFinite(authenticatedAt) || authenticatedAt <= 0 || Date.now() / 1000 - authenticatedAt > 10 * 60) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Verify a sign-in method again before deleting your account.',
    );
  }

  const firestore = admin.firestore();
  const blockers = await findOwnershipBlockers(firestore, uid);
  if (blockers.teams.length || blockers.squads.length) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Transfer ownership or add another administrator before deleting this account.',
      { reason: 'sole_owner', ...blockers },
    );
  }

  const appleRevocationRef = await ensureAppleAuthorizationRevoked(
    firestore,
    uid,
    stringValue(data?.appleAuthorizationCode),
  );

  const summary: DeletionSummary = {
    anonymizedDocuments: 0,
    deletedDocuments: 0,
    deletedStorageObjects: 0,
  };

  await deleteAuthoredMessagesAndAudio(firestore, uid, summary);
  await deleteAuthoredAnnouncements(firestore, uid, summary);
  await deleteVoiceUploadReservations(firestore, uid, summary);
  await deleteFriendChatMediaUploadReservations(firestore, uid, summary);
  summary.deletedDocuments += await deleteMatchingDocuments(
    firestore.collection('friendChatMediaPlaybackGrants').where('userId', '==', uid),
  );
  summary.deletedDocuments += await deleteMatchingDocuments(
    firestore.collectionGroup('reactions').where('userId', '==', uid),
  );
  summary.deletedDocuments += await deleteMatchingDocuments(
    firestore.collectionGroup('replies').where('userId', '==', uid),
  );

  await removeTeamMemberships(firestore, uid, summary);
  await removeSquadMemberships(firestore, uid, summary);
  await removeSquadSeasonIdentity(firestore, uid, summary);
  await removeFriendRelationships(firestore, uid, summary);
  await removeFriendConversationMemberships(firestore, uid, summary);
  await removePrivateTeamConversationMemberships(firestore, uid, summary);
  await removeMessageVisibilityReferences(firestore, uid, summary);
  await removeTriviaParticipation(firestore, uid, summary);
  await removeGameRewardParticipation(firestore, uid, summary);

  summary.deletedDocuments += await deleteMatchingDocuments(
    firestore.collection('friendRequests').where('fromUserId', '==', uid),
  );
  summary.deletedDocuments += await deleteMatchingDocuments(
    firestore.collection('friendRequests').where('toUserId', '==', uid),
  );
  summary.deletedDocuments += await deleteMatchingDocuments(
    firestore.collection('notificationTokens').where('uid', '==', uid),
  );
  summary.deletedDocuments += await deleteMatchingDocuments(
    firestore.collection('activity').where('userId', '==', uid),
  );
  summary.deletedDocuments += await deleteMatchingDocuments(
    firestore.collection('coachAiRequests').where('userId', '==', uid),
    true,
  );
  for (const collectionName of ['gameJoinCodes', 'gameJoinSessionLinks', 'gameJoinRequests']) {
    summary.deletedDocuments += await deleteMatchingDocuments(
      firestore.collection(collectionName).where('hostUserId', '==', uid),
      true,
    );
  }
  await Promise.all([
    firestore.collection('gameJoinRateLimits').doc(hashIdentifier(uid)).delete(),
    firestore.collection('triviaGameRateLimits').doc(hashIdentifier(uid)).delete(),
    firestore.collection('triviaGameRateLimits').doc(hashIdentifier(`create:${uid}`)).delete(),
  ]);
  summary.deletedDocuments += 3;
  summary.deletedDocuments += await deleteMatchingDocuments(
    firestore.collection('triviaGameRateLimits').where('userId', '==', uid),
  );

  await deleteSquadAdministrationRequests(firestore, uid, summary);
  await deleteUserBlocks(firestore, uid, summary);
  await anonymizeModerationReports(firestore, uid, summary);
  await anonymizeNotificationReferences(firestore, uid, summary);
  await deleteRealtimeGameParticipation(uid);

  const notificationRoot = firestore.collection('userNotifications').doc(uid);
  const userRoot = firestore.collection('users').doc(uid);
  const publicProfile = firestore.collection('publicUserProfiles').doc(uid);
  await Promise.all([
    firestore.recursiveDelete(notificationRoot),
    firestore.recursiveDelete(userRoot),
    publicProfile.delete(),
  ]);
  summary.deletedDocuments += 3;

  // Deleting Auth last ensures a partial Firestore/Storage failure can be
  // retried by the same authenticated user without privileged support.
  await admin.auth().deleteUser(uid);
  if (appleRevocationRef) {
    await appleRevocationRef.delete().catch((error: unknown) => {
      functions.logger.warn('apple_revocation_marker_cleanup_failed', {
        category: error instanceof Error ? error.name : 'unknown',
        uidHash: hashForLog(uid),
      });
    });
  }
  functions.logger.info('account_deletion_completed', { uidHash: hashForLog(uid), ...summary });
  return { deleted: true, ...summary };
});

async function ensureAppleAuthorizationRevoked(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  authorizationCode: string | null,
) {
  const authUser = await admin.auth().getUser(uid);
  const appleProvider = authUser.providerData.find((provider) => provider.providerId === 'apple.com');
  let requiredAuthorizationCode: string | null;
  try {
    requiredAuthorizationCode = resolveAppleDeletionAuthorization({
      authorizationCode,
      providerIds: authUser.providerData.map((provider) => provider.providerId),
    });
  } catch (error) {
    if (error instanceof AppleDeletionAuthorizationError && error.category === 'apple_provider_not_linked') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'The current account is not connected to Apple.',
        { reason: 'apple_provider_not_linked' },
      );
    }
    if (error instanceof AppleDeletionAuthorizationError) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Verify with Apple again before deleting this account.',
        { reason: error.category },
      );
    }
    throw error;
  }
  if (!requiredAuthorizationCode) return null;
  if (!appleProvider?.uid) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'The Apple account link is unavailable.',
      { reason: 'apple_provider_not_linked' },
    );
  }

  const markerRef = firestore.collection('accountDeletionAppleRevocations').doc(hashIdentifier(uid));
  const correlationId = randomUUID();
  const now = Date.now();
  const state = await firestore.runTransaction(async (transaction) => {
    const marker = await transaction.get(markerRef);
    const markerData = marker.data();
    if (markerData?.status === 'revoked') return 'revoked' as const;
    const expiresAt = markerData?.expiresAt instanceof Timestamp
      ? markerData.expiresAt.toMillis()
      : 0;
    if (markerData?.status === 'processing' && expiresAt > now) {
      throw new functions.https.HttpsError(
        'aborted',
        'Account deletion is already in progress.',
        { reason: 'account_deletion_in_progress' },
      );
    }
    transaction.set(markerRef, {
      correlationId,
      expiresAt: Timestamp.fromMillis(now + 10 * 60 * 1000),
      startedAt: FieldValue.serverTimestamp(),
      status: 'processing',
    });
    return 'claimed' as const;
  });
  if (state === 'revoked') return markerRef;

  try {
    await revokeAppleAuthorizationCode({
      authorizationCode: requiredAuthorizationCode,
      expectedAppleSubject: appleProvider.uid,
      secrets: readAppleRevocationSecrets(),
    });
    await markerRef.set({
      completedAt: FieldValue.serverTimestamp(),
      correlationId,
      expiresAt: FieldValue.delete(),
      status: 'revoked',
    }, { merge: true });
    functions.logger.info('apple_authorization_revocation_completed', { correlationId });
    return markerRef;
  } catch (error) {
    const category = error instanceof AppleRevocationError
      ? error.category
      : 'apple_revocation_failed';
    await firestore.runTransaction(async (transaction) => {
      const marker = await transaction.get(markerRef);
      if (marker.data()?.correlationId === correlationId) transaction.delete(markerRef);
    }).catch(() => undefined);
    functions.logger.error('apple_authorization_revocation_failed', { category, correlationId });
    throw new functions.https.HttpsError(
      'unavailable',
      'Apple authorization could not be revoked. Verify with Apple again and retry.',
      { reason: category, correlationId },
    );
  }
}

async function findOwnershipBlockers(firestore: FirebaseFirestore.Firestore, uid: string) {
  const teamSnapshots = await firestore.collection('teams').where('createdBy', '==', uid).get();
  const teamBlockers: { id: string; name: string }[] = [];
  for (const teamSnapshot of teamSnapshots.docs) {
    if (!isTeamActive(teamSnapshot.data())) continue;
    const memberSnapshots = await teamSnapshot.ref.collection('members').where('status', '==', 'active').get();
    const successor = memberSnapshots.docs.find((member) => member.id !== uid && hasCoachAccess(member.data()));
    if (!successor) {
      teamBlockers.push({ id: teamSnapshot.id, name: safeLabel(teamSnapshot.data().name, 'Team') });
    }
  }

  const memberships = await firestore.collection('squadMemberships').where('userId', '==', uid).get();
  const squadBlockers: { id: string; name: string }[] = [];
  for (const membership of memberships.docs) {
    const squadId = stringValue(membership.data().squadId);
    if (!squadId || !isActiveMembership(membership.data())) continue;
    const squad = await firestore.collection('squads').doc(squadId).get();
    if (!squad.exists || squad.data()?.isActive === false) continue;
    const allMemberships = await firestore.collection('squadMemberships').where('squadId', '==', squadId).get();
    const membershipData = allMemberships.docs.map((document) => document.data());
    if (!isActiveSquadAdmin({ squad: squad.data(), membership: membership.data(), squadId, userId: uid })) continue;
    const remaining = activeSquadAdminIds({ squad: squad.data(), squadId, memberships: membershipData })
      .filter((adminUserId) => adminUserId !== uid);
    if (remaining.length === 0) {
      squadBlockers.push({ id: squadId, name: safeLabel(squad.data()?.venueName ?? squad.data()?.name, 'Squad') });
    }
  }

  return { squads: squadBlockers, teams: teamBlockers };
}

async function deleteAuthoredMessagesAndAudio(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  summary: DeletionSummary,
) {
  while (true) {
    const snapshot = await firestore.collectionGroup('messages').where('senderUserId', '==', uid).limit(100).get();
    if (snapshot.empty) return;
    await Promise.all(snapshot.docs.map(async (message) => {
      const storagePath = stringValue(message.data()?.voiceMemo?.storagePath);
      if (storagePath?.startsWith('teamVoiceMemos/')) {
        await admin.storage().bucket().file(storagePath).delete({ ignoreNotFound: true });
        summary.deletedStorageObjects += 1;
      }
      for (const friendStoragePath of friendChatMediaStoragePaths(message.data())) {
        await admin.storage().bucket().file(friendStoragePath).delete({ ignoreNotFound: true });
        summary.deletedStorageObjects += 1;
      }
      await message.ref.set({
        caption: '',
        contentType: 'text',
        image: null,
        mediaStoragePaths: [],
        messageType: 'text',
        reactionCounts: {},
        reactionTotalCount: 0,
        removedAt: FieldValue.serverTimestamp(),
        removedBy: 'account-deletion',
        senderDisplayName: 'Deleted user',
        senderUserId: null,
        status: 'removed',
        text: '',
        voiceMemo: null,
      }, { merge: true });
      summary.anonymizedDocuments += 1;
    }));
  }
}

async function deleteAuthoredAnnouncements(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  summary: DeletionSummary,
) {
  while (true) {
    const snapshot = await firestore.collectionGroup('announcements').where('createdBy', '==', uid).limit(50).get();
    if (snapshot.empty) return;
    for (const announcement of snapshot.docs) {
      const teamRef = announcement.ref.parent.parent;
      const memberIds = teamRef ? (await teamRef.collection('members').get()).docs.map((member) => member.id) : [];
      const storagePath = stringValue(announcement.data()?.voiceMemo?.storagePath);
      await deleteTeamAnnouncementData(firestore, announcement.ref, memberIds);
      summary.deletedDocuments += 1;
      if (storagePath?.startsWith('teamVoiceMemos/')) {
        await admin.storage().bucket().file(storagePath).delete({ ignoreNotFound: true });
        summary.deletedStorageObjects += 1;
      }
    }
  }
}

async function deleteVoiceUploadReservations(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  summary: DeletionSummary,
) {
  while (true) {
    const snapshot = await firestore.collection('teamVoiceUploadReservations').where('userId', '==', uid).limit(100).get();
    if (snapshot.empty) return;
    await Promise.all(snapshot.docs.map(async (reservation) => {
      const storagePath = stringValue(reservation.data()?.storagePath);
      if (storagePath?.startsWith('teamVoiceMemos/')) {
        await admin.storage().bucket().file(storagePath).delete({ ignoreNotFound: true });
        summary.deletedStorageObjects += 1;
      }
      await reservation.ref.delete();
      summary.deletedDocuments += 1;
    }));
  }
}

async function deleteFriendChatMediaUploadReservations(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  summary: DeletionSummary,
) {
  while (true) {
    const snapshot = await firestore.collection('friendChatUploadReservations').where('userId', '==', uid).limit(100).get();
    if (snapshot.empty) return;
    await Promise.all(snapshot.docs.map(async (reservation) => {
      for (const storagePath of friendChatMediaStoragePaths(reservation.data())) {
        await admin.storage().bucket().file(storagePath).delete({ ignoreNotFound: true });
        summary.deletedStorageObjects += 1;
      }
      await reservation.ref.delete();
      summary.deletedDocuments += 1;
    }));
  }
}

async function removeTeamMemberships(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  summary: DeletionSummary,
) {
  const snapshots = await firestore.collectionGroup('members').where('userId', '==', uid).get();
  const teamMembers = snapshots.docs.filter((member) => member.ref.parent.parent?.parent.id === 'teams');
  for (const member of teamMembers) {
    const teamRef = member.ref.parent.parent;
    if (!teamRef) continue;
    const team = await teamRef.get();
    if (team.exists) {
      const update: Record<string, unknown> = {
        coachIds: FieldValue.arrayRemove(uid),
        parentIds: FieldValue.arrayRemove(uid),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (team.data()?.createdBy === uid) {
        const members = await teamRef.collection('members').where('status', '==', 'active').get();
        const successor = members.docs.find((candidate) => candidate.id !== uid && hasCoachAccess(candidate.data()));
        if (successor) update.createdBy = successor.id;
      }
      await teamRef.set(update, { merge: true });
    }
    await firestore.recursiveDelete(member.ref);
    summary.deletedDocuments += 1;
  }
}

async function removeSquadMemberships(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  summary: DeletionSummary,
) {
  const memberships = await firestore.collection('squadMemberships').where('userId', '==', uid).get();
  for (const membership of memberships.docs) {
    const squadId = stringValue(membership.data().squadId);
    if (squadId) {
      const squadRef = firestore.collection('squads').doc(squadId);
      const squad = await squadRef.get();
      if (squad.exists) {
        const memberIds = stringArray(squad.data()?.memberIds).filter((memberId) => memberId !== uid);
        const update: Record<string, unknown> = {
          activeMemberCount: memberIds.length,
          memberCount: memberIds.length,
          memberIds,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (squad.data()?.createdBy === uid || squad.data()?.creatorId === uid) {
          const allMemberships = await firestore.collection('squadMemberships').where('squadId', '==', squadId).get();
          const remainingAdminIds = activeSquadAdminIds({
            squad: squad.data(),
            squadId,
            memberships: allMemberships.docs.map((document) => document.data()),
          }).filter((adminUserId) => adminUserId !== uid);
          if (remainingAdminIds[0]) {
            update.createdBy = remainingAdminIds[0];
            update.creatorId = remainingAdminIds[0];
          }
        }
        await squadRef.set(update, { merge: true });
      }
    }
    await membership.ref.delete();
    summary.deletedDocuments += 1;
  }
}

async function removeSquadSeasonIdentity(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  summary: DeletionSummary,
) {
  summary.deletedDocuments += await deleteMatchingDocuments(
    firestore.collectionGroup('memberTotals').where('userId', '==', uid),
    true,
  );

  for (const fieldName of ['createdBy', 'closedBy'] as const) {
    while (true) {
      const snapshot = await firestore.collectionGroup('seasons').where(fieldName, '==', uid).limit(200).get();
      if (snapshot.empty) break;
      const writer = firestore.bulkWriter();
      snapshot.docs.forEach((season) => writer.set(season.ref, {
        [fieldName]: null,
        accountDeletionAnonymizedAt: FieldValue.serverTimestamp(),
      }, { merge: true }));
      await writer.close();
      summary.anonymizedDocuments += snapshot.size;
    }
  }
}

async function removeFriendRelationships(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  summary: DeletionSummary,
) {
  while (true) {
    const snapshot = await firestore.collection('users').where('friendIds', 'array-contains', uid).limit(200).get();
    if (snapshot.empty) return;
    const writer = firestore.bulkWriter();
    snapshot.docs.forEach((user) => writer.set(user.ref, {
      friendIds: FieldValue.arrayRemove(uid),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    await writer.close();
    summary.anonymizedDocuments += snapshot.size;
  }
}

async function removeFriendConversationMemberships(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  summary: DeletionSummary,
) {
  const memberships = await firestore.collectionGroup('members').where('userId', '==', uid).get();
  const friendMembers = memberships.docs.filter((member) => member.ref.parent.parent?.parent.id === 'friendConversations');
  for (const member of friendMembers) {
    const conversationRef = member.ref.parent.parent;
    if (!conversationRef) continue;
    const [conversation, allMembers] = await Promise.all([conversationRef.get(), conversationRef.collection('members').get()]);
    const remaining = allMembers.docs.filter((candidate) => candidate.id !== uid && candidate.data()?.status === 'active');
    if (remaining.length === 0) {
      await firestore.recursiveDelete(conversationRef);
    } else {
      const update: Record<string, unknown> = {
        activeParticipantIds: FieldValue.arrayRemove(uid),
        invitedParticipantIds: FieldValue.arrayRemove(uid),
        adminUserIds: FieldValue.arrayRemove(uid),
        activeMemberIds: FieldValue.arrayRemove(uid),
        memberIds: FieldValue.arrayRemove(uid),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (conversation.data()?.ownerUserId === uid) {
        update.ownerUserId = remaining[0].id;
        await remaining[0].ref.set({ role: 'owner', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      if (conversation.data()?.createdBy === uid) update.createdBy = null;
      if (conversation.data()?.conversationType === 'direct') update.status = 'readOnly';
      await conversationRef.set(update, { merge: true });
      if (Object.prototype.hasOwnProperty.call(conversation.data()?.participantNameSnapshots ?? {}, uid)) {
        await conversationRef.update(
          new FieldPath('participantNameSnapshots', uid),
          FieldValue.delete(),
        );
      }
      await Promise.all([
        firestore.recursiveDelete(member.ref),
        conversationRef.collection('memberProfiles').doc(uid).delete(),
      ]);
    }
    summary.deletedDocuments += 1;
  }
}

async function removePrivateTeamConversationMemberships(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  summary: DeletionSummary,
) {
  const memberships = await firestore.collectionGroup('members').where('userId', '==', uid).get();
  const privateMembers = memberships.docs.filter((member) => member.ref.parent.parent?.parent.id === 'teamPrivateConversations');
  for (const member of privateMembers) {
    const conversationRef = member.ref.parent.parent;
    if (conversationRef) {
      const conversation = await conversationRef.get();
      const update: Record<string, unknown> = {
        lastMessagePreview: null,
        participantUserIds: FieldValue.arrayRemove(uid),
        status: 'readOnly',
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (conversation.data()?.coachUserId === uid) {
        update.coachDisplayName = 'Deleted user';
        update.coachUserId = null;
      }
      if (conversation.data()?.parentUserId === uid) {
        update.parentDisplayName = 'Deleted user';
        update.parentUserId = null;
      }
      await conversationRef.set(update, { merge: true });
    }
    await firestore.recursiveDelete(member.ref);
    summary.deletedDocuments += 1;
  }
}

async function removeMessageVisibilityReferences(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  summary: DeletionSummary,
) {
  while (true) {
    const snapshot = await firestore.collectionGroup('messages')
      .where('visibleToUserIds', 'array-contains', uid)
      .limit(200)
      .get();
    if (snapshot.empty) return;
    const writer = firestore.bulkWriter();
    snapshot.docs.forEach((message) => writer.set(message.ref, {
      visibleToUserIds: FieldValue.arrayRemove(uid),
    }, { merge: true }));
    await writer.close();
    summary.anonymizedDocuments += snapshot.size;
  }
}

async function removeTriviaParticipation(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  summary: DeletionSummary,
) {
  summary.deletedDocuments += await deleteMatchingDocuments(
    firestore.collection('triviaGameSubmissions').where('playerId', '==', uid),
  );

  while (true) {
    const snapshot = await firestore.collection('sessions').where('playerIds', 'array-contains', uid).limit(100).get();
    if (snapshot.empty) return;
    for (const session of snapshot.docs) {
      const remainingPlayerIds = stringArray(session.data()?.playerIds).filter((playerId) => playerId !== uid);
      if (remainingPlayerIds.length === 0) {
        summary.deletedDocuments += await deleteMatchingDocuments(
          firestore.collection('triviaGameSubmissions').where('sessionId', '==', session.id),
        );
        await firestore.collection('triviaGameSecrets').doc(session.id).delete();
        await firestore.recursiveDelete(session.ref);
        summary.deletedDocuments += 2;
        continue;
      }
      const update: Record<string, unknown> = {
        playerIds: remainingPlayerIds,
        updatedAt: FieldValue.serverTimestamp(),
      };
      const gameRef = session.ref.collection('games').doc('triviaBlitz');
      const secretRef = firestore.collection('triviaGameSecrets').doc(session.id);
      const [game, secret] = await Promise.all([gameRef.get(), secretRef.get()]);
      const batch = firestore.batch();
      if (session.data()?.hostPlayerId === uid) {
        const replacementHostId = remainingPlayerIds[0];
        update.hostPlayerId = replacementHostId;
        if (game.exists) {
          batch.update(gameRef, {
            hostPlayerId: replacementHostId,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        if (secret.exists) {
          batch.update(secretRef, {
            hostPlayerId: replacementHostId,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
      batch.set(session.ref, update, { merge: true });
      batch.delete(gameRef.collection('players').doc(uid));
      await batch.commit();
      summary.deletedDocuments += 1;
    }
  }
}

async function removeGameRewardParticipation(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  summary: DeletionSummary,
) {
  while (true) {
    const snapshot = await firestore.collection('gameRewardSessions')
      .where('participantIds', 'array-contains', uid)
      .limit(100)
      .get();
    if (snapshot.empty) return;
    const writer = firestore.bulkWriter();
    snapshot.docs.forEach((session) => {
      const remainingParticipantIds = stringArray(session.data()?.participantIds)
        .filter((participantId) => participantId !== uid);
      if (remainingParticipantIds.length === 0) {
        writer.delete(session.ref);
        summary.deletedDocuments += 1;
      } else {
        writer.set(session.ref, {
          participantIds: remainingParticipantIds,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        summary.anonymizedDocuments += 1;
      }
    });
    await writer.close();
  }
}

async function deleteSquadAdministrationRequests(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  summary: DeletionSummary,
) {
  for (const [collectionName, fieldName] of [
    ['squadAdminInvitations', 'targetUserId'],
    ['squadAdminInvitations', 'invitedByUserId'],
    ['squadAdminAccessRequests', 'requesterUserId'],
    ['squadAdminAccessRequests', 'reviewedBy'],
  ] as const) {
    summary.deletedDocuments += await deleteMatchingDocuments(
      firestore.collection(collectionName).where(fieldName, '==', uid),
    );
  }
}

async function deleteUserBlocks(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  summary: DeletionSummary,
) {
  await firestore.recursiveDelete(firestore.collection('userBlocks').doc(uid));
  summary.deletedDocuments += 1;
  summary.deletedDocuments += await deleteMatchingDocuments(
    firestore.collectionGroup('blockedUsers').where('blockedUserId', '==', uid),
  );
}

async function anonymizeModerationReports(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  summary: DeletionSummary,
) {
  for (const collectionName of ['chatModerationReports', 'contentModerationReports'] as const) {
    for (const fieldName of ['reporterUserId', 'reportedUserId'] as const) {
      while (true) {
        const snapshot = await firestore.collection(collectionName).where(fieldName, '==', uid).limit(200).get();
        if (snapshot.empty) break;
        const writer = firestore.bulkWriter();
        snapshot.docs.forEach((report) => writer.set(report.ref, {
          [fieldName]: null,
          accountDeletionAnonymizedAt: FieldValue.serverTimestamp(),
        }, { merge: true }));
        await writer.close();
        summary.anonymizedDocuments += snapshot.size;
      }
    }
  }
}

async function anonymizeNotificationReferences(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  summary: DeletionSummary,
) {
  while (true) {
    const snapshot = await firestore.collectionGroup('notifications').where('actorUserId', '==', uid).limit(200).get();
    if (snapshot.empty) return;
    const writer = firestore.bulkWriter();
    snapshot.docs.forEach((notification) => writer.set(notification.ref, {
      actorName: 'Deleted user',
      actorUserId: null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    await writer.close();
    summary.anonymizedDocuments += snapshot.size;
  }
}

async function deleteRealtimeGameParticipation(uid: string) {
  const root = admin.database().ref();
  const snapshot = await root.child('gameSessions').get();
  if (!snapshot.exists()) return;
  const updates: Record<string, null> = {};
  snapshot.forEach((session) => {
    if (session.child('hostUserId').val() === uid) {
      updates[`gameSessions/${session.key}`] = null;
      updates[`gameSessionSecrets/${session.key}`] = null;
    } else if (session.child(`players/${uid}`).exists()) {
      updates[`gameSessions/${session.key}/players/${uid}`] = null;
    }
  });
  if (Object.keys(updates).length) await root.update(updates);
}

async function deleteMatchingDocuments(query: FirebaseFirestore.Query, recursive = false) {
  let deleted = 0;
  while (true) {
    const snapshot = await query.limit(200).get();
    if (snapshot.empty) return deleted;
    if (recursive) {
      await Promise.all(snapshot.docs.map((document) => document.ref.firestore.recursiveDelete(document.ref)));
    } else {
      const writer = snapshot.docs[0].ref.firestore.bulkWriter();
      snapshot.docs.forEach((document) => writer.delete(document.ref));
      await writer.close();
    }
    deleted += snapshot.size;
  }
}

function isActiveMembership(data: FirebaseFirestore.DocumentData) {
  return data.membershipStatus === 'active' || (data.membershipStatus == null && data.isActive === true);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0)))
    : [];
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function friendChatMediaStoragePaths(data: FirebaseFirestore.DocumentData | undefined) {
  const candidates = [
    data?.voiceMemo?.storagePath,
    data?.image?.fullPath,
    data?.image?.thumbnailPath,
    data?.storagePath,
    data?.fullPath,
    data?.thumbnailPath,
    ...(Array.isArray(data?.mediaStoragePaths) ? data.mediaStoragePaths : []),
  ];
  return Array.from(new Set(candidates
    .map((value) => stringValue(value))
    .filter((value): value is string => Boolean(value?.startsWith('friendChatMedia/')))));
}

function safeLabel(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : fallback;
}

function hashForLog(uid: string) {
  return createHash('sha256').update(uid).digest('hex').slice(0, 12);
}

function hashIdentifier(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
