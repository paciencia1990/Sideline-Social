import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as firebaseFunctions from 'firebase-functions';

import { permanentAccountFunctions } from './permanentAuth';
import { isCanonicalPublicProfile, resolveCanonicalPublicProfile, toMinimalPublicUserProfile } from './publicUserProfileCore';
import {
  SQUAD_ADMIN_INVITATION_MS,
  activeSquadAdminIds,
  isActiveSquadAdmin,
  isDurablyActiveSquadMembership,
  recordedSquadCreatorId,
  squadAdminAccessRequestId,
  squadAdminInvitationAcceptedNotificationId,
  squadAdminInvitationId,
  squadAdminInvitationNotificationId,
  squadAdminRecoveryNotificationId,
  usesLegacyCreatorAdminFallback,
  type SquadAdminInvitationStatus,
  type SquadAuthorizationData,
  type SquadMembershipAuthorizationData,
} from './squadAdminCore';
import { resolveSelectionAfterLeave } from './squadCore';
import { sendPushToUser } from './pushNotificationDelivery';

const functions = permanentAccountFunctions(firebaseFunctions);
const MAX_ACTIVE_MEMBERS = 250;
// Each invitation may also update one notification in the same atomic batch.
// Keeping this at 200 stays safely below Firestore's 500-write batch limit.
const INVITATION_EXPIRY_BATCH_SIZE = 200;

type SquadData = FirebaseFirestore.DocumentData & SquadAuthorizationData & {
  isActive?: boolean;
  memberIds?: string[];
  venueName?: string;
  name?: string;
  sportDisplayName?: string;
  sport?: string;
};

type MembershipData = FirebaseFirestore.DocumentData & SquadMembershipAuthorizationData;

type ActiveMembershipRecord = {
  data: MembershipData;
  ref: FirebaseFirestore.DocumentReference;
};

type InvitationData = FirebaseFirestore.DocumentData & {
  squadId?: string;
  targetUserId?: string;
  invitedByUserId?: string;
  status?: SquadAdminInvitationStatus;
  attempt?: number;
  expiresAt?: Timestamp;
  notificationId?: string;
};

type SquadNotificationType =
  | 'squadAdminInvitation'
  | 'squadAdminInvitationAccepted'
  | 'squadAdminRecoveryRequested';

type SquadNotificationInput = {
  recipientUserId: string;
  eventId: string;
  type: SquadNotificationType;
  titleKey: string;
  bodyKey: string;
  params: Record<string, string | number>;
  squadId: string;
  actorUserId?: string;
  actorDisplayName?: string | null;
  invitationId?: string;
  pushTitle: string;
  pushBody: string;
};

function firestore() {
  return admin.firestore();
}

function authenticatedUserId(context: firebaseFunctions.https.CallableContext): string {
  const userId = context.auth?.uid;
  if (!userId) throw new functions.https.HttpsError('unauthenticated', 'Sign in to manage this Squad.');
  return userId;
}

function readId(value: unknown, label: string): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,360}$/u.test(id)) {
    throw new functions.https.HttpsError('invalid-argument', `A valid ${label} is required.`);
  }
  return id;
}

function fail(
  reason: string,
  squadId: string,
  code: firebaseFunctions.https.FunctionsErrorCode = 'failed-precondition',
): never {
  throw new functions.https.HttpsError(code, 'The Squad administrator request could not be completed.', {
    reason,
    squadId,
  });
}

function invitationRef(squadId: string, targetUserId: string) {
  return firestore().collection('squadAdminInvitations').doc(squadAdminInvitationId(squadId, targetUserId));
}

function recoveryRequestRef(squadId: string, requesterUserId: string) {
  return firestore().collection('squadAdminAccessRequests').doc(squadAdminAccessRequestId(squadId, requesterUserId));
}

function notificationRef(userId: string, notificationId: string) {
  return firestore().collection('userNotifications').doc(userId).collection('notifications').doc(notificationId);
}

function timestampMillis(value: unknown): number {
  return value instanceof Timestamp ? value.toMillis() : 0;
}

function activeMembershipRecords(snapshot: FirebaseFirestore.QuerySnapshot): ActiveMembershipRecord[] {
  const byUserId = new Map<string, ActiveMembershipRecord>();
  snapshot.docs.forEach((document) => {
    const data = document.data() as MembershipData;
    if (data.membershipStatus !== 'active' || typeof data.userId !== 'string' || !data.userId) return;
    const existing = byUserId.get(data.userId);
    if (!existing || document.id === `${data.squadId}__${data.userId}`) {
      byUserId.set(data.userId, { data, ref: document.ref });
    }
  });
  return Array.from(byUserId.values());
}

