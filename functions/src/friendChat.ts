import { randomUUID } from 'node:crypto';

import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as firebaseFunctions from 'firebase-functions';

import { formatSuggestedConnectionName, resolvePublicProfileName } from './friendSuggestionCore';
import { friendRequestIdFor } from './friendRequestCore';
import { resolveFriendRequestNotification } from './friendRequestNotifications';
import { sendPushToUser } from './pushNotificationDelivery';
import { assertUserContentAllowed } from './contentSafety';
import {
  accountCanCommunicate,
  accountCanUseApp,
  permanentAccountFunctions,
} from './permanentAuth';
import {
  CHAT_SEND_COOLDOWN_MS,
  MAX_CHAT_PARTICIPANTS,
  directConversationIdFor,
  isAcceptedFriend,
  messageIdFor,
  normalizeChatUserId,
  normalizeClientMessageId,
  normalizeConversationId,
  normalizeFriendIds,
  sanitizeChatMessage,
  sanitizeGroupName,
  sanitizeMessagePreview,
} from './friendChatCore';

const functions = permanentAccountFunctions(firebaseFunctions);
const chatFunctions = functions.region('us-central1');
const communicationFunctions = permanentAccountFunctions(firebaseFunctions, "communication");
const communicationChatFunctions = communicationFunctions.region('us-central1');
const safetyFunctions = permanentAccountFunctions(firebaseFunctions, "safety");
const safetyChatFunctions = safetyFunctions.region('us-central1');
const firestore = () => admin.firestore();

type ConversationData = admin.firestore.DocumentData & {
  conversationType?: 'direct' | 'group';
  ownerUserId?: string | null;
  adminUserIds?: string[];
  activeParticipantIds?: string[];
  invitedParticipantIds?: string[];
  participantNameSnapshots?: Record<string, string>;
  groupName?: string | null;
  lastMessageId?: string | null;
};

function requireUid(context: firebaseFunctions.https.CallableContext) {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in is required.');
  return uid;
}

function invalid(message: string): never {
  throw new functions.https.HttpsError('invalid-argument', message);
}

function denied(message: string): never {
  throw new functions.https.HttpsError('permission-denied', message);
}

function failed(message: string): never {
  throw new functions.https.HttpsError('failed-precondition', message);
}

function safeName(data: admin.firestore.DocumentData | undefined) {
  return formatSuggestedConnectionName(resolvePublicProfileName(data)) || '';
}

function conversationRef(conversationId: string) {
  return firestore().collection('friendConversations').doc(conversationId);
}

function memberRef(conversationId: string, userId: string) {
  return conversationRef(conversationId).collection('members').doc(userId);
}

function memberProfileRef(conversationId: string, userId: string) {
  return conversationRef(conversationId).collection('memberProfiles').doc(userId);
}

function blockRef(blockerId: string, blockedId: string) {
  return firestore().collection('userBlocks').doc(blockerId).collection('blockedUsers').doc(blockedId);
}

