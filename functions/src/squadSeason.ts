import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions';

import { formatPublicUserName, resolvePublicProfileName } from './friendSuggestionCore';
import { LEADERBOARD_RESPONSE_LIMIT, getSidelineStarsTier, normalizeStars } from './sidelineStarsCore';
import {
  addCalendarDays,
  isAuthorizedSeasonManager,
  localMidnightToUtcMs,
  normalizeIanaTimeZone,
  normalizeSeasonName,
  normalizeSeasonStars,
  planSeasonStateSynchronization,
  rankSeasonLeaderboardEntries,
  resolveSeasonBoundaries,
  seasonContainsTimestamp,
  seasonRangesOverlap,
  type SquadSeasonStatus,
} from './squadSeasonCore';
import { getSportDisplayName, normalizeSportId } from './squadCore';

const regionalFunctions = functions.region('us-central1');
const MAX_ELIGIBLE_SQUADS = 25;

type SquadData = FirebaseFirestore.DocumentData & {
  createdBy?: string;
  creatorId?: string;
  currentSeasonId?: string | null;
  isActive?: boolean;
  venueName?: string;
  name?: string;
  sportId?: string;
  sportDisplayName?: string;
  sport?: string;
  timeZone?: string | null;
};

type SeasonData = FirebaseFirestore.DocumentData & {
  seasonId?: string;
  squadId?: string;
  name?: string;
  startAt?: Timestamp;
  endAt?: Timestamp;
  timeZone?: string;
  status?: SquadSeasonStatus;
  createdAt?: Timestamp;
};

type TrustedReward = {
  rewardId: string;
  amount: number;
  awardedAt: Timestamp;
  sourceType: 'weeklyChallenge' | 'game';
  gameType?: 'triviaBlitz' | 'spotDifferences' | 'bombDefusal';
  sourceSquadId: string | null;
  seasonEligibleSquadIds: string[];
};

function readSquadId(value: unknown): string {
  const squadId = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,360}$/.test(squadId)) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid Squad reference is required.');
  }
  return squadId;
}

function readSeasonId(value: unknown): string {
  const seasonId = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(seasonId)) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid season reference is required.');
  }
  return seasonId;
}

function isPlatformAdmin(context: functions.https.CallableContext): boolean {
  return context.auth?.token.admin === true || context.auth?.token.platformAdmin === true;
}

function squadCreatorId(squad: SquadData): string | null {
  return typeof squad.createdBy === 'string' && squad.createdBy
    ? squad.createdBy
    : typeof squad.creatorId === 'string' && squad.creatorId
      ? squad.creatorId
      : null;
}

async function readActiveMembership(
  firestore: FirebaseFirestore.Firestore,
  userId: string,
  squadId: string,
): Promise<FirebaseFirestore.DocumentData | null> {
  const canonical = await firestore.collection('squadMemberships').doc(`${squadId}__${userId}`).get();
  if (canonical.exists) {
    const membership = canonical.data()!;
    return membership.membershipStatus === 'active' ? membership : null;
  }
  const legacy = await firestore.collection('squadMemberships')
    .where('userId', '==', userId)
    .where('squadId', '==', squadId)
    .get();
  return legacy.docs.map((document) => document.data()).find((membership) => (
    membership.membershipStatus === 'active' ||
    (membership.membershipStatus == null && membership.isActive === true)
  )) ?? null;
}

async function assertSquadAccess(input: {
  context: functions.https.CallableContext;
  squadId: string;
  requireAdmin?: boolean;
}) {
  const userId = input.context.auth?.uid;
  if (!userId) throw new functions.https.HttpsError('unauthenticated', 'Sign in to access Squad seasons.');
  const firestore = admin.firestore();
  const squadSnapshot = await firestore.collection('squads').doc(input.squadId).get();
  if (!squadSnapshot.exists || squadSnapshot.data()?.isActive === false) {
    throw new functions.https.HttpsError('not-found', 'This Squad is unavailable.');
  }
  const squad = squadSnapshot.data() as SquadData;
  const platformAdmin = isPlatformAdmin(input.context);
  const membership = platformAdmin ? null : await readActiveMembership(firestore, userId, input.squadId);
  if (!platformAdmin && !membership) {
    throw new functions.https.HttpsError('permission-denied', 'Active Squad membership is required.');
  }
  const canManageSeasons = isAuthorizedSeasonManager({
    userId,
    isPlatformAdmin: platformAdmin,
    membershipStatus: membership?.membershipStatus ?? (membership?.isActive === true ? 'active' : null),
    squadRole: membership?.squadRole,
    squadCreatorId: squadCreatorId(squad),
  });
  if (input.requireAdmin && !canManageSeasons) {
    throw new functions.https.HttpsError('permission-denied', 'Only Squad Admins can manage seasons.');
  }
  return { firestore, membership, squad, squadSnapshot, userId, canManageSeasons, platformAdmin };
}