function membershipFor(records: ActiveMembershipRecord[], userId: string) {
  return records.find((record) => record.data.userId === userId) ?? null;
}

function adminIds(squadId: string, squad: SquadData, records: ActiveMembershipRecord[]) {
  return activeSquadAdminIds({ squad, squadId, memberships: records.map((record) => record.data) });
}

function healLegacyCreatorIfNeeded(
  transaction: FirebaseFirestore.Transaction,
  squadId: string,
  squad: SquadData,
  records: ActiveMembershipRecord[],
  now: Timestamp,
) {
  const creatorId = recordedSquadCreatorId(squad);
  if (!creatorId) return;
  const creator = membershipFor(records, creatorId);
  if (!creator || !usesLegacyCreatorAdminFallback({
    squad,
    membership: creator.data,
    squadId,
    userId: creatorId,
  })) return;
  creator.data.squadRole = 'admin';
  transaction.set(creator.ref, {
    squadRole: 'admin',
    squadRoleUpdatedAt: now,
    squadRoleUpdatedBy: 'system:legacy-creator-self-heal',
    updatedAt: now,
  }, { merge: true });
}

function assertActiveAdmin(
  squadId: string,
  squad: SquadData,
  records: ActiveMembershipRecord[],
  userId: string,
) {
  const membership = membershipFor(records, userId);
  if (!membership || !isActiveSquadAdmin({ squad, membership: membership.data, squadId, userId })) {
    fail('not_squad_admin', squadId, 'permission-denied');
  }
  return membership;
}

async function loadPublicMemberProfiles(userIds: string[]) {
  const db = firestore();
  const ids = Array.from(new Set(userIds)).slice(0, MAX_ACTIVE_MEMBERS);
  const publicSnapshots = ids.length
    ? await db.getAll(...ids.map((userId) => db.collection('publicUserProfiles').doc(userId)))
    : [];
  const resolved = new Map(ids.map((userId) => [userId, {
    userId,
    displayName: null as string | null,
    photoURL: null as string | null,
    profileState: 'deleted' as 'available' | 'unnamed' | 'deleted',
  }]));
  const missingIds: string[] = [];
  publicSnapshots.forEach((snapshot) => {
    const profile = snapshot.data();
    if (isCanonicalPublicProfile(profile, snapshot.id)) {
      resolved.set(snapshot.id, { ...toMinimalPublicUserProfile(profile as NonNullable<ReturnType<typeof resolveCanonicalPublicProfile>>), profileState: 'available' });
    }
    else missingIds.push(snapshot.id);
  });
  if (missingIds.length) {
    const privateSnapshots = await db.getAll(...missingIds.map((userId) => db.collection('users').doc(userId)));
    const authFallbackIds: string[] = [];
    privateSnapshots.forEach((snapshot) => {
      const profile = resolveCanonicalPublicProfile(snapshot.id, snapshot.data() as Record<string, unknown> | undefined);
      if (profile) resolved.set(snapshot.id, { ...toMinimalPublicUserProfile(profile), profileState: 'available' });
      else if (snapshot.exists) resolved.set(snapshot.id, { userId: snapshot.id, displayName: null, photoURL: null, profileState: 'unnamed' });
      else authFallbackIds.push(snapshot.id);
    });
    for (let index = 0; index < authFallbackIds.length; index += 100) {
      const authUsers = await admin.auth().getUsers(authFallbackIds.slice(index, index + 100).map((uid) => ({ uid })));
      authUsers.users.forEach((authUser) => {
        const profile = resolveCanonicalPublicProfile(authUser.uid, undefined, authUser.displayName);
        resolved.set(authUser.uid, profile
          ? { ...toMinimalPublicUserProfile(profile), profileState: 'available' }
          : { userId: authUser.uid, displayName: null, photoURL: null, profileState: 'unnamed' });
      });
    }
  }
  return resolved;
}

async function publicActorName(userId: string): Promise<string> {
  const profiles = await loadPublicMemberProfiles([userId]);
  const profile = profiles.get(userId);
  return profile?.displayName || 'Sideline Social member';
}