function readIds(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function baseMember(input: {
  userId: string;
  displayNameSnapshot: string;
  status: 'active' | 'invited';
  role: 'owner' | 'member';
  invitedBy: string | null;
  invitationId?: string | null;
  now: Timestamp;
}) {
  return {
    userId: input.userId,
    status: input.status,
    role: input.role,
    displayNameSnapshot: input.displayNameSnapshot,
    invitedBy: input.invitedBy,
    invitationId: input.invitationId ?? null,
    invitedAt: input.status === 'invited' ? input.now : null,
    joinedAt: input.status === 'active' ? input.now : null,
    declinedAt: null,
    leftAt: null,
    removedAt: null,
    removedBy: null,
    lastReadAt: input.status === 'active' ? input.now : null,
    lastSentAt: null,
    muted: false,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function memberProfile(input: { userId: string; displayNameSnapshot: string; status: string; role: string; now: Timestamp }) {
  return {
    userId: input.userId,
    displayNameSnapshot: input.displayNameSnapshot,
    status: input.status,
    role: input.role,
    updatedAt: input.now,
  };
}

async function getBlockSnapshots(
  transaction: admin.firestore.Transaction,
  pairs: Array<[string, string]>,
) {
  const refs = Array.from(new Map(pairs.flatMap(([a, b]) => [
    [`${a}:${b}`, blockRef(a, b)],
    [`${b}:${a}`, blockRef(b, a)],
  ])).values());
  const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
  return snapshots.some((snapshot) => snapshot.exists);
}

export const createOrOpenDirectConversation = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const friendUserId = normalizeChatUserId(data?.friendUserId);
  if (!friendUserId) invalid('A valid friendUserId is required.');
  if (friendUserId === uid) invalid('You cannot message yourself.');
  const conversationId = directConversationIdFor(uid, friendUserId);
  const ref = conversationRef(conversationId);

  return firestore().runTransaction(async (transaction) => {
    const userRef = firestore().collection('users').doc(uid);
    const friendRef = firestore().collection('users').doc(friendUserId);
    const [existing, user, friend, userMember, friendMember, blockedByCaller, blockedByFriend] = await Promise.all([
      transaction.get(ref),
      transaction.get(userRef),
      transaction.get(friendRef),
      transaction.get(memberRef(conversationId, uid)),
      transaction.get(memberRef(conversationId, friendUserId)),
      transaction.get(blockRef(uid, friendUserId)),
      transaction.get(blockRef(friendUserId, uid)),
    ]);
    if (blockedByCaller.exists || blockedByFriend.exists) denied('Messaging is unavailable for this connection.');
    if (!user.exists || !friend.exists || !isAcceptedFriend(user.data(), friend.data(), uid, friendUserId)) {
      denied('An accepted friendship is required.');
    }

    const now = Timestamp.now();
    const names = { [uid]: safeName(user.data()), [friendUserId]: safeName(friend.data()) };
    if (!existing.exists) {
      transaction.create(ref, {
        conversationId,
        conversationType: 'direct',
        groupName: null,
        ownerUserId: null,
        adminUserIds: [],
        activeParticipantIds: [uid, friendUserId].sort(),
        invitedParticipantIds: [],
        activeParticipantCount: 2,
        invitedParticipantCount: 0,
        participantNameSnapshots: names,
        createdBy: uid,
        createdAt: now,
        updatedAt: now,
        lastMessageAt: null,
        lastMessageId: null,
        lastMessagePreview: null,
        lastMessageRemoved: false,
        lastSenderId: null,
        status: 'active',
      });
    } else if (existing.data()?.conversationType !== 'direct') {
      failed('Conversation identity is unavailable.');
    } else {
      transaction.update(ref, {
        activeParticipantIds: [uid, friendUserId].sort(),
        activeParticipantCount: 2,
        invitedParticipantIds: [],
        invitedParticipantCount: 0,
        participantNameSnapshots: names,
        status: 'active',
        updatedAt: now,
      });
    }

    const writeDirectMember = (snapshot: admin.firestore.DocumentSnapshot, userId: string) => {
      const member = baseMember({
        userId,
        displayNameSnapshot: names[userId],
        status: 'active',
        role: 'member',
        invitedBy: null,
        now,
      });
      if (!snapshot.exists) transaction.create(memberRef(conversationId, userId), member);
      else transaction.set(memberRef(conversationId, userId), {
        status: 'active', role: 'member', displayNameSnapshot: names[userId], joinedAt: snapshot.data()?.joinedAt ?? now,
        declinedAt: null, leftAt: null, removedAt: null, removedBy: null, updatedAt: now,
      }, { merge: true });
      transaction.set(memberProfileRef(conversationId, userId), memberProfile({
        userId, displayNameSnapshot: names[userId], status: 'active', role: 'member', now,
      }), { merge: true });
    };
    writeDirectMember(userMember, uid);
    writeDirectMember(friendMember, friendUserId);
    return { conversationId, status: existing.exists ? 'existing' as const : 'created' as const };
  });
});

export const createFriendGroupConversation = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const requestedIds = Array.isArray(data?.friendUserIds) ? data.friendUserIds : null;
  if (!requestedIds) invalid('friendUserIds must be an array.');
  if (requestedIds.some((value: unknown) => !normalizeChatUserId(value))) invalid('Every friend ID must be valid.');
  const friendUserIds = normalizeFriendIds(requestedIds, uid);
  if (requestedIds.some((value: unknown) => value === uid)) invalid('Do not include yourself.');
  if (friendUserIds.length < 2) invalid('Select at least two accepted friends.');
  if (friendUserIds.length + 1 > MAX_CHAT_PARTICIPANTS) invalid('This group is too large.');
  let groupName: string | null;
  try { groupName = sanitizeGroupName(data?.groupName); } catch (error) { invalid((error as Error).message); }
  const ref = firestore().collection('friendConversations').doc();
  const conversationId = ref.id;
  const invitations: Array<{ userId: string; invitationId: string; inviterUserId: string; inviterName: string; groupName: string | null }> = [];

  await firestore().runTransaction(async (transaction) => {
    const userRefs = [uid, ...friendUserIds].map((userId) => firestore().collection('users').doc(userId));
    const userSnapshots = await Promise.all(userRefs.map((userRef) => transaction.get(userRef)));
    if (userSnapshots.some((snapshot) => !snapshot.exists)) denied('Every participant must be an accepted friend.');
    const creator = userSnapshots[0];
    friendUserIds.forEach((friendId, index) => {
      if (!isAcceptedFriend(creator.data(), userSnapshots[index + 1].data(), uid, friendId)) {
        denied('Every participant must be an accepted friend.');
      }
    });
    if (await getBlockSnapshots(transaction, friendUserIds.map((friendId) => [uid, friendId]))) {
      denied('A blocked connection cannot be invited.');
    }

    const now = Timestamp.now();
    const names = Object.fromEntries([uid, ...friendUserIds].map((userId, index) => [userId, safeName(userSnapshots[index].data())]));
    transaction.create(ref, {
      conversationId,
      conversationType: 'group',
      groupName,
      ownerUserId: uid,
      adminUserIds: [uid],
      activeParticipantIds: [uid],
      invitedParticipantIds: friendUserIds,
      activeParticipantCount: 1,
      invitedParticipantCount: friendUserIds.length,
      participantNameSnapshots: names,
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: null,
      lastMessageId: null,
      lastMessagePreview: null,
      lastMessageRemoved: false,
      lastSenderId: null,
      status: 'active',
    });
    transaction.create(memberRef(conversationId, uid), baseMember({
      userId: uid, displayNameSnapshot: names[uid], status: 'active', role: 'owner', invitedBy: null, now,
    }));
    transaction.create(memberProfileRef(conversationId, uid), memberProfile({
      userId: uid, displayNameSnapshot: names[uid], status: 'active', role: 'owner', now,
    }));
    friendUserIds.forEach((friendId) => {
      const invitationId = randomUUID().replace(/-/gu, '');
      transaction.create(memberRef(conversationId, friendId), baseMember({
        userId: friendId, displayNameSnapshot: names[friendId], status: 'invited', role: 'member',
        invitedBy: uid, invitationId, now,
      }));
      transaction.create(memberProfileRef(conversationId, friendId), memberProfile({
        userId: friendId, displayNameSnapshot: names[friendId], status: 'invited', role: 'member', now,
      }));
      invitations.push({ userId: friendId, invitationId, inviterUserId: uid, inviterName: names[uid], groupName });
    });
  });
  await Promise.allSettled(invitations.map((invitation) => createGroupInvitationNotification(conversationId, invitation)));
  return { conversationId, invitedCount: friendUserIds.length };
});