async function assertTransactionSeasonAdmin(input: {
  transaction: FirebaseFirestore.Transaction;
  firestore: FirebaseFirestore.Firestore;
  squadId: string;
  userId: string;
  platformAdmin: boolean;
}) {
  const squadRef = input.firestore.collection('squads').doc(input.squadId);
  const squadSnapshot = await input.transaction.get(squadRef);
  if (!squadSnapshot.exists || squadSnapshot.data()?.isActive === false) {
    throw new functions.https.HttpsError('not-found', 'This Squad is unavailable.');
  }
  const squad = squadSnapshot.data() as SquadData;
  if (input.platformAdmin) return { squad, squadRef };

  const canonicalRef = input.firestore.collection('squadMemberships').doc(`${input.squadId}__${input.userId}`);
  const canonical = await input.transaction.get(canonicalRef);
  let membership = canonical.exists && canonical.data()?.membershipStatus === 'active'
    ? canonical.data()!
    : null;
  if (!canonical.exists) {
    const legacy = await input.transaction.get(input.firestore.collection('squadMemberships')
      .where('userId', '==', input.userId)
      .where('squadId', '==', input.squadId));
    membership = legacy.docs.map((document) => document.data()).find((candidate) => (
      candidate.membershipStatus === 'active' ||
      (candidate.membershipStatus == null && candidate.isActive === true)
    )) ?? null;
  }
  if (!isAuthorizedSeasonManager({
    userId: input.userId,
    isPlatformAdmin: false,
    membershipStatus: membership?.membershipStatus ?? (membership?.isActive === true ? 'active' : null),
    squadRole: membership?.squadRole,
    squadCreatorId: squadCreatorId(squad),
  })) {
    throw new functions.https.HttpsError('permission-denied', 'Only Squad Admins can manage seasons.');
  }
  return { squad, squadRef };
}

function timestamp(value: unknown, field: string): Timestamp {
  if (!(value instanceof Timestamp)) {
    throw new functions.https.HttpsError('failed-precondition', `Season ${field} is invalid.`);
  }
  return value;
}

function translateSeasonCoreError(error: unknown): never {
  if (error instanceof functions.https.HttpsError) throw error;
  const code = error instanceof Error ? error.message : '';
  if (code === 'INVALID_SEASON_NAME') {
    throw new functions.https.HttpsError('invalid-argument', 'A valid season name is required.');
  }
  if (code === 'INVALID_TIME_ZONE' || code === 'INVALID_TIME_ZONE_BOUNDARY') {
    throw new functions.https.HttpsError('invalid-argument', 'A valid IANA timezone is required.');
  }
  if (code === 'INVALID_CALENDAR_DATE') {
    throw new functions.https.HttpsError('invalid-argument', 'Season dates must use YYYY-MM-DD.');
  }
  if (code === 'START_IN_PAST') {
    throw new functions.https.HttpsError('failed-precondition', 'Start date cannot be in the past.');
  }
  if (code === 'END_NOT_AFTER_START') {
    throw new functions.https.HttpsError('failed-precondition', 'End date must be after the start date.');
  }
  throw error;
}