function squadLabel(squad: SquadData): string {
  const venue = typeof squad.venueName === 'string' && squad.venueName.trim()
    ? squad.venueName.trim()
    : typeof squad.name === 'string' && squad.name.trim() ? squad.name.trim() : 'Squad';
  const sport = typeof squad.sportDisplayName === 'string' && squad.sportDisplayName.trim()
    ? squad.sportDisplayName.trim()
    : typeof squad.sport === 'string' && squad.sport.trim() ? squad.sport.trim() : '';
  return sport ? `${venue} · ${sport}` : venue;
}

async function createSquadNotificationAndPush(input: SquadNotificationInput) {
  const db = firestore();
  const ref = notificationRef(input.recipientUserId, input.eventId);
  const created = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) return false;
    transaction.create(ref, {
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
      squadId: input.squadId,
      squadAdminInvitationId: input.invitationId ?? null,
      expiresAt: null,
    });
    return true;
  });
  if (!created) return false;

  const results = await Promise.allSettled([
    sendPushToUser(input.recipientUserId, {
      notificationId: input.eventId,
      type: input.type,
      squadId: input.squadId,
      ...(input.invitationId ? { squadAdminInvitationId: input.invitationId } : {}),
    }),
  ]);
  const failures = results.filter((result) => result.status === 'rejected').length;
  if (failures) console.warn('[squadAdminNotification] push delivery failures', { type: input.type, failures });
  return true;
}

function codeFrom(error: object) {
  return 'code' in error ? (error as { code?: unknown }).code : '';
}

export async function resolveSquadAdminInvitationNotification(invitation: InvitationData | undefined) {
  const targetUserId = typeof invitation?.targetUserId === 'string' ? invitation.targetUserId : '';
  const notificationId = typeof invitation?.notificationId === 'string' ? invitation.notificationId : '';
  if (!targetUserId || !notificationId) return;
  const ref = notificationRef(targetUserId, notificationId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.status === 'dismissed') return;
  await ref.update({
    status: 'dismissed',
    dismissedAt: FieldValue.serverTimestamp(),
    dismissReason: 'resolved',
    isRead: true,
    readAt: snapshot.data()?.readAt ?? FieldValue.serverTimestamp(),
  });
}

export const getSquadAdministration = functions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const squadId = readId(data?.squadId, 'Squad reference');
  const db = firestore();
  const squadRef = db.collection('squads').doc(squadId);
  const state = await db.runTransaction(async (transaction) => {
    const squadSnapshot = await transaction.get(squadRef);
    const membershipsSnapshot = await transaction.get(db.collection('squadMemberships')
      .where('squadId', '==', squadId)
      .where('membershipStatus', '==', 'active'));
    if (!squadSnapshot.exists || squadSnapshot.data()?.isActive === false) fail('squad_not_found', squadId, 'not-found');
    const squad = squadSnapshot.data() as SquadData;
    const records = activeMembershipRecords(membershipsSnapshot);
    const caller = membershipFor(records, userId);
    if (!caller || !isDurablyActiveSquadMembership({ membership: caller.data, squadId, userId })) {
      fail('target_not_active_member', squadId, 'permission-denied');
    }
    const now = Timestamp.now();
    healLegacyCreatorIfNeeded(transaction, squadId, squad, records, now);
    return {
      squad,
      memberships: records.map((record) => ({ ...record.data } as MembershipData)),
    };
  });

  const currentAdminIds = activeSquadAdminIds({ squad: state.squad, squadId, memberships: state.memberships });
  const callerIsAdmin = currentAdminIds.includes(userId);
  const invitationsSnapshot = await db.collection('squadAdminInvitations').where('squadId', '==', squadId).limit(100).get();
  const nowMillis = Date.now();
  const expired: InvitationData[] = [];
  const pendingInvitations = invitationsSnapshot.docs.flatMap((document) => {
    const invitation = document.data() as InvitationData;
    if (invitation.status !== 'pending') return [];
    if (timestampMillis(invitation.expiresAt) <= nowMillis) {
      expired.push(invitation);
      return [];
    }
    if (!callerIsAdmin && invitation.targetUserId !== userId) return [];
    return [{
      invitationId: document.id,
      targetUserId: invitation.targetUserId ?? '',
      invitedByUserId: invitation.invitedByUserId ?? '',
      status: 'pending' as const,
      expiresAtMillis: timestampMillis(invitation.expiresAt),
    }];
  });
  if (expired.length) {
    const batch = db.batch();
    invitationsSnapshot.docs.forEach((document) => {
      const invitation = document.data() as InvitationData;
      if (invitation.status === 'pending' && timestampMillis(invitation.expiresAt) <= nowMillis) {
        batch.update(document.ref, {
          status: 'expired',
          expiredAt: Timestamp.now(),
          respondedAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
      }
    });
    await batch.commit();
    await Promise.allSettled(expired.map(resolveSquadAdminInvitationNotification));
  }

  const profiles = await loadPublicMemberProfiles(state.memberships.map((membership) => String(membership.userId ?? '')));
  const members = state.memberships.map((membership) => {
    const memberUserId = String(membership.userId ?? '');
    const profile = profiles.get(memberUserId);
    return {
      userId: memberUserId,
      displayName: profile?.displayName ?? null,
      photoURL: profile?.photoURL ?? null,
      profileState: profile?.profileState ?? 'deleted',
      squadRole: currentAdminIds.includes(memberUserId) ? 'admin' as const : 'member' as const,
      isCurrentUser: memberUserId === userId,
    };
  }).sort((left, right) => (left.displayName ?? '').localeCompare(right.displayName ?? '') || left.userId.localeCompare(right.userId));
  const pendingTargetIds = new Set(pendingInvitations.map((invitation) => invitation.targetUserId));
  const ownRecoverySnapshot = await recoveryRequestRef(squadId, userId).get();
  return {
    squadId,
    squadLabel: squadLabel(state.squad),
    callerIsAdmin,
    activeAdminCount: currentAdminIds.length,
    isOrphaned: currentAdminIds.length === 0,
    admins: members.filter((member) => member.squadRole === 'admin'),
    members: callerIsAdmin ? members : members.filter((member) => member.squadRole === 'admin'),
    eligibleMembers: callerIsAdmin
      ? members.filter((member) => member.squadRole === 'member' && !member.isCurrentUser && !pendingTargetIds.has(member.userId))
      : [],
    pendingInvitations,
    myInvitation: pendingInvitations.find((invitation) => invitation.targetUserId === userId) ?? null,
    recoveryRequestStatus: ownRecoverySnapshot.exists ? ownRecoverySnapshot.data()?.status ?? null : null,
  };
});