export const respondToFriendGroupInvitation = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  const response = data?.response;
  if (!conversationId || (response !== 'accept' && response !== 'decline')) invalid('A valid response is required.');
  return firestore().runTransaction(async (transaction) => {
    const ref = conversationRef(conversationId);
    const ownRef = memberRef(conversationId, uid);
    const [conversation, member] = await Promise.all([transaction.get(ref), transaction.get(ownRef)]);
    if (!conversation.exists || conversation.data()?.conversationType !== 'group' || !member.exists) denied('Invitation unavailable.');
    const currentStatus = member.data()?.status;
    if ((response === 'accept' && currentStatus === 'active') || (response === 'decline' && currentStatus === 'declined')) {
      return { status: response === 'accept' ? 'accepted' as const : 'declined' as const, alreadyResponded: true };
    }
    if (currentStatus !== 'invited') failed('This invitation has already been resolved.');
    const now = Timestamp.now();
    const active = readIds(conversation.data()?.activeParticipantIds);
    const invited = readIds(conversation.data()?.invitedParticipantIds).filter((id) => id !== uid);
    if (response === 'accept') {
      transaction.update(ownRef, { status: 'active', joinedAt: now, declinedAt: null, updatedAt: now });
      transaction.update(memberProfileRef(conversationId, uid), { status: 'active', updatedAt: now });
      transaction.update(ref, {
        activeParticipantIds: Array.from(new Set([...active, uid])), invitedParticipantIds: invited,
        activeParticipantCount: active.includes(uid) ? active.length : active.length + 1,
        invitedParticipantCount: invited.length, updatedAt: now,
      });
      return { status: 'accepted' as const, alreadyResponded: false };
    }
    transaction.update(ownRef, { status: 'declined', declinedAt: now, updatedAt: now });
    transaction.update(memberProfileRef(conversationId, uid), { status: 'declined', updatedAt: now });
    transaction.update(ref, { invitedParticipantIds: invited, invitedParticipantCount: invited.length, updatedAt: now });
    return { status: 'declined' as const, alreadyResponded: false };
  });
});