function serializeSeason(snapshot: FirebaseFirestore.DocumentSnapshot, currentSeasonId: string | null) {
  const season = snapshot.data() as SeasonData;
  return {
    seasonId: snapshot.id,
    name: typeof season.name === 'string' ? season.name : 'Season',
    startAt: timestamp(season.startAt, 'start date'),
    endAt: timestamp(season.endAt, 'end date'),
    timeZone: normalizeIanaTimeZone(season.timeZone),
    status: season.status,
    isCurrent: snapshot.id === currentSeasonId && season.status === 'active',
  };
}

function calendarDateInTimeZone(value: Timestamp, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value.toDate());
  const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export async function synchronizeSquadSeasonStates(squadId: string, now = Timestamp.now()) {
  const firestore = admin.firestore();
  const squadRef = firestore.collection('squads').doc(squadId);
  const seasonsRef = squadRef.collection('seasons');
  return firestore.runTransaction(async (transaction) => {
    const [squadSnapshot, seasonsSnapshot] = await Promise.all([
      transaction.get(squadRef),
      transaction.get(seasonsRef),
    ]);
    if (!squadSnapshot.exists || squadSnapshot.data()?.isActive === false) return false;
    const currentSeasonId = typeof squadSnapshot.data()?.currentSeasonId === 'string'
      ? squadSnapshot.data()!.currentSeasonId
      : null;
    const seasons = seasonsSnapshot.docs.map((document) => {
      const season = document.data() as SeasonData;
      return {
        seasonId: document.id,
        status: season.status ?? 'upcoming',
        startAtMs: timestamp(season.startAt, 'start date').toMillis(),
        endAtMs: timestamp(season.endAt, 'end date').toMillis(),
      };
    });
    const plan = planSeasonStateSynchronization(seasons, now.toMillis(), currentSeasonId);
    plan.changes.forEach((change) => {
      const update: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
        status: change.status,
        updatedAt: now,
      };
      if (change.status === 'active') update.activatedAt = Timestamp.fromMillis(change.activatedAtMs!);
      if (change.status === 'closed') {
        update.closedAt = Timestamp.fromMillis(change.closedAtMs!);
        update.closedBy = null;
        update.closeReason = change.closeReason;
      }
      transaction.update(seasonsRef.doc(change.seasonId), update);
    });
    if (currentSeasonId !== plan.currentSeasonId || plan.changes.length > 0) {
      transaction.update(squadRef, {
        currentSeasonId: plan.currentSeasonId,
        updatedAt: now,
      });
    }
    return plan.changes.length > 0 || currentSeasonId !== plan.currentSeasonId;
  });
}

export const createSquadSeason = regionalFunctions.https.onCall(async (data, context) => {
  const squadId = readSquadId(data?.squadId);
  const access = await assertSquadAccess({ context, squadId, requireAdmin: true });
  await synchronizeSquadSeasonStates(squadId);
  const now = Timestamp.now();
  let name: string;
  let boundaries: ReturnType<typeof resolveSeasonBoundaries>;
  try {
    name = normalizeSeasonName(data?.name);
    boundaries = resolveSeasonBoundaries({
      startDate: data?.startDate,
      endDate: data?.endDate,
      timeZone: data?.timeZone,
      startNow: data?.startNow === true,
      nowMs: now.toMillis(),
    });
  } catch (error) {
    translateSeasonCoreError(error);
  }
  const startNow = data?.startNow === true;
  const seasonRef = access.firestore.collection('squads').doc(squadId).collection('seasons').doc();

  await access.firestore.runTransaction(async (transaction) => {
    const { squadRef } = await assertTransactionSeasonAdmin({
      transaction,
      firestore: access.firestore,
      squadId,
      userId: access.userId,
      platformAdmin: access.platformAdmin,
    });
    const seasonsSnapshot = await transaction.get(squadRef.collection('seasons'));
    const existing = seasonsSnapshot.docs.map((document) => {
      const season = document.data() as SeasonData;
      return {
        status: season.status,
        startAtMs: timestamp(season.startAt, 'start date').toMillis(),
        endAtMs: timestamp(season.endAt, 'end date').toMillis(),
      };
    });
    if (existing.some((season) => seasonRangesOverlap(season, boundaries))) {
      throw new functions.https.HttpsError('already-exists', 'Season dates overlap.');
    }
    if (startNow && existing.some((season) => season.status === 'active')) {
      throw new functions.https.HttpsError('failed-precondition', 'End the current season before starting another.');
    }
    const status: SquadSeasonStatus = startNow ? 'active' : 'upcoming';
    transaction.create(seasonRef, {
      seasonId: seasonRef.id,
      squadId,
      name,
      startAt: Timestamp.fromMillis(boundaries.startAtMs),
      endAt: Timestamp.fromMillis(boundaries.endAtMs),
      timeZone: boundaries.timeZone,
      status,
      createdBy: access.userId,
      createdAt: now,
      updatedAt: now,
      activatedAt: startNow ? now : null,
      closedAt: null,
      closedBy: null,
      closeReason: null,
    });
    transaction.update(squadRef, {
      ...(startNow ? { currentSeasonId: seasonRef.id } : {}),
      timeZone: boundaries.timeZone,
      updatedAt: now,
    });
  });

  return { seasonId: seasonRef.id, status: startNow ? 'active' : 'upcoming' };
});