export const inviteSquadAdmin = functions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const squadId = readId(data?.squadId, 'Squad reference');
  const targetUserId = readId(data?.targetUserId, 'member reference');
  if (targetUserId === userId) fail('cannot_invite_self', squadId);
  const db = firestore();
  const ref = invitationRef(squadId, targetUserId);
  const result = await db.runTransaction(async (transaction) => {
    const [squadSnapshot, invitationSnapshot] = await transaction.getAll(db.collection('squads').doc(squadId), ref);
    const membershipsSnapshot = await transaction.get(db.collection('squadMemberships')
      .where('squadId', '==', squadId)
      .where('membershipStatus', '==', 'active'));
    if (!squadSnapshot.exists || squadSnapshot.data()?.isActive === false) fail('squad_not_found', squadId, 'not-found');
    const squad = squadSnapshot.data() as SquadData;
    const records = activeMembershipRecords(membershipsSnapshot);
    const now = Timestamp.now();
    healLegacyCreatorIfNeeded(transaction, squadId, squad, records, now);
    assertActiveAdmin(squadId, squad, records, userId);
    const target = membershipFor(records, targetUserId);
    if (!target || !isDurablyActiveSquadMembership({ membership: target.data, squadId, userId: targetUserId })) {
      fail('target_not_active_member', squadId);
    }
    if (isActiveSquadAdmin({ squad, membership: target.data, squadId, userId: targetUserId })) {
      fail('target_already_admin', squadId);
    }
    const existing = invitationSnapshot.data() as InvitationData | undefined;
    if (existing?.status === 'pending' && timestampMillis(existing.expiresAt) > now.toMillis()) {
      fail('invitation_already_pending', squadId, 'already-exists');
    }
    const attempt = typeof existing?.attempt === 'number' ? Math.max(0, Math.floor(existing.attempt)) + 1 : 1;
    const notificationId = squadAdminInvitationNotificationId(ref.id, attempt);
    transaction.set(ref, {
      squadId,
      targetUserId,
      invitedByUserId: userId,
      status: 'pending',
      attempt,
      createdAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + SQUAD_ADMIN_INVITATION_MS),
      respondedAt: null,
      canceledAt: null,
      expiredAt: null,
      notificationId,
      updatedAt: now,
    });
    return { attempt, invitationId: ref.id, notificationId, previousInvitation: existing, squad };
  });

  if (result.previousInvitation?.notificationId !== result.notificationId) {
    await resolveSquadAdminInvitationNotification(result.previousInvitation);
  }
  const inviterName = await publicActorName(userId);
  const label = squadLabel(result.squad);
  await createSquadNotificationAndPush({
    recipientUserId: targetUserId,
    eventId: result.notificationId,
    type: 'squadAdminInvitation',
    titleKey: 'notifications.types.squadAdminInvitationTitle',
    bodyKey: 'notifications.types.squadAdminInvitationBody',
    params: { actorName: inviterName, squadName: label },
    squadId,
    actorUserId: userId,
    actorDisplayName: inviterName,
    invitationId: result.invitationId,
    pushTitle: 'Squad Admin Invitation',
    pushBody: `${inviterName} invited you to help manage ${label}.`,
  });
  return { status: 'pending' as const, invitationId: result.invitationId };
});