export const inviteFriendsToGroupConversation = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  if (!conversationId || !Array.isArray(data?.friendUserIds)) invalid('Conversation and friends are required.');
  if (data.friendUserIds.some((value: unknown) => !normalizeChatUserId(value))) invalid('Every friend ID must be valid.');
  const friendUserIds = normalizeFriendIds(data.friendUserIds, uid);
  if (friendUserIds.length === 0) invalid('Select at least one friend.');
  const invitations: Array<{ userId: string; invitationId: string; inviterUserId: string; inviterName: string; groupName: string | null }> = [];

  await firestore().runTransaction(async (transaction) => {
    const ref = conversationRef(conversationId);
    const callerRef = memberRef(conversationId, uid);
    const [conversation, caller, ...candidateMembers] = await Promise.all([
      transaction.get(ref), transaction.get(callerRef),
      ...friendUserIds.map((friendId) => transaction.get(memberRef(conversationId, friendId))),
    ]);
    const conversationData = conversation.data() as ConversationData | undefined;
    if (!conversation.exists || conversationData?.conversationType !== 'group') failed('Group conversation required.');
    if (caller.data()?.status !== 'active' || !['owner', 'admin'].includes(caller.data()?.role)) denied('Group admin access required.');
    candidateMembers.forEach((member) => {
      if (member.exists && ['active', 'invited'].includes(member.data()?.status)) failed('A selected person is already in this group.');
    });
    const active = readIds(conversationData.activeParticipantIds);
    const invited = readIds(conversationData.invitedParticipantIds);
    if (active.length + invited.length + friendUserIds.length > MAX_CHAT_PARTICIPANTS) invalid('This group is too large.');

    const callerUser = await transaction.get(firestore().collection('users').doc(uid));
    const friendUsers = await Promise.all(friendUserIds.map((id) => transaction.get(firestore().collection('users').doc(id))));
    friendUserIds.forEach((friendId, index) => {
      if (!friendUsers[index].exists || !isAcceptedFriend(callerUser.data(), friendUsers[index].data(), uid, friendId)) {
        denied('You may invite only accepted friends.');
      }
    });
    const pairs: Array<[string, string]> = [];
    friendUserIds.forEach((friendId) => active.forEach((activeId) => pairs.push([activeId, friendId])));
    if (await getBlockSnapshots(transaction, pairs)) denied('A blocked connection cannot be invited.');

    const now = Timestamp.now();
    const nextNames = { ...(conversationData.participantNameSnapshots ?? {}) };
    friendUserIds.forEach((friendId, index) => {
      const invitationId = randomUUID().replace(/-/gu, '');
      const name = safeName(friendUsers[index].data());
      nextNames[friendId] = name;
      transaction.set(memberRef(conversationId, friendId), baseMember({
        userId: friendId, displayNameSnapshot: name, status: 'invited', role: 'member', invitedBy: uid,
        invitationId, now,
      }));
      transaction.set(memberProfileRef(conversationId, friendId), memberProfile({
        userId: friendId, displayNameSnapshot: name, status: 'invited', role: 'member', now,
      }));
      invitations.push({
        userId: friendId, invitationId, inviterUserId: uid, inviterName: caller.data()?.displayNameSnapshot ?? '',
        groupName: conversationData.groupName ?? null,
      });
    });
    const nextInvited = [...invited, ...friendUserIds];
    transaction.update(ref, {
      invitedParticipantIds: nextInvited, invitedParticipantCount: nextInvited.length,
      participantNameSnapshots: nextNames, updatedAt: now,
    });
  });
  await Promise.allSettled(invitations.map((invitation) => createGroupInvitationNotification(conversationId, invitation)));
  return { invitedCount: invitations.length };
});

export const renameFriendGroupConversation = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  if (!conversationId) invalid('Conversation required.');
  let groupName: string | null;
  try { groupName = sanitizeGroupName(data?.groupName); } catch (error) { invalid((error as Error).message); }
  await firestore().runTransaction(async (transaction) => {
    const [conversation, caller] = await Promise.all([
      transaction.get(conversationRef(conversationId)), transaction.get(memberRef(conversationId, uid)),
    ]);
    if (!conversation.exists || conversation.data()?.conversationType !== 'group') failed('Group conversation required.');
    if (caller.data()?.status !== 'active' || !['owner', 'admin'].includes(caller.data()?.role)) denied('Group admin access required.');
    transaction.update(conversation.ref, { groupName, updatedAt: Timestamp.now() });
  });
  return { groupName };
});

