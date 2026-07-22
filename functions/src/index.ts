/**
 * Sideline Squad — Firebase Cloud Functions
 *
 * Deploy: cd functions && npm install && npm run build && firebase deploy --only functions
 *
 * Functions:
 *  1. updateActiveMemberCount — triggered on squadMemberships writes
 *  2. deactivateInactiveMembers — scheduled daily at 02:00 UTC
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';

import * as admin from 'firebase-admin';
import { FieldValue, GeoPoint, Timestamp } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions';
import { distanceBetween, geohashForLocation, geohashQueryBounds } from 'geofire-common';
import {
  countMutualConnections,
  findSharedActivity,
  formatPublicUserName,
  formatSuggestedConnectionName,
  readStringArray,
  resolvePublicProfileName,
} from './friendSuggestionCore';
import {
  friendRequestIdFor,
  friendRequestExpiresAtMillis,
  isActivePendingRequest,
  normalizeFriendTargetId,
  resolveLegacyFriendRequestExpiresAtMillis,
  resolveFriendRequestSendStatus,
} from './friendRequestCore';
import {
  friendRequestNotificationId,
  resolveFriendRequestNotification,
} from './friendRequestNotifications';
import {
  processPendingExpoPushReceipts,
  sendPushToUser,
} from './pushNotificationDelivery';
import { assertUserContentAllowed } from './contentSafety';
import {
  isCanonicalPublicProfile,
  resolveCanonicalPublicName,
  resolveCanonicalPublicProfile,
  toMinimalPublicUserProfile,
} from './publicUserProfileCore';
import {
  deleteTeamAnnouncementData,
  type TeamAnnouncementDeletionStatus,
} from './teamAnnouncementDeletionCore';
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
  canAccessTeamAnnouncement,
  canDeleteTeamAnnouncementReply,
  canManageTeamAnnouncements,
  canManageTeamRoles,
  hasCoachAccess,
  hasParentRole,
  isTeamActive,
  isEligibleStaffRoleTarget,
  legacyRoleForMergedMembership,
  mergeChildIds,
  mergeParentRole,
  normalizeChildIds,
  removeParentRole,
  removeChildReference,
  resolveReplyAuthorName,
  setStaffRole,
} from './teamMembershipCore';
import {
  TEAM_VOICE_MAX_SIZE_BYTES,
  isExplicitConversationParticipant,
  privateMessagePreview,
  readAnnouncementAudience,
  readBoundedText,
  readClientIdentifier,
  readOptionalBoundedText,
  readRequiredIdentifier,
  shouldReceiveAnnouncement,
  teamPrivateConversationId,
  teamPrivateMessageId,
  teamVoiceStoragePath,
  validateVoiceMemoMetadata,
} from './teamVoiceMessagingCore';
import {
  assertValidCoordinates,
  canonicalVenueId,
  deterministicSquadId,
  getSportDisplayName,
  normalizeSportId,
  normalizeVenueName,
  resolveJoinProjection,
  validateVenueId,
  venueSportKeyFor,
  type SquadSportId,
} from './squadCore';
import {
  WEEKLY_CHALLENGE_STARS,
  calculateBombDefusalReward,
  calculateSpotDifferencesReward,
  calculateTriviaReward,
  gameRewardId,
  normalizeStars,
  totalBreakdown,
  type GameRewardBreakdown,
  type SupportedRewardGame,
} from './sidelineStarsCore';
import { readSeasonEligibleSquadIds } from './squadSeason';

export {
  createSquadSeason,
  endSquadSeason,
  getSquadLeaderboard,
  getSquadSeasons,
  projectRewardToSquadSeasons,
  syncSquadSeasonStates,
  updateSquadSeason,
} from './squadSeason';
export {
  cancelSquadAdminInvitation,
  expireSquadAdminInvitations,
  getSquadAdministration,
  inviteSquadAdmin,
  leaveVenueSportSquad,
  removeSquadAdmin,
  requestSquadAdminAccess,
  respondToSquadAdminInvitation,
  reviewSquadAdminAccessRequest,
} from './squadAdmin';
export {
  acknowledgeNotificationOpened,
  cleanupExpiredUserNotifications,
  clearUserNotifications,
} from './userNotificationDismissal';
export { generateCoachResourceHelp } from './coachResourceHelp';
export { deleteOwnAccount } from './accountDeletion';
export { reportTeamContent } from './contentModeration';
export {
  cleanupExpiredGameJoinCodes,
  createGameJoinCode,
  getActiveSquadGameSession,
  getGameJoinCodeForSession,
  recordSpotDifferenceFound,
  releaseGameJoinCode,
  resolveAndJoinGameByCode,
  updateGameJoinCodeStatus,
} from './gameJoinCodes';
export {
  blockFriendChatUser,
  createFriendGroupConversation,
  createOrOpenDirectConversation,
  getBlockedFriendChatUserIds,
  inviteFriendsToGroupConversation,
  leaveFriendConversation,
  markFriendConversationRead,
  removeFriendGroupMember,
  removeOwnFriendChatMessage,
  renameFriendGroupConversation,
  reportFriendChatMessage,
  reportFriendChatUser,
  respondToFriendGroupInvitation,
  sendFriendChatMessage,
  setFriendConversationMuted,
  setFriendGroupAdminRole,
  transferFriendGroupOwnership,
  unblockFriendChatUser,
} from './friendChat';

admin.initializeApp();

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const TEAM_INVITE_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_SQUAD_RADIUS_MILES = 2;
const MAX_SQUAD_RADIUS_MILES = 10;
const SQUAD_MILES_TO_METERS = 1609.34;

type PersonalNotificationInput = {
  recipientUserId: string;
  eventId: string;
  type: 'coachAnnouncement' | 'teamPrivateMessage' | 'friendRequest' | 'friendRequestAccepted';
  titleKey: string;
  bodyKey: string;
  params: Record<string, string | number>;
  actorUserId?: string;
  actorDisplayName?: string;
  teamId?: string;
  announcementId?: string;
  conversationId?: string;
  conversationType?: 'coach' | 'parent';
  friendRequestId?: string;
  pushTitle: string;
  pushBody: string;
  pushData: Record<string, string>;
};

async function createPersonalNotificationAndPush(input: PersonalNotificationInput) {
  if (!input.recipientUserId || !input.eventId) return false;
  const firestore = admin.firestore();
  const notificationRef = firestore
    .collection('userNotifications')
    .doc(input.recipientUserId)
    .collection('notifications')
    .doc(input.eventId);

  const created = await firestore.runTransaction(async (transaction) => {
    const notificationSnapshot = await transaction.get(notificationRef);
    if (notificationSnapshot.exists) return false;
    if (input.type === 'friendRequest' && input.friendRequestId) {
      const requestSnapshot = await transaction.get(
        firestore.collection('friendRequests').doc(input.friendRequestId),
      );
      if (!requestSnapshot.exists || requestSnapshot.data()?.status !== 'pending') return false;
    }
    transaction.create(notificationRef, {
      recipientUserId: input.recipientUserId,
      type: input.type,
      titleKey: input.titleKey,
      bodyKey: input.bodyKey,
      params: input.params,
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
      isRead: false,
      dismissedAt: null,
      dismissReason: null,
      status: 'active',
      actorUserId: input.actorUserId ?? null,
      actorDisplayName: input.actorDisplayName ?? null,
      teamId: input.teamId ?? null,
      announcementId: input.announcementId ?? null,
      conversationId: input.conversationId ?? null,
      conversationType: input.conversationType ?? null,
      friendRequestId: input.friendRequestId ?? null,
      expiresAt: null,
    });
    return true;
  });

  if (!created) return false;
  const results = await Promise.allSettled([
    sendPushToUser(input.recipientUserId, {
      ...input.pushData,
      notificationId: input.eventId,
      type: input.type,
    }),
  ]);

  const failures = results.filter((result) => result.status === 'rejected').length;
  if (failures > 0) {
    console.warn('[personalNotification] push delivery failures', { type: input.type, failures });
  }
  return true;
}

async function getPrivateNotificationActorName(userId: unknown, fallback = 'Sideline Social member') {
  if (typeof userId !== 'string' || !userId) return fallback;
  const snapshot = await admin.firestore().collection('users').doc(userId).get();
  const firestoreName = resolveCanonicalPublicName(snapshot.data())?.displayName;
  if (firestoreName) return firestoreName;
  try {
    const authUser = await admin.auth().getUser(userId);
    return resolveCanonicalPublicName({ displayName: authUser.displayName })?.displayName || fallback;
  } catch {
    return fallback;
  }
}

type SquadDocument = admin.firestore.DocumentData & {
  squadId?: string;
  venueId?: string;
  venueName?: string;
  normalizedVenueName?: string;
  sportId?: string;
  sportDisplayName?: string;
  sport?: string;
  venueSportKey?: string;
  venueLocation?: GeoPoint;
  venueGeohash?: string;
  memberIds?: string[];
  memberCount?: number;
  activeMemberCount?: number;
  isActive?: boolean;
  createdBy?: string;
  creatorId?: string;
  currentSeasonId?: string | null;
  timeZone?: string | null;
};

function readCallableCoordinates(data: unknown) {
  const input = (data ?? {}) as { latitude?: unknown; longitude?: unknown };
  const latitude = typeof input.latitude === 'number' ? input.latitude : Number.NaN;
  const longitude = typeof input.longitude === 'number' ? input.longitude : Number.NaN;
  try {
    assertValidCoordinates(latitude, longitude);
  } catch {
    throw new functions.https.HttpsError('invalid-argument', 'Valid venue coordinates are required.');
  }
  return { latitude, longitude };
}

function readCallableVenueName(value: unknown) {
  const venueName = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (venueName.length < 2 || venueName.length > 120) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid venue name is required.');
  }
  return venueName;
}

function readCallableSportId(value: unknown): SquadSportId {
  const sportId = normalizeSportId(value);
  if (!sportId) throw new functions.https.HttpsError('invalid-argument', 'A supported sport is required.');
  return sportId;
}

function readCallableSquadId(value: unknown) {
  const squadId = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,360}$/.test(squadId)) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid Squad reference is required.');
  }
  return squadId;
}

function readGameSessionId(value: unknown) {
  const sessionId = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(sessionId)) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid game session reference is required.');
  }
  return sessionId;
}

function readRewardGameType(value: unknown): SupportedRewardGame {
  if (value === 'triviaBlitz' || value === 'spotDifferences' || value === 'bombDefusal') return value;
  throw new functions.https.HttpsError('invalid-argument', 'A supported game type is required.');
}

function readLocalRewardGameType(value: unknown): 'spotDifferences' | 'bombDefusal' {
  const gameType = readRewardGameType(value);
  if (gameType === 'triviaBlitz') {
    throw new functions.https.HttpsError('invalid-argument', 'Trivia Blitz uses its existing canonical session.');
  }
  return gameType;
}

async function hasDurableSquadMembership(uid: string, squadId: string) {
  const snapshot = await admin.firestore().collection('squadMemberships').doc(`${squadId}__${uid}`).get();
  return snapshot.exists && snapshot.data()?.membershipStatus === 'active';
}

type RewardEligibility = { breakdown: GameRewardBreakdown; sourceSquadId: string | null };

async function readTriviaRewardEligibility(
  transaction: FirebaseFirestore.Transaction,
  sessionId: string,
  uid: string,
): Promise<RewardEligibility | null> {
  const firestore = admin.firestore();
  const parentRef = firestore.collection('sessions').doc(sessionId);
  const gameRef = parentRef.collection('games').doc('triviaBlitz');
  const playerRef = gameRef.collection('players').doc(uid);
  const [parentSnapshot, gameSnapshot, playerSnapshot] = await Promise.all([
    transaction.get(parentRef),
    transaction.get(gameRef),
    transaction.get(playerRef),
  ]);
  if (!parentSnapshot.exists || !gameSnapshot.exists || !playerSnapshot.exists) return null;
  const parent = parentSnapshot.data()!;
  const game = gameSnapshot.data()!;
  const participantIds = readStringArray(parent.playerIds);
  const questionCount = Array.isArray(game.selectedQuestions) ? game.selectedQuestions.length : 0;
  const completedAllQuestions = parent.status === 'results' && game.status === 'results' &&
    questionCount > 0 && questionCount <= 10 && game.questionIndex === questionCount - 1 &&
    game.answeredQuestions === questionCount;
  if (!participantIds.includes(uid) && parent.hostPlayerId !== uid) return null;
  const breakdown = calculateTriviaReward({
    completedAllQuestions,
    correctAnswers: game.correctAnswers,
    questionCount,
  });
  return breakdown ? { breakdown, sourceSquadId: typeof parent.sourceSquadId === 'string' ? parent.sourceSquadId : null } : null;
}

async function readLocalGameRewardEligibility(
  transaction: FirebaseFirestore.Transaction,
  gameType: 'spotDifferences' | 'bombDefusal',
  sessionId: string,
  uid: string,
): Promise<RewardEligibility | null> {
  const sessionRef = admin.firestore().collection('gameRewardSessions').doc(`${gameType}_${sessionId}`);
  const sessionSnapshot = await transaction.get(sessionRef);
  if (!sessionSnapshot.exists) return null;
  const session = sessionSnapshot.data()!;
  if (session.status !== 'completed' || !readStringArray(session.participantIds).includes(uid)) return null;
  const result = session.finalizedResult as Record<string, unknown> | undefined;
  if (!result) return null;
  const breakdown = gameType === 'spotDifferences'
    ? calculateSpotDifferencesReward({
      terminal: result.outcome === 'completed' || result.outcome === 'timeExpired',
      foundCount: result.foundCount as number,
      totalDifferences: result.totalDifferences as number,
    })
    : calculateBombDefusalReward({
      outcome: result.outcome as 'defused' | 'exploded',
      firstAttemptCorrectStepCount: result.firstAttemptCorrectStepCount as number,
      totalSteps: result.totalSteps as number,
    });
  return breakdown ? {
    breakdown,
    sourceSquadId: typeof session.sourceSquadId === 'string' ? session.sourceSquadId : null,
  } : null;
}

function emptyRewardBreakdown(): GameRewardBreakdown {
  return { completionStars: 0, performanceStars: 0, achievementStars: 0 };
}

function normalizeStoredBreakdown(value: unknown): GameRewardBreakdown {
  const breakdown = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    completionStars: normalizeStars(breakdown.completionStars),
    performanceStars: normalizeStars(breakdown.performanceStars),
    achievementStars: normalizeStars(breakdown.achievementStars),
  };
}

function legacySportIdForSquad(squad: SquadDocument): SquadSportId {
  return normalizeSportId(squad.sportId ?? squad.sportDisplayName ?? squad.sport) ?? 'other';
}

function squadProjection(snapshot: admin.firestore.DocumentSnapshot) {
  const squad = (snapshot.data() ?? {}) as SquadDocument;
  const sportId = legacySportIdForSquad(squad);
  const venueName = typeof squad.venueName === 'string' && squad.venueName.trim()
    ? squad.venueName.trim()
    : typeof squad.name === 'string' && squad.name.trim()
      ? squad.name.trim()
      : 'Sports Venue';
  const point = squad.venueLocation;
  return {
    squadId: snapshot.id,
    venueId: typeof squad.venueId === 'string' ? squad.venueId : `legacy_${snapshot.id}`,
    venueName,
    normalizedVenueName: typeof squad.normalizedVenueName === 'string'
      ? squad.normalizedVenueName
      : normalizeVenueName(venueName),
    sportId,
    sportDisplayName: typeof squad.sportDisplayName === 'string' && squad.sportDisplayName.trim()
      ? squad.sportDisplayName.trim()
      : getSportDisplayName(sportId),
    venueSportKey: typeof squad.venueSportKey === 'string' ? squad.venueSportKey : null,
    venueLocation: point instanceof GeoPoint
      ? { latitude: point.latitude, longitude: point.longitude }
      : null,
    venueGeohash: typeof squad.venueGeohash === 'string' ? squad.venueGeohash : null,
    memberCount: typeof squad.memberCount === 'number'
      ? Math.max(0, squad.memberCount)
      : Array.isArray(squad.memberIds) ? new Set(squad.memberIds).size : 0,
    activeMemberCount: typeof squad.activeMemberCount === 'number' ? Math.max(0, squad.activeMemberCount) : 0,
    isActive: squad.isActive !== false,
  };
}

async function findLegacyVenueSportCandidate(input: {
  firestore: admin.firestore.Firestore;
  latitude: number;
  longitude: number;
  normalizedVenueName: string;
  sportId: SquadSportId;
}) {
  const bounds = geohashQueryBounds([input.latitude, input.longitude], 250);
  const snapshots = await Promise.all(bounds.map(([lower, upper]) => input.firestore
    .collection('squads')
    .where('venueGeohash', '>=', lower)
    .where('venueGeohash', '<=', upper)
    .where('isActive', '==', true)
    .limit(50)
    .get()));
  const candidates = new Map<string, admin.firestore.QueryDocumentSnapshot>();
  snapshots.forEach((snapshot) => snapshot.docs.forEach((candidate) => {
    const squad = candidate.data() as SquadDocument;
    const point = squad.venueLocation;
    if (!(point instanceof GeoPoint)) return;
    const venueName = typeof squad.venueName === 'string' ? squad.venueName : squad.name;
    if (typeof venueName !== 'string' || normalizeVenueName(venueName) !== input.normalizedVenueName) return;
    if (legacySportIdForSquad(squad) !== input.sportId) return;
    const miles = distanceBetween(
      [input.latitude, input.longitude],
      [point.latitude, point.longitude],
    ) * 0.621371;
    if (miles <= 0.15) candidates.set(candidate.id, candidate);
  }));
  if (candidates.size > 1) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Multiple legacy Squads may match this venue and sport. Review them before creating another.',
      { reason: 'duplicate-candidates' },
    );
  }
  return Array.from(candidates.values())[0] ?? null;
}

// A venue-and-sport key is the canonical Squad identity. The deterministic
// document ID makes concurrent creation of the same combination race-safe.
export const findOrCreateVenueSportSquad = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to create a Squad.');
  const venueName = readCallableVenueName(data?.venueName);
  const { latitude, longitude } = readCallableCoordinates(data);
  const sportId = readCallableSportId(data?.sportId);
  const normalizedVenueName = normalizeVenueName(venueName);
  const suppliedVenueId = data?.venueId == null ? null : validateVenueId(data.venueId);
  if (data?.venueId != null && !suppliedVenueId) {
    throw new functions.https.HttpsError('invalid-argument', 'The venue reference is invalid.');
  }
  const firestore = admin.firestore();
  if (suppliedVenueId) {
    const venueDocuments = await firestore.collection('squads').where('venueId', '==', suppliedVenueId).limit(20).get();
    const verified = venueDocuments.docs.some((document) => {
      const existingSquad = document.data() as SquadDocument;
      const point = existingSquad.venueLocation;
      const existingVenueName = existingSquad.venueName ?? existingSquad.name;
      return existingSquad.isActive !== false
        && point instanceof GeoPoint
        && typeof existingVenueName === 'string'
        && normalizeVenueName(existingVenueName) === normalizedVenueName
        && distanceBetween([latitude, longitude], [point.latitude, point.longitude]) * 0.621371 <= 0.15;
    });
    if (!verified) {
      throw new functions.https.HttpsError('invalid-argument', 'The venue reference could not be verified.');
    }
  }
  const venueId = suppliedVenueId ?? canonicalVenueId(venueName, latitude, longitude);
  const venueSportKey = venueSportKeyFor(venueId, sportId);
  const canonicalSquadId = deterministicSquadId(venueSportKey);

  const indexedExisting = await firestore.collection('squads')
    .where('venueSportKey', '==', venueSportKey)
    .where('isActive', '==', true)
    .limit(2)
    .get();
  if (indexedExisting.size > 1) {
    throw new functions.https.HttpsError('failed-precondition', 'Duplicate Squad records require review.', { reason: 'duplicate-candidates' });
  }
  let existing = indexedExisting.docs[0] ?? null;
  if (!existing) {
    const canonicalSnapshot = await firestore.collection('squads').doc(canonicalSquadId).get();
    if (canonicalSnapshot.exists && canonicalSnapshot.data()?.isActive !== false) {
      existing = canonicalSnapshot as admin.firestore.QueryDocumentSnapshot;
    }
  }
  if (!existing) {
    existing = await findLegacyVenueSportCandidate({
      firestore, latitude, longitude, normalizedVenueName, sportId,
    });
  }

  if (existing) {
    const existingData = existing.data() as SquadDocument;
    const existingVenueName = typeof existingData.venueName === 'string' && existingData.venueName.trim()
      ? existingData.venueName.trim()
      : typeof existingData.name === 'string' && existingData.name.trim()
        ? existingData.name.trim()
        : venueName;
    await existing.ref.set({
      squadId: existing.id,
      venueId,
      venueName: existingVenueName,
      normalizedVenueName: normalizeVenueName(existingVenueName),
      sportId,
      sportDisplayName: getSportDisplayName(sportId),
      venueSportKey,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { squadId: existing.id, status: 'existing' as const };
  }

  const squadRef = firestore.collection('squads').doc(canonicalSquadId);
  const status = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(squadRef);
    if (snapshot.exists && snapshot.data()?.isActive !== false) return 'existing' as const;
    const timestamp = FieldValue.serverTimestamp();
    transaction.set(squadRef, {
      squadId: canonicalSquadId,
      name: venueName,
      venueId,
      venueName,
      normalizedVenueName,
      sportId,
      sport: getSportDisplayName(sportId),
      sportDisplayName: getSportDisplayName(sportId),
      venueSportKey,
      venueLocation: new GeoPoint(latitude, longitude),
      venueGeohash: geohashForLocation([latitude, longitude]),
      memberIds: [],
      memberCount: 0,
      activeMemberCount: 0,
      createdBy: uid,
      createdAt: timestamp,
      updatedAt: timestamp,
      isActive: true,
      seasonId: null,
      currentSeasonId: null,
      timeZone: null,
      sponsorId: null,
      lastActivityAt: null,
    });
    return 'created' as const;
  });
  return { squadId: canonicalSquadId, status };
});

export const joinVenueSportSquad = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to join a Squad.');
  const squadId = readCallableSquadId(data?.squadId);
  const firestore = admin.firestore();
  const squadRef = firestore.collection('squads').doc(squadId);
  const userRef = firestore.collection('users').doc(uid);
  const membershipRef = firestore.collection('squadMemberships').doc(`${squadId}__${uid}`);

  return firestore.runTransaction(async (transaction) => {
    const [squadSnapshot, userSnapshot, membershipSnapshot] = await transaction.getAll(squadRef, userRef, membershipRef);
    const legacyMembershipSnapshot = await transaction.get(firestore.collection('squadMemberships')
      .where('userId', '==', uid)
      .where('squadId', '==', squadId));
    if (!squadSnapshot.exists || squadSnapshot.data()?.isActive === false) {
      throw new functions.https.HttpsError('failed-precondition', 'This Squad is unavailable.');
    }
    if (!userSnapshot.exists) throw new functions.https.HttpsError('failed-precondition', 'User profile not found.');
    const squad = squadSnapshot.data() as SquadDocument;
    const memberIds = Array.from(new Set(Array.isArray(squad.memberIds) ? squad.memberIds : []));
    const existingMembership = membershipSnapshot.data();
    const activeLegacyMembership = legacyMembershipSnapshot.docs.map((document) => document.data()).find((membership) => (
      membership.membershipStatus === 'active'
      || (membership.membershipStatus == null && membership.isActive === true)
    ));
    const hasActiveMembership = existingMembership?.membershipStatus === 'active'
      || Boolean(activeLegacyMembership);
    const existingRole = existingMembership?.squadRole ?? activeLegacyMembership?.squadRole;
    const isRecordedCreator = squad.createdBy === uid || squad.creatorId === uid;
    const isFirstRecordedCreatorMembership = isRecordedCreator
      && !membershipSnapshot.exists
      && legacyMembershipSnapshot.empty;
    const isActiveLegacyCreator = isRecordedCreator
      && hasActiveMembership
      && existingRole !== 'admin'
      && existingRole !== 'member';
    const { alreadyMember, memberIds: nextMemberIds } = resolveJoinProjection(memberIds, uid, hasActiveMembership);
    const timestamp = Timestamp.now();
    transaction.set(membershipRef, {
      membershipId: membershipRef.id,
      userId: uid,
      squadId,
      membershipStatus: 'active',
      squadRole: (hasActiveMembership && existingRole === 'admin') || isFirstRecordedCreatorMembership || isActiveLegacyCreator
        ? 'admin'
        : 'member',
      presenceStatus: 'recent',
      joinedAt: existingMembership?.joinedAt ?? timestamp,
      updatedAt: timestamp,
      lastSeenAt: timestamp,
      // Kept only for legacy readers. It now mirrors durable membership and is
      // never expired by the presence cleanup job.
      isActive: true,
      lastActiveAt: timestamp,
      notificationEligible: !alreadyMember,
    }, { merge: true });
    legacyMembershipSnapshot.docs.forEach((document) => {
      if (document.id === membershipRef.id) return;
      transaction.set(document.ref, {
        membershipStatus: 'superseded',
        presenceStatus: 'away',
        isActive: false,
        supersededBy: membershipRef.id,
        updatedAt: timestamp,
      }, { merge: true });
    });
    transaction.update(squadRef, {
      memberIds: nextMemberIds,
      memberCount: nextMemberIds.length,
      updatedAt: timestamp,
    });
    const currentSquadIds = Array.from(new Set(
      Array.isArray(userSnapshot.data()?.squadIds) ? userSnapshot.data()!.squadIds : [],
    )) as string[];
    const nextSquadIds = currentSquadIds.includes(squadId) ? currentSquadIds : [...currentSquadIds, squadId];
    const selectedSquadId = typeof userSnapshot.data()?.selectedSquadId === 'string'
      && nextSquadIds.includes(userSnapshot.data()!.selectedSquadId)
      ? userSnapshot.data()!.selectedSquadId
      : squadId;
    transaction.set(userRef, { squadIds: nextSquadIds, selectedSquadId, updatedAt: timestamp }, { merge: true });
    return { squadId, status: alreadyMember ? 'existing' : 'joined', selectedSquadId };
  });
});

export const setSelectedSquad = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to select a Squad.');
  const selectedSquadId = data?.squadId == null ? null : readCallableSquadId(data.squadId);
  const userRef = admin.firestore().collection('users').doc(uid);
  return admin.firestore().runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists) throw new functions.https.HttpsError('failed-precondition', 'User profile not found.');
    const squadIds = Array.isArray(userSnapshot.data()?.squadIds) ? userSnapshot.data()!.squadIds as string[] : [];
    if (selectedSquadId && !squadIds.includes(selectedSquadId)) {
      throw new functions.https.HttpsError('permission-denied', 'Join this Squad before selecting it.');
    }
    transaction.update(userRef, {
      selectedSquadId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { selectedSquadId };
  });
});

export const refreshSquadPresence = functions.https.onCall(async (_data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to update Squad presence.');
  const firestore = admin.firestore();
  const userSnapshot = await firestore.collection('users').doc(uid).get();
  const squadIds = Array.isArray(userSnapshot.data()?.squadIds)
    ? Array.from(new Set(userSnapshot.data()!.squadIds as string[])).slice(0, 25)
    : [];
  const batch = firestore.batch();
  const timestamp = Timestamp.now();
  squadIds.forEach((squadId) => batch.set(
    firestore.collection('squadMemberships').doc(`${squadId}__${uid}`),
    {
      membershipId: `${squadId}__${uid}`,
      userId: uid,
      squadId,
      membershipStatus: 'active',
      presenceStatus: 'recent',
      isActive: true,
      lastSeenAt: timestamp,
      lastActiveAt: timestamp,
      updatedAt: timestamp,
      notificationEligible: false,
    },
    { merge: true },
  ));
  await batch.commit();
  return { updatedCount: squadIds.length };
});

export const findNearbyVenueSportSquads = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to find nearby Squads.');
  const { latitude, longitude } = readCallableCoordinates(data);
  const requestedRadius = typeof data?.radiusMiles === 'number' ? data.radiusMiles : DEFAULT_SQUAD_RADIUS_MILES;
  const radiusMiles = Math.min(MAX_SQUAD_RADIUS_MILES, Math.max(0.25, requestedRadius));
  const bounds = geohashQueryBounds([latitude, longitude], radiusMiles * SQUAD_MILES_TO_METERS);
  const firestore = admin.firestore();
  const snapshots = await Promise.all(bounds.map(([lower, upper]) => firestore.collection('squads')
    .where('venueGeohash', '>=', lower)
    .where('venueGeohash', '<=', upper)
    .where('isActive', '==', true)
    .limit(60)
    .get()));
  const results = new Map<string, ReturnType<typeof squadProjection> & { distanceMiles: number }>();
  snapshots.forEach((snapshot) => snapshot.docs.forEach((squadSnapshot) => {
    const projection = squadProjection(squadSnapshot);
    if (!projection.venueLocation) return;
    const distanceMiles = distanceBetween(
      [latitude, longitude],
      [projection.venueLocation.latitude, projection.venueLocation.longitude],
    ) * 0.621371;
    if (distanceMiles <= radiusMiles) results.set(squadSnapshot.id, { ...projection, distanceMiles });
  }));
  return {
    radiusMiles,
    squads: Array.from(results.values()).sort((a, b) => a.distanceMiles - b.distanceMiles).slice(0, 50),
  };
});

export const searchVenueSportSquads = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to search for Squads.');
  const queryText = typeof data?.queryText === 'string' ? normalizeVenueName(data.queryText) : '';
  if (queryText.length < 2 || queryText.length > 80) {
    throw new functions.https.HttpsError('invalid-argument', 'Enter at least two characters of the venue name.');
  }
  const snapshot = await admin.firestore().collection('squads')
    .where('isActive', '==', true)
    .where('normalizedVenueName', '>=', queryText)
    .where('normalizedVenueName', '<=', `${queryText}\uf8ff`)
    .limit(50)
    .get();
  return { squads: snapshot.docs.map(squadProjection) };
});

// ---------------------------------------------------------------------------
// 1. updateActiveMemberCount
//    Triggered whenever a squadMemberships document is created or updated.
//    Counts durable members seen within the past 3 hours. Presence can expire;
//    membership cannot.
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

    const canonicalSnapshot = await admin
      .firestore()
      .collection('squadMemberships')
      .where('squadId', '==', squadId)
      .where('membershipStatus', '==', 'active')
      .where('lastSeenAt', '>=', new Date(threeHoursAgo))
      .get();
    const legacySnapshot = await admin
      .firestore()
      .collection('squadMemberships')
      .where('squadId', '==', squadId)
      .where('isActive', '==', true)
      .where('lastActiveAt', '>=', threeHoursAgo)
      .get();
    const activeUserIds = new Set<string>();
    canonicalSnapshot.docs.concat(legacySnapshot.docs).forEach((document) => {
      const userId = document.data().userId;
      if (typeof userId === 'string') activeUserIds.add(userId);
    });
    const activeMemberCount = activeUserIds.size;
    const lastActivityAt = activeMemberCount > 0 ? Timestamp.now() : null;

    const update: Record<string, unknown> = { activeMemberCount, lastActivityAt };

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
    const now = Timestamp.now();
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
// Secure friend mutations
// The authenticated UID is always the sender/actor. Clients provide only the
// target or request ID and cannot write trusted request identity fields.
// ---------------------------------------------------------------------------

const FRIEND_REQUEST_PAGE_SIZE = 100;

function timestampMillis(value: unknown): number | null {
  return value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function'
    ? value.toMillis()
    : null;
}

function requestExpiresAtMillis(request: Record<string, unknown>) {
  return resolveLegacyFriendRequestExpiresAtMillis(
    timestampMillis(request.expiresAt),
    timestampMillis(request.createdAt),
  );
}

function preserveTerminalRequestOutcomes(request: Record<string, unknown>) {
  const previous = Array.isArray(request.priorOutcomes)
    ? request.priorOutcomes.filter((item) => item && typeof item === 'object').slice(-19)
    : [];
  if (!['accepted', 'declined', 'canceled', 'expired'].includes(String(request.status ?? ''))) return previous;
  return [...previous, {
    status: request.status,
    createdAt: request.createdAt ?? null,
    expiresAt: request.expiresAt ?? null,
    respondedAt: request.respondedAt ?? null,
    acceptedAt: request.acceptedAt ?? null,
    declinedAt: request.declinedAt ?? null,
    canceledAt: request.canceledAt ?? null,
    expiredAt: request.expiredAt ?? null,
  }];
}

async function readBlockedRelationshipIds(userId: string) {
  const firestore = admin.firestore();
  const [outgoing, incoming] = await Promise.all([
    firestore.collection('userBlocks').doc(userId).collection('blockedUsers').limit(500).get(),
    firestore.collectionGroup('blockedUsers').where('blockedUserId', '==', userId).limit(500).get(),
  ]);
  return new Set([
    ...outgoing.docs.filter((document) => document.data()?.status !== 'inactive').map((document) => document.id),
    ...incoming.docs
      .filter((document) => document.data()?.status !== 'inactive')
      .map((document) => String(document.data()?.blockerUserId ?? document.ref.parent.parent?.id ?? ''))
      .filter(Boolean),
  ]);
}

function publicFriendRequest(document: admin.firestore.QueryDocumentSnapshot, expiresAtMillis: number) {
  const request = document.data();
  return {
    id: document.id,
    fromUserId: request.fromUserId,
    fromDisplayName: request.fromDisplayName ?? request.senderDisplayNameSnapshot ?? null,
    fromPhotoURL: request.fromPhotoURL ?? request.senderPhotoUrlSnapshot ?? null,
    toUserId: request.toUserId,
    toDisplayName: request.toDisplayName ?? request.recipientDisplayNameSnapshot ?? null,
    toPhotoURL: request.toPhotoURL ?? request.recipientPhotoUrlSnapshot ?? null,
    status: request.status,
    createdAt: request.createdAt ?? null,
    updatedAt: request.updatedAt ?? null,
    expiresAt: Timestamp.fromMillis(expiresAtMillis),
  };
}

export const getActiveFriendRequests = functions.https.onCall(async (_data, context) => {
  const userId = context.auth?.uid;
  if (!userId) throw new functions.https.HttpsError('unauthenticated', 'Sign in to view friend requests.');
  const firestore = admin.firestore();
  const now = Timestamp.now();
  const [incomingSnapshot, outgoingSnapshot, blockedUserIds] = await Promise.all([
    firestore.collection('friendRequests')
      .where('toUserId', '==', userId)
      .where('status', 'in', ['pending', 'deletePending'])
      .limit(FRIEND_REQUEST_PAGE_SIZE)
      .get(),
    firestore.collection('friendRequests')
      .where('fromUserId', '==', userId)
      .where('status', '==', 'pending')
      .limit(FRIEND_REQUEST_PAGE_SIZE)
      .get(),
    readBlockedRelationshipIds(userId),
  ]);

  const active: { direction: 'incoming' | 'outgoing'; document: admin.firestore.QueryDocumentSnapshot; expiresAt: number }[] = [];
  const expired: admin.firestore.QueryDocumentSnapshot[] = [];
  const needsExpiryProjection: { document: admin.firestore.QueryDocumentSnapshot; expiresAt: number }[] = [];
  const inspect = (direction: 'incoming' | 'outgoing', documents: admin.firestore.QueryDocumentSnapshot[]) => {
    documents.forEach((document) => {
      const request = document.data();
      const otherUserId = direction === 'incoming' ? request.fromUserId : request.toUserId;
      if (typeof otherUserId !== 'string' || blockedUserIds.has(otherUserId)) return;
      const expiresAt = requestExpiresAtMillis(request);
      if (expiresAt === null || expiresAt <= now.toMillis()) {
        expired.push(document);
        return;
      }
      if (timestampMillis(request.expiresAt) === null) {
        needsExpiryProjection.push({ document, expiresAt });
      }
      active.push({ direction, document, expiresAt });
    });
  };
  inspect('incoming', incomingSnapshot.docs);
  inspect('outgoing', outgoingSnapshot.docs);

  if (expired.length > 0 || needsExpiryProjection.length > 0) {
    const batch = firestore.batch();
    needsExpiryProjection.forEach(({ document, expiresAt }) => batch.update(document.ref, {
      expiresAt: Timestamp.fromMillis(expiresAt),
      updatedAt: now,
    }));
    expired.forEach((document) => batch.update(document.ref, {
      status: 'expired',
      expiresAt: Timestamp.fromMillis(requestExpiresAtMillis(document.data()) ?? now.toMillis()),
      expiredAt: now,
      updatedAt: now,
    }));
    await batch.commit();
    await Promise.allSettled(expired.map((document) => resolveFriendRequestNotification(
      String(document.data()?.toUserId ?? ''),
      document.id,
      typeof document.data()?.notificationId === 'string' ? document.data().notificationId : null,
    )));
  }

  const byNewest = (left: typeof active[number], right: typeof active[number]) => (
    (timestampMillis(right.document.data()?.createdAt) ?? 0) - (timestampMillis(left.document.data()?.createdAt) ?? 0)
  );
  return {
    incoming: active.filter((item) => item.direction === 'incoming').sort(byNewest)
      .map((item) => publicFriendRequest(item.document, item.expiresAt)),
    outgoing: active.filter((item) => item.direction === 'outgoing').sort(byNewest)
      .map((item) => publicFriendRequest(item.document, item.expiresAt)),
  };
});

export const sendFriendRequest = functions.https.onCall(async (data, context) => {
  const senderUserId = context.auth?.uid;
  if (!senderUserId) throw new functions.https.HttpsError('unauthenticated', 'Sign in to send a friend request.');

  let targetUserId: string;
  try {
    targetUserId = normalizeFriendTargetId(data?.targetUserId);
  } catch {
    throw new functions.https.HttpsError('invalid-argument', 'A valid target user is required.');
  }
  if (targetUserId === senderUserId) {
    throw new functions.https.HttpsError('invalid-argument', 'You cannot send a friend request to yourself.');
  }

  const firestore = admin.firestore();
  const senderRef = firestore.collection('users').doc(senderUserId);
  const targetRef = firestore.collection('users').doc(targetUserId);
  const requestId = friendRequestIdFor(senderUserId, targetUserId);
  const reverseRequestId = friendRequestIdFor(targetUserId, senderUserId);
  const outgoingRef = firestore.collection('friendRequests').doc(requestId);
  const incomingRef = firestore.collection('friendRequests').doc(reverseRequestId);
  const senderBlockRef = firestore.collection('userBlocks').doc(senderUserId).collection('blockedUsers').doc(targetUserId);
  const targetBlockRef = firestore.collection('userBlocks').doc(targetUserId).collection('blockedUsers').doc(senderUserId);

  const result = await firestore.runTransaction(async (transaction) => {
    const [senderSnapshot, targetSnapshot, outgoingSnapshot, incomingSnapshot, senderBlock, targetBlock] = await Promise.all([
      transaction.get(senderRef), transaction.get(targetRef), transaction.get(outgoingRef), transaction.get(incomingRef),
      transaction.get(senderBlockRef), transaction.get(targetBlockRef),
    ]);
    if (!senderSnapshot.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'Your profile is unavailable.');
    }
    if (!targetSnapshot.exists || ['deleted', 'disabled', 'removed'].includes(String(targetSnapshot.data()?.status ?? ''))) {
      throw new functions.https.HttpsError('not-found', 'That parent is no longer available.');
    }
    if (senderBlock.exists || targetBlock.exists) {
      throw new functions.https.HttpsError('permission-denied', 'This connection is unavailable.');
    }

    const now = Timestamp.now();
    const outgoing = outgoingSnapshot.data() ?? {};
    const incoming = incomingSnapshot.data() ?? {};
    const outcome = resolveFriendRequestSendStatus({
      senderFriendIds: senderSnapshot.data()?.friendIds,
      targetFriendIds: targetSnapshot.data()?.friendIds,
      targetUserId,
      senderUserId,
      outgoingStatus: outgoing.status,
      incomingStatus: incoming.status,
      outgoingExpiresAtMillis: requestExpiresAtMillis(outgoing),
      incomingExpiresAtMillis: requestExpiresAtMillis(incoming),
      nowMillis: now.toMillis(),
    });
    if (outcome !== 'pending') return { status: outcome, expiredReverseRequest: null };

    const senderCanonicalProfile = resolveCanonicalPublicProfile(senderUserId, senderSnapshot.data());
    if (!senderCanonicalProfile) {
      throw new functions.https.HttpsError('failed-precondition', 'Add your first and last name before sending friend requests.');
    }
    const targetCanonicalProfile = resolveCanonicalPublicProfile(targetUserId, targetSnapshot.data());
    if (!targetCanonicalProfile) {
      throw new functions.https.HttpsError('failed-precondition', 'That parent does not have a public name yet.');
    }
    const senderProfile = toMinimalPublicUserProfile(senderCanonicalProfile);
    const targetProfile = toMinimalPublicUserProfile(targetCanonicalProfile);

    let expiredReverseRequest: { recipientUserId: string; requestId: string; notificationId: string | null } | null = null;
    const incomingExpiresAt = requestExpiresAtMillis(incoming);
    if (incoming.status === 'pending' && !isActivePendingRequest(incoming.status, incomingExpiresAt, now.toMillis())) {
      transaction.update(incomingRef, {
        status: 'expired',
        expiresAt: Timestamp.fromMillis(incomingExpiresAt ?? now.toMillis()),
        expiredAt: now,
        updatedAt: now,
      });
      expiredReverseRequest = {
        recipientUserId: senderUserId,
        requestId: reverseRequestId,
        notificationId: typeof incoming.notificationId === 'string' ? incoming.notificationId : null,
      };
    }

    const expiresAt = Timestamp.fromMillis(friendRequestExpiresAtMillis(now.toMillis()));
    const notificationId = friendRequestNotificationId(requestId, now.toMillis());
    transaction.set(outgoingRef, {
      fromUserId: senderUserId,
      fromDisplayName: senderProfile.displayName,
      fromPhotoURL: senderProfile.photoURL,
      toUserId: targetUserId,
      toDisplayName: targetProfile.displayName,
      toPhotoURL: targetProfile.photoURL,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt,
      respondedAt: null,
      acceptedAt: null,
      declinedAt: null,
      canceledAt: null,
      expiredAt: null,
      notificationId,
      attemptNumber: Number.isInteger(outgoing.attemptNumber) ? Number(outgoing.attemptNumber) + 1 : 1,
      priorOutcomes: preserveTerminalRequestOutcomes(outgoing),
    });
    return { status: 'pending' as const, expiredReverseRequest };
  });

  if (result.expiredReverseRequest) {
    await resolveFriendRequestNotification(
      result.expiredReverseRequest.recipientUserId,
      result.expiredReverseRequest.requestId,
      result.expiredReverseRequest.notificationId,
    );
  }
  return { requestId, status: result.status };
});

export const respondToFriendRequest = functions.https.onCall(async (data, context) => {
  const userId = context.auth?.uid;
  if (!userId) throw new functions.https.HttpsError('unauthenticated', 'Sign in to respond to a friend request.');
  const requestId = typeof data?.requestId === 'string' ? data.requestId.trim() : '';
  const decision = data?.decision === 'accepted' || data?.response === 'accept'
    ? 'accepted'
    : data?.decision === 'declined' || data?.response === 'decline'
      ? 'declined'
      : null;
  if (!/^[A-Za-z0-9_-]{1,300}$/u.test(requestId) || (decision !== 'accepted' && decision !== 'declined')) {
    throw new functions.https.HttpsError('invalid-argument', 'The friend request response is invalid.');
  }

  const firestore = admin.firestore();
  const requestRef = firestore.collection('friendRequests').doc(requestId);
  const result = await firestore.runTransaction(async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);
    if (!requestSnapshot.exists) throw new functions.https.HttpsError('not-found', 'This request is no longer available.');
    const request = requestSnapshot.data() ?? {};
    if (request.toUserId !== userId) {
      throw new functions.https.HttpsError('permission-denied', 'Only the recipient may respond to this request.');
    }
    if (request.status !== 'pending') {
      if (request.status === decision) {
        return { status: decision, alreadyHandled: true, recipientUserId: userId, notificationId: request.notificationId ?? null };
      }
      return { status: 'alreadyHandled' as const, alreadyHandled: true, recipientUserId: userId, notificationId: request.notificationId ?? null };
    }

    const now = Timestamp.now();
    const expiresAt = requestExpiresAtMillis(request);
    if (expiresAt === null || expiresAt <= now.toMillis()) {
      transaction.update(requestRef, {
        status: 'expired',
        expiresAt: Timestamp.fromMillis(expiresAt ?? now.toMillis()),
        expiredAt: now,
        updatedAt: now,
      });
      return { status: 'expired' as const, alreadyHandled: false, recipientUserId: userId, notificationId: request.notificationId ?? null };
    }

    if (decision === 'accepted') {
      if (typeof request.fromUserId !== 'string' || !request.fromUserId) {
        throw new functions.https.HttpsError('failed-precondition', 'This request is invalid.');
      }
      const senderRef = firestore.collection('users').doc(request.fromUserId);
      const recipientRef = firestore.collection('users').doc(userId);
      const senderBlockRef = firestore.collection('userBlocks').doc(request.fromUserId).collection('blockedUsers').doc(userId);
      const recipientBlockRef = firestore.collection('userBlocks').doc(userId).collection('blockedUsers').doc(request.fromUserId);
      const [senderSnapshot, recipientSnapshot, senderBlock, recipientBlock] = await Promise.all([
        transaction.get(senderRef), transaction.get(recipientRef),
        transaction.get(senderBlockRef), transaction.get(recipientBlockRef),
      ]);
      if (!senderSnapshot.exists || !recipientSnapshot.exists) {
        throw new functions.https.HttpsError('not-found', 'A friend profile is no longer available.');
      }
      if (senderBlock.exists || recipientBlock.exists) {
        transaction.update(requestRef, { status: 'canceled', canceledAt: now, updatedAt: now });
        return { status: 'canceled' as const, alreadyHandled: false, recipientUserId: userId, notificationId: request.notificationId ?? null };
      }
      transaction.set(senderRef, { friendIds: FieldValue.arrayUnion(userId) }, { merge: true });
      transaction.set(recipientRef, { friendIds: FieldValue.arrayUnion(request.fromUserId) }, { merge: true });
    }

    transaction.update(requestRef, {
      status: decision,
      expiresAt: Timestamp.fromMillis(expiresAt),
      respondedAt: now,
      acceptedAt: decision === 'accepted' ? now : request.acceptedAt ?? null,
      declinedAt: decision === 'declined' ? now : request.declinedAt ?? null,
      updatedAt: now,
    });
    return { status: decision, alreadyHandled: false, recipientUserId: userId, notificationId: request.notificationId ?? null };
  });
  await resolveFriendRequestNotification(result.recipientUserId, requestId, result.notificationId);
  return { status: result.status, alreadyHandled: result.alreadyHandled };
});

export const cancelFriendRequest = functions.https.onCall(async (data, context) => {
  const userId = context.auth?.uid;
  if (!userId) throw new functions.https.HttpsError('unauthenticated', 'Sign in to cancel a friend request.');
  const requestId = typeof data?.requestId === 'string' ? data.requestId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,300}$/u.test(requestId)) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid friend request is required.');
  }
  const requestRef = admin.firestore().collection('friendRequests').doc(requestId);
  const result = await admin.firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(requestRef);
    if (!snapshot.exists) return { status: 'notFound' as const, recipientUserId: '', notificationId: null };
    const request = snapshot.data() ?? {};
    if (request.fromUserId !== userId) {
      throw new functions.https.HttpsError('permission-denied', 'Only the sender may cancel this request.');
    }
    if (request.status !== 'pending') {
      return {
        status: request.status === 'canceled' ? 'canceled' as const : 'alreadyHandled' as const,
        recipientUserId: String(request.toUserId ?? ''),
        notificationId: typeof request.notificationId === 'string' ? request.notificationId : null,
      };
    }
    const now = Timestamp.now();
    const expiresAt = requestExpiresAtMillis(request);
    const expired = expiresAt === null || expiresAt <= now.toMillis();
    transaction.update(requestRef, expired ? {
      status: 'expired', expiresAt: Timestamp.fromMillis(expiresAt ?? now.toMillis()), expiredAt: now, updatedAt: now,
    } : {
      status: 'canceled', expiresAt: Timestamp.fromMillis(expiresAt), canceledAt: now, updatedAt: now,
    });
    return {
      status: expired ? 'expired' as const : 'canceled' as const,
      recipientUserId: String(request.toUserId ?? ''),
      notificationId: typeof request.notificationId === 'string' ? request.notificationId : null,
    };
  });
  await resolveFriendRequestNotification(result.recipientUserId, requestId, result.notificationId);
  return { status: result.status };
});

export const removeFriendConnection = functions.https.onCall(async (data, context) => {
  const userId = context.auth?.uid;
  if (!userId) throw new functions.https.HttpsError('unauthenticated', 'Sign in to remove a friend.');
  let friendUserId: string;
  try {
    friendUserId = normalizeFriendTargetId(data?.friendUserId);
  } catch {
    throw new functions.https.HttpsError('invalid-argument', 'A valid friend is required.');
  }
  if (friendUserId === userId) return { removed: false };

  const firestore = admin.firestore();
  const requestRefs = [
    firestore.collection('friendRequests').doc(friendRequestIdFor(userId, friendUserId)),
    firestore.collection('friendRequests').doc(friendRequestIdFor(friendUserId, userId)),
  ];
  const resolvedNotifications = await firestore.runTransaction(async (transaction) => {
    const requests = await Promise.all(requestRefs.map((reference) => transaction.get(reference)));
    const now = Timestamp.now();
    transaction.set(firestore.collection('users').doc(userId), {
      friendIds: FieldValue.arrayRemove(friendUserId),
    }, { merge: true });
    transaction.set(firestore.collection('users').doc(friendUserId), {
      friendIds: FieldValue.arrayRemove(userId),
    }, { merge: true });
    const notifications: { recipientUserId: string; requestId: string; notificationId: string | null }[] = [];
    requests.forEach((snapshot) => {
      if (!snapshot.exists || !['pending', 'accepted'].includes(String(snapshot.data()?.status ?? ''))) return;
      transaction.update(snapshot.ref, { status: 'canceled', canceledAt: now, updatedAt: now });
      notifications.push({
        recipientUserId: String(snapshot.data()?.toUserId ?? ''),
        requestId: snapshot.id,
        notificationId: typeof snapshot.data()?.notificationId === 'string' ? snapshot.data()?.notificationId : null,
      });
    });
    return notifications;
  });
  await Promise.allSettled(resolvedNotifications.map((item) => resolveFriendRequestNotification(
    item.recipientUserId, item.requestId, item.notificationId,
  )));
  return { removed: true };
});

export const expirePendingFriendRequests = functions.region('us-central1').pubsub
  .schedule('15 4 * * *')
  .timeZone('Etc/UTC')
  .onRun(async () => {
    const firestore = admin.firestore();
    let expiredCount = 0;
    let pageCount = 0;
    while (true) {
      const now = Timestamp.now();
      const page = await firestore.collection('friendRequests')
        .where('status', '==', 'pending')
        .where('expiresAt', '<=', now)
        .orderBy('expiresAt')
        .limit(400)
        .get();
      if (page.empty) break;
      const batch = firestore.batch();
      page.docs.forEach((document) => batch.update(document.ref, {
        status: 'expired', expiredAt: now, updatedAt: now,
      }));
      await batch.commit();
      await Promise.allSettled(page.docs.map((document) => resolveFriendRequestNotification(
        String(document.data()?.toUserId ?? ''),
        document.id,
        typeof document.data()?.notificationId === 'string' ? document.data().notificationId : null,
      )));
      expiredCount += page.size;
      pageCount += 1;
      if (page.size < 400) break;
    }
    console.info('[expirePendingFriendRequests] completed', { expiredCount, pageCount });
    return { expiredCount, pageCount };
  });

// ---------------------------------------------------------------------------
// 5. FCM Triggers
// ---------------------------------------------------------------------------

export const onFriendRequestCreated = functions.firestore
  .document('friendRequests/{requestId}')
  .onWrite(async (change) => {
    if (!change.after.exists) return null;
    const request = change.after.data() ?? {};
    const previousStatus = change.before.exists ? change.before.data()?.status : null;
    if (request.status !== 'pending' || previousStatus === 'pending') return null;
    if (
      typeof request.fromUserId !== 'string' ||
      typeof request.toUserId !== 'string' ||
      request.fromUserId === request.toUserId
    ) return null;

    const senderName = await getPrivateNotificationActorName(request.fromUserId, '');
    const eventTimestamp = typeof request.createdAt?.toMillis === 'function'
      ? request.createdAt.toMillis()
      : 'initial';
    const eventId = typeof request.notificationId === 'string'
      ? request.notificationId
      : friendRequestNotificationId(change.after.id, eventTimestamp);
    await createPersonalNotificationAndPush({
      recipientUserId: request.toUserId,
      eventId,
      type: 'friendRequest',
      titleKey: 'notifications.types.friendRequestTitle',
      bodyKey: senderName
        ? 'notifications.types.friendRequestBody'
        : 'notifications.types.friendRequestFallbackBody',
      params: senderName ? { actorName: senderName } : {},
      actorUserId: request.fromUserId,
      actorDisplayName: senderName || undefined,
      friendRequestId: change.after.id,
      pushTitle: 'New friend request',
      pushBody: senderName
        ? `${senderName} wants to connect with you.`
        : 'A Sideline parent wants to connect with you.',
      pushData: { friendRequestId: change.after.id },
    });
    return null;
  });

export const onFriendRequestAccepted = functions.firestore
  .document('friendRequests/{requestId}')
  .onUpdate(async (change) => {
    const before = change.before.data();
    const after = change.after.data();
    if (before.status !== 'pending' || after.status !== 'accepted') return null;

    if (typeof after.fromUserId !== 'string' || typeof after.toUserId !== 'string') return null;
    const accepterName = await getPrivateNotificationActorName(after.toUserId);
    const acceptedTimestamp = typeof after.updatedAt?.toMillis === 'function'
      ? after.updatedAt.toMillis()
      : 'accepted';
    await createPersonalNotificationAndPush({
      recipientUserId: after.fromUserId,
      eventId: `friendRequestAccepted_${change.after.id}_${acceptedTimestamp}`,
      type: 'friendRequestAccepted',
      titleKey: 'notifications.types.friendRequestAcceptedTitle',
      bodyKey: 'notifications.types.friendRequestAcceptedBody',
      params: { actorName: accepterName },
      actorUserId: after.toUserId,
      actorDisplayName: accepterName,
      friendRequestId: change.after.id,
      pushTitle: 'Friend request accepted',
      pushBody: `${accepterName} accepted your friend request.`,
      pushData: { friendRequestId: change.after.id },
    });
    return null;
  });

export const onSquadMemberJoined = functions.firestore
  .document('squadMemberships/{membershipId}')
  .onCreate(async (snap) => {
    const membership = snap.data();
    if (
      (membership.membershipStatus !== 'active' && membership.isActive !== true)
      || membership.notificationEligible === false
    ) return null;

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
        title: `New member in ${squad.venueName ?? squad.name ?? 'your Squad'}`,
        body: `${squad.sportDisplayName ?? squad.sport ?? 'A parent'} joined this Squad.`,
      },
      data: { type: 'squad_member_joined', squadId: membership.squadId },
    });
    return null;
  });

// ---------------------------------------------------------------------------
// 2. deactivateInactiveMembers
//    Runs daily at 02:00 UTC.
//    Marks recent presence as away after 24 hours. It never ends membership.
// ---------------------------------------------------------------------------

export const deactivateInactiveMembers = functions.pubsub
  .schedule('0 2 * * *') // cron: every day at 02:00 UTC
  .timeZone('UTC')
  .onRun(async () => {
    const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;

    const snapshot = await admin
      .firestore()
      .collection('squadMemberships')
      .where('membershipStatus', '==', 'active')
      .where('lastSeenAt', '<', new Date(cutoff))
      .get();

    if (snapshot.empty) {
      console.log('[deactivateInactiveMembers] No expired Squad presence found.');
      return null;
    }

    // Firestore batch is limited to 500 ops — chunk it
    const BATCH_LIMIT = 499;
    const docs = snapshot.docs;
    let processed = 0;

    for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
      const chunk = docs.slice(i, i + BATCH_LIMIT);
      const batch = admin.firestore().batch();
      let writes = 0;
      chunk.forEach((doc) => {
        if (doc.data().presenceStatus !== 'away') {
          batch.update(doc.ref, {
            presenceStatus: 'away',
            presenceUpdatedAt: FieldValue.serverTimestamp(),
          });
          writes += 1;
        }
      });
      if (writes > 0) await batch.commit();
      processed += chunk.length;
    }

    console.log(`[deactivateInactiveMembers] Reviewed ${processed} expired presence records.`);
    return null;
  });

// ---------------------------------------------------------------------------
// 6. awardGameStars
//    Firestore trigger — when a gameSessions document status changes to
//    'completed', award Sideline Stars to all winning players in Firestore.
//    Note: gameSessions live in Realtime DB, so we use an HTTPS callable
//    function that game clients invoke on completion instead.
// ---------------------------------------------------------------------------

// awardGameStars was intentionally removed. It accepted arbitrary target UIDs
// and client-provided scores without authentication or idempotency. The only
// active game award entry point is finalizeGameReward below.

export const createGameRewardSession = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in before starting a rewarded game.');
  const gameType = readLocalRewardGameType(data?.gameType);
  const requestedSessionId = data?.sessionId == null ? null : readGameSessionId(data.sessionId);
  const requestedSourceSquadId = data?.sourceSquadId == null ? null : readCallableSquadId(data.sourceSquadId);
  let sourceSquadId = requestedSourceSquadId;

  if (requestedSessionId) {
    const realtimeSnapshot = await admin.database().ref(`/gameSessions/${requestedSessionId}`).once('value');
    if (!realtimeSnapshot.exists()) {
      throw new functions.https.HttpsError('failed-precondition', 'The multiplayer game session was not found.');
    }
    const realtimeSession = realtimeSnapshot.val() as Record<string, unknown>;
    const expectedLegacyType = gameType === 'spotDifferences' ? 'spot_difference' : 'bomb_defusal';
    const participants = realtimeSession.players as Record<string, unknown> | undefined;
    if (realtimeSession.gameType !== expectedLegacyType || !participants?.[uid]) {
      throw new functions.https.HttpsError('permission-denied', 'You are not a participant in this game session.');
    }
    sourceSquadId = typeof realtimeSession.squadId === 'string' ? realtimeSession.squadId : sourceSquadId;
  }
  if (sourceSquadId && !await hasDurableSquadMembership(uid, sourceSquadId)) sourceSquadId = null;

  const sessionId = requestedSessionId ?? `solo_${randomBytes(18).toString('base64url')}`;
  const sessionRef = admin.firestore().collection('gameRewardSessions').doc(`${gameType}_${sessionId}`);
  const result = await admin.firestore().runTransaction(async (transaction) => {
    const existing = await transaction.get(sessionRef);
    if (existing.exists) {
      const participantIds = readStringArray(existing.data()?.participantIds);
      if (existing.data()?.gameType !== gameType || (!requestedSessionId && !participantIds.includes(uid))) {
        throw new functions.https.HttpsError('permission-denied', 'This game session is unavailable.');
      }
      if (!participantIds.includes(uid)) {
        transaction.update(sessionRef, {
          participantIds: [...participantIds, uid],
          updatedAt: Timestamp.now(),
        });
      }
      return { sessionId, sourceSquadId: existing.data()?.sourceSquadId ?? null };
    }
    const timestamp = Timestamp.now();
    transaction.create(sessionRef, {
      sessionId,
      gameType,
      participantIds: [uid],
      sourceSquadId: sourceSquadId ?? null,
      mode: requestedSessionId ? 'multiplayer' : 'solo',
      status: 'active',
      expectedTotal: gameType === 'spotDifferences' ? 10 : 5,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { sessionId, sourceSquadId: sourceSquadId ?? null };
  });
  console.info('[createGameRewardSession] completed', { gameType, mode: requestedSessionId ? 'multiplayer' : 'solo' });
  return result;
});

export const recordGameSessionResult = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to finish this game.');
  const gameType = readLocalRewardGameType(data?.gameType);
  const sessionId = readGameSessionId(data?.sessionId);
  const sessionRef = admin.firestore().collection('gameRewardSessions').doc(`${gameType}_${sessionId}`);

  return admin.firestore().runTransaction(async (transaction) => {
    const sessionSnapshot = await transaction.get(sessionRef);
    if (!sessionSnapshot.exists || !readStringArray(sessionSnapshot.data()?.participantIds).includes(uid)) {
      throw new functions.https.HttpsError('permission-denied', 'You are not a participant in this game session.');
    }
    if (sessionSnapshot.data()?.status === 'completed') return { status: 'alreadyRecorded' as const };
    const expectedTotal = sessionSnapshot.data()?.expectedTotal;
    let finalizedResult: Record<string, unknown>;
    if (gameType === 'spotDifferences') {
      const outcome = data?.outcome;
      const foundCount = data?.foundCount;
      const totalDifferences = data?.totalDifferences;
      const breakdown = calculateSpotDifferencesReward({ terminal: true, foundCount, totalDifferences });
      if (
        !breakdown || totalDifferences !== expectedTotal ||
        !['completed', 'timeExpired'].includes(outcome) ||
        (outcome === 'completed' && foundCount !== totalDifferences)
      ) throw new functions.https.HttpsError('invalid-argument', 'The Spot the Differences result is invalid.');
      finalizedResult = { outcome, foundCount, totalDifferences };
    } else {
      const outcome = data?.outcome;
      const firstAttemptCorrectStepCount = data?.firstAttemptCorrectStepCount;
      const totalSteps = data?.totalSteps;
      const breakdown = calculateBombDefusalReward({ outcome, firstAttemptCorrectStepCount, totalSteps });
      if (
        !breakdown || totalSteps !== expectedTotal ||
        (outcome === 'defused' && firstAttemptCorrectStepCount !== totalSteps)
      ) throw new functions.https.HttpsError('invalid-argument', 'The Bomb Defusal result is invalid.');
      finalizedResult = { outcome, firstAttemptCorrectStepCount, totalSteps };
    }
    transaction.update(sessionRef, {
      status: 'completed',
      finalizedResult,
      finalizedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    console.info('[recordGameSessionResult] completed', { gameType, outcome: finalizedResult.outcome });
    return { status: 'recorded' as const };
  });
});

export const finalizeGameReward = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to receive Sideline Stars.');
  const gameType = readRewardGameType(data?.gameType);
  const sessionId = readGameSessionId(data?.sessionId);
  const firestore = admin.firestore();
  const userRef = firestore.collection('users').doc(uid);
  const rewardId = gameRewardId(gameType, sessionId, uid);
  const rewardRef = userRef.collection('rewardTransactions').doc(rewardId);

  const result = await firestore.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const rewardSnapshot = await transaction.get(rewardRef);
    if (!userSnapshot.exists) throw new functions.https.HttpsError('failed-precondition', 'User profile not found.');
    const currentStars = normalizeStars(userSnapshot.data()?.sidelineStars);
    if (rewardSnapshot.exists) {
      return {
        status: 'alreadyAwarded' as const,
        starsAwarded: normalizeStars(rewardSnapshot.data()?.amount ?? rewardSnapshot.data()?.points),
        totalSidelineStars: currentStars,
        breakdown: normalizeStoredBreakdown(rewardSnapshot.data()?.breakdown),
      };
    }

    const eligibility = gameType === 'triviaBlitz'
      ? await readTriviaRewardEligibility(transaction, sessionId, uid)
      : await readLocalGameRewardEligibility(transaction, gameType, sessionId, uid);
    if (!eligibility) {
      return {
        status: 'notEligible' as const,
        starsAwarded: 0,
        totalSidelineStars: currentStars,
        breakdown: emptyRewardBreakdown(),
      };
    }
    const amount = totalBreakdown(eligibility.breakdown);
    const awardedAt = Timestamp.now();
    const seasonEligibleSquadIds = await readSeasonEligibleSquadIds(transaction, uid);
    transaction.update(userRef, {
      sidelineStars: FieldValue.increment(amount),
      updatedAt: awardedAt,
    });
    transaction.create(rewardRef, {
      amount,
      sourceType: 'game',
      sourceId: sessionId,
      gameType,
      sourceSquadId: eligibility.sourceSquadId,
      awardedAt,
      seasonEligibleSquadIds,
      breakdown: eligibility.breakdown,
    });
    return {
      status: 'awarded' as const,
      starsAwarded: amount,
      totalSidelineStars: currentStars + amount,
      breakdown: eligibility.breakdown,
    };
  });
  console.info('[finalizeGameReward] completed', { gameType, rewardStatus: result.status, starsAmount: result.starsAwarded });
  return result;
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
      assignedAt: FieldValue.serverTimestamp(),
      completed: false,
      completedAt: null,
      pointsAwarded: false,
      timezone,
      updatedAt: FieldValue.serverTimestamp(),
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
          updatedAt: FieldValue.serverTimestamp(),
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

    const completedAt = Timestamp.now();
    const seasonEligibleSquadIds = await readSeasonEligibleSquadIds(transaction, uid);
    transaction.update(assignmentRef, {
      completed: true,
      completedAt,
      pointsAwarded: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(userRef, {
      sidelineStars: FieldValue.increment(WEEKLY_CHALLENGE_STARS),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(rewardRef, {
      transactionId: rewardId,
      amount: WEEKLY_CHALLENGE_STARS,
      sourceType: 'weeklyChallenge',
      sourceId: weekKey,
      type: 'weekly_challenge',
      weekKey,
      challengeId: definition.id,
      points: WEEKLY_CHALLENGE_STARS,
      awardedAt: completedAt,
      seasonEligibleSquadIds,
    });
    const displayName = resolveCanonicalPublicName(userSnapshot.data())?.displayName || 'Sideline Social member';
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
      pointsAwarded: WEEKLY_CHALLENGE_STARS,
      sidelineStars: currentStars + WEEKLY_CHALLENGE_STARS,
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
  if ((platform !== 'android' && platform !== 'ios') || token.length < 20 || token.length > 4096) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid notification token is required.');
  }
  if (platform === 'ios' && !/^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token)) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid Expo push token is required on iOS.');
  }

  const firestore = admin.firestore();
  const tokenId = createHash('sha256').update(token).digest('hex');
  await Promise.all([
    firestore.collection('notificationTokens').doc(tokenId).set({
      uid,
      token,
      platform,
      updatedAt: FieldValue.serverTimestamp(),
    }),
    // Remove the legacy profile fields if a development build ever wrote them.
    firestore.collection('users').doc(uid).set({
      fcmToken: FieldValue.delete(),
      fcmTokenUpdatedAt: FieldValue.delete(),
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

export const cleanupExpoPushReceipts = functions.pubsub
  .schedule('every 15 minutes')
  .onRun(async () => {
    await processPendingExpoPushReceipts();
    return null;
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
    if (!['parents', 'staff', 'all'].includes(announcement.audience)) return null;

    const teamId = context.params.teamId as string;
    const announcementId = context.params.announcementId as string;
    const firestore = admin.firestore();
    const teamSnapshot = await firestore.collection('teams').doc(teamId).get();
    if (!teamSnapshot.exists || !isTeamActive(teamSnapshot.data())) return null;
    const membersSnapshot = await firestore.collection('teams').doc(teamId).collection('members')
      .where('status', '==', 'active')
      .get();
    if (membersSnapshot.empty) return null;

    const authorUserId = typeof announcement.createdBy === 'string' ? announcement.createdBy : '';
    const coachName = await getPrivateNotificationActorName(authorUserId, 'Sideline Social member');
    const teamName = resolvePublicProfileName({ displayName: teamSnapshot.data()?.name }) || 'your team';
    const deliveries = await Promise.allSettled(
      membersSnapshot.docs.map(async (memberSnapshot) => {
        const member = memberSnapshot.data();
        if (!shouldReceiveAnnouncement(member, announcement.audience) || memberSnapshot.id === authorUserId) return;
        const isVoice = announcement.contentType === 'voice';
        await createPersonalNotificationAndPush({
          recipientUserId: memberSnapshot.id,
          eventId: `coachAnnouncement_${teamId}_${announcementId}`,
          type: 'coachAnnouncement',
          titleKey: 'notifications.types.coachAnnouncementTitle',
          bodyKey: 'notifications.types.coachAnnouncementBody',
          params: { actorName: coachName, teamName },
          actorUserId: authorUserId || undefined,
          teamId,
          announcementId,
          pushTitle: isVoice ? 'New team voice message' : 'New team announcement',
          pushBody: isVoice
            ? `${coachName} sent a voice message about ${teamName}.`
            : `${coachName} posted an update for ${teamName}.`,
          pushData: { teamId, announcementId },
        });
      }),
    );

    const failures = deliveries.filter((delivery) => delivery.status === 'rejected').length;
    if (failures > 0) {
      console.warn('[notifyParentsOfTeamAnnouncement] delivery failures', {
        type: 'coachAnnouncement',
        failures,
      });
    }
    return null;
  });

// ---------------------------------------------------------------------------
// Team voice uploads and private coach-parent Team Messages
// Reservations own every Storage path. Visible records are created only after
// trusted metadata verification, and private conversations are readable only
// by their explicit coach and parent participants.
// ---------------------------------------------------------------------------

const teamMessagingFunctions = functions.region('us-central1').runWith({
  timeoutSeconds: 30,
  memory: '256MB',
});
const TEAM_VOICE_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const TEAM_VOICE_SIGNED_URL_MS = 5 * 60 * 1000;

export const getOrCreatePrivateTeamConversation = teamMessagingFunctions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in is required.', { reason: 'auth_required' });
  try {
    const teamId = readRequiredIdentifier(data?.teamId, 'invalid_team_id');
    const parentUserId = readRequiredIdentifier(data?.parentUserId, 'invalid_parent_id');
    if (uid === parentUserId) throw new Error('invalid_parent_id');
    const firestore = admin.firestore();
    const teamRef = firestore.collection('teams').doc(teamId);
    const coachMemberRef = teamRef.collection('members').doc(uid);
    const parentMemberRef = teamRef.collection('members').doc(parentUserId);
    const conversationId = teamPrivateConversationId(teamId, uid, parentUserId);
    const conversationRef = firestore.collection('teamPrivateConversations').doc(conversationId);
    const [coachName, parentName] = await Promise.all([
      getPrivateNotificationActorName(uid, 'Sideline Social member'),
      getPrivateNotificationActorName(parentUserId, 'Sideline Social member'),
    ]);
    const result = await firestore.runTransaction(async (transaction) => {
      const [teamSnapshot, coachSnapshot, parentSnapshot, conversationSnapshot] = await transaction.getAll(
        teamRef,
        coachMemberRef,
        parentMemberRef,
        conversationRef,
      );
      const team = teamSnapshot.data();
      const coachMember = coachSnapshot.data();
      const parentMember = parentSnapshot.data();
      if (!teamSnapshot.exists || !isTeamActive(team)) throw new Error('team_not_found');
      if (!coachSnapshot.exists || !canManageTeamAnnouncements(coachMember)) throw new Error('not_authorized_coach');
      if (!parentSnapshot.exists || parentMember?.status !== 'active' || !hasParentRole(parentMember)) {
        throw new Error('parent_not_active');
      }
      const now = Timestamp.now();
      const teamName = resolvePublicProfileName({ displayName: team?.name }) || 'Team';
      if (conversationSnapshot.exists) {
        const existing = conversationSnapshot.data();
        if (existing?.teamId !== teamId || existing?.coachUserId !== uid || existing?.parentUserId !== parentUserId) {
          throw new Error('conversation_conflict');
        }
        transaction.update(conversationRef, { status: 'active', updatedAt: now });
      } else {
        transaction.create(conversationRef, {
          conversationId,
          teamId,
          coachUserId: uid,
          parentUserId,
          participantUserIds: [uid, parentUserId],
          status: 'active',
          teamName,
          coachDisplayName: coachName,
          parentDisplayName: parentName,
          lastMessageAt: null,
          lastMessageType: null,
          lastMessagePreview: null,
          lastSenderUserId: null,
          createdAt: now,
          updatedAt: now,
        });
        transaction.create(conversationRef.collection('members').doc(uid), {
          userId: uid,
          role: 'coach',
          joinedAt: now,
          lastReadAt: now,
          unreadCount: 0,
        });
        transaction.create(conversationRef.collection('members').doc(parentUserId), {
          userId: parentUserId,
          role: 'parent',
          joinedAt: now,
          lastReadAt: null,
          unreadCount: 0,
        });
      }
      return { conversationId, teamId, coachUserId: uid, parentUserId, teamName, coachName, parentName };
    });
    functions.logger.info('private_team_conversation_opened', { createdForTeam: Boolean(result.teamId) });
    return result;
  } catch (error) {
    throwTeamMessagingError(error);
  }
});

export const sendPrivateTeamTextMessage = teamMessagingFunctions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in is required.', { reason: 'auth_required' });
  try {
    const conversationId = readRequiredIdentifier(data?.conversationId, 'invalid_conversation_id');
    const clientMessageId = readClientIdentifier(data?.clientMessageId);
    const text = readBoundedText(data?.text, 1, 2000, 'invalid_message_text');
    assertUserContentAllowed(text);
    const firestore = admin.firestore();
    await enforceTeamMessageRateLimit(firestore, uid, 'privateText', 60);
    const result = await createPrivateTeamMessageTransaction(firestore, {
      caption: undefined,
      clientMessageId,
      contentType: 'text',
      conversationId,
      senderUserId: uid,
      text,
    });
    if (result.blocked) throw new Error('conversation_read_only');
    if (result.created) await notifyPrivateTeamMessage(result.conversation, uid, result.messageId);
    return { messageId: result.messageId, status: result.created ? 'sent' : 'alreadySent' };
  } catch (error) {
    throwTeamMessagingError(error);
  }
});

export const createTeamVoiceMemoUpload = teamMessagingFunctions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in is required.', { reason: 'auth_required' });
  try {
    const teamId = readRequiredIdentifier(data?.teamId, 'invalid_team_id');
    const kind = data?.kind;
    if (kind !== 'announcement' && kind !== 'privateMessage') throw new Error('invalid_voice_target');
    const voiceMemo = validateVoiceMemoMetadata(data?.voiceMemo);
    const firestore = admin.firestore();
    await enforceTeamMessageRateLimit(firestore, uid, 'voiceUpload', 20);
    const reservationRef = firestore.collection('teamVoiceUploadReservations').doc();
    const expiresAt = Timestamp.fromMillis(Date.now() + TEAM_VOICE_UPLOAD_TTL_MS);
    let targetId: string;
    let storagePath: string;
    let reservationData: Record<string, unknown>;
    if (kind === 'announcement') {
      const title = readBoundedText(data?.title, 1, 160, 'announcement_title_required');
      const summary = readBoundedText(data?.summary, 1, 2000, 'announcement_summary_required');
      assertUserContentAllowed(title, summary);
      const audience = readAnnouncementAudience(data?.audience);
      const allowReplies = data?.allowReplies !== false;
      const teamRef = firestore.collection('teams').doc(teamId);
      const [teamSnapshot, memberSnapshot] = await Promise.all([
        teamRef.get(),
        teamRef.collection('members').doc(uid).get(),
      ]);
      if (!teamSnapshot.exists || !isTeamActive(teamSnapshot.data())) throw new Error('team_not_found');
      if (!memberSnapshot.exists || !canManageTeamAnnouncements(memberSnapshot.data())) throw new Error('not_authorized_coach');
      targetId = teamRef.collection('announcements').doc().id;
      storagePath = teamVoiceStoragePath({ teamId, announcementId: targetId, reservationId: reservationRef.id });
      reservationData = { title, summary, audience, allowReplies };
    } else {
      const conversationId = readRequiredIdentifier(data?.conversationId, 'invalid_conversation_id');
      const clientMessageId = readClientIdentifier(data?.clientMessageId);
      const caption = readOptionalBoundedText(data?.caption, 500, 'invalid_caption');
      assertUserContentAllowed(caption);
      const conversation = await requireActivePrivateConversation(firestore, conversationId, uid);
      if (conversation.teamId !== teamId) throw new Error('conversation_not_found');
      targetId = teamPrivateMessageId(conversationId, uid, clientMessageId);
      storagePath = teamVoiceStoragePath({
        teamId,
        conversationId,
        messageId: targetId,
        reservationId: reservationRef.id,
      });
      reservationData = { conversationId, clientMessageId, caption: caption ?? null };
    }
    await reservationRef.create({
      reservationId: reservationRef.id,
      kind,
      teamId,
      userId: uid,
      targetId,
      storagePath,
      status: 'pending',
      voiceMemo,
      ...reservationData,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
    });
    return { reservationId: reservationRef.id, targetId, storagePath, expiresAtMillis: expiresAt.toMillis() };
  } catch (error) {
    throwTeamMessagingError(error);
  }
});

export const finalizeTeamVoiceAnnouncement = teamMessagingFunctions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in is required.', { reason: 'auth_required' });
  try {
    const reservationId = readRequiredIdentifier(data?.reservationId, 'invalid_reservation_id');
    const firestore = admin.firestore();
    const reservationRef = firestore.collection('teamVoiceUploadReservations').doc(reservationId);
    const initialSnapshot = await reservationRef.get();
    const initial = initialSnapshot.data();
    if (!initialSnapshot.exists || initial?.kind !== 'announcement' || initial.userId !== uid) throw new Error('upload_expired');
    if (initial.status === 'finalized') return { announcementId: initial.targetId, status: 'alreadyFinalized' };
    const verifiedVoiceMemo = await verifyUploadedVoiceMemo(initial);
    const teamId = readRequiredIdentifier(initial.teamId, 'invalid_team_id');
    const announcementId = readRequiredIdentifier(initial.targetId, 'invalid_announcement_id');
    const teamRef = firestore.collection('teams').doc(teamId);
    const announcementRef = teamRef.collection('announcements').doc(announcementId);
    const status = await firestore.runTransaction(async (transaction) => {
      const [reservationSnapshot, teamSnapshot, memberSnapshot, announcementSnapshot] = await transaction.getAll(
        reservationRef,
        teamRef,
        teamRef.collection('members').doc(uid),
        announcementRef,
      );
      const reservation = reservationSnapshot.data();
      if (!reservationSnapshot.exists || reservation?.userId !== uid || reservation.kind !== 'announcement') throw new Error('upload_expired');
      if (reservation.status === 'finalized' || announcementSnapshot.exists) return 'alreadyFinalized' as const;
      if ((timestampMillis(reservation.expiresAt) ?? 0) <= Date.now()) throw new Error('upload_expired');
      if (!teamSnapshot.exists || !isTeamActive(teamSnapshot.data())) throw new Error('team_not_found');
      if (!memberSnapshot.exists || !canManageTeamAnnouncements(memberSnapshot.data())) throw new Error('not_authorized_coach');
      transaction.create(announcementRef, {
        contentType: 'voice',
        title: reservation.title,
        body: reservation.summary,
        voiceMemo: verifiedVoiceMemo,
        audience: reservation.audience,
        allowReplies: reservation.allowReplies !== false,
        createdBy: uid,
        createdByName: resolveReplyAuthorName(undefined, memberSnapshot.data(), context.auth?.token?.name),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(reservationRef, { status: 'finalized', finalizedAt: FieldValue.serverTimestamp() });
      return 'sent' as const;
    });
    return { announcementId, status };
  } catch (error) {
    throwTeamMessagingError(error);
  }
});

export const finalizePrivateTeamVoiceMessage = teamMessagingFunctions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in is required.', { reason: 'auth_required' });
  try {
    const reservationId = readRequiredIdentifier(data?.reservationId, 'invalid_reservation_id');
    const firestore = admin.firestore();
    const reservationRef = firestore.collection('teamVoiceUploadReservations').doc(reservationId);
    const initialSnapshot = await reservationRef.get();
    const initial = initialSnapshot.data();
    if (!initialSnapshot.exists || initial?.kind !== 'privateMessage' || initial.userId !== uid) throw new Error('upload_expired');
    if (initial.status === 'finalized') return { messageId: initial.targetId, status: 'alreadyFinalized' };
    const voiceMemo = await verifyUploadedVoiceMemo(initial);
    const result = await createPrivateTeamMessageTransaction(firestore, {
      caption: typeof initial.caption === 'string' ? initial.caption : undefined,
      clientMessageId: readClientIdentifier(initial.clientMessageId),
      contentType: 'voice',
      conversationId: readRequiredIdentifier(initial.conversationId, 'invalid_conversation_id'),
      reservationRef,
      senderUserId: uid,
      voiceMemo,
    });
    if (result.blocked) throw new Error('conversation_read_only');
    if (result.created) await notifyPrivateTeamMessage(result.conversation, uid, result.messageId);
    return { messageId: result.messageId, status: result.created ? 'sent' : 'alreadyFinalized' };
  } catch (error) {
    throwTeamMessagingError(error);
  }
});

export const markPrivateTeamConversationRead = teamMessagingFunctions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in is required.', { reason: 'auth_required' });
  try {
    const conversationId = readRequiredIdentifier(data?.conversationId, 'invalid_conversation_id');
    const firestore = admin.firestore();
    const conversationRef = firestore.collection('teamPrivateConversations').doc(conversationId);
    await firestore.runTransaction(async (transaction) => {
      const conversationSnapshot = await transaction.get(conversationRef);
      const conversation = conversationSnapshot.data();
      if (!conversationSnapshot.exists || !isExplicitConversationParticipant(conversation, uid)) {
        throw new Error('not_conversation_participant');
      }
      transaction.set(conversationRef.collection('members').doc(uid), {
        userId: uid,
        role: conversation?.coachUserId === uid ? 'coach' : 'parent',
        lastReadAt: FieldValue.serverTimestamp(),
        unreadCount: 0,
      }, { merge: true });
    });
    return { status: 'read' };
  } catch (error) {
    throwTeamMessagingError(error);
  }
});

export const getTeamPrivateMessageInbox = teamMessagingFunctions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in is required.', { reason: 'auth_required' });
  try {
    const requestedRole = data?.role === 'coach' ? 'coach' : data?.role === 'parent' ? 'parent' : null;
    if (!requestedRole) throw new Error('invalid_conversation_role');
    const teamId = data?.teamId == null ? null : readRequiredIdentifier(data.teamId, 'invalid_team_id');
    const offset = data?.offset == null ? 0 : Number(data.offset);
    const pageSize = data?.pageSize == null ? 25 : Number(data.pageSize);
    if (!Number.isInteger(offset) || offset < 0 || offset > 500) throw new Error('invalid_inbox_offset');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new Error('invalid_inbox_page_size');
    const firestore = admin.firestore();
    const snapshot = await firestore.collection('teamPrivateConversations')
      .where('participantUserIds', 'array-contains', uid)
      .orderBy('lastMessageAt', 'desc')
      .offset(offset)
      .limit(pageSize + 1)
      .get();
    const pageDocuments = snapshot.docs.slice(0, pageSize);
    const conversations = pageDocuments.filter((document) => {
      const value = document.data();
      if (!isExplicitConversationParticipant(value, uid)) return false;
      if (requestedRole === 'coach' && value.coachUserId !== uid) return false;
      if (requestedRole === 'parent' && value.parentUserId !== uid) return false;
      return !teamId || value.teamId === teamId;
    });
    const memberSnapshots = conversations.length > 0
      ? await firestore.getAll(...conversations.map((document) => document.ref.collection('members').doc(uid)))
      : [];
    return {
      conversations: conversations.map((document, index) => serializePrivateConversation(
        document.id,
        document.data(),
        memberSnapshots[index]?.data(),
      )),
      hasMore: snapshot.size > pageSize,
      nextOffset: offset + pageDocuments.length,
    };
  } catch (error) {
    throwTeamMessagingError(error);
  }
});

export const getTeamVoiceMemoDownloadUrl = teamMessagingFunctions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in is required.', { reason: 'auth_required' });
  try {
    const storagePath = readBoundedText(data?.storagePath, 1, 1024, 'invalid_storage_path');
    const match = /^teamVoiceMemos\/[^/]+\/(?:announcements|privateConversations)\/.+\/([A-Za-z0-9_-]+)\/memo\.m4a$/u.exec(storagePath);
    if (!match) throw new Error('invalid_storage_path');
    const reservationSnapshot = await admin.firestore().collection('teamVoiceUploadReservations').doc(match[1]).get();
    const reservation = reservationSnapshot.data();
    if (!reservationSnapshot.exists || reservation?.status !== 'finalized' || reservation.storagePath !== storagePath) {
      throw new Error('voice_message_unavailable');
    }
    const firestore = admin.firestore();
    if (reservation.kind === 'announcement') {
      const teamId = readRequiredIdentifier(reservation.teamId, 'invalid_team_id');
      const [memberSnapshot, announcementSnapshot] = await Promise.all([
        firestore.collection('teams').doc(teamId).collection('members').doc(uid).get(),
        firestore.collection('teams').doc(teamId).collection('announcements').doc(reservation.targetId).get(),
      ]);
      if (!announcementSnapshot.exists || !canAccessTeamAnnouncement(memberSnapshot.data(), announcementSnapshot.data()?.audience)) {
        throw new Error('not_authorized_voice_recipient');
      }
    } else {
      const conversationSnapshot = await firestore.collection('teamPrivateConversations').doc(reservation.conversationId).get();
      if (!conversationSnapshot.exists || !isExplicitConversationParticipant(conversationSnapshot.data(), uid)) {
        throw new Error('not_conversation_participant');
      }
    }
    const expiresAtMillis = Date.now() + TEAM_VOICE_SIGNED_URL_MS;
    const [url] = await admin.storage().bucket().file(storagePath).getSignedUrl({ action: 'read', expires: expiresAtMillis });
    return { url, expiresAtMillis };
  } catch (error) {
    throwTeamMessagingError(error);
  }
});

export const cleanupAbandonedTeamVoiceUploads = teamMessagingFunctions.pubsub
  .schedule('every 24 hours')
  .onRun(async () => {
    const firestore = admin.firestore();
    const snapshot = await firestore.collection('teamVoiceUploadReservations')
      .where('status', '==', 'pending')
      .where('expiresAt', '<=', Timestamp.now())
      .limit(100)
      .get();
    let deletedObjects = 0;
    await Promise.all(snapshot.docs.map(async (document) => {
      const storagePath = document.data()?.storagePath;
      if (typeof storagePath === 'string' && storagePath.startsWith('teamVoiceMemos/')) {
        await admin.storage().bucket().file(storagePath).delete({ ignoreNotFound: true });
        deletedObjects += 1;
      }
      await document.ref.delete();
    }));
    functions.logger.info('team_voice_cleanup_completed', {
      reservations: snapshot.size,
      deletedObjects,
    });
    return null;
  });

type PrivateMessageTransactionInput = {
  caption?: string;
  clientMessageId: string;
  contentType: 'text' | 'voice';
  conversationId: string;
  reservationRef?: FirebaseFirestore.DocumentReference;
  senderUserId: string;
  text?: string;
  voiceMemo?: Record<string, unknown>;
};

async function createPrivateTeamMessageTransaction(
  firestore: FirebaseFirestore.Firestore,
  input: PrivateMessageTransactionInput,
) {
  const conversationRef = firestore.collection('teamPrivateConversations').doc(input.conversationId);
  const messageId = teamPrivateMessageId(input.conversationId, input.senderUserId, input.clientMessageId);
  return firestore.runTransaction(async (transaction) => {
    const conversationSnapshot = await transaction.get(conversationRef);
    const conversation = conversationSnapshot.data();
    if (!conversationSnapshot.exists || !isExplicitConversationParticipant(conversation, input.senderUserId)) {
      throw new Error('not_conversation_participant');
    }
    const teamId = readRequiredIdentifier(conversation?.teamId, 'invalid_team_id');
    const coachUserId = readRequiredIdentifier(conversation?.coachUserId, 'invalid_coach_id');
    const parentUserId = readRequiredIdentifier(conversation?.parentUserId, 'invalid_parent_id');
    const teamRef = firestore.collection('teams').doc(teamId);
    const messageRef = conversationRef.collection('messages').doc(messageId);
    const senderMemberRef = teamRef.collection('members').doc(input.senderUserId);
    const coachMemberRef = teamRef.collection('members').doc(coachUserId);
    const parentMemberRef = teamRef.collection('members').doc(parentUserId);
    const reads: FirebaseFirestore.DocumentReference[] = [teamRef, coachMemberRef, parentMemberRef, messageRef];
    if (input.reservationRef) reads.push(input.reservationRef);
    const [teamSnapshot, coachSnapshot, parentSnapshot, messageSnapshot, reservationSnapshot] = await transaction.getAll(...reads);
    const active = teamSnapshot.exists && isTeamActive(teamSnapshot.data()) &&
      coachSnapshot.exists && canManageTeamAnnouncements(coachSnapshot.data()) &&
      parentSnapshot.exists && parentSnapshot.data()?.status === 'active' && hasParentRole(parentSnapshot.data());
    if (!active) {
      transaction.update(conversationRef, { status: 'readOnly', updatedAt: FieldValue.serverTimestamp() });
      return { blocked: true as const, conversation: conversation ?? {}, created: false, messageId };
    }
    if (messageSnapshot.exists) {
      if (input.reservationRef && reservationSnapshot?.exists && reservationSnapshot.data()?.status !== 'finalized') {
        transaction.update(input.reservationRef, { status: 'finalized', finalizedAt: FieldValue.serverTimestamp() });
      }
      return { blocked: false as const, conversation: conversation ?? {}, created: false, messageId };
    }
    if (input.reservationRef) {
      const reservation = reservationSnapshot?.data();
      if (!reservationSnapshot?.exists || reservation?.userId !== input.senderUserId || reservation.status !== 'pending') {
        throw new Error('upload_expired');
      }
      if ((timestampMillis(reservation.expiresAt) ?? 0) <= Date.now()) throw new Error('upload_expired');
    }
    const senderRole = conversation?.coachUserId === input.senderUserId ? 'coach' : 'parent';
    const recipientUserId = senderRole === 'coach' ? parentUserId : coachUserId;
    const now = Timestamp.now();
    const preview = privateMessagePreview(input.contentType, input.text ?? input.caption, input.voiceMemo?.durationMilliseconds as number | undefined);
    transaction.create(messageRef, {
      messageId,
      conversationId: input.conversationId,
      teamId,
      senderUserId: input.senderUserId,
      senderRole,
      contentType: input.contentType,
      text: input.contentType === 'text' ? input.text : null,
      caption: input.contentType === 'voice' ? input.caption ?? null : null,
      voiceMemo: input.contentType === 'voice' ? input.voiceMemo : null,
      clientMessageId: input.clientMessageId,
      createdAt: now,
    });
    transaction.update(conversationRef, {
      status: 'active',
      lastMessageAt: now,
      lastMessageType: input.contentType,
      lastMessagePreview: preview,
      lastSenderUserId: input.senderUserId,
      updatedAt: now,
    });
    transaction.set(conversationRef.collection('members').doc(input.senderUserId), {
      userId: input.senderUserId,
      role: senderRole,
      lastReadAt: now,
      unreadCount: 0,
    }, { merge: true });
    transaction.set(conversationRef.collection('members').doc(recipientUserId), {
      userId: recipientUserId,
      role: senderRole === 'coach' ? 'parent' : 'coach',
      unreadCount: FieldValue.increment(1),
    }, { merge: true });
    if (input.reservationRef) transaction.update(input.reservationRef, { status: 'finalized', finalizedAt: now });
    return { blocked: false as const, conversation: conversation ?? {}, created: true, messageId };
  });
}

async function requireActivePrivateConversation(
  firestore: FirebaseFirestore.Firestore,
  conversationId: string,
  userId: string,
) {
  const conversationRef = firestore.collection('teamPrivateConversations').doc(conversationId);
  const conversationSnapshot = await conversationRef.get();
  const conversation = conversationSnapshot.data();
  if (!conversationSnapshot.exists || !isExplicitConversationParticipant(conversation, userId)) {
    throw new Error('not_conversation_participant');
  }
  const teamId = readRequiredIdentifier(conversation?.teamId, 'invalid_team_id');
  const [teamSnapshot, coachSnapshot, parentSnapshot] = await Promise.all([
    firestore.collection('teams').doc(teamId).get(),
    firestore.collection('teams').doc(teamId).collection('members').doc(String(conversation?.coachUserId)).get(),
    firestore.collection('teams').doc(teamId).collection('members').doc(String(conversation?.parentUserId)).get(),
  ]);
  if (!teamSnapshot.exists || !isTeamActive(teamSnapshot.data()) ||
    !coachSnapshot.exists || !canManageTeamAnnouncements(coachSnapshot.data()) ||
    !parentSnapshot.exists || parentSnapshot.data()?.status !== 'active' || !hasParentRole(parentSnapshot.data())) {
    await conversationRef.set({ status: 'readOnly', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw new Error('conversation_read_only');
  }
  return conversation as Record<string, unknown>;
}

async function verifyUploadedVoiceMemo(reservation: Record<string, unknown>) {
  const storagePath = readBoundedText(reservation.storagePath, 1, 1024, 'invalid_storage_path');
  const declared = validateVoiceMemoMetadata(reservation.voiceMemo);
  const [exists] = await admin.storage().bucket().file(storagePath).exists();
  if (!exists) throw new Error('upload_failed');
  const [metadata] = await admin.storage().bucket().file(storagePath).getMetadata();
  const actualSize = Number(metadata.size);
  const actualMime = typeof metadata.contentType === 'string' ? metadata.contentType : '';
  if (!Number.isInteger(actualSize) || actualSize < 1 || actualSize > TEAM_VOICE_MAX_SIZE_BYTES || actualSize !== declared.sizeBytes) {
    throw new Error('voice_file_too_large');
  }
  if (!['audio/mp4', 'audio/m4a', 'audio/x-m4a'].includes(actualMime) || actualMime !== declared.mimeType) {
    throw new Error('unsupported_audio_type');
  }
  return { storagePath, ...declared };
}

async function notifyPrivateTeamMessage(
  conversation: Record<string, unknown>,
  senderUserId: string,
  messageId: string,
) {
  const coachUserId = String(conversation.coachUserId ?? '');
  const parentUserId = String(conversation.parentUserId ?? '');
  const recipientUserId = senderUserId === coachUserId ? parentUserId : coachUserId;
  if (!recipientUserId) return;
  const senderName = await getPrivateNotificationActorName(senderUserId, 'Sideline Social member');
  const teamName = resolvePublicProfileName({ displayName: conversation.teamName }) || 'your team';
  const recipientIsCoach = recipientUserId === coachUserId;
  await createPersonalNotificationAndPush({
    recipientUserId,
    eventId: `teamPrivateMessage_${conversation.conversationId}_${messageId}`,
    type: 'teamPrivateMessage',
    titleKey: 'notifications.types.teamPrivateMessageTitle',
    bodyKey: 'notifications.types.teamPrivateMessageBody',
    params: { actorName: senderName, teamName },
    actorUserId: senderUserId,
    teamId: String(conversation.teamId ?? ''),
    conversationId: String(conversation.conversationId ?? ''),
    conversationType: recipientIsCoach ? 'coach' : 'parent',
    pushTitle: recipientIsCoach ? 'New private team reply' : 'New private team message',
    pushBody: recipientIsCoach
      ? `${senderName} replied about ${teamName}.`
      : `${senderName} sent you a message about ${teamName}.`,
    pushData: {
      teamId: String(conversation.teamId ?? ''),
      conversationId: String(conversation.conversationId ?? ''),
      conversationType: recipientIsCoach ? 'coach' : 'parent',
    },
  });
}

async function enforceTeamMessageRateLimit(
  firestore: FirebaseFirestore.Firestore,
  userId: string,
  scope: string,
  maximum: number,
) {
  const reference = firestore.collection('teamMessageRateLimits').doc(`${userId}_${scope}`);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const now = Date.now();
    const windowStart = timestampMillis(snapshot.data()?.windowStart) ?? 0;
    const withinWindow = now - windowStart < 60 * 60 * 1000;
    const count = withinWindow ? Number(snapshot.data()?.count ?? 0) : 0;
    if (count >= maximum) throw new Error('rate_limited');
    transaction.set(reference, {
      userId,
      scope,
      count: count + 1,
      windowStart: Timestamp.fromMillis(withinWindow ? windowStart : now),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

function serializePrivateConversation(
  conversationId: string,
  conversation: Record<string, unknown>,
  member: Record<string, unknown> | undefined,
) {
  return {
    conversationId,
    teamId: String(conversation.teamId ?? ''),
    coachUserId: String(conversation.coachUserId ?? ''),
    parentUserId: String(conversation.parentUserId ?? ''),
    teamName: String(conversation.teamName ?? ''),
    coachDisplayName: String(conversation.coachDisplayName ?? 'Sideline Social member'),
    parentDisplayName: String(conversation.parentDisplayName ?? 'Sideline Social member'),
    status: conversation.status === 'readOnly' ? 'readOnly' : 'active',
    lastMessageAtMillis: timestampMillis(conversation.lastMessageAt) ?? 0,
    lastMessageType: conversation.lastMessageType === 'voice' ? 'voice' : conversation.lastMessageType === 'text' ? 'text' : null,
    lastMessagePreview: typeof conversation.lastMessagePreview === 'string' ? conversation.lastMessagePreview : null,
    lastSenderUserId: typeof conversation.lastSenderUserId === 'string' ? conversation.lastSenderUserId : null,
    unreadCount: Math.max(0, Number(member?.unreadCount ?? 0)),
  };
}

function throwTeamMessagingError(error: unknown): never {
  if (error instanceof functions.https.HttpsError) throw error;
  const reason = error instanceof Error ? error.message : 'team_messaging_failed';
  const permissionReasons = new Set([
    'not_authorized_coach',
    'not_conversation_participant',
    'not_authorized_voice_recipient',
    'parent_not_active',
  ]);
  const notFoundReasons = new Set(['team_not_found', 'conversation_not_found', 'voice_message_unavailable']);
  const failedReasons = new Set(['conversation_read_only', 'upload_expired']);
  const code: functions.https.FunctionsErrorCode = reason === 'rate_limited'
    ? 'resource-exhausted'
    : permissionReasons.has(reason)
      ? 'permission-denied'
      : notFoundReasons.has(reason)
        ? 'not-found'
        : failedReasons.has(reason)
          ? 'failed-precondition'
          : 'invalid-argument';
  throw new functions.https.HttpsError(code, 'The Team Message request could not be completed.', { reason });
}

// ---------------------------------------------------------------------------
// Public social profile reads
// Private users documents remain self-only. These callables return only the
// minimum profile and suggestion fields needed by authenticated app surfaces.
// ---------------------------------------------------------------------------

export const syncPublicUserProfile = functions.firestore
  .document('users/{userId}')
  .onWrite(async (change, context) => {
    const publicRef = admin.firestore().collection('publicUserProfiles').doc(context.params.userId);
    if (!change.after.exists) {
      await publicRef.delete();
      return null;
    }
    const profile = resolveCanonicalPublicProfile(context.params.userId, change.after.data());
    if (!profile) {
      await publicRef.delete();
      return null;
    }
    await publicRef.set({ ...toMinimalPublicUserProfile(profile), updatedAt: FieldValue.serverTimestamp() });
    return null;
  });

export const updatePublicUserProfile = functions.https.onCall(async (data, context) => {
  const userId = context.auth?.uid;
  if (!userId) throw new functions.https.HttpsError('unauthenticated', 'Sign in to update your profile.');
  const firstName = typeof data?.firstName === 'string' ? data.firstName : '';
  const lastName = typeof data?.lastName === 'string' ? data.lastName : '';
  const requestedPhotoURL = data?.photoURL;
  const firestore = admin.firestore();
  const privateRef = firestore.collection('users').doc(userId);
  const publicRef = firestore.collection('publicUserProfiles').doc(userId);
  const profile = await firestore.runTransaction(async (transaction) => {
    const privateSnapshot = await transaction.get(privateRef);
    if (!privateSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Your profile is unavailable.');
    const existing = privateSnapshot.data() ?? {};
    const photoURL = requestedPhotoURL === undefined
      ? existing.photoURL ?? existing.photoUrl ?? null
      : requestedPhotoURL;
    if (photoURL !== null && (typeof photoURL !== 'string' || photoURL.length > 2048 || !/^https:\/\//u.test(photoURL))) {
      throw new functions.https.HttpsError('invalid-argument', 'The profile photo is invalid.');
    }
    const next = resolveCanonicalPublicProfile(userId, { firstName, lastName, photoURL });
    if (!next) {
      throw new functions.https.HttpsError('invalid-argument', 'A valid first and last name are required.');
    }
    const now = Timestamp.now();
    transaction.set(privateRef, {
      firstName: next.firstName,
      lastName: next.lastName,
      displayName: next.displayName,
      photoURL: next.photoURL,
      updatedAt: now,
    }, { merge: true });
    const publicProfile = toMinimalPublicUserProfile(next);
    transaction.set(publicRef, { ...publicProfile, updatedAt: now });
    return { privateProfile: next, publicProfile };
  });
  try {
    await admin.auth().updateUser(userId, { displayName: profile.privateProfile.displayName, photoURL: profile.privateProfile.photoURL ?? undefined });
  } catch (error) {
    console.warn('[updatePublicUserProfile] auth projection unavailable', {
      code: typeof error === 'object' && error && 'code' in error ? String(error.code) : 'unknown',
    });
  }
  return { profile: profile.publicProfile };
});

export const getPublicUserProfiles = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication is required.');
  }
  const requestedCount = Array.isArray(data?.userIds) ? data.userIds.length : 0;
  const userIds = normalizePublicProfileIds(data?.userIds);
  if (userIds.length === 0) return { profiles: [] };

  const firestore = admin.firestore();
  const publicSnapshots = await firestore.getAll(
    ...userIds.map((userId) => firestore.collection('publicUserProfiles').doc(userId)),
  );
  const resolved = new Map<string, ReturnType<typeof resolveCanonicalPublicProfile>>();
  let projectionNameCount = 0;
  publicSnapshots.forEach((snapshot) => {
    const profile = snapshot.data();
    if (isCanonicalPublicProfile(profile, snapshot.id)) {
      projectionNameCount += 1;
      resolved.set(snapshot.id, profile as NonNullable<ReturnType<typeof resolveCanonicalPublicProfile>>);
    }
  });

  const fallbackIds = userIds.filter((userId) => !resolved.has(userId));
  const privateSnapshots = fallbackIds.length > 0
    ? await firestore.getAll(...fallbackIds.map((userId) => firestore.collection('users').doc(userId)))
    : [];
  const existingUserIds = new Set(privateSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => snapshot.id));
  privateSnapshots.forEach((snapshot) => {
    const profile = resolveCanonicalPublicProfile(snapshot.id, snapshot.data());
    if (profile) resolved.set(snapshot.id, profile);
  });

  const authFallbackIds = fallbackIds.filter((userId) => !resolved.has(userId));
  if (authFallbackIds.length > 0) {
    const authUsers = await admin.auth().getUsers(authFallbackIds.map((uid) => ({ uid })));
    authUsers.users.forEach((authUser) => {
      existingUserIds.add(authUser.uid);
      const profile = resolveCanonicalPublicProfile(authUser.uid, undefined, authUser.displayName);
      if (profile) resolved.set(authUser.uid, profile);
    });
  }

  const selfHealingProfiles = fallbackIds
    .map((userId) => resolved.get(userId))
    .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile));
  await Promise.allSettled(selfHealingProfiles.map((profile) => firestore
    .collection('publicUserProfiles')
    .doc(profile.userId)
    .set({ ...toMinimalPublicUserProfile(profile), updatedAt: FieldValue.serverTimestamp() })));

  const resolvedProfiles: {
    userId: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    photoURL: string | null;
    profileState: 'available' | 'unnamed' | 'deleted';
  }[] = [];
  userIds.forEach((userId) => {
    const profile = resolved.get(userId);
    if (profile) {
      resolvedProfiles.push({ ...toMinimalPublicUserProfile(profile), profileState: 'available' });
      return;
    }
    if (existingUserIds.has(userId)) {
      resolvedProfiles.push({ userId, firstName: null, lastName: null, displayName: null, photoURL: null, profileState: 'unnamed' });
      return;
    }
    resolvedProfiles.push({ userId, firstName: null, lastName: null, displayName: null, photoURL: null, profileState: 'deleted' });
  });
  console.warn('[publicProfiles] resolution summary', {
    requestedCount,
    validIdCount: userIds.length,
    projectionNameCount,
    serverFallbackCount: selfHealingProfiles.length,
    unresolvedCount: resolvedProfiles.filter((profile) => !profile.displayName).length,
    returnedProfileCount: resolvedProfiles.length,
  });
  return {
    profiles: resolvedProfiles,
  };
});

export const getSuggestedConnections = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to view suggestions.');

  const queryText = typeof data?.queryText === 'string' ? data.queryText.trim() : '';
  if (queryText.length > 80) {
    throw new functions.https.HttpsError('invalid-argument', 'Search text is too long.');
  }
  const normalizedQuery = queryText.toLocaleLowerCase();
  const firestore = admin.firestore();
  const viewerSnapshot = await firestore.collection('users').doc(uid).get();
  if (!viewerSnapshot.exists) return { suggestions: [] };

  const viewer = viewerSnapshot.data() ?? {};
  const viewerFriendIds = readStringArray(viewer.friendIds);
  const blockedUserIds = await readBlockedRelationshipIds(uid);
  const excludedUserIds = new Set([uid, ...viewerFriendIds, ...blockedUserIds]);
  let candidateSnapshots: admin.firestore.QueryDocumentSnapshot[];
  if (normalizedQuery) {
    const prefixSnapshot = await firestore.collection('users')
      .where('searchName', '>=', normalizedQuery)
      .where('searchName', '<=', `${normalizedQuery}\uf8ff`)
      .limit(50)
      .get();
    candidateSnapshots = prefixSnapshot.docs;
    if (candidateSnapshots.length === 0) {
      candidateSnapshots = (await firestore.collection('users').limit(100).get()).docs;
    }
  } else {
    candidateSnapshots = (await firestore.collection('users').orderBy('createdAt', 'desc').limit(50).get()).docs;
  }

  const candidates = candidateSnapshots
    .filter((snapshot) => !excludedUserIds.has(snapshot.id))
    .map((snapshot) => ({
      snapshot,
      profile: snapshot.data(),
      publicProfile: (() => {
        const profile = resolveCanonicalPublicProfile(snapshot.id, snapshot.data());
        return profile ? toMinimalPublicUserProfile(profile) : null;
      })(),
    }))
    .filter((candidate) => Boolean(candidate.publicProfile))
    .filter((candidate) => !normalizedQuery || candidate.publicProfile?.displayName.toLocaleLowerCase().includes(normalizedQuery));

  const sharedSquadNames = new Map<string, string>();
  const viewerSquads = await firestore.collection('squads')
    .where('memberIds', 'array-contains', uid)
    .limit(50)
    .get();
  for (const squadSnapshot of viewerSquads.docs) {
    const squad = squadSnapshot.data();
    const squadName = typeof squad.name === 'string' ? squad.name.trim() : '';
    if (!squadName) continue;
    const memberIds = new Set(readStringArray(squad.memberIds));
    candidates.forEach((candidate) => {
      if (memberIds.has(candidate.snapshot.id) && !sharedSquadNames.has(candidate.snapshot.id)) {
        sharedSquadNames.set(candidate.snapshot.id, squadName);
      }
    });
  }

  return {
    suggestions: candidates.slice(0, 20).map(({ snapshot, profile, publicProfile }) => {
      const mutualConnectionCount = countMutualConnections(viewerFriendIds, profile.friendIds);
      return {
        userId: snapshot.id,
        firstName: publicProfile?.firstName ?? null,
        lastName: publicProfile?.lastName ?? null,
        displayName: publicProfile?.displayName ?? null,
        photoURL: publicProfile?.photoURL ?? null,
        profileState: 'available' as const,
        sharedSquadName: sharedSquadNames.get(snapshot.id) ?? null,
        sharedActivity: findSharedActivity(viewer.sports, profile.sports),
        mutualConnectionCount: mutualConnectionCount > 0 ? mutualConnectionCount : null,
      };
    }),
  };
});

function normalizePublicProfileIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new functions.https.HttpsError('invalid-argument', 'User references are required.');
  }
  const userIds = Array.from(new Set(value.map((item) => typeof item === 'string' ? item.trim() : '')));
  if (userIds.length > 50 || userIds.some((userId) => !/^[A-Za-z0-9_-]{1,128}$/.test(userId))) {
    throw new functions.https.HttpsError('invalid-argument', 'User references are invalid.');
  }
  return userIds;
}

// ---------------------------------------------------------------------------
// Team announcement deletion
// The callable owns authorization and recursive cleanup so a client cannot
// leave reply/read descendants behind or delete an announcement for another
// team. Active staff retain their existing announcement-management permission.
// ---------------------------------------------------------------------------

export const deleteTeamAnnouncement = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to delete an announcement.');

  const teamId = readReplyPathId(data?.teamId, 'team');
  const announcementId = readReplyPathId(data?.announcementId, 'announcement');
  const firestore = admin.firestore();
  const teamRef = firestore.collection('teams').doc(teamId);
  const memberRef = teamRef.collection('members').doc(uid);
  const announcementRef = teamRef.collection('announcements').doc(announcementId);
  let status: TeamAnnouncementDeletionStatus = 'alreadyDeleted';
  let voiceStoragePath: string | null = null;

  await firestore.runTransaction(async (transaction) => {
    const [teamSnapshot, memberSnapshot, announcementSnapshot] = await transaction.getAll(
      teamRef,
      memberRef,
      announcementRef,
    );
    if (!teamSnapshot.exists) {
      throw new functions.https.HttpsError('not-found', 'Team unavailable.');
    }
    if (!isTeamActive(teamSnapshot.data())) {
      throw new functions.https.HttpsError('failed-precondition', 'This team is no longer active.', { reason: 'team-inactive' });
    }
    const member = memberSnapshot.exists ? memberSnapshot.data() : undefined;
    if (!canManageTeamAnnouncements(member)) {
      throw new functions.https.HttpsError('permission-denied', 'Announcement management access is required.');
    }
    if (!announcementSnapshot.exists) return;

    const storedPath = announcementSnapshot.data()?.voiceMemo?.storagePath;
    voiceStoragePath = typeof storedPath === 'string' && storedPath.startsWith(`teamVoiceMemos/${teamId}/announcements/`)
      ? storedPath
      : null;

    transaction.delete(announcementRef);
    status = 'deleted';
  });

  // Membership documents are retained when access changes, so this list also
  // reaches announcement inbox entries belonging to former team members.
  const memberSnapshot = await teamRef.collection('members').get();
  await deleteTeamAnnouncementData(
    firestore,
    announcementRef,
    memberSnapshot.docs.map((memberDocument) => memberDocument.id),
  );
  if (voiceStoragePath) {
    const reservationMatch = /\/([A-Za-z0-9_-]+)\/memo\.m4a$/u.exec(voiceStoragePath);
    const reservationRef = reservationMatch
      ? firestore.collection('teamVoiceUploadReservations').doc(reservationMatch[1])
      : null;
    if (reservationRef) {
      await reservationRef.set({ status: 'deletePending', expiresAt: Timestamp.now(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    try {
      await admin.storage().bucket().file(voiceStoragePath).delete({ ignoreNotFound: true });
      if (reservationRef) await reservationRef.delete();
    } catch (error) {
      functions.logger.warn('team_voice_announcement_cleanup_deferred', { retryScheduled: Boolean(reservationRef) });
    }
  }

  return { status };
});

// ---------------------------------------------------------------------------
// Team announcement replies
// Reply identity and moderation stay server-owned so clients cannot spoof an
// author, timestamp, or role-based deletion permission.
// ---------------------------------------------------------------------------

export const createTeamAnnouncement = teamMessagingFunctions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to create an announcement.');
  try {
    const teamId = readRequiredIdentifier(data?.teamId, 'invalid_team_id');
    const title = readBoundedText(data?.title, 1, 160, 'announcement_title_required');
    const body = readBoundedText(data?.body, 1, 2000, 'announcement_body_required');
    const audience = readAnnouncementAudience(data?.audience);
    const allowReplies = data?.allowReplies !== false;
    assertUserContentAllowed(title, body);
    const firestore = admin.firestore();
    const teamRef = firestore.collection('teams').doc(teamId);
    const announcementRef = teamRef.collection('announcements').doc();
    await enforceTeamMessageRateLimit(firestore, uid, 'textAnnouncement', 20);
    await firestore.runTransaction(async (transaction) => {
      const [team, member, profile] = await transaction.getAll(
        teamRef,
        teamRef.collection('members').doc(uid),
        firestore.collection('users').doc(uid),
      );
      if (!team.exists || !isTeamActive(team.data())) throw new Error('team_not_found');
      if (!member.exists || !canManageTeamAnnouncements(member.data())) throw new Error('not_authorized_coach');
      transaction.create(announcementRef, {
        title,
        body,
        audience,
        allowReplies,
        contentType: 'text',
        voiceMemo: null,
        createdBy: uid,
        createdByName: resolveReplyAuthorName(profile.data(), member.data(), context.auth?.token?.name),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return { announcementId: announcementRef.id, status: 'created' };
  } catch (error) {
    throwTeamMessagingError(error);
  }
});

export const createTeamAnnouncementReply = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to reply.');

  const teamId = readReplyPathId(data?.teamId, 'team');
  const announcementId = readReplyPathId(data?.announcementId, 'announcement');
  const body = typeof data?.body === 'string' ? data.body.trim() : '';
  const replyType = data?.replyType === 'privateToCoach' ? 'privateToCoach' : 'team';
  if (!body || body.length > 2000) {
    throw new functions.https.HttpsError('invalid-argument', 'Reply text must be between 1 and 2,000 characters.');
  }
  assertUserContentAllowed(body);

  const firestore = admin.firestore();
  const teamRef = firestore.collection('teams').doc(teamId);
  const memberRef = teamRef.collection('members').doc(uid);
  const announcementRef = teamRef.collection('announcements').doc(announcementId);
  const profileRef = firestore.collection('users').doc(uid);
  const replyRef = announcementRef.collection('replies').doc();
  let displayName = 'Sideline Social member';

  await firestore.runTransaction(async (transaction) => {
    const [teamSnapshot, memberSnapshot, announcementSnapshot, profileSnapshot] = await transaction.getAll(
      teamRef,
      memberRef,
      announcementRef,
      profileRef,
    );
    if (!teamSnapshot.exists || !isTeamActive(teamSnapshot.data())) {
      throw new functions.https.HttpsError('failed-precondition', 'This team is no longer active.', { reason: 'team-inactive' });
    }
    const member = memberSnapshot.exists ? memberSnapshot.data() : undefined;
    if (!member || member.status !== 'active') {
      throw new functions.https.HttpsError('permission-denied', 'An active team membership is required.');
    }
    const announcement = announcementSnapshot.data();
    if (!announcementSnapshot.exists || !announcement) {
      throw new functions.https.HttpsError('not-found', 'Announcement unavailable.');
    }
    if (!canAccessTeamAnnouncement(member, announcement.audience)) {
      throw new functions.https.HttpsError('permission-denied', 'This announcement is unavailable.');
    }
    if (announcement.allowReplies !== true) {
      throw new functions.https.HttpsError('failed-precondition', 'Replies are closed for this announcement.');
    }
    if (replyType === 'privateToCoach' && !hasCoachAccess(member)) {
      throw new functions.https.HttpsError('permission-denied', 'This reply type is unavailable.');
    }

    displayName = resolveReplyAuthorName(
      profileSnapshot.exists ? profileSnapshot.data() : undefined,
      member,
      context.auth?.token?.name,
    );
    transaction.create(replyRef, {
      userId: uid,
      displayName,
      body,
      replyType,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    reply: {
      id: replyRef.id,
      userId: uid,
      displayName,
      body,
      replyType,
      createdAtMillis: Date.now(),
    },
  };
});

export const deleteTeamAnnouncementReply = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to delete a reply.');

  const teamId = readReplyPathId(data?.teamId, 'team');
  const announcementId = readReplyPathId(data?.announcementId, 'announcement');
  const replyId = readReplyPathId(data?.replyId, 'reply');
  const firestore = admin.firestore();
  const teamRef = firestore.collection('teams').doc(teamId);
  const memberRef = teamRef.collection('members').doc(uid);
  const announcementRef = teamRef.collection('announcements').doc(announcementId);
  const replyRef = announcementRef.collection('replies').doc(replyId);
  let deleted = false;

  await firestore.runTransaction(async (transaction) => {
    const [teamSnapshot, memberSnapshot, announcementSnapshot, replySnapshot] = await transaction.getAll(
      teamRef,
      memberRef,
      announcementRef,
      replyRef,
    );
    if (!teamSnapshot.exists || !isTeamActive(teamSnapshot.data())) {
      throw new functions.https.HttpsError('failed-precondition', 'This team is no longer active.', { reason: 'team-inactive' });
    }
    const member = memberSnapshot.exists ? memberSnapshot.data() : undefined;
    if (!member || member.status !== 'active') {
      throw new functions.https.HttpsError('permission-denied', 'An active team membership is required.');
    }
    const announcement = announcementSnapshot.data();
    if (!announcementSnapshot.exists || !announcement) {
      throw new functions.https.HttpsError('not-found', 'Announcement unavailable.');
    }
    if (!canAccessTeamAnnouncement(member, announcement.audience)) {
      throw new functions.https.HttpsError('permission-denied', 'This announcement is unavailable.');
    }
    if (!replySnapshot.exists) return;
    if (!canDeleteTeamAnnouncementReply(uid, member, replySnapshot.data())) {
      throw new functions.https.HttpsError('permission-denied', 'You cannot delete this reply.');
    }

    transaction.delete(replyRef);
    deleted = true;
  });

  return { deleted };
});

function readReplyPathId(value: unknown, label: string): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new functions.https.HttpsError('invalid-argument', `A valid ${label} reference is required.`);
  }
  return id;
}
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
    const displayName = (resolveCanonicalPublicName(userSnapshot.data())
      ?? resolveCanonicalPublicName({ displayName: context.auth?.token?.name }))?.displayName
      || 'Sideline Social member';
    transaction.set(memberRef, {
      userId: uid,
      teamId: teamRef.id,
      displayName,
      roles,
      role: legacyRoleForMergedMembership(member?.role, roles),
      status: 'active',
      createdAt: memberSnapshot.exists
        ? member?.createdAt ?? FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(linkRef, {
      teamId: teamRef.id,
      childIds: linkedChildIds,
      status: 'active',
      createdAt: linkSnapshot.exists
        ? linkSnapshot.data()?.createdAt ?? FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.update(teamRef, {
      parentIds: FieldValue.arrayUnion(uid),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(userRef, {
      activeTeamId: teamRef.id,
      parentTeamIds: FieldValue.arrayUnion(teamRef.id),
      updatedAt: FieldValue.serverTimestamp(),
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
      updatedAt: FieldValue.serverTimestamp(),
      staffRoleUpdatedAt: FieldValue.serverTimestamp(),
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
      childId: FieldValue.delete(),
      childName: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(linkRef, {
      teamId,
      childIds,
      status: childIds.length > 0 ? 'active' : 'inactive',
      createdAt: linkSnapshot.exists
        ? linkSnapshot.data()?.createdAt ?? FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
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
      childId: FieldValue.delete(),
      childName: FieldValue.delete(),
      parentLeftAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(linkRef, {
      teamId,
      childIds: [],
      status: 'inactive',
      createdAt: linkSnapshot.exists
        ? linkSnapshot.data()?.createdAt ?? FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.update(teamRef, {
      parentIds: FieldValue.arrayRemove(uid),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const userUpdate: Record<string, unknown> = {
      parentTeamIds: FieldValue.arrayRemove(teamId),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (nextMembership.status === 'active') {
      userUpdate.coachTeamIds = FieldValue.arrayUnion(teamId);
    } else if (userSnapshot.data()?.activeTeamId === teamId) {
      userUpdate.activeTeamId = FieldValue.delete();
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
        archivedAt: FieldValue.serverTimestamp(),
        archivedBy: uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      transaction.update(teamRef, {
        status: 'active',
        inviteCode: replacementInviteCode,
        restoredAt: FieldValue.serverTimestamp(),
        restoredBy: uid,
        updatedAt: FieldValue.serverTimestamp(),
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
          updatedAt: FieldValue.serverTimestamp(),
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
  const completedAt = data.completedAt instanceof Timestamp
    ? data.completedAt.toDate().toISOString()
    : null;
  return {
    weekKey: data.weekKey,
    challengeId: data.challengeId,
    title: data.title,
    description: data.description,
    points: WEEKLY_CHALLENGE_STARS,
    category: data.category,
    completed: data.completed === true,
    completedAt,
    pointsAwarded: data.pointsAwarded === true,
    timezone: data.timezone,
    nextResetKey,
  };
}