export const respondToSquadAdminInvitation = functions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const squadId = readId(data?.squadId, 'Squad reference');
  const decision = data?.decision === 'accept' || data?.decision === 'decline' ? data.decision : null;
  if (!decision) throw new functions.https.HttpsError('invalid-argument', 'Accept or decline the invitation.');
  const db = firestore();
  const ref = invitationRef(squadId, userId);
  const result = await db.runTransaction(async (transaction) => {
    const [squadSnapshot, invitationSnapshot] = await transaction.getAll(db.collection('squads').doc(squadId), ref);
    const membershipsSnapshot = await transaction.get(db.collection('squadMemberships')
      .where('squadId', '==', squadId)
      .where('membershipStatus', '==', 'active'));
    if (!invitationSnapshot.exists) fail('invitation_not_found', squadId, 'not-found');
    const invitation = invitationSnapshot.data() as InvitationData;
    if (invitation.targetUserId !== userId || invitation.squadId !== squadId) fail('invitation_not_found', squadId, 'permission-denied');
    if (invitation.status === (decision === 'accept' ? 'accepted' : 'declined')) {
      return { changed: false, outcome: invitation.status, invitation, squad: squadSnapshot.data() as SquadData | undefined };
    }
    if (invitation.status !== 'pending') fail(`invitation_${invitation.status ?? 'not_found'}`, squadId);
    const now = Timestamp.now();
    if (timestampMillis(invitation.expiresAt) <= now.toMillis()) {
      transaction.update(ref, { status: 'expired', expiredAt: now, respondedAt: now, updatedAt: now });
      return { changed: true, outcome: 'expired' as const, invitation };
    }
    if (!squadSnapshot.exists || squadSnapshot.data()?.isActive === false) fail('squad_not_found', squadId, 'not-found');
    const squad = squadSnapshot.data() as SquadData;
    const records = activeMembershipRecords(membershipsSnapshot);
    const target = membershipFor(records, userId);
    if (!target) {
      transaction.update(ref, { status: 'canceled', canceledAt: now, respondedAt: now, updatedAt: now });
      return { changed: true, outcome: 'target_not_active_member' as const, invitation };
    }
    healLegacyCreatorIfNeeded(transaction, squadId, squad, records, now);
    if (adminIds(squadId, squad, records).length === 0) fail('squad_has_no_active_admin', squadId);
    if (decision === 'accept') {
      transaction.set(target.ref, {
        squadRole: 'admin',
        squadRoleUpdatedAt: now,
        squadRoleUpdatedBy: userId,
        updatedAt: now,
      }, { merge: true });
      transaction.update(ref, { status: 'accepted', respondedAt: now, acceptedAt: now, updatedAt: now });
      return { changed: true, outcome: 'accepted' as const, invitation, squad };
    }
    transaction.update(ref, { status: 'declined', respondedAt: now, declinedAt: now, updatedAt: now });
    return { changed: true, outcome: 'declined' as const, invitation, squad };
  });

  await resolveSquadAdminInvitationNotification(result.invitation);
  if (result.outcome === 'expired') fail('invitation_expired', squadId);
  if (result.outcome === 'target_not_active_member') fail('target_not_active_member', squadId);
  if (result.outcome === 'accepted') {
    const accepterName = await publicActorName(userId);
    const attempt = typeof result.invitation.attempt === 'number' ? result.invitation.attempt : 1;
    const eventId = squadAdminInvitationAcceptedNotificationId(ref.id, attempt);
    const inviterUserId = String(result.invitation.invitedByUserId ?? '');
    if (inviterUserId) {
      await createSquadNotificationAndPush({
        recipientUserId: inviterUserId,
        eventId,
        type: 'squadAdminInvitationAccepted',
        titleKey: 'notifications.types.squadAdminAcceptedTitle',
        bodyKey: 'notifications.types.squadAdminAcceptedBody',
        params: { actorName: accepterName, squadName: squadLabel(result.squad ?? {}) },
        squadId,
        actorUserId: userId,
        actorDisplayName: accepterName,
        invitationId: ref.id,
        pushTitle: 'Admin invitation accepted',
        pushBody: `${accepterName} accepted your Squad admin invitation.`,
      });
    }
  }
  return { status: result.outcome };
});