export const setFriendGroupAdminRole = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  const memberUserId = normalizeChatUserId(data?.memberUserId);
  const makeAdmin = data?.makeAdmin;
  if (!conversationId || !memberUserId || typeof makeAdmin !== 'boolean') invalid('Valid admin change required.');
  await firestore().runTransaction(async (transaction) => {
    const ref = conversationRef(conversationId);
    const [conversation, caller, target] = await Promise.all([
      transaction.get(ref), transaction.get(memberRef(conversationId, uid)), transaction.get(memberRef(conversationId, memberUserId)),
    ]);
    if (!conversation.exists || conversation.data()?.conversationType !== 'group') failed('Group conversation required.');
    if (caller.data()?.status !== 'active' || caller.data()?.role !== 'owner') denied('Only the owner may manage admins.');
    if (target.data()?.status !== 'active' || target.data()?.role === 'owner') failed('Active non-owner member required.');
    const adminIds = new Set(readIds(conversation.data()?.adminUserIds));
    if (makeAdmin) adminIds.add(memberUserId); else adminIds.delete(memberUserId);
    transaction.update(target.ref, { role: makeAdmin ? 'admin' : 'member', updatedAt: Timestamp.now() });
    transaction.update(memberProfileRef(conversationId, memberUserId), { role: makeAdmin ? 'admin' : 'member', updatedAt: Timestamp.now() });
    transaction.update(ref, { adminUserIds: Array.from(adminIds), updatedAt: Timestamp.now() });
  });
  return { updated: true };
});

export const transferFriendGroupOwnership = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  const memberUserId = normalizeChatUserId(data?.memberUserId);
  if (!conversationId || !memberUserId || memberUserId === uid) invalid('New owner required.');
  await firestore().runTransaction(async (transaction) => {
    const ref = conversationRef(conversationId);
    const [conversation, caller, target] = await Promise.all([
      transaction.get(ref), transaction.get(memberRef(conversationId, uid)), transaction.get(memberRef(conversationId, memberUserId)),
    ]);
    if (!conversation.exists || conversation.data()?.conversationType !== 'group') failed('Group conversation required.');
    if (caller.data()?.status !== 'active' || caller.data()?.role !== 'owner') denied('Only the owner may transfer ownership.');
    if (target.data()?.status !== 'active') failed('New owner must be active.');
    const now = Timestamp.now();
    const admins = new Set(readIds(conversation.data()?.adminUserIds));
    admins.delete(uid); admins.add(memberUserId);
    transaction.update(caller.ref, { role: 'member', updatedAt: now });
    transaction.update(target.ref, { role: 'owner', updatedAt: now });
    transaction.update(memberProfileRef(conversationId, uid), { role: 'member', updatedAt: now });
    transaction.update(memberProfileRef(conversationId, memberUserId), { role: 'owner', updatedAt: now });
    transaction.update(ref, { ownerUserId: memberUserId, adminUserIds: Array.from(admins), updatedAt: now });
  });
  return { transferred: true };
});

export const removeFriendGroupMember = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  const memberUserId = normalizeChatUserId(data?.memberUserId);
  if (!conversationId || !memberUserId || memberUserId === uid) invalid('Member required.');
  await firestore().runTransaction(async (transaction) => {
    const ref = conversationRef(conversationId);
    const [conversation, caller, target] = await Promise.all([
      transaction.get(ref), transaction.get(memberRef(conversationId, uid)), transaction.get(memberRef(conversationId, memberUserId)),
    ]);
    if (!conversation.exists || conversation.data()?.conversationType !== 'group') failed('Group conversation required.');
    if (caller.data()?.status !== 'active' || !['owner', 'admin'].includes(caller.data()?.role)) denied('Group admin access required.');
    if (target.data()?.status !== 'active' || target.data()?.role === 'owner') failed('This member cannot be removed.');
    if (caller.data()?.role === 'admin' && target.data()?.role === 'admin') denied('Admins cannot remove another admin.');
    const active = readIds(conversation.data()?.activeParticipantIds).filter((id) => id !== memberUserId);
    const admins = readIds(conversation.data()?.adminUserIds).filter((id) => id !== memberUserId);
    const now = Timestamp.now();
    transaction.update(target.ref, { status: 'removed', removedAt: now, removedBy: uid, updatedAt: now });
    transaction.update(memberProfileRef(conversationId, memberUserId), { status: 'removed', updatedAt: now });
    transaction.update(ref, { activeParticipantIds: active, activeParticipantCount: active.length, adminUserIds: admins, updatedAt: now });
  });
  return { removed: true };
});