export const updateSquadSeason = regionalFunctions.https.onCall(async (data, context) => {
  const squadId = readSquadId(data?.squadId);
  const seasonId = readSeasonId(data?.seasonId);
  const access = await assertSquadAccess({ context, squadId, requireAdmin: true });
  await synchronizeSquadSeasonStates(squadId);
  const now = Timestamp.now();

  return access.firestore.runTransaction(async (transaction) => {
    const { squadRef } = await assertTransactionSeasonAdmin({
      transaction,
      firestore: access.firestore,
      squadId,
      userId: access.userId,
      platformAdmin: access.platformAdmin,
    });
    const seasonRef = squadRef.collection('seasons').doc(seasonId);
    const [seasonSnapshot, seasonsSnapshot] = await Promise.all([
      transaction.get(seasonRef),
      transaction.get(squadRef.collection('seasons')),
    ]);
    if (!seasonSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Season not found.');
    const season = seasonSnapshot.data() as SeasonData;
    if (season.status === 'closed') {
      throw new functions.https.HttpsError('failed-precondition', 'Closed seasons cannot be edited.');
    }

    let name: string;
    try {
      name = data?.name == null ? normalizeSeasonName(season.name) : normalizeSeasonName(data.name);
    } catch (error) {
      translateSeasonCoreError(error);
    }
    const existingStart = timestamp(season.startAt, 'start date');
    const existingEnd = timestamp(season.endAt, 'end date');
    const existingTimeZone = normalizeIanaTimeZone(season.timeZone);
    let startAt = existingStart;
    let endAt = existingEnd;
    let timeZone = existingTimeZone;

    if (season.status === 'upcoming') {
      try {
        const boundaries = resolveSeasonBoundaries({
          startDate: data?.startDate ?? calendarDateInTimeZone(existingStart, existingTimeZone),
          endDate: data?.endDate ?? calendarDateInTimeZone(Timestamp.fromMillis(existingEnd.toMillis() - 1), existingTimeZone),
          timeZone: data?.timeZone ?? existingTimeZone,
          startNow: false,
          nowMs: now.toMillis(),
        });
        startAt = Timestamp.fromMillis(boundaries.startAtMs);
        endAt = Timestamp.fromMillis(boundaries.endAtMs);
        timeZone = boundaries.timeZone;
      } catch (error) {
        translateSeasonCoreError(error);
      }
    } else {
      if (data?.startDate != null || (data?.timeZone != null && data.timeZone !== existingTimeZone)) {
        throw new functions.https.HttpsError('failed-precondition', 'An active season start date and timezone cannot change.');
      }
      if (data?.endDate != null) {
        try {
          endAt = Timestamp.fromMillis(localMidnightToUtcMs(addCalendarDays(data.endDate, 1), existingTimeZone));
        } catch (error) {
          translateSeasonCoreError(error);
        }
        if (endAt.toMillis() < existingEnd.toMillis()) {
          throw new functions.https.HttpsError('failed-precondition', 'Use End Season to close a season early.');
        }
      }
    }

    const nextRange = { startAtMs: startAt.toMillis(), endAtMs: endAt.toMillis() };
    if (nextRange.endAtMs <= nextRange.startAtMs) {
      throw new functions.https.HttpsError('failed-precondition', 'End date must be after the start date.');
    }
    const overlaps = seasonsSnapshot.docs.some((document) => {
      if (document.id === seasonId) return false;
      const other = document.data() as SeasonData;
      return seasonRangesOverlap(nextRange, {
        startAtMs: timestamp(other.startAt, 'start date').toMillis(),
        endAtMs: timestamp(other.endAt, 'end date').toMillis(),
      });
    });
    if (overlaps) throw new functions.https.HttpsError('already-exists', 'Season dates overlap.');

    transaction.update(seasonRef, { name, startAt, endAt, timeZone, updatedAt: now });
    transaction.update(squadRef, { timeZone, updatedAt: now });
    return { seasonId, status: season.status };
  });
});

export const endSquadSeason = regionalFunctions.https.onCall(async (data, context) => {
  const squadId = readSquadId(data?.squadId);
  const seasonId = readSeasonId(data?.seasonId);
  const access = await assertSquadAccess({ context, squadId, requireAdmin: true });
  await synchronizeSquadSeasonStates(squadId);
  const now = Timestamp.now();

  await access.firestore.runTransaction(async (transaction) => {
    const { squadRef } = await assertTransactionSeasonAdmin({
      transaction,
      firestore: access.firestore,
      squadId,
      userId: access.userId,
      platformAdmin: access.platformAdmin,
    });
    const seasonRef = squadRef.collection('seasons').doc(seasonId);
    const seasonSnapshot = await transaction.get(seasonRef);
    if (!seasonSnapshot.exists || seasonSnapshot.data()?.status !== 'active') {
      throw new functions.https.HttpsError('failed-precondition', 'Only the active season can be ended.');
    }
    transaction.update(seasonRef, {
      status: 'closed',
      endAt: now,
      closedAt: now,
      closedBy: access.userId,
      closeReason: 'endedEarly',
      updatedAt: now,
    });
    transaction.update(squadRef, { currentSeasonId: null, updatedAt: now });
  });
  return { seasonId, status: 'closed' as const };
});

export const getSquadSeasons = regionalFunctions.https.onCall(async (data, context) => {
  const squadId = readSquadId(data?.squadId);
  await assertSquadAccess({ context, squadId });
  await synchronizeSquadSeasonStates(squadId);
  const access = await assertSquadAccess({ context, squadId });
  const snapshot = await access.firestore.collection('squads').doc(squadId).collection('seasons')
    .orderBy('startAt', 'desc')
    .get();
  const squadSnapshot = await access.firestore.collection('squads').doc(squadId).get();
  const currentSeasonId = typeof squadSnapshot.data()?.currentSeasonId === 'string'
    ? squadSnapshot.data()!.currentSeasonId
    : null;
  return {
    squadId,
    currentSeasonId,
    canManageSeasons: access.canManageSeasons,
    timeZone: typeof squadSnapshot.data()?.timeZone === 'string' ? squadSnapshot.data()!.timeZone : null,
    seasons: snapshot.docs.map((document) => serializeSeason(document, currentSeasonId)),
  };
});

async function getUserDocuments(userIds: string[]) {
  const firestore = admin.firestore();
  const snapshots: FirebaseFirestore.DocumentSnapshot[] = [];
  for (let index = 0; index < userIds.length; index += 100) {
    snapshots.push(...await firestore.getAll(...userIds.slice(index, index + 100)
      .map((userId) => firestore.collection('users').doc(userId))));
  }
  return snapshots;
}

export const getSquadLeaderboard = regionalFunctions.https.onCall(async (data, context) => {
  const squadId = readSquadId(data?.squadId);
  const requestedSeasonId = data?.seasonId == null ? null : readSeasonId(data.seasonId);
  await assertSquadAccess({ context, squadId });
  await synchronizeSquadSeasonStates(squadId);
  const access = await assertSquadAccess({ context, squadId });
  const squadRef = access.firestore.collection('squads').doc(squadId);
  const [squadSnapshot, seasonsSnapshot, currentUserSnapshot] = await Promise.all([
    squadRef.get(),
    squadRef.collection('seasons').orderBy('startAt', 'desc').get(),
    access.firestore.collection('users').doc(access.userId).get(),
  ]);
  const squad = squadSnapshot.data() as SquadData;
  const currentSeasonId = typeof squad.currentSeasonId === 'string' ? squad.currentSeasonId : null;
  let selectedSeasonSnapshot: FirebaseFirestore.DocumentSnapshot | null = null;
  if (requestedSeasonId) {
    selectedSeasonSnapshot = await squadRef.collection('seasons').doc(requestedSeasonId).get();
    if (!selectedSeasonSnapshot.exists) {
      throw new functions.https.HttpsError('not-found', 'The requested season does not belong to this Squad.');
    }
    if (!['active', 'closed'].includes(selectedSeasonSnapshot.data()?.status)) {
      throw new functions.https.HttpsError('failed-precondition', 'Upcoming season standings are not available yet.');
    }
  } else if (currentSeasonId) {
    const current = seasonsSnapshot.docs.find((document) => document.id === currentSeasonId);
    selectedSeasonSnapshot = current?.data()?.status === 'active' ? current : null;
  }

  const activeMembershipSnapshot = await access.firestore.collection('squadMemberships')
    .where('squadId', '==', squadId)
    .get();
  const activeMemberIds = Array.from(new Set(activeMembershipSnapshot.docs
    .filter((document) => {
      const membership = document.data();
      return membership.membershipStatus === 'active' ||
        (membership.membershipStatus == null && membership.isActive === true);
    })
    .map((document) => document.data().userId)
    .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0)));
  if (!access.platformAdmin && !activeMemberIds.includes(access.userId)) {
    throw new functions.https.HttpsError('permission-denied', 'Active Squad membership is required.');
  }

  let candidateIds: string[] = [];
  let totals = new Map<string, number>();
  if (selectedSeasonSnapshot) {
    const totalSnapshot = await selectedSeasonSnapshot.ref.collection('memberTotals').get();
    totals = new Map(totalSnapshot.docs.map((document) => [
      document.id,
      normalizeSeasonStars(document.data().seasonStars),
    ]));
    candidateIds = selectedSeasonSnapshot.data()?.status === 'active'
      ? activeMemberIds
      : Array.from(totals.keys());
  }

  const userSnapshots = await getUserDocuments(candidateIds);
  const byId = new Map(userSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const publicNames = new Map(candidateIds.map((userId) => [
    userId,
    formatPublicUserName(resolvePublicProfileName(byId.get(userId)?.data())),
  ]));
  const missingNameIds = candidateIds.filter((userId) => !publicNames.get(userId));
  for (let index = 0; index < missingNameIds.length; index += 100) {
    const authResult = await admin.auth().getUsers(missingNameIds.slice(index, index + 100)
      .map((userId) => ({ uid: userId })));
    authResult.users.forEach((user) => publicNames.set(
      user.uid,
      formatPublicUserName(resolvePublicProfileName({ displayName: user.displayName })),
    ));
  }

  const ranked = rankSeasonLeaderboardEntries(candidateIds.map((userId) => ({
    userId,
    displayName: publicNames.get(userId) ?? null,
    seasonStars: totals.get(userId) ?? 0,
    lifetimeTier: getSidelineStarsTier(byId.get(userId)?.data()?.sidelineStars),
    isCurrentUser: userId === access.userId,
  })));
  const entries = ranked.slice(0, LEADERBOARD_RESPONSE_LIMIT);
  const currentUserEntry = ranked.find((entry) => entry.userId === access.userId) ?? null;
  const sportId = normalizeSportId(squad.sportId ?? squad.sportDisplayName ?? squad.sport) ?? 'other';
  const availableSeasons = seasonsSnapshot.docs.map((document) => serializeSeason(document, currentSeasonId));
  const nextSeason = availableSeasons
    .filter((season) => season.status === 'upcoming')
    .sort((left, right) => left.startAt.toMillis() - right.startAt.toMillis())[0] ?? null;

  console.info('[getSquadLeaderboard] completed', {
    hasSeason: Boolean(selectedSeasonSnapshot),
    entryCount: entries.length,
    totalMemberCount: candidateIds.length,
  });
  return {
    squad: {
      squadId,
      venueName: typeof squad.venueName === 'string' && squad.venueName.trim()
        ? squad.venueName.trim()
        : typeof squad.name === 'string' && squad.name.trim() ? squad.name.trim() : 'Sports Venue',
      sportId,
      sportDisplayName: typeof squad.sportDisplayName === 'string' && squad.sportDisplayName.trim()
        ? squad.sportDisplayName.trim()
        : getSportDisplayName(sportId),
    },
    season: selectedSeasonSnapshot ? serializeSeason(selectedSeasonSnapshot, currentSeasonId) : null,
    entries,
    currentUserEntry,
    currentUserLifetimeStars: normalizeStars(currentUserSnapshot.data()?.sidelineStars),
    totalMemberCount: candidateIds.length,
    availableSeasons,
    nextSeason,
    canManageSeasons: access.canManageSeasons,
  };
});

export async function readSeasonEligibleSquadIds(
  transaction: FirebaseFirestore.Transaction,
  userId: string,
): Promise<string[]> {
  const snapshot = await transaction.get(admin.firestore().collection('squadMemberships')
    .where('userId', '==', userId));
  return Array.from(new Set(snapshot.docs
    .filter((document) => {
      const membership = document.data();
      return membership.membershipStatus === 'active' ||
        (membership.membershipStatus == null && membership.isActive === true);
    })
    .map((document) => document.data().squadId)
    .filter((squadId): squadId is string => typeof squadId === 'string' && /^[A-Za-z0-9_-]{1,360}$/.test(squadId))))
    .slice(0, MAX_ELIGIBLE_SQUADS);
}

function readTrustedReward(rewardId: string, data: FirebaseFirestore.DocumentData): TrustedReward | null {
  const amount = data.amount;
  const awardedAt = data.awardedAt;
  const sourceType = data.sourceType;
  const eligible = data.seasonEligibleSquadIds;
  if (!Number.isInteger(amount) || amount <= 0 || amount > 15 || !(awardedAt instanceof Timestamp)) return null;
  if (sourceType !== 'weeklyChallenge' && sourceType !== 'game') return null;
  if (!Array.isArray(eligible) || eligible.length > MAX_ELIGIBLE_SQUADS) return null;
  if (sourceType === 'weeklyChallenge' && amount !== 5) return null;
  if (sourceType === 'game' && !['triviaBlitz', 'spotDifferences', 'bombDefusal'].includes(data.gameType)) return null;
  const seasonEligibleSquadIds = Array.from(new Set(eligible.filter((squadId): squadId is string => (
    typeof squadId === 'string' && /^[A-Za-z0-9_-]{1,360}$/.test(squadId)
  ))));
  if (seasonEligibleSquadIds.length !== eligible.length) return null;
  return {
    rewardId,
    amount,
    awardedAt,
    sourceType,
    gameType: sourceType === 'game' ? data.gameType : undefined,
    sourceSquadId: typeof data.sourceSquadId === 'string' ? data.sourceSquadId : null,
    seasonEligibleSquadIds,
  };
}

async function projectRewardToSquad(userId: string, reward: TrustedReward, squadId: string) {
  await synchronizeSquadSeasonStates(squadId);
  const firestore = admin.firestore();
  const seasonsSnapshot = await firestore.collection('squads').doc(squadId).collection('seasons').get();
  const matching = seasonsSnapshot.docs.filter((document) => {
    const season = document.data() as SeasonData;
    if (season.status !== 'active' && season.status !== 'closed') return false;
    const startAt = timestamp(season.startAt, 'start date');
    const endAt = timestamp(season.endAt, 'end date');
    const createdAt = timestamp(season.createdAt, 'creation date');
    return createdAt.toMillis() <= reward.awardedAt.toMillis() && seasonContainsTimestamp({
      startAtMs: startAt.toMillis(),
      endAtMs: endAt.toMillis(),
    }, reward.awardedAt.toMillis());
  });
  if (matching.length === 0) return 'noSeason' as const;
  if (matching.length > 1) throw new Error('OVERLAPPING_SEASON_PROJECTION');
  const seasonRef = matching[0].ref;
  const totalRef = seasonRef.collection('memberTotals').doc(userId);
  const contributionRef = totalRef.collection('contributions').doc(reward.rewardId);
  return firestore.runTransaction(async (transaction) => {
    const [seasonSnapshot, totalSnapshot, contributionSnapshot] = await Promise.all([
      transaction.get(seasonRef),
      transaction.get(totalRef),
      transaction.get(contributionRef),
    ]);
    if (contributionSnapshot.exists) return 'alreadyProjected' as const;
    const season = seasonSnapshot.data() as SeasonData;
    const startAt = timestamp(season.startAt, 'start date');
    const endAt = timestamp(season.endAt, 'end date');
    const createdAt = timestamp(season.createdAt, 'creation date');
    if (!['active', 'closed'].includes(season.status ?? '') ||
      createdAt.toMillis() > reward.awardedAt.toMillis() ||
      !seasonContainsTimestamp({
        startAtMs: startAt.toMillis(),
        endAtMs: endAt.toMillis(),
      }, reward.awardedAt.toMillis())) return 'noSeason' as const;
    const createdAtNow = Timestamp.now();
    transaction.create(contributionRef, {
      rewardId: reward.rewardId,
      amount: reward.amount,
      awardedAt: reward.awardedAt,
      sourceType: reward.sourceType,
      gameType: reward.gameType ?? null,
      sourceSquadId: reward.sourceSquadId,
      createdAt: createdAtNow,
    });
    if (totalSnapshot.exists) {
      transaction.update(totalRef, {
        seasonStars: FieldValue.increment(reward.amount),
        rewardCount: FieldValue.increment(1),
        firstRewardAt: totalSnapshot.data()?.firstRewardAt ?? reward.awardedAt,
        lastRewardAt: reward.awardedAt,
        updatedAt: createdAtNow,
      });
    } else {
      transaction.create(totalRef, {
        userId,
        seasonStars: reward.amount,
        rewardCount: 1,
        firstRewardAt: reward.awardedAt,
        lastRewardAt: reward.awardedAt,
        updatedAt: createdAtNow,
      });
    }
    return 'projected' as const;
  });
}

export async function projectRewardRecord(
  userId: string,
  rewardId: string,
  data: FirebaseFirestore.DocumentData,
) {
  const reward = readTrustedReward(rewardId, data);
  if (!reward) return { status: 'ignored' as const, projectedCount: 0 };
  const results = await Promise.all(reward.seasonEligibleSquadIds
    .map((squadId) => projectRewardToSquad(userId, reward, squadId)));
  return {
    status: 'processed' as const,
    projectedCount: results.filter((status) => status === 'projected').length,
  };
}

export const projectRewardToSquadSeasons = regionalFunctions.firestore
  .document('users/{uid}/rewardTransactions/{rewardId}')
  .onCreate(async (snapshot, context) => {
    const result = await projectRewardRecord(context.params.uid, context.params.rewardId, snapshot.data());
    console.info('[projectRewardToSquadSeasons] completed', {
      status: result.status,
      projectedCount: result.projectedCount,
    });
  });

export const syncSquadSeasonStates = regionalFunctions.pubsub
  .schedule('every 60 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    const now = Timestamp.now();
    const firestore = admin.firestore();
    const [ending, starting] = await Promise.all([
      firestore.collectionGroup('seasons').where('status', '==', 'active').where('endAt', '<=', now).get(),
      firestore.collectionGroup('seasons').where('status', '==', 'upcoming').where('startAt', '<=', now).get(),
    ]);
    const squadIds = Array.from(new Set([...ending.docs, ...starting.docs]
      .map((document) => document.data().squadId)
      .filter((squadId): squadId is string => typeof squadId === 'string' && squadId.length > 0)));
    const results = await Promise.allSettled(squadIds.map((squadId) => synchronizeSquadSeasonStates(squadId, now)));
    const failures = results.filter((result) => result.status === 'rejected').length;
    console.info('[syncSquadSeasonStates] completed', { squadCount: squadIds.length, failures });
    return null;
  });