export const cancelSquadAdminInvitation = functions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const squadId = readId(data?.squadId, 'Squad reference');
  const targetUserId = readId(data?.targetUserId, 'member reference');
  const db = firestore();
  const ref = invitationRef(squadId, targetUserId);
  const result = await db.runTransaction(async (transaction) => {
    const [squadSnapshot, invitationSnapshot] = await transaction.getAll(db.collection('squads').doc(squadId), ref);
    const membershipsSnapshot = await transaction.get(db.collection('squadMemberships')
      .where('squadId', '==', squadId)
      .where('membershipStatus', '==', 'active'));
    if (!squadSnapshot.exists) fail('squad_not_found', squadId, 'not-found');
    const squad = squadSnapshot.data() as SquadData;
    const records = activeMembershipRecords(membershipsSnapshot);
    const now = Timestamp.now();
    healLegacyCreatorIfNeeded(transaction, squadId, squad, records, now);
    assertActiveAdmin(squadId, squad, records, userId);
    if (!invitationSnapshot.exists) fail('invitation_not_found', squadId, 'not-found');
    const invitation = invitationSnapshot.data() as InvitationData;
    if (invitation.status === 'canceled') return { invitation, status: 'canceled' as const };
    if (invitation.status !== 'pending') fail(`invitation_${invitation.status ?? 'not_found'}`, squadId);
    if (timestampMillis(invitation.expiresAt) <= now.toMillis()) {
      transaction.update(ref, { status: 'expired', expiredAt: now, respondedAt: now, updatedAt: now });
      return { invitation, status: 'expired' as const };
    }
    transaction.update(ref, { status: 'canceled', canceledAt: now, respondedAt: now, updatedAt: now });
    return { invitation, status: 'canceled' as const };
  });
  await resolveSquadAdminInvitationNotification(result.invitation);
  if (result.status === 'expired') fail('invitation_expired', squadId);
  return { status: result.status };
});

export const removeSquadAdmin = functions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const squadId = readId(data?.squadId, 'Squad reference');
  const targetUserId = readId(data?.targetUserId, 'member reference');
  const db = firestore();
  await db.runTransaction(async (transaction) => {
    const squadSnapshot = await transaction.get(db.collection('squads').doc(squadId));
    const membershipsSnapshot = await transaction.get(db.collection('squadMemberships')
      .where('squadId', '==', squadId)
      .where('membershipStatus', '==', 'active'));
    if (!squadSnapshot.exists) fail('squad_not_found', squadId, 'not-found');
    const squad = squadSnapshot.data() as SquadData;
    const records = activeMembershipRecords(membershipsSnapshot);
    const now = Timestamp.now();
    healLegacyCreatorIfNeeded(transaction, squadId, squad, records, now);
    assertActiveAdmin(squadId, squad, records, userId);
    const target = membershipFor(records, targetUserId);
    if (!target || !isActiveSquadAdmin({ squad, membership: target.data, squadId, userId: targetUserId })) {
      fail('target_not_admin', squadId);
    }
    const currentAdminIds = adminIds(squadId, squad, records);
    if (currentAdminIds.length <= 1) fail('last_active_admin', squadId);
    transaction.set(target.ref, {
      squadRole: 'member',
      squadRoleUpdatedAt: now,
      squadRoleUpdatedBy: userId,
      updatedAt: now,
    }, { merge: true });
  });
  return { status: 'member' as const, targetUserId };
});