export const leaveFriendConversation = chatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  if (!conversationId) invalid('Conversation required.');
  await firestore().runTransaction(async (transaction) => {
    const ref = conversationRef(conversationId);
    const ownRef = memberRef(conversationId, uid);
    const [conversation, member] = await Promise.all([transaction.get(ref), transaction.get(ownRef)]);
    if (!conversation.exists || conversation.data()?.conversationType !== 'group' || member.data()?.status !== 'active') failed('Active group membership required.');
    const active = readIds(conversation.data()?.activeParticipantIds);
    if (member.data()?.role === 'owner' && active.length > 1) failed('Transfer ownership before leaving.');
    const nextActive = active.filter((id) => id !== uid);
    const admins = readIds(conversation.data()?.adminUserIds).filter((id) => id !== uid);
    const now = Timestamp.now();
    transaction.update(ownRef, { status: 'left', leftAt: now, updatedAt: now });
    transaction.update(memberProfileRef(conversationId, uid), { status: 'left', updatedAt: now });
    transaction.update(ref, {
      activeParticipantIds: nextActive, activeParticipantCount: nextActive.length,
      adminUserIds: admins, ownerUserId: nextActive.length === 0 ? null : conversation.data()?.ownerUserId,
      status: nextActive.length === 0 ? 'archived' : 'active', updatedAt: now,
    });
  });
  return { left: true };
});

export const setFriendConversationMuted = chatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  if (!conversationId || typeof data?.muted !== 'boolean') invalid('Conversation and muted state required.');
  const ref = memberRef(conversationId, uid);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.status !== 'active') denied('Active membership required.');
  await ref.update({ muted: data.muted, updatedAt: Timestamp.now() });
  return { muted: data.muted };
});

export const markFriendConversationRead = chatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  if (!conversationId) invalid('Conversation required.');
  const ref = memberRef(conversationId, uid);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.status !== 'active') denied('Active membership required.');
  await ref.update({ lastReadAt: Timestamp.now(), updatedAt: Timestamp.now() });
  return { markedRead: true };
});

export const sendFriendChatMessage = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  const clientMessageId = normalizeClientMessageId(data?.clientMessageId);
  if (!conversationId || !clientMessageId) invalid('Conversation and clientMessageId are required.');
  let text: string;
  try { text = sanitizeChatMessage(data?.text); } catch (error) { invalid((error as Error).message); }
  assertUserContentAllowed(text);
  const messageId = messageIdFor(uid, clientMessageId);
  const messageRef = conversationRef(conversationId).collection('messages').doc(messageId);
  let conversationType: 'direct' | 'group' = 'direct';
  let createdAt = Timestamp.now();
  let alreadySent = false;

  await firestore().runTransaction(async (transaction) => {
    const ref = conversationRef(conversationId);
    const ownRef = memberRef(conversationId, uid);
    const [conversation, member, existingMessage, sender] = await Promise.all([
      transaction.get(ref), transaction.get(ownRef), transaction.get(messageRef),
      transaction.get(firestore().collection('users').doc(uid)),
    ]);
    if (!conversation.exists || conversation.data()?.status !== 'active') failed('Conversation unavailable.');
    if (!member.exists || member.data()?.status !== 'active') denied('Active membership required.');
    if (existingMessage.exists) {
      alreadySent = true;
      createdAt = existingMessage.data()?.createdAt ?? createdAt;
      return;
    }
    const lastSentAt = member.data()?.lastSentAt?.toMillis?.() ?? 0;
    createdAt = Timestamp.now();
    if (createdAt.toMillis() - lastSentAt < CHAT_SEND_COOLDOWN_MS) {
      throw new functions.https.HttpsError('resource-exhausted', 'Please wait a moment before sending again.');
    }
    conversationType = conversation.data()?.conversationType === 'group' ? 'group' : 'direct';
    if (conversationType === 'direct') {
      const participantIds = readIds(conversation.data()?.activeParticipantIds);
      const friendId = participantIds.find((id) => id !== uid);
      if (!friendId) failed('Direct conversation unavailable.');
      const [friend, blockedByCaller, blockedByFriend] = await Promise.all([
        transaction.get(firestore().collection('users').doc(friendId)),
        transaction.get(blockRef(uid, friendId)), transaction.get(blockRef(friendId, uid)),
      ]);
      if (blockedByCaller.exists || blockedByFriend.exists) denied('Messaging is unavailable for this connection.');
      if (!sender.exists || !friend.exists || !isAcceptedFriend(sender.data(), friend.data(), uid, friendId)) {
        failed('You are no longer friends.');
      }
    }
    const senderDisplayName = safeName(sender.data());
    const visibleToUserIds = readIds(conversation.data()?.activeParticipantIds);
    transaction.create(messageRef, {
      messageId, conversationId, messageType: 'text', senderUserId: uid, senderDisplayName,
      text, createdAt, status: 'active', removedAt: null, removedBy: null, clientMessageId, visibleToUserIds,
    });
    transaction.update(ref, {
      lastMessageAt: createdAt, lastMessageId: messageId, lastMessagePreview: sanitizeMessagePreview(text),
      lastMessageRemoved: false, lastSenderId: uid, updatedAt: createdAt,
    });
    transaction.update(ownRef, { lastSentAt: createdAt, lastReadAt: createdAt, updatedAt: createdAt });
  });
  if (!alreadySent) void sendMessagePushes(conversationId, uid, text, conversationType);
  return { messageId, status: alreadySent ? 'alreadySent' as const : 'sent' as const, createdAt: createdAt.toDate().toISOString() };
});