export const leaveVenueSportSquad = functions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const squadId = readId(data?.squadId, 'Squad reference');
  const db = firestore();
  const squadRef = db.collection('squads').doc(squadId);
  const userRef = db.collection('users').doc(userId);
  const canonicalMembershipRef = db.collection('squadMemberships').doc(`${squadId}__${userId}`);
  const pendingInvitationRef = invitationRef(squadId, userId);
  const result = await db.runTransaction(async (transaction) => {
    const [squadSnapshot, userSnapshot, invitationSnapshot] = await transaction.getAll(
      squadRef, userRef, pendingInvitationRef,
    );
    const membershipsSnapshot = await transaction.get(db.collection('squadMemberships')
      .where('squadId', '==', squadId)
      .where('membershipStatus', '==', 'active'));
    if (!userSnapshot.exists) fail('user_not_found', squadId);
    const squad = (squadSnapshot.data() ?? {}) as SquadData;
    const records = activeMembershipRecords(membershipsSnapshot);
    const leavingMembership = membershipFor(records, userId);
    const now = Timestamp.now();
    if (squadSnapshot.exists) healLegacyCreatorIfNeeded(transaction, squadId, squad, records, now);
    if (leavingMembership && isActiveSquadAdmin({ squad, membership: leavingMembership.data, squadId, userId })) {
      const remainingAdminIds = adminIds(squadId, squad, records).filter((adminUserId) => adminUserId !== userId);
      if (remainingAdminIds.length === 0) fail('last_active_admin', squadId);
    }
    const memberIds = Array.isArray(squad.memberIds)
      ? Array.from(new Set(squad.memberIds.filter((id): id is string => typeof id === 'string' && id !== userId)))
      : [];
    if (squadSnapshot.exists) {
      transaction.update(squadRef, { memberIds, memberCount: memberIds.length, updatedAt: now });
    }
    const joinedAt = leavingMembership?.data.joinedAt ?? now;
    transaction.set(canonicalMembershipRef, {
      membershipId: canonicalMembershipRef.id,
      userId,
      squadId,
      membershipStatus: 'left',
      squadRole: 'member',
      squadRoleUpdatedAt: now,
      squadRoleUpdatedBy: userId,
      presenceStatus: 'away',
      isActive: false,
      leftAt: now,
      updatedAt: now,
      joinedAt,
    }, { merge: true });
    records.filter((record) => record.data.userId === userId && record.ref.id !== canonicalMembershipRef.id)
      .forEach((record) => transaction.set(record.ref, {
        membershipStatus: 'left', squadRole: 'member', squadRoleUpdatedAt: now, squadRoleUpdatedBy: userId,
        presenceStatus: 'away', isActive: false, leftAt: now, updatedAt: now,
      }, { merge: true }));
    const invitation = invitationSnapshot.data() as InvitationData | undefined;
    if (invitation?.status === 'pending') {
      transaction.update(pendingInvitationRef, { status: 'canceled', canceledAt: now, respondedAt: now, updatedAt: now });
    }
    const selection = resolveSelectionAfterLeave(userSnapshot.data()?.squadIds, userSnapshot.data()?.selectedSquadId, squadId);
    transaction.set(userRef, { ...selection, updatedAt: now }, { merge: true });
    return { ...selection, invitation };
  });
  await resolveSquadAdminInvitationNotification(result.invitation);
  return { squadId, status: 'left' as const, selectedSquadId: result.selectedSquadId };
});

export const requestSquadAdminAccess = functions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const squadId = readId(data?.squadId, 'Squad reference');
  const db = firestore();
  const ref = recoveryRequestRef(squadId, userId);
  await db.runTransaction(async (transaction) => {
    const [squadSnapshot, requestSnapshot] = await transaction.getAll(db.collection('squads').doc(squadId), ref);
    const membershipsSnapshot = await transaction.get(db.collection('squadMemberships')
      .where('squadId', '==', squadId)
      .where('membershipStatus', '==', 'active'));
    if (!squadSnapshot.exists || squadSnapshot.data()?.isActive === false) fail('squad_not_found', squadId, 'not-found');
    const squad = squadSnapshot.data() as SquadData;
    const records = activeMembershipRecords(membershipsSnapshot);
    const requester = membershipFor(records, userId);
    if (!requester) fail('target_not_active_member', squadId, 'permission-denied');
    const now = Timestamp.now();
    healLegacyCreatorIfNeeded(transaction, squadId, squad, records, now);
    if (adminIds(squadId, squad, records).length > 0) fail('squad_has_active_admin', squadId);
    if (requestSnapshot.exists && requestSnapshot.data()?.status === 'pending') {
      fail('recovery_request_already_pending', squadId, 'already-exists');
    }
    transaction.set(ref, {
      squadId,
      requesterUserId: userId,
      status: 'pending',
      createdAt: now,
      reviewedAt: null,
      reviewedBy: null,
      updatedAt: now,
    });
  });
  const requestId = ref.id;
  await createSquadNotificationAndPush({
    recipientUserId: userId,
    eventId: squadAdminRecoveryNotificationId(requestId),
    type: 'squadAdminRecoveryRequested',
    titleKey: 'notifications.types.squadAdminRecoveryTitle',
    bodyKey: 'notifications.types.squadAdminRecoveryBody',
    params: {},
    squadId,
    pushTitle: 'Admin access request submitted',
    pushBody: 'Sideline Social will review your Squad admin access request.',
  });
  return { status: 'pending' as const, requestId };
});

export const reviewSquadAdminAccessRequest = functions.https.onCall(async (data, context) => {
  authenticatedUserId(context);
  if (context.auth?.token.admin !== true && context.auth?.token.platformAdmin !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Trusted platform administrator access is required.');
  }
  const reviewerUserId = context.auth.uid;
  const squadId = readId(data?.squadId, 'Squad reference');
  const requesterUserId = readId(data?.requesterUserId, 'requester reference');
  const decision = data?.decision === 'approve' || data?.decision === 'decline' ? data.decision : null;
  if (!decision) throw new functions.https.HttpsError('invalid-argument', 'Approve or decline the request.');
  const db = firestore();
  const ref = recoveryRequestRef(squadId, requesterUserId);
  await db.runTransaction(async (transaction) => {
    const [squadSnapshot, requestSnapshot] = await transaction.getAll(db.collection('squads').doc(squadId), ref);
    const membershipsSnapshot = await transaction.get(db.collection('squadMemberships')
      .where('squadId', '==', squadId)
      .where('membershipStatus', '==', 'active'));
    if (!requestSnapshot.exists || requestSnapshot.data()?.status !== 'pending') fail('recovery_request_not_found', squadId, 'not-found');
    if (!squadSnapshot.exists || squadSnapshot.data()?.isActive === false) fail('squad_not_found', squadId, 'not-found');
    const squad = squadSnapshot.data() as SquadData;
    const records = activeMembershipRecords(membershipsSnapshot);
    const requester = membershipFor(records, requesterUserId);
    if (!requester) fail('target_not_active_member', squadId);
    const now = Timestamp.now();
    healLegacyCreatorIfNeeded(transaction, squadId, squad, records, now);
    if (decision === 'approve' && adminIds(squadId, squad, records).length > 0) fail('squad_has_active_admin', squadId);
    if (decision === 'approve') {
      transaction.set(requester.ref, {
        squadRole: 'admin', squadRoleUpdatedAt: now, squadRoleUpdatedBy: reviewerUserId, updatedAt: now,
      }, { merge: true });
    }
    transaction.update(ref, {
      status: decision === 'approve' ? 'approved' : 'declined',
      reviewedAt: now,
      reviewedBy: reviewerUserId,
      updatedAt: now,
    });
  });
  return { status: decision === 'approve' ? 'approved' as const : 'declined' as const };
});

export const expireSquadAdminInvitations = functions.region('us-central1').pubsub
  .schedule('30 4 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    const db = firestore();
    const now = Timestamp.now();
    const snapshot = await db.collection('squadAdminInvitations')
      .where('status', '==', 'pending')
      .where('expiresAt', '<=', now)
      .orderBy('expiresAt', 'asc')
      .limit(INVITATION_EXPIRY_BATCH_SIZE)
      .get();
    if (snapshot.empty) {
      console.log('[expireSquadAdminInvitations] completed', { expiredCount: 0 });
      return null;
    }
    const batch = db.batch();
    snapshot.docs.forEach((document) => {
      const invitation = document.data() as InvitationData;
      batch.update(document.ref, { status: 'expired', expiredAt: now, respondedAt: now, updatedAt: now });
      if (typeof invitation.targetUserId === 'string' && typeof invitation.notificationId === 'string') {
        batch.set(notificationRef(invitation.targetUserId, invitation.notificationId), {
          status: 'dismissed', dismissedAt: now, dismissReason: 'resolved', isRead: true, readAt: now,
        }, { merge: true });
      }
    });
    await batch.commit();
    console.log('[expireSquadAdminInvitations] completed', { expiredCount: snapshot.size });
    return null;
  });