export const removeOwnFriendChatMessage = chatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  const messageId = normalizeConversationId(data?.messageId);
  if (!conversationId || !messageId) invalid('Conversation and message required.');
  await firestore().runTransaction(async (transaction) => {
    const ref = conversationRef(conversationId);
    const ownMember = await transaction.get(memberRef(conversationId, uid));
    const message = await transaction.get(ref.collection('messages').doc(messageId));
    const conversation = await transaction.get(ref);
    if (ownMember.data()?.status !== 'active') denied('Active membership required.');
    if (!message.exists || message.data()?.senderUserId !== uid) denied('You may remove only your own message.');
    if (message.data()?.status === 'removed') return;
    const now = Timestamp.now();
    transaction.update(message.ref, { status: 'removed', text: '', removedAt: now, removedBy: uid });
    if (conversation.data()?.lastMessageId === messageId) {
      transaction.update(ref, { lastMessagePreview: null, lastMessageRemoved: true, updatedAt: now });
    }
  });
  return { removed: true };
});

export const blockFriendChatUser = safetyChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const blockedUserId = normalizeChatUserId(data?.blockedUserId);
  if (!blockedUserId || blockedUserId === uid) invalid('A different user is required.');
  const notifications = await firestore().runTransaction(async (transaction) => {
    const userRef = firestore().collection('users').doc(uid);
    const blockedRef = firestore().collection('users').doc(blockedUserId);
    const requestRefs = [
      firestore().collection('friendRequests').doc(friendRequestIdFor(uid, blockedUserId)),
      firestore().collection('friendRequests').doc(friendRequestIdFor(blockedUserId, uid)),
    ];
    const [user, blockedUser, existing, ...requests] = await Promise.all([
      transaction.get(userRef), transaction.get(blockedRef), transaction.get(blockRef(uid, blockedUserId)),
      ...requestRefs.map((reference) => transaction.get(reference)),
    ]);
    if (!user.exists || !blockedUser.exists) failed('User unavailable.');
    const now = Timestamp.now();
    if (!existing.exists) transaction.create(blockRef(uid, blockedUserId), { blockerUserId: uid, blockedUserId, createdAt: now, status: 'active' });
    transaction.set(userRef, { friendIds: FieldValue.arrayRemove(blockedUserId) }, { merge: true });
    transaction.set(blockedRef, { friendIds: FieldValue.arrayRemove(uid) }, { merge: true });
    const resolved: { recipientUserId: string; requestId: string; notificationId: string | null }[] = [];
    requests.forEach((request) => {
      if (!request.exists || request.data()?.status !== 'pending') return;
      transaction.update(request.ref, { status: 'canceled', canceledAt: now, updatedAt: now });
      resolved.push({
        recipientUserId: String(request.data()?.toUserId ?? ''),
        requestId: request.id,
        notificationId: typeof request.data()?.notificationId === 'string' ? request.data()?.notificationId : null,
      });
    });
    return resolved;
  });
  await Promise.allSettled(notifications.map((item) => resolveFriendRequestNotification(
    item.recipientUserId, item.requestId, item.notificationId,
  )));
  return { blocked: true };
});

export const getBlockedFriendChatUserIds = chatFunctions.https.onCall(async (_data, context) => {
  const uid = requireUid(context);
  const snapshot = await firestore().collection('userBlocks').doc(uid).collection('blockedUsers')
    .where('status', '==', 'active').limit(500).get();
  return { blockedUserIds: snapshot.docs.map((document) => document.id) };
});

export const unblockFriendChatUser = safetyChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const blockedUserId = normalizeChatUserId(data?.blockedUserId);
  if (!blockedUserId || blockedUserId === uid) invalid('A blocked user is required.');
  await blockRef(uid, blockedUserId).delete();
  return { unblocked: true };
});

export const reportFriendChatUser = safetyChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const reportedUserId = normalizeChatUserId(data?.reportedUserId);
  const conversationId = normalizeConversationId(data?.conversationId);
  if (!reportedUserId || reportedUserId === uid || !conversationId) invalid('Report references are required.');
  await assertActiveMember(conversationId, uid);
  const reportedMember = await memberRef(conversationId, reportedUserId).get();
  if (!reportedMember.exists || reportedMember.data()?.status !== 'active') failed('Reported user is not an active conversation member.');
  const ref = firestore().collection('chatModerationReports').doc();
  await ref.set({ reportId: ref.id, reporterUserId: uid, reportedUserId, conversationId, messageId: null, reportType: 'user', status: 'open', createdAt: Timestamp.now() });
  return { reportId: ref.id, reported: true };
});

export const reportFriendChatMessage = safetyChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  const messageId = normalizeConversationId(data?.messageId);
  const reason = data?.reason == null
    ? 'other'
    : typeof data.reason === 'string' && ['privacy', 'harassment', 'offensive', 'other'].includes(data.reason)
      ? data.reason
      : null;
  if (!conversationId || !messageId || !reason) invalid('Report references are required.');
  await assertActiveMember(conversationId, uid);
  const message = await conversationRef(conversationId).collection('messages').doc(messageId).get();
  if (!message.exists) failed('Message unavailable.');
  if (!readIds(message.data()?.visibleToUserIds).includes(uid)) denied('Message is not visible to this member.');
  const ref = firestore().collection('chatModerationReports').doc();
  await ref.set({
    reportId: ref.id, reporterUserId: uid, reportedUserId: message.data()?.senderUserId ?? null,
    conversationId, messageId, reason, reportType: 'message', status: 'open', createdAt: Timestamp.now(),
  });
  return { reportId: ref.id, reported: true };
});

async function assertActiveMember(conversationId: string, userId: string) {
  const snapshot = await memberRef(conversationId, userId).get();
  if (!snapshot.exists || snapshot.data()?.status !== 'active') denied('Active membership required.');
}

async function createGroupInvitationNotification(
  conversationId: string,
  invitation: { userId: string; invitationId: string; inviterUserId: string; inviterName: string; groupName: string | null },
) {
  if (!await accountCanCommunicate(invitation.inviterUserId) ||
    !await accountCanUseApp(invitation.userId)) return;
  const eventId = `chatGroupInvitation_${conversationId}_${invitation.invitationId}`;
  const ref = firestore().collection('userNotifications').doc(invitation.userId).collection('notifications').doc(eventId);
  const created = await firestore().runTransaction(async (transaction) => {
    if ((await transaction.get(ref)).exists) return false;
    transaction.create(ref, {
      recipientUserId: invitation.userId,
      type: 'chatGroupInvitation',
      titleKey: 'notifications.types.chatGroupInvitationTitle',
      bodyKey: invitation.groupName ? 'notifications.types.chatGroupInvitationBody' : 'notifications.types.chatGroupInvitationUnnamedBody',
      params: { actorName: invitation.inviterName, groupName: invitation.groupName ?? '' },
      createdAt: FieldValue.serverTimestamp(), readAt: null, isRead: false,
      dismissedAt: null, dismissReason: null, status: 'active', actorUserId: invitation.inviterUserId,
      actorDisplayName: invitation.inviterName || null, teamId: null, announcementId: null,
      friendRequestId: null, conversationId, invitationId: invitation.invitationId, expiresAt: null,
    });
    return true;
  });
  if (!created) return;
  if (!await accountCanCommunicate(invitation.inviterUserId) ||
    !await accountCanUseApp(invitation.userId)) {
    await ref.delete();
    return;
  }
  await sendPushToUser(
    invitation.userId,
    { type: 'chatGroupInvitation', conversationId, notificationId: eventId },
    'chat-messages',
  );
}

async function sendMessagePushes(conversationId: string, senderUserId: string, text: string, conversationType: 'direct' | 'group') {
  try {
    if (!await accountCanCommunicate(senderUserId)) return;
    const [conversation, members] = await Promise.all([
      conversationRef(conversationId).get(),
      conversationRef(conversationId).collection('members').where('status', '==', 'active').limit(MAX_CHAT_PARTICIPANTS).get(),
    ]);
    if (!conversation.exists) return;
    const senderName = conversation.data()?.participantNameSnapshots?.[senderUserId] || 'Sideline Social member';
    const recipients = members.docs.filter((member) => member.id !== senderUserId && member.data()?.muted !== true);
    await Promise.allSettled(recipients.map(async (member) => {
      const [blockedBySender, blockedByRecipient] = await Promise.all([
        blockRef(senderUserId, member.id).get(), blockRef(member.id, senderUserId).get(),
      ]);
      if (blockedBySender.exists || blockedByRecipient.exists) return;
      if (!await accountCanCommunicate(senderUserId)) return;
      await sendPushToUser(
        member.id,
        { type: 'friendChatMessage', conversationId, conversationType },
        'chat-messages',
      );
    }));
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'unknown';
    console.warn('[friendChatPush] delivery failed', { conversationType, code });
  }
}
