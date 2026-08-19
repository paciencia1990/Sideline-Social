import { createHash, randomBytes, randomUUID } from 'node:crypto';

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
  FRIEND_CHAT_FORWARD_COOLDOWN_MS,
  FRIEND_CHAT_FORWARD_MAX_DESTINATIONS,
  FRIEND_CHAT_IMAGE_MAX_SIZE_BYTES,
  FRIEND_CHAT_IMAGE_PROFILE_V2,
  FRIEND_CHAT_IMAGE_THUMBNAIL_MAX_SIZE_BYTES,
  FRIEND_CHAT_IMAGE_V2_MAX_SIZE_BYTES,
  FRIEND_CHAT_IMAGE_V2_THUMBNAIL_MAX_SIZE_BYTES,
  FRIEND_CHAT_MEDIA_RESERVATION_COOLDOWN_MS,
  FRIEND_CHAT_REACTIONS,
  FRIEND_CHAT_PIN_DURATIONS,
  FRIEND_CHAT_VOICE_MAX_SIZE_BYTES,
  MAX_CHAT_PARTICIPANTS,
  directConversationIdFor,
  friendChatImageStoragePaths,
  friendChatMediaPreview,
  friendChatVoiceStoragePath,
  forwardClientMessageIdFor,
  isAcceptedFriend,
  mediaReservationIdFor,
  messageIdFor,
  normalizeChatUserId,
  normalizeClientMessageId,
  normalizeConversationId,
  normalizeFriendIds,
  normalizeFriendChatReaction,
  parseFriendChatMediaStoragePath,
  readJpegDimensions,
  sanitizeChatMessage,
  sanitizeGroupName,
  sanitizeMessagePreview,
  sanitizeOptionalChatCaption,
  validateFriendChatImageMetadata,
  validateFriendChatVoiceMetadata,
  type FriendChatImageMetadata,
  type FriendChatReaction,
  type FriendChatVoiceMetadata,
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

type FriendChatMediaUploadReservation = admin.firestore.DocumentData & {
  caption?: string | null;
  clientMessageId?: string;
  conversationId?: string;
  expiresAt?: Timestamp;
  fullPath?: string;
  image?: FriendChatImageMetadata;
  kind?: 'image' | 'voice';
  replyToMessageId?: string | null;
  status?: 'pending' | 'finalized' | 'deletePending';
  storagePath?: string;
  targetId?: string;
  thumbnailPath?: string;
  userId?: string;
  voiceMemo?: FriendChatVoiceMetadata;
};

type FriendChatMessageInput = {
  caption?: string | null;
  clientMessageId: string;
  conversationId: string;
  image?: Record<string, unknown>;
  mediaStoragePaths?: string[];
  messageType: 'image' | 'text' | 'voice';
  reservationRef?: FirebaseFirestore.DocumentReference;
  forwarded?: boolean;
  replyToMessageId?: string | null;
  senderUserId: string;
  text?: string;
  voiceMemo?: Record<string, unknown>;
};

const FRIEND_CHAT_MEDIA_UPLOAD_TTL_MS = 15 * 60 * 1000;
const FRIEND_CHAT_MEDIA_SIGNED_URL_MS = 5 * 60 * 1000;

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

function uploadReservationRef(reservationId: string) {
  return firestore().collection('friendChatUploadReservations').doc(reservationId);
}

function mediaGrantRef(grantToken: string) {
  return firestore().collection('friendChatMediaPlaybackGrants')
    .doc(createHash('sha256').update(grantToken).digest('hex'));
}

function userMessageStateRef(conversationId: string, userId: string, messageId: string) {
  return conversationRef(conversationId)
    .collection('userMessageStates')
    .doc(userId)
    .collection('messages')
    .doc(messageId);
}

function forwardRateRef(userId: string) {
  return firestore().collection('friendChatForwardRateLimits').doc(hashId(userId));
}

function mediaReservationRateRef(userId: string) {
  return firestore().collection('friendChatMediaReservationRateLimits').doc(hashId(userId));
}

function readIds(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function timestampMillis(value: unknown) {
  if (value instanceof Timestamp) return value.toMillis();
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof value.toMillis === 'function'
  ) {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function contentIsModerated(value: admin.firestore.DocumentData | undefined) {
  return value?.moderationState === 'hidden' ||
    value?.moderationState === 'removed';
}

function messageIsUnavailableForUser(message: admin.firestore.DocumentData | undefined, userId: string) {
  return !message ||
    message.status === 'removed' ||
    contentIsModerated(message) ||
    message.messageType === 'system' ||
    !readIds(message.visibleToUserIds).includes(userId);
}

function safeMessageExcerpt(message: admin.firestore.DocumentData) {
  const messageType = message.messageType === 'image'
    ? 'image'
    : message.messageType === 'voice'
      ? 'voice'
      : 'text';
  const text = messageType === 'text'
    ? typeof message.text === 'string' ? message.text : ''
    : typeof message.caption === 'string' ? message.caption : '';
  return text ? sanitizeMessagePreview(text) : null;
}

async function resolveReplyContext(
  transaction: admin.firestore.Transaction,
  conversationId: string,
  messageId: string | null | undefined,
  userId: string,
) {
  const replyMessageId = normalizeConversationId(messageId);
  if (!replyMessageId) return null;
  const replyRef = conversationRef(conversationId).collection('messages').doc(replyMessageId);
  const reply = await transaction.get(replyRef);
  const replyData = reply.data();
  if (messageIsUnavailableForUser(replyData, userId)) denied('Reply target is unavailable.');
  const messageType = replyData?.messageType === 'image'
    ? 'image'
    : replyData?.messageType === 'voice'
      ? 'voice'
      : 'text';
  return {
    createdAt: replyData?.createdAt ?? null,
    messageId: reply.id,
    messageType,
    senderDisplayName: typeof replyData?.senderDisplayName === 'string' ? safeName({ displayName: replyData.senderDisplayName }) || replyData.senderDisplayName : null,
    senderUserId: typeof replyData?.senderUserId === 'string' ? replyData.senderUserId : null,
    textExcerpt: replyData ? safeMessageExcerpt(replyData) : null,
  };
}

function normalizeMessageIds(value: unknown, max = 20) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(normalizeConversationId).filter((id): id is string => Boolean(id)))).slice(0, max);
}

function hashId(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function assertMediaReservationThrottle(
  rateSnapshot: admin.firestore.DocumentSnapshot,
  reservationId: string,
  now: Timestamp,
) {
  const lastCreatedAt = timestampMillis(rateSnapshot.data()?.lastReservationCreatedAt);
  const lastReservationId = typeof rateSnapshot.data()?.lastReservationId === 'string'
    ? rateSnapshot.data()?.lastReservationId
    : null;
  if (
    lastCreatedAt !== null &&
    lastReservationId !== reservationId &&
    now.toMillis() - lastCreatedAt < FRIEND_CHAT_MEDIA_RESERVATION_COOLDOWN_MS
  ) {
    throw new functions.https.HttpsError(
      'resource-exhausted',
      'Please wait a moment before sending another media message.',
    );
  }
}

function setMediaReservationThrottle(
  transaction: admin.firestore.Transaction,
  userId: string,
  reservationId: string,
  now: Timestamp,
) {
  transaction.set(mediaReservationRateRef(userId), {
    lastReservationCreatedAt: now,
    lastReservationId: reservationId,
    updatedAt: FieldValue.serverTimestamp(),
    userIdHash: hashId(userId),
  }, { merge: true });
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

async function createFriendChatMessageTransaction(
  db: FirebaseFirestore.Firestore,
  input: FriendChatMessageInput,
) {
  const ref = db.collection('friendConversations').doc(input.conversationId);
  const ownRef = ref.collection('members').doc(input.senderUserId);
  const messageId = messageIdFor(input.senderUserId, input.clientMessageId);
  const messageRef = ref.collection('messages').doc(messageId);
  let conversationType: 'direct' | 'group' = 'direct';
  let createdAt = Timestamp.now();
  return db.runTransaction(async (transaction) => {
    const [conversation, member, existingMessage, sender] = await Promise.all([
      transaction.get(ref),
      transaction.get(ownRef),
      transaction.get(messageRef),
      transaction.get(db.collection('users').doc(input.senderUserId)),
    ]);
    const conversationData = conversation.data() as ConversationData | undefined;
    if (!conversation.exists || conversationData?.status !== 'active') failed('Conversation unavailable.');
    if (!member.exists || member.data()?.status !== 'active') denied('Active membership required.');
    if (existingMessage.exists) {
      if (input.reservationRef) transaction.set(input.reservationRef, {
        finalizedAt: FieldValue.serverTimestamp(),
        status: 'finalized',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      createdAt = existingMessage.data()?.createdAt ?? createdAt;
      return {
        conversationType,
        created: false,
        createdAt,
        messageId,
      };
    }

    const lastSentAt = member.data()?.lastSentAt?.toMillis?.() ?? 0;
    createdAt = Timestamp.now();
    if (createdAt.toMillis() - lastSentAt < CHAT_SEND_COOLDOWN_MS) {
      throw new functions.https.HttpsError('resource-exhausted', 'Please wait a moment before sending again.');
    }

    conversationType = conversationData?.conversationType === 'group' ? 'group' : 'direct';
    const participantIds = readIds(conversationData?.activeParticipantIds);
    if (!participantIds.includes(input.senderUserId)) denied('Active membership required.');
    const recipients = participantIds.filter((id) => id !== input.senderUserId);
    if (recipients.length === 0) failed('Conversation unavailable.');
    if (await getBlockSnapshots(transaction, recipients.map((recipientId) => [input.senderUserId, recipientId]))) {
      denied('Messaging is unavailable for this connection.');
    }
    if (conversationType === 'direct') {
      const friendId = recipients[0];
      const friend = await transaction.get(db.collection('users').doc(friendId));
      if (!sender.exists || !friend.exists || !isAcceptedFriend(sender.data(), friend.data(), input.senderUserId, friendId)) {
        failed('You are no longer friends.');
      }
    } else if (!sender.exists) {
      failed('Sender unavailable.');
    }

    const replyTo = await resolveReplyContext(transaction, input.conversationId, input.replyToMessageId, input.senderUserId);
    const senderDisplayName = safeName(sender.data());
    const visibleToUserIds = participantIds;
    const messageData: Record<string, unknown> = {
      caption: input.caption ?? null,
      clientMessageId: input.clientMessageId,
      conversationId: input.conversationId,
      createdAt,
      forwarded: input.forwarded === true,
      image: input.image ?? null,
      mediaStoragePaths: input.mediaStoragePaths ?? [],
      messageId,
      messageType: input.messageType,
      reactionCounts: {},
      reactionTotalCount: 0,
      removedAt: null,
      removedBy: null,
      replyTo,
      senderDisplayName,
      senderUserId: input.senderUserId,
      status: 'active',
      text: input.messageType === 'text' ? input.text : input.caption ?? '',
      visibleToUserIds,
      voiceMemo: input.voiceMemo ?? null,
    };
    transaction.create(messageRef, messageData);
    if (input.reservationRef) transaction.set(input.reservationRef, {
      finalizedAt: FieldValue.serverTimestamp(),
      status: 'finalized',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.update(ref, {
      lastMessageAt: createdAt,
      lastMessageId: messageId,
      lastMessagePreview: friendChatMediaPreview(input.messageType, input.messageType === 'text' ? input.text : input.caption),
      lastMessageRemoved: false,
      lastMessageType: input.messageType,
      lastSenderId: input.senderUserId,
      updatedAt: createdAt,
    });
    transaction.update(ownRef, { lastSentAt: createdAt, lastReadAt: createdAt, updatedAt: createdAt });
    return {
      conversationType,
      created: true,
      createdAt,
      messageId,
    };
  });
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
  const replyToMessageId = normalizeConversationId(data?.replyToMessageId);
  if (!conversationId || !clientMessageId) invalid('Conversation and clientMessageId are required.');
  let text: string;
  try { text = sanitizeChatMessage(data?.text); } catch (error) { invalid((error as Error).message); }
  assertUserContentAllowed(text);
  const result = await createFriendChatMessageTransaction(firestore(), {
    clientMessageId,
    conversationId,
    messageType: 'text',
    replyToMessageId,
    senderUserId: uid,
    text,
  });
  if (result.created) void sendMessagePushes(conversationId, uid, 'text', result.conversationType);
  return {
    messageId: result.messageId,
    status: result.created ? 'sent' as const : 'alreadySent' as const,
    createdAt: result.createdAt.toDate().toISOString(),
  };
});

export const createFriendChatVoiceUpload = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  const clientMessageId = normalizeClientMessageId(data?.clientMessageId);
  const replyToMessageId = normalizeConversationId(data?.replyToMessageId);
  if (!conversationId || !clientMessageId) invalid('Conversation and clientMessageId are required.');
  let caption: string | null;
  try { caption = sanitizeOptionalChatCaption(data?.caption); } catch (error) { invalid((error as Error).message); }
  if (caption) assertUserContentAllowed(caption);
  let voiceMemo: FriendChatVoiceMetadata;
  try { voiceMemo = validateFriendChatVoiceMetadata(data?.voiceMemo); } catch (error) { invalid((error as Error).message); }
  const messageId = messageIdFor(uid, clientMessageId);
  const reservationId = mediaReservationIdFor(uid, clientMessageId, 'voice');
  const storagePath = friendChatVoiceStoragePath({ conversationId, messageId, reservationId });
  const createdAt = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(createdAt.toMillis() + FRIEND_CHAT_MEDIA_UPLOAD_TTL_MS);

  await firestore().runTransaction(async (transaction) => {
    const reservationRef = uploadReservationRef(reservationId);
    const [existingReservation, conversation, member, rateLimit] = await Promise.all([
      transaction.get(reservationRef),
      transaction.get(conversationRef(conversationId)),
      transaction.get(memberRef(conversationId, uid)),
      transaction.get(mediaReservationRateRef(uid)),
    ]);
    if (!conversation.exists || conversation.data()?.status !== 'active') failed('Conversation unavailable.');
    if (!member.exists || member.data()?.status !== 'active') denied('Active membership required.');
    const conversationType = conversation.data()?.conversationType === 'group' ? 'group' : 'direct';
    const participantIds = readIds(conversation.data()?.activeParticipantIds);
    const recipients = participantIds.filter((id) => id !== uid);
    if (!participantIds.includes(uid) || recipients.length === 0) denied('Active membership required.');
    if (await getBlockSnapshots(transaction, recipients.map((recipientId) => [uid, recipientId]))) {
      denied('Messaging is unavailable for this connection.');
    }
    if (conversationType === 'direct') {
      const friendId = recipients[0];
      const [sender, friend] = await Promise.all([
        transaction.get(firestore().collection('users').doc(uid)),
        transaction.get(firestore().collection('users').doc(friendId)),
      ]);
      if (!sender.exists || !friend.exists || !isAcceptedFriend(sender.data(), friend.data(), uid, friendId)) {
        failed('You are no longer friends.');
      }
    }
    if (existingReservation.exists) {
      const existing = existingReservation.data() as FriendChatMediaUploadReservation;
      if (
        existing.userId !== uid ||
        existing.conversationId !== conversationId ||
        existing.targetId !== messageId ||
        existing.kind !== 'voice' ||
        existing.storagePath !== storagePath
      ) failed('Upload reservation unavailable.');
      if (existing.status === 'finalized') return;
      transaction.set(reservationRef, {
        caption,
        expiresAt,
        replyToMessageId,
        status: 'pending',
        updatedAt: FieldValue.serverTimestamp(),
        voiceMemo,
      }, { merge: true });
      return;
    }
    assertMediaReservationThrottle(rateLimit, reservationId, createdAt);
    transaction.create(reservationRef, {
      caption,
      clientMessageId,
      conversationId,
      createdAt,
      expiresAt,
      kind: 'voice',
      reservationId,
      replyToMessageId,
      status: 'pending',
      storagePath,
      targetId: messageId,
      userId: uid,
      voiceMemo,
    });
    setMediaReservationThrottle(transaction, uid, reservationId, createdAt);
  });

  return { expiresAtMillis: expiresAt.toMillis(), reservationId, storagePath, targetId: messageId };
});

export const finalizeFriendChatVoiceMessage = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const reservationId = normalizeConversationId(data?.reservationId);
  if (!reservationId) invalid('A valid reservation is required.');
  const reservationRef = uploadReservationRef(reservationId);
  const initialSnapshot = await reservationRef.get();
  const initial = initialSnapshot.data() as FriendChatMediaUploadReservation | undefined;
  if (!initialSnapshot.exists || initial?.kind !== 'voice' || initial.userId !== uid) failed('Upload expired.');
  if (initial.status === 'finalized') return { messageId: initial.targetId, status: 'alreadyFinalized' as const };
  const voiceMemo = await verifyUploadedFriendVoiceMemo(initial);
  const conversationId = normalizeConversationId(initial.conversationId);
  const clientMessageId = normalizeClientMessageId(initial.clientMessageId);
  if (!conversationId || !clientMessageId) failed('Upload expired.');
  const result = await createFriendChatMessageTransaction(firestore(), {
    caption: typeof initial.caption === 'string' ? initial.caption : null,
    clientMessageId,
    conversationId,
    mediaStoragePaths: [voiceMemo.storagePath],
    messageType: 'voice',
    reservationRef,
    replyToMessageId: typeof initial.replyToMessageId === 'string' ? initial.replyToMessageId : null,
    senderUserId: uid,
    voiceMemo,
  });
  if (result.created) void sendMessagePushes(conversationId, uid, 'voice', result.conversationType);
  return { messageId: result.messageId, status: result.created ? 'sent' as const : 'alreadyFinalized' as const };
});

export const createFriendChatImageUpload = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  const clientMessageId = normalizeClientMessageId(data?.clientMessageId);
  const replyToMessageId = normalizeConversationId(data?.replyToMessageId);
  if (!conversationId || !clientMessageId) invalid('Conversation and clientMessageId are required.');
  let caption: string | null;
  try { caption = sanitizeOptionalChatCaption(data?.caption); } catch (error) { invalid((error as Error).message); }
  if (caption) assertUserContentAllowed(caption);
  let image: FriendChatImageMetadata;
  try { image = validateFriendChatImageMetadata(data?.image); } catch (error) { invalid((error as Error).message); }
  const messageId = messageIdFor(uid, clientMessageId);
  const reservationId = mediaReservationIdFor(uid, clientMessageId, 'image');
  const paths = friendChatImageStoragePaths({ conversationId, messageId, reservationId });
  const createdAt = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(createdAt.toMillis() + FRIEND_CHAT_MEDIA_UPLOAD_TTL_MS);

  await firestore().runTransaction(async (transaction) => {
    const reservationRef = uploadReservationRef(reservationId);
    const [existingReservation, conversation, member, rateLimit] = await Promise.all([
      transaction.get(reservationRef),
      transaction.get(conversationRef(conversationId)),
      transaction.get(memberRef(conversationId, uid)),
      transaction.get(mediaReservationRateRef(uid)),
    ]);
    if (!conversation.exists || conversation.data()?.status !== 'active') failed('Conversation unavailable.');
    if (!member.exists || member.data()?.status !== 'active') denied('Active membership required.');
    const conversationType = conversation.data()?.conversationType === 'group' ? 'group' : 'direct';
    const participantIds = readIds(conversation.data()?.activeParticipantIds);
    const recipients = participantIds.filter((id) => id !== uid);
    if (!participantIds.includes(uid) || recipients.length === 0) denied('Active membership required.');
    if (await getBlockSnapshots(transaction, recipients.map((recipientId) => [uid, recipientId]))) {
      denied('Messaging is unavailable for this connection.');
    }
    if (conversationType === 'direct') {
      const friendId = recipients[0];
      const [sender, friend] = await Promise.all([
        transaction.get(firestore().collection('users').doc(uid)),
        transaction.get(firestore().collection('users').doc(friendId)),
      ]);
      if (!sender.exists || !friend.exists || !isAcceptedFriend(sender.data(), friend.data(), uid, friendId)) {
        failed('You are no longer friends.');
      }
    }
    if (existingReservation.exists) {
      const existing = existingReservation.data() as FriendChatMediaUploadReservation;
      if (
        existing.userId !== uid ||
        existing.conversationId !== conversationId ||
        existing.targetId !== messageId ||
        existing.kind !== 'image' ||
        existing.fullPath !== paths.fullPath ||
        existing.thumbnailPath !== paths.thumbnailPath
      ) failed('Upload reservation unavailable.');
      if (existing.status === 'finalized') return;
      transaction.set(reservationRef, {
        caption,
        expiresAt,
        image,
        replyToMessageId,
        status: 'pending',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }
    assertMediaReservationThrottle(rateLimit, reservationId, createdAt);
    transaction.create(reservationRef, {
      caption,
      clientMessageId,
      conversationId,
      createdAt,
      expiresAt,
      fullPath: paths.fullPath,
      image,
      kind: 'image',
      reservationId,
      replyToMessageId,
      status: 'pending',
      targetId: messageId,
      thumbnailPath: paths.thumbnailPath,
      userId: uid,
    });
    setMediaReservationThrottle(transaction, uid, reservationId, createdAt);
  });

  return {
    expiresAtMillis: expiresAt.toMillis(),
    fullPath: paths.fullPath,
    reservationId,
    targetId: messageId,
    thumbnailPath: paths.thumbnailPath,
  };
});

export const finalizeFriendChatImageMessage = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const reservationId = normalizeConversationId(data?.reservationId);
  if (!reservationId) invalid('A valid reservation is required.');
  const reservationRef = uploadReservationRef(reservationId);
  const initialSnapshot = await reservationRef.get();
  const initial = initialSnapshot.data() as FriendChatMediaUploadReservation | undefined;
  if (!initialSnapshot.exists || initial?.kind !== 'image' || initial.userId !== uid) failed('Upload expired.');
  if (initial.status === 'finalized') return { messageId: initial.targetId, status: 'alreadyFinalized' as const };
  const image = await verifyUploadedFriendImage(initial);
  const conversationId = normalizeConversationId(initial.conversationId);
  const clientMessageId = normalizeClientMessageId(initial.clientMessageId);
  if (!conversationId || !clientMessageId) failed('Upload expired.');
  const result = await createFriendChatMessageTransaction(firestore(), {
    caption: typeof initial.caption === 'string' ? initial.caption : null,
    clientMessageId,
    conversationId,
    image,
    mediaStoragePaths: [image.fullPath, image.thumbnailPath],
    messageType: 'image',
    reservationRef,
    replyToMessageId: typeof initial.replyToMessageId === 'string' ? initial.replyToMessageId : null,
    senderUserId: uid,
  });
  if (result.created) void sendMessagePushes(conversationId, uid, 'image', result.conversationType);
  return { messageId: result.messageId, status: result.created ? 'sent' as const : 'alreadyFinalized' as const };
});

export const removeOwnFriendChatMessage = chatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  const messageId = normalizeConversationId(data?.messageId);
  if (!conversationId || !messageId) invalid('Conversation and message required.');
  let mediaStoragePaths: string[] = [];
  let retainMediaForModeration = false;
  await firestore().runTransaction(async (transaction) => {
    const ref = conversationRef(conversationId);
    const ownMember = await transaction.get(memberRef(conversationId, uid));
    const message = await transaction.get(ref.collection('messages').doc(messageId));
    const conversation = await transaction.get(ref);
    if (ownMember.data()?.status !== 'active') denied('Active membership required.');
    if (
      !message.exists ||
      message.data()?.conversationId !== conversationId ||
      message.data()?.senderUserId !== uid
    ) denied('You may remove only your own message.');
    if (message.data()?.status === 'removed') return;
    const now = Timestamp.now();
    retainMediaForModeration = message.data()?.moderationEvidenceRetained === true;
    mediaStoragePaths = readIds(message.data()?.mediaStoragePaths);
    const voicePath = typeof message.data()?.voiceMemo?.storagePath === 'string' ? message.data()?.voiceMemo?.storagePath : '';
    const imageFullPath = typeof message.data()?.image?.fullPath === 'string' ? message.data()?.image?.fullPath : '';
    const imageThumbnailPath = typeof message.data()?.image?.thumbnailPath === 'string' ? message.data()?.image?.thumbnailPath : '';
    mediaStoragePaths = Array.from(new Set([...mediaStoragePaths, voicePath, imageFullPath, imageThumbnailPath]
      .filter((path) => Boolean(parseFriendChatMediaStoragePath(path)))));
    transaction.update(message.ref, {
      caption: null,
      image: null,
      mediaStoragePaths: [],
      reactionCounts: {},
      reactionTotalCount: 0,
      status: 'removed',
      text: '',
      removedAt: now,
      removedBy: uid,
      voiceMemo: null,
    });
    readIds(conversation.data()?.activeParticipantIds).forEach((participantId) => {
      transaction.delete(userMessageStateRef(conversationId, participantId, messageId));
    });
    if (conversation.data()?.lastMessageId === messageId) {
      transaction.update(ref, {
        lastMessagePreview: null,
        lastMessageRemoved: true,
        lastMessageType: 'deleted',
        pinnedMessage: conversation.data()?.pinnedMessage?.messageId === messageId ? FieldValue.delete() : conversation.data()?.pinnedMessage ?? FieldValue.delete(),
        updatedAt: now,
      });
    } else if (conversation.data()?.pinnedMessage?.messageId === messageId) {
      transaction.update(ref, { pinnedMessage: FieldValue.delete(), updatedAt: now });
    }
  });
  const [legacyReportRetainsMedia] = await Promise.all([
    friendChatMessageHasModerationReport(conversationId, messageId),
    revokeFriendChatMediaGrants(conversationId, messageId),
    removeFriendChatMessageReactions(conversationId, messageId),
    redactFriendChatReplyPreviews(conversationId, messageId),
  ]);
  const storageCleanup = retainMediaForModeration || legacyReportRetainsMedia
    ? 'retainedForModeration' as const
    : await deleteFriendChatStorageObjects(mediaStoragePaths);
  return { removed: true, storageCleanup };
});

async function friendChatMessageHasModerationReport(conversationId: string, messageId: string) {
  const reports = await firestore().collection('chatModerationReports')
    .where('messageId', '==', messageId)
    .limit(10)
    .get();
  return reports.docs.some((report) => report.data()?.conversationId === conversationId);
}

async function revokeFriendChatMediaGrants(conversationId: string, messageId: string) {
  const grants = await firestore().collection('friendChatMediaPlaybackGrants')
    .where('messageId', '==', messageId)
    .limit(100)
    .get();
  const matching = grants.docs.filter((grant) => grant.data()?.conversationId === conversationId);
  if (matching.length === 0) return;
  const writer = firestore().bulkWriter();
  matching.forEach((grant) => writer.delete(grant.ref));
  await writer.close();
}

async function removeFriendChatMessageReactions(conversationId: string, messageId: string) {
  const reactions = await conversationRef(conversationId).collection('messages').doc(messageId)
    .collection('reactions').limit(MAX_CHAT_PARTICIPANTS).get();
  if (reactions.empty) return;
  const writer = firestore().bulkWriter();
  reactions.docs.forEach((reaction) => writer.delete(reaction.ref));
  await writer.close();
}

async function redactFriendChatReplyPreviews(conversationId: string, messageId: string) {
  const replies = await conversationRef(conversationId).collection('messages')
    .where('replyTo.messageId', '==', messageId)
    .limit(100)
    .get();
  if (replies.empty) return;
  const writer = firestore().bulkWriter();
  replies.docs.forEach((reply) => writer.update(reply.ref, {
    replyTo: {
      createdAt: null,
      messageId,
      messageType: 'text',
      senderDisplayName: null,
      senderUserId: null,
      textExcerpt: null,
    },
    updatedAt: FieldValue.serverTimestamp(),
  }));
  await writer.close();
}

export const deleteFriendChatMessagesForMe = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  const messageIds = normalizeMessageIds(data?.messageIds, 20);
  if (!conversationId || messageIds.length === 0) invalid('Messages are required.');
  let hidden = 0;
  await firestore().runTransaction(async (transaction) => {
    const [conversation, member, ...messages] = await Promise.all([
      transaction.get(conversationRef(conversationId)),
      transaction.get(memberRef(conversationId, uid)),
      ...messageIds.map((messageId) => transaction.get(conversationRef(conversationId).collection('messages').doc(messageId))),
    ]);
    if (!conversation.exists || conversation.data()?.status !== 'active') failed('Conversation unavailable.');
    if (!member.exists || member.data()?.status !== 'active') denied('Active membership required.');
    messages.forEach((message) => {
      const messageData = message.data();
      if (messageIsUnavailableForUser(messageData, uid)) return;
      hidden += 1;
      transaction.set(userMessageStateRef(conversationId, uid, message.id), {
        conversationId,
        hiddenForMe: true,
        hiddenForMeAt: FieldValue.serverTimestamp(),
        messageId: message.id,
        updatedAt: FieldValue.serverTimestamp(),
        userId: uid,
      }, { merge: true });
    });
  });
  return { hidden };
});

export const setFriendChatMessagesStarred = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  const messageIds = normalizeMessageIds(data?.messageIds, 20);
  const starred = data?.starred === true;
  if (!conversationId || messageIds.length === 0) invalid('Messages are required.');
  let updated = 0;
  await firestore().runTransaction(async (transaction) => {
    const [conversation, member, ...messages] = await Promise.all([
      transaction.get(conversationRef(conversationId)),
      transaction.get(memberRef(conversationId, uid)),
      ...messageIds.map((messageId) => transaction.get(conversationRef(conversationId).collection('messages').doc(messageId))),
    ]);
    if (!conversation.exists || conversation.data()?.status !== 'active') failed('Conversation unavailable.');
    if (!member.exists || member.data()?.status !== 'active') denied('Active membership required.');
    messages.forEach((message) => {
      const messageData = message.data();
      if (messageIsUnavailableForUser(messageData, uid)) return;
      updated += 1;
      transaction.set(userMessageStateRef(conversationId, uid, message.id), {
        conversationId,
        messageId: message.id,
        starred,
        starredAt: starred ? FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
        userId: uid,
      }, { merge: true });
    });
  });
  return { updated };
});

type ForwardSourceImage = {
  fullPath: string;
  metadata: FriendChatImageMetadata;
  stored: {
    fullPath: string;
    height: number;
    mediaProfileVersion: 1 | 2;
    mimeType: string;
    sizeBytes: number;
    sourceMimeType: string | null;
    sourceSizeBytes: number;
    thumbnailHeight: number;
    thumbnailMimeType: string;
    thumbnailPath: string;
    thumbnailSizeBytes: number;
    thumbnailWidth: number;
    width: number;
  };
  thumbnailPath: string;
};

type ForwardSourceMessage = {
  caption: string | null;
  image: ForwardSourceImage | null;
  messageId: string;
  messageType: 'image' | 'text';
  text: string;
};

type ForwardDestination = {
  conversationId: string;
  conversationType: 'direct' | 'group';
  participantIds: string[];
};

type ForwardPlan = {
  clientMessageId: string;
  destination: ForwardDestination;
  fullPath: string | null;
  messageId: string;
  reservationId: string | null;
  source: ForwardSourceMessage;
  thumbnailPath: string | null;
};

function readForwardSourceImage(
  conversationId: string,
  messageId: string,
  message: admin.firestore.DocumentData,
): ForwardSourceImage | null {
  const image = message.image;
  if (!image || typeof image !== 'object' || Array.isArray(image)) return null;
  const fullPath = typeof image.fullPath === 'string' ? image.fullPath : '';
  const thumbnailPath = typeof image.thumbnailPath === 'string' ? image.thumbnailPath : '';
  const fullReference = parseFriendChatMediaStoragePath(fullPath);
  const thumbnailReference = parseFriendChatMediaStoragePath(thumbnailPath);
  if (
    !fullReference ||
    !thumbnailReference ||
    fullReference.kind !== 'image' ||
    thumbnailReference.kind !== 'thumbnail' ||
    fullReference.conversationId !== conversationId ||
    thumbnailReference.conversationId !== conversationId ||
    fullReference.messageId !== messageId ||
    thumbnailReference.messageId !== messageId ||
    fullReference.reservationId !== thumbnailReference.reservationId
  ) return null;
  try {
    const metadata = validateFriendChatImageMetadata({
      main: {
        height: image.height,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        width: image.width,
      },
      mediaProfileVersion: image.mediaProfileVersion,
      sourceMimeType: image.sourceMimeType,
      sourceSizeBytes: image.sourceSizeBytes,
      thumbnail: {
        height: image.thumbnailHeight,
        mimeType: image.thumbnailMimeType,
        sizeBytes: image.thumbnailSizeBytes,
        width: image.thumbnailWidth,
      },
    });
    return {
      fullPath,
      metadata,
      stored: {
        fullPath,
        height: metadata.main.height,
        mediaProfileVersion: metadata.mediaProfileVersion,
        mimeType: metadata.main.mimeType,
        sizeBytes: metadata.main.sizeBytes,
        sourceMimeType: metadata.sourceMimeType,
        sourceSizeBytes: metadata.sourceSizeBytes,
        thumbnailHeight: metadata.thumbnail.height,
        thumbnailMimeType: metadata.thumbnail.mimeType,
        thumbnailPath,
        thumbnailSizeBytes: metadata.thumbnail.sizeBytes,
        thumbnailWidth: metadata.thumbnail.width,
        width: metadata.main.width,
      },
      thumbnailPath,
    };
  } catch {
    return null;
  }
}

async function hasForwardBlock(userId: string, participantIds: string[]) {
  const refs = participantIds
    .filter((participantId) => participantId !== userId)
    .flatMap((participantId) => [blockRef(userId, participantId), blockRef(participantId, userId)]);
  const snapshots = await Promise.all(refs.map((ref) => ref.get()));
  return snapshots.some((snapshot) => snapshot.exists);
}

async function loadForwardImageBytes(userId: string, source: ForwardSourceImage) {
  const [fullAuthorized, thumbnailAuthorized] = await Promise.all([
    canAccessFriendChatMedia(firestore(), userId, source.fullPath),
    canAccessFriendChatMedia(firestore(), userId, source.thumbnailPath),
  ]);
  if (!fullAuthorized || !thumbnailAuthorized) denied('Media is unavailable.');
  const bucket = admin.storage().bucket();
  const fullFile = bucket.file(source.fullPath);
  const thumbnailFile = bucket.file(source.thumbnailPath);
  const [[fullMetadata], [thumbnailMetadata], [fullBytes], [thumbnailBytes]] = await Promise.all([
    fullFile.getMetadata(),
    thumbnailFile.getMetadata(),
    fullFile.download(),
    thumbnailFile.download(),
  ]);
  if (
    Number(fullMetadata.size) !== source.metadata.main.sizeBytes ||
    Number(thumbnailMetadata.size) !== source.metadata.thumbnail.sizeBytes ||
    fullBytes.byteLength !== source.metadata.main.sizeBytes ||
    thumbnailBytes.byteLength !== source.metadata.thumbnail.sizeBytes ||
    fullMetadata.contentType !== source.metadata.main.mimeType ||
    thumbnailMetadata.contentType !== source.metadata.thumbnail.mimeType
  ) failed('Media is unavailable.');
  return { fullBytes, thumbnailBytes };
}

async function cleanupUnreferencedForwardMedia(
  copied: Array<{ messageRef: FirebaseFirestore.DocumentReference; storagePath: string }>,
) {
  await Promise.allSettled(copied.map(async ({ messageRef, storagePath }) => {
    const message = await messageRef.get();
    if (message.exists && readIds(message.data()?.mediaStoragePaths).includes(storagePath)) return;
    await admin.storage().bucket().file(storagePath).delete({ ignoreNotFound: true });
  }));
}

export const forwardFriendChatMessages = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const requestedClientForwardId = normalizeClientMessageId(data?.clientForwardId);
  const clientForwardId = requestedClientForwardId ?? `legacy_${randomUUID()}`;
  const sourceConversationId = normalizeConversationId(data?.conversationId);
  const messageIds = normalizeMessageIds(data?.messageIds, 5);
  const destinationConversationIds = normalizeMessageIds(data?.destinationConversationIds, FRIEND_CHAT_FORWARD_MAX_DESTINATIONS)
    .filter((conversationId) => conversationId !== sourceConversationId);
  if (!sourceConversationId || messageIds.length === 0 || destinationConversationIds.length === 0) {
    invalid('Forward destinations and messages are required.');
  }

  const sourceRef = conversationRef(sourceConversationId);
  const [sourceConversation, sourceMember, sender, ...sourceSnapshots] = await Promise.all([
    sourceRef.get(),
    memberRef(sourceConversationId, uid).get(),
    firestore().collection('users').doc(uid).get(),
    ...messageIds.map((messageId) => sourceRef.collection('messages').doc(messageId).get()),
  ]);
  const sourceData = sourceConversation.data() as ConversationData | undefined;
  if (!sourceConversation.exists || sourceData?.status !== 'active') failed('Conversation unavailable.');
  if (!sourceMember.exists || sourceMember.data()?.status !== 'active') denied('Active membership required.');
  if (!sender.exists) failed('Sender unavailable.');
  const sourceParticipantIds = readIds(sourceData?.activeParticipantIds);
  if (!sourceParticipantIds.includes(uid) || await hasForwardBlock(uid, sourceParticipantIds)) {
    denied('Messaging is unavailable for this connection.');
  }
  if (sourceData?.conversationType !== 'group') {
    const friendId = sourceParticipantIds.find((participantId) => participantId !== uid);
    const friend = friendId ? await firestore().collection('users').doc(friendId).get() : null;
    if (!friendId || !friend?.exists || !isAcceptedFriend(sender.data(), friend.data(), uid, friendId)) {
      failed('You are no longer friends.');
    }
  }

  const unsupportedMediaMessageIds: string[] = [];
  const sources: ForwardSourceMessage[] = [];
  for (const snapshot of sourceSnapshots) {
    const message = snapshot.data();
    if (messageIsUnavailableForUser(message, uid)) denied('Message is unavailable.');
    if (message?.messageType === 'voice' || message?.messageType === 'system') {
      unsupportedMediaMessageIds.push(snapshot.id);
      continue;
    }
    if (message?.messageType === 'image') {
      const image = readForwardSourceImage(sourceConversationId, snapshot.id, message);
      if (!image) failed('Media is unavailable.');
      sources.push({
        caption: sanitizeOptionalChatCaption(message.caption),
        image,
        messageId: snapshot.id,
        messageType: 'image',
        text: '',
      });
      continue;
    }
    const text = typeof message?.text === 'string' && message.text.trim()
      ? sanitizeChatMessage(message.text)
      : '';
    if (!text) {
      unsupportedMediaMessageIds.push(snapshot.id);
      continue;
    }
    sources.push({ caption: null, image: null, messageId: snapshot.id, messageType: 'text', text });
  }
  if (sources.length === 0) failed('No supported messages are available to forward.');

  const destinations: ForwardDestination[] = [];
  for (const conversationId of destinationConversationIds) {
    const [conversation, member] = await Promise.all([
      conversationRef(conversationId).get(),
      memberRef(conversationId, uid).get(),
    ]);
    const conversationData = conversation.data() as ConversationData | undefined;
    if (!conversation.exists || conversationData?.status !== 'active') denied('Destination unavailable.');
    if (!member.exists || member.data()?.status !== 'active') denied('Destination membership required.');
    const participantIds = readIds(conversationData?.activeParticipantIds);
    const recipients = participantIds.filter((participantId) => participantId !== uid);
    if (
      !participantIds.includes(uid) ||
      recipients.length === 0 ||
      participantIds.length > MAX_CHAT_PARTICIPANTS ||
      await hasForwardBlock(uid, participantIds)
    ) denied('Destination membership required.');
    const conversationType = conversationData?.conversationType === 'group' ? 'group' : 'direct';
    if (conversationType === 'direct') {
      const friend = await firestore().collection('users').doc(recipients[0]).get();
      if (!friend.exists || !isAcceptedFriend(sender.data(), friend.data(), uid, recipients[0])) {
        failed('You are no longer friends.');
      }
    }
    destinations.push({ conversationId, conversationType, participantIds });
  }

  const plans: ForwardPlan[] = destinations.flatMap((destination) => sources.map((source) => {
    const clientMessageId = forwardClientMessageIdFor(clientForwardId, source.messageId, destination.conversationId);
    const messageId = messageIdFor(uid, clientMessageId);
    const reservationId = source.image ? mediaReservationIdFor(uid, clientMessageId, 'image') : null;
    const paths = reservationId
      ? friendChatImageStoragePaths({ conversationId: destination.conversationId, messageId, reservationId })
      : null;
    return {
      clientMessageId,
      destination,
      fullPath: paths?.fullPath ?? null,
      messageId,
      reservationId,
      source,
      thumbnailPath: paths?.thumbnailPath ?? null,
    };
  }));

  const imageBytes = new Map<string, Awaited<ReturnType<typeof loadForwardImageBytes>>>();
  for (const source of sources) {
    if (source.image && !imageBytes.has(source.messageId)) {
      imageBytes.set(source.messageId, await loadForwardImageBytes(uid, source.image));
    }
  }

  const preexisting = await firestore().getAll(...plans.map((plan) =>
    conversationRef(plan.destination.conversationId).collection('messages').doc(plan.messageId)));
  const copied: Array<{ messageRef: FirebaseFirestore.DocumentReference; storagePath: string }> = [];
  try {
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index];
      if (!plan.source.image || preexisting[index]?.exists) continue;
      const bytes = imageBytes.get(plan.source.messageId);
      if (!bytes || !plan.fullPath || !plan.thumbnailPath) failed('Media is unavailable.');
      const messageRef = conversationRef(plan.destination.conversationId).collection('messages').doc(plan.messageId);
      await admin.storage().bucket().file(plan.fullPath).save(bytes.fullBytes, {
        metadata: { cacheControl: 'private, max-age=0, no-store', contentType: plan.source.image.metadata.main.mimeType },
        resumable: false,
      });
      copied.push({ messageRef, storagePath: plan.fullPath });
      await admin.storage().bucket().file(plan.thumbnailPath).save(bytes.thumbnailBytes, {
        metadata: { cacheControl: 'private, max-age=0, no-store', contentType: plan.source.image.metadata.thumbnail.mimeType },
        resumable: false,
      });
      copied.push({ messageRef, storagePath: plan.thumbnailPath });
    }

    const transactionResult = await firestore().runTransaction(async (transaction) => {
      const now = Timestamp.now();
      const [rate, currentSourceConversation, currentSourceMember, currentSender, ...currentSourceMessages] = await Promise.all([
        transaction.get(forwardRateRef(uid)),
        transaction.get(sourceRef),
        transaction.get(memberRef(sourceConversationId, uid)),
        transaction.get(firestore().collection('users').doc(uid)),
        ...messageIds.map((messageId) => transaction.get(sourceRef.collection('messages').doc(messageId))),
      ]);
      const currentSourceData = currentSourceConversation.data() as ConversationData | undefined;
      if (!currentSourceConversation.exists || currentSourceData?.status !== 'active') failed('Conversation unavailable.');
      if (!currentSourceMember.exists || currentSourceMember.data()?.status !== 'active') denied('Active membership required.');
      if (!currentSender.exists) failed('Sender unavailable.');
      const currentSourceParticipants = readIds(currentSourceData?.activeParticipantIds);
      if (!currentSourceParticipants.includes(uid) ||
        await getBlockSnapshots(transaction, currentSourceParticipants.filter((id) => id !== uid).map((id) => [uid, id]))) {
        denied('Messaging is unavailable for this connection.');
      }
      for (const source of sources) {
        const current = currentSourceMessages.find((snapshot) => snapshot.id === source.messageId);
        const currentData = current?.data();
        if (messageIsUnavailableForUser(currentData, uid) || currentData?.messageType !== source.messageType) {
          denied('Message is unavailable.');
        }
        if (source.image &&
          (currentData?.image?.fullPath !== source.image.fullPath || currentData?.image?.thumbnailPath !== source.image.thumbnailPath)) {
          denied('Media is unavailable.');
        }
      }

      const destinationSnapshots = await Promise.all(destinations.flatMap((destination) => [
        transaction.get(conversationRef(destination.conversationId)),
        transaction.get(memberRef(destination.conversationId, uid)),
      ]));
      for (let index = 0; index < destinations.length; index += 1) {
        const destination = destinations[index];
        const conversation = destinationSnapshots[index * 2];
        const member = destinationSnapshots[(index * 2) + 1];
        const participantIds = readIds(conversation.data()?.activeParticipantIds);
        if (!conversation.exists || conversation.data()?.status !== 'active' ||
          !member.exists || member.data()?.status !== 'active' ||
          !participantIds.includes(uid) || participantIds.length > MAX_CHAT_PARTICIPANTS) {
          denied('Destination membership required.');
        }
        if (await getBlockSnapshots(transaction, participantIds.filter((id) => id !== uid).map((id) => [uid, id]))) {
          denied('Messaging is unavailable for this connection.');
        }
        if (destination.conversationType === 'direct') {
          const friendId = participantIds.find((id) => id !== uid);
          const friend = friendId ? await transaction.get(firestore().collection('users').doc(friendId)) : null;
          if (!friendId || !friend?.exists || !isAcceptedFriend(currentSender.data(), friend.data(), uid, friendId)) {
            failed('You are no longer friends.');
          }
        }
      }

      const existingMessages = await Promise.all(plans.map((plan) =>
        transaction.get(conversationRef(plan.destination.conversationId).collection('messages').doc(plan.messageId))));
      const existingReservations = await Promise.all(plans.map((plan) => plan.reservationId
        ? transaction.get(uploadReservationRef(plan.reservationId))
        : Promise.resolve(null)));
      const newPlanIndexes = plans.flatMap((_, index) => existingMessages[index].exists ? [] : [index]);
      if (newPlanIndexes.length > 0) {
        const lastForwardAt = timestampMillis(rate.data()?.lastForwardAt);
        if (lastForwardAt !== null && now.toMillis() - lastForwardAt < FRIEND_CHAT_FORWARD_COOLDOWN_MS) {
          throw new functions.https.HttpsError('resource-exhausted', 'Please wait a moment before forwarding again.');
        }
        for (const destination of destinations) {
          const member = destinationSnapshots[(destinations.indexOf(destination) * 2) + 1];
          const lastSentAt = timestampMillis(member.data()?.lastSentAt);
          if (lastSentAt !== null && now.toMillis() - lastSentAt < CHAT_SEND_COOLDOWN_MS) {
            throw new functions.https.HttpsError('resource-exhausted', 'Please wait a moment before sending again.');
          }
        }
      }

      const senderDisplayName = safeName(currentSender.data());
      const pushTargets = new Map<string, { conversationId: string; conversationType: 'direct' | 'group'; messageType: 'image' | 'text' }>();
      for (let index = 0; index < plans.length; index += 1) {
        const plan = plans[index];
        const existingMessage = existingMessages[index];
        if (existingMessage.exists) {
          const existing = existingMessage.data();
          if (existing?.senderUserId !== uid || existing?.clientMessageId !== plan.clientMessageId || existing?.forwarded !== true) {
            failed('Forward operation unavailable.');
          }
          continue;
        }
        const createdAt = Timestamp.now();
        const destinationImage = plan.source.image && plan.fullPath && plan.thumbnailPath
          ? { ...plan.source.image.stored, fullPath: plan.fullPath, thumbnailPath: plan.thumbnailPath }
          : null;
        if (plan.source.image && plan.reservationId && plan.fullPath && plan.thumbnailPath) {
          const reservationRef = uploadReservationRef(plan.reservationId);
          const reservation = existingReservations[index];
          const reservationData = reservation?.data() as FriendChatMediaUploadReservation | undefined;
          if (reservation?.exists &&
            (reservationData?.userId !== uid || reservationData?.conversationId !== plan.destination.conversationId ||
              reservationData?.targetId !== plan.messageId || reservationData?.kind !== 'image')) {
            failed('Forward operation unavailable.');
          }
          transaction.set(reservationRef, {
            caption: plan.source.caption,
            clientMessageId: plan.clientMessageId,
            conversationId: plan.destination.conversationId,
            createdAt,
            expiresAt: Timestamp.fromMillis(createdAt.toMillis() + FRIEND_CHAT_MEDIA_UPLOAD_TTL_MS),
            finalizedAt: createdAt,
            fullPath: plan.fullPath,
            image: plan.source.image.metadata,
            kind: 'image',
            reservationId: plan.reservationId,
            status: 'finalized',
            targetId: plan.messageId,
            thumbnailPath: plan.thumbnailPath,
            updatedAt: createdAt,
            userId: uid,
          }, { merge: true });
        }
        transaction.create(conversationRef(plan.destination.conversationId).collection('messages').doc(plan.messageId), {
          caption: plan.source.caption,
          clientMessageId: plan.clientMessageId,
          conversationId: plan.destination.conversationId,
          createdAt,
          forwarded: true,
          forwardedFrom: { messageType: plan.source.messageType },
          image: destinationImage,
          mediaStoragePaths: destinationImage ? [destinationImage.fullPath, destinationImage.thumbnailPath] : [],
          messageId: plan.messageId,
          messageType: plan.source.messageType,
          reactionCounts: {},
          reactionTotalCount: 0,
          removedAt: null,
          removedBy: null,
          replyTo: null,
          senderDisplayName,
          senderUserId: uid,
          status: 'active',
          text: plan.source.messageType === 'text' ? plan.source.text : plan.source.caption ?? '',
          visibleToUserIds: plan.destination.participantIds,
          voiceMemo: null,
        });
        transaction.update(conversationRef(plan.destination.conversationId), {
          lastMessageAt: createdAt,
          lastMessageId: plan.messageId,
          lastMessagePreview: friendChatMediaPreview(plan.source.messageType, plan.source.messageType === 'text' ? plan.source.text : plan.source.caption),
          lastMessageRemoved: false,
          lastMessageType: plan.source.messageType,
          lastSenderId: uid,
          updatedAt: createdAt,
        });
        transaction.set(memberRef(plan.destination.conversationId, uid), { lastSentAt: createdAt, updatedAt: createdAt }, { merge: true });
        pushTargets.set(plan.destination.conversationId, {
          conversationId: plan.destination.conversationId,
          conversationType: plan.destination.conversationType,
          messageType: plan.source.messageType,
        });
      }
      if (newPlanIndexes.length > 0) {
        transaction.set(forwardRateRef(uid), {
          lastForwardAt: now,
          updatedAt: FieldValue.serverTimestamp(),
          userIdHash: hashId(uid),
        }, { merge: true });
      }
      return { pushTargets: Array.from(pushTargets.values()) };
    });

    await Promise.allSettled(transactionResult.pushTargets.map((target) =>
      sendMessagePushes(target.conversationId, uid, target.messageType, target.conversationType)));
    return { forwarded: plans.length, unsupportedMediaMessageIds };
  } catch (error) {
    await cleanupUnreferencedForwardMedia(copied);
    throw error;
  }
});

export const pinFriendChatMessage = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  const messageId = normalizeConversationId(data?.messageId);
  const duration = FRIEND_CHAT_PIN_DURATIONS.includes(data?.duration) ? data.duration as typeof FRIEND_CHAT_PIN_DURATIONS[number] : null;
  if (!conversationId || !messageId || !duration) invalid('Pin references are required.');
  const durationMs = duration === '24h' ? 24 * 60 * 60 * 1000 : duration === '7d' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  await firestore().runTransaction(async (transaction) => {
    const [conversation, member, message] = await Promise.all([
      transaction.get(conversationRef(conversationId)),
      transaction.get(memberRef(conversationId, uid)),
      transaction.get(conversationRef(conversationId).collection('messages').doc(messageId)),
    ]);
    const conversationData = conversation.data() as ConversationData | undefined;
    if (!conversation.exists || conversationData?.status !== 'active') failed('Conversation unavailable.');
    if (!member.exists || member.data()?.status !== 'active') denied('Active membership required.');
    if (conversationData?.conversationType === 'group' && !['owner', 'admin'].includes(member.data()?.role)) {
      denied('Group admin access required.');
    }
    const messageData = message.data();
    if (messageIsUnavailableForUser(messageData, uid)) denied('Message is unavailable.');
    const pinnedContext = await resolveReplyContext(transaction, conversationId, messageId, uid);
    if (!pinnedContext) denied('Message is unavailable.');
    const now = Timestamp.now();
    transaction.update(conversation.ref, {
      pinnedMessage: {
        ...pinnedContext,
        expiresAt: Timestamp.fromMillis(now.toMillis() + durationMs),
        pinnedAt: now,
        pinnedByUserId: uid,
      },
      updatedAt: now,
    });
  });
  return { pinned: true };
});

export const unpinFriendChatMessage = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  const messageId = normalizeConversationId(data?.messageId);
  if (!conversationId || !messageId) invalid('Pin references are required.');
  await firestore().runTransaction(async (transaction) => {
    const [conversation, member] = await Promise.all([
      transaction.get(conversationRef(conversationId)),
      transaction.get(memberRef(conversationId, uid)),
    ]);
    const conversationData = conversation.data() as ConversationData | undefined;
    if (!conversation.exists || conversationData?.status !== 'active') failed('Conversation unavailable.');
    if (!member.exists || member.data()?.status !== 'active') denied('Active membership required.');
    if (conversationData?.conversationType === 'group' && !['owner', 'admin'].includes(member.data()?.role)) {
      denied('Group admin access required.');
    }
    const pinned = conversationData?.pinnedMessage as { messageId?: unknown } | undefined;
    if (pinned?.messageId === messageId) {
      transaction.update(conversation.ref, { pinnedMessage: FieldValue.delete(), updatedAt: Timestamp.now() });
    }
  });
  return { unpinned: true };
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
  const ref = firestore().collection('chatModerationReports').doc();
  await firestore().runTransaction(async (transaction) => {
    const messageRef = conversationRef(conversationId).collection('messages').doc(messageId);
    const message = await transaction.get(messageRef);
    const messageData = message.data() ?? {};
    if (!message.exists || messageData.status === 'removed' || contentIsModerated(messageData)) failed('Message unavailable.');
    if (!readIds(messageData.visibleToUserIds).includes(uid)) denied('Message is not visible to this member.');
    const messageType = messageData.messageType === 'voice'
      ? 'voice'
      : messageData.messageType === 'image'
        ? 'image'
        : 'text';
    transaction.create(ref, {
      attachmentEvidence: {
        image: messageType === 'image' ? {
          fullPath: typeof messageData.image?.fullPath === 'string' ? messageData.image.fullPath : null,
          height: Number.isInteger(messageData.image?.height) ? messageData.image.height : null,
          mimeType: typeof messageData.image?.mimeType === 'string' ? messageData.image.mimeType : null,
          thumbnailPath: typeof messageData.image?.thumbnailPath === 'string' ? messageData.image.thumbnailPath : null,
          width: Number.isInteger(messageData.image?.width) ? messageData.image.width : null,
        } : null,
        voiceMemo: messageType === 'voice' ? {
          durationMilliseconds: Number.isInteger(messageData.voiceMemo?.durationMilliseconds) ? messageData.voiceMemo.durationMilliseconds : null,
          mimeType: typeof messageData.voiceMemo?.mimeType === 'string' ? messageData.voiceMemo.mimeType : null,
          sizeBytes: Number.isInteger(messageData.voiceMemo?.sizeBytes) ? messageData.voiceMemo.sizeBytes : null,
          storagePath: typeof messageData.voiceMemo?.storagePath === 'string' ? messageData.voiceMemo.storagePath : null,
        } : null,
      },
      contentSnapshot: {
        caption: typeof messageData.caption === 'string' ? sanitizeMessagePreview(messageData.caption) : null,
        messageType,
        text: typeof messageData.text === 'string' ? sanitizeMessagePreview(messageData.text) : null,
      },
      reportId: ref.id, reporterUserId: uid, reportedUserId: messageData.senderUserId ?? null,
      conversationId, messageId, reason, reportType: 'message', status: 'open', createdAt: Timestamp.now(),
    });
    transaction.update(messageRef, {
      moderationEvidenceRetained: true,
      moderationEvidenceRetainedAt: FieldValue.serverTimestamp(),
    });
  });
  return { reportId: ref.id, reported: true };
});

export const toggleFriendChatReaction = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const conversationId = normalizeConversationId(data?.conversationId);
  const messageId = normalizeConversationId(data?.messageId);
  const emoji = normalizeFriendChatReaction(data?.emoji);
  if (!conversationId || !messageId || !emoji) invalid('A supported reaction is required.');
  const messageRef = conversationRef(conversationId).collection('messages').doc(messageId);
  const reactionRef = messageRef.collection('reactions').doc(uid);
  await firestore().runTransaction(async (transaction) => {
    const [conversation, member, message, reactionSnapshot] = await Promise.all([
      transaction.get(conversationRef(conversationId)),
      transaction.get(memberRef(conversationId, uid)),
      transaction.get(messageRef),
      transaction.get(messageRef.collection('reactions')),
    ]);
    if (!conversation.exists || conversation.data()?.status !== 'active') failed('Conversation unavailable.');
    if (!member.exists || member.data()?.status !== 'active') denied('Active membership required.');
    const messageData = message.data();
    if (
      !message.exists ||
      messageData?.status === 'removed' ||
      contentIsModerated(messageData) ||
      messageData?.messageType === 'system' ||
      !readIds(messageData?.visibleToUserIds).includes(uid)
    ) denied('Message is unavailable.');
    const participantIds = readIds(conversation.data()?.activeParticipantIds);
    const recipients = participantIds.filter((id) => id !== uid);
    if (await getBlockSnapshots(transaction, recipients.map((recipientId) => [uid, recipientId]))) {
      denied('Messaging is unavailable for this connection.');
    }
    const existingReactions = new Map<string, FriendChatReaction>();
    reactionSnapshot.docs.forEach((reactionDocument) => {
      const existingEmoji = normalizeFriendChatReaction(reactionDocument.get('emoji'));
      if (existingEmoji) existingReactions.set(reactionDocument.id, existingEmoji);
    });
    const currentEmoji = existingReactions.get(uid) ?? null;
    if (currentEmoji === emoji) {
      existingReactions.delete(uid);
      transaction.delete(reactionRef);
    } else {
      existingReactions.set(uid, emoji);
      transaction.set(reactionRef, {
        emoji,
        reactedAt: FieldValue.serverTimestamp(),
        userId: uid,
      });
    }
    const compactCounts: Partial<Record<FriendChatReaction, number>> = {};
    for (const reaction of existingReactions.values()) {
      compactCounts[reaction] = Math.min(MAX_CHAT_PARTICIPANTS, (compactCounts[reaction] ?? 0) + 1);
    }
    transaction.update(messageRef, {
      reactionCounts: compactCounts,
      reactionTotalCount: Object.values(compactCounts).reduce((sum: number, count) => sum + Number(count ?? 0), 0),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { updated: true };
});

export const getFriendChatMediaDownloadUrl = communicationChatFunctions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const messageId = normalizeConversationId(data?.messageId);
  const storagePath = typeof data?.storagePath === 'string' ? data.storagePath.trim() : '';
  const storageReference = parseFriendChatMediaStoragePath(storagePath);
  if (!messageId || !storageReference || storageReference.messageId !== messageId) {
    invalid('A valid media reference is required.');
  }
  const authorized = await canAccessFriendChatMedia(firestore(), uid, storagePath);
  if (!authorized) denied('Media is unavailable.');

  const expiresAtMillis = Date.now() + FRIEND_CHAT_MEDIA_SIGNED_URL_MS;
  const bucket = admin.storage().bucket();
  const storageEmulatorHost = process.env.STORAGE_EMULATOR_HOST;
  const storageEmulatorOrigin = storageEmulatorHost && /^https?:\/\//u.test(storageEmulatorHost)
    ? storageEmulatorHost
    : `http://${storageEmulatorHost}`;
  const file = bucket.file(storagePath);
  let url: string;
  if (process.env.FUNCTIONS_EMULATOR === 'true' && storageEmulatorHost) {
    const [metadata] = await file.getMetadata();
    const existingToken = metadata.metadata?.firebaseStorageDownloadTokens;
    const emulatorToken = typeof existingToken === 'string' && existingToken
      ? existingToken.split(',')[0]
      : randomBytes(18).toString('hex');
    if (!existingToken) {
      await file.setMetadata({
        metadata: {
          ...metadata.metadata,
          firebaseStorageDownloadTokens: emulatorToken,
        },
      });
    }
    url = `${storageEmulatorOrigin}/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(emulatorToken)}`;
  } else {
    const grantToken = randomBytes(32).toString('hex');
    await mediaGrantRef(grantToken).create({
      conversationId: storageReference.conversationId,
      expiresAt: Timestamp.fromMillis(expiresAtMillis),
      messageId,
      mediaKind: storageReference.kind,
      storagePath,
      userId: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    const projectId = process.env.GCLOUD_PROJECT || admin.app().options.projectId;
    if (!projectId) failed('Media access is unavailable.');
    url = `https://us-central1-${projectId}.cloudfunctions.net/streamFriendChatMedia?grant=${grantToken}`;
  }
  return { expiresAtMillis, url };
});

export const streamFriendChatMedia = chatFunctions.https.onRequest(async (request, response) => {
  response.set('Cache-Control', 'private, no-store, max-age=0');
  response.set('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.status(405).set('Allow', 'GET, HEAD').end();
    return;
  }
  const grantToken = typeof request.query.grant === 'string' ? request.query.grant : '';
  if (!/^[a-f0-9]{64}$/u.test(grantToken)) {
    response.status(404).end();
    return;
  }
  try {
    const grant = await mediaGrantRef(grantToken).get();
    const data = grant.data();
    const expiresAtMillis = timestampMillis(data?.expiresAt) ?? 0;
    const storagePath = typeof data?.storagePath === 'string' ? data.storagePath : '';
    const uid = typeof data?.userId === 'string' ? data.userId : '';
    if (!grant.exists || !uid || expiresAtMillis <= Date.now() || !await canAccessFriendChatMedia(firestore(), uid, storagePath)) {
      response.status(404).end();
      return;
    }
    const storageReference = parseFriendChatMediaStoragePath(storagePath);
    if (!storageReference) {
      response.status(404).end();
      return;
    }
    const file = admin.storage().bucket().file(storagePath);
    const [metadata] = await file.getMetadata();
    const sizeBytes = Number(metadata.size);
    const mimeType = typeof metadata.contentType === 'string' ? metadata.contentType : '';
    const maxSize = storageReference.kind === 'thumbnail'
      ? FRIEND_CHAT_IMAGE_THUMBNAIL_MAX_SIZE_BYTES
      : storageReference.kind === 'image'
        ? FRIEND_CHAT_IMAGE_MAX_SIZE_BYTES
        : FRIEND_CHAT_VOICE_MAX_SIZE_BYTES;
    const allowed = storageReference.kind === 'voice'
      ? ['audio/mp4', 'audio/m4a', 'audio/x-m4a'].includes(mimeType)
      : ['image/jpeg', 'image/webp'].includes(mimeType);
    if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > maxSize || !allowed) {
      response.status(415).end();
      return;
    }
    const range = parseByteRange(request.get('range'), sizeBytes);
    if (range === 'invalid') {
      response.status(416).set('Content-Range', `bytes */${sizeBytes}`).end();
      return;
    }
    response.set('Accept-Ranges', 'bytes');
    response.type(mimeType);
    if (range) {
      response.status(206);
      response.set('Content-Range', `bytes ${range.start}-${range.end}/${sizeBytes}`);
      response.set('Content-Length', String(range.end - range.start + 1));
    } else {
      response.status(200);
      response.set('Content-Length', String(sizeBytes));
    }
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const [contents] = await file.download(range ? { start: range.start, end: range.end } : undefined);
    response.send(contents);
  } catch (error) {
    functions.logger.warn('friend_chat_media_stream_failed', { reason: error instanceof Error ? error.message : 'unknown' });
    if (!response.headersSent) response.status(404).end();
    else response.end();
  }
});

export const cleanupAbandonedFriendChatMediaUploads = chatFunctions.pubsub
  .schedule('every 24 hours')
  .onRun(async () => {
    const snapshot = await firestore().collection('friendChatUploadReservations')
      .where('status', '==', 'pending')
      .where('expiresAt', '<=', Timestamp.now())
      .limit(100)
      .get();
    let deletedObjects = 0;
    await Promise.all(snapshot.docs.map(async (document) => {
      const storagePaths = storagePathsForReservation(document.data() as FriendChatMediaUploadReservation);
      await Promise.all(storagePaths.map(async (storagePath) => {
        await admin.storage().bucket().file(storagePath).delete({ ignoreNotFound: true });
        deletedObjects += 1;
      }));
      await document.ref.delete();
    }));
    const deletePendingSnapshot = await firestore().collection('friendChatUploadReservations')
      .where('status', '==', 'deletePending')
      .limit(100)
      .get();
    await Promise.all(deletePendingSnapshot.docs.map(async (document) => {
      const storagePaths = storagePathsForReservation(document.data() as FriendChatMediaUploadReservation);
      await Promise.all(storagePaths.map(async (storagePath) => {
        await admin.storage().bucket().file(storagePath).delete({ ignoreNotFound: true });
        deletedObjects += 1;
      }));
      await document.ref.delete();
    }));
    const grants = await firestore().collection('friendChatMediaPlaybackGrants')
      .where('expiresAt', '<=', Timestamp.now())
      .limit(500)
      .get();
    if (!grants.empty) {
      const writer = firestore().bulkWriter();
      grants.docs.forEach((document) => writer.delete(document.ref));
      await writer.close();
    }
    functions.logger.info('friend_chat_media_cleanup_completed', {
      deletedObjects,
      reservations: snapshot.size + deletePendingSnapshot.size,
    });
    return null;
  });

async function verifyUploadedFriendVoiceMemo(reservation: FriendChatMediaUploadReservation) {
  const storagePath = typeof reservation.storagePath === 'string' ? reservation.storagePath : '';
  const storageReference = parseFriendChatMediaStoragePath(storagePath);
  const voiceMemo = reservation.voiceMemo;
  if (
    !storageReference ||
    storageReference.kind !== 'voice' ||
    storageReference.reservationId !== reservation.reservationId ||
    storageReference.messageId !== reservation.targetId ||
    !voiceMemo
  ) failed('Upload expired.');
  if ((timestampMillis(reservation.expiresAt) ?? 0) <= Date.now()) failed('Upload expired.');
  const [metadata] = await admin.storage().bucket().file(storagePath).getMetadata();
  const sizeBytes = Number(metadata.size);
  const mimeType = typeof metadata.contentType === 'string' ? metadata.contentType : '';
  if (
    sizeBytes !== voiceMemo.sizeBytes ||
    sizeBytes < 1 ||
    sizeBytes > FRIEND_CHAT_VOICE_MAX_SIZE_BYTES ||
    mimeType !== voiceMemo.mimeType
  ) failed('Uploaded voice message could not be verified.');
  return { ...voiceMemo, storagePath };
}

async function verifyUploadedFriendImage(reservation: FriendChatMediaUploadReservation) {
  const image = reservation.image;
  const fullPath = typeof reservation.fullPath === 'string' ? reservation.fullPath : '';
  const thumbnailPath = typeof reservation.thumbnailPath === 'string' ? reservation.thumbnailPath : '';
  const fullReference = parseFriendChatMediaStoragePath(fullPath);
  const thumbnailReference = parseFriendChatMediaStoragePath(thumbnailPath);
  if (
    !image ||
    !fullReference ||
    !thumbnailReference ||
    fullReference.kind !== 'image' ||
    thumbnailReference.kind !== 'thumbnail' ||
    fullReference.reservationId !== reservation.reservationId ||
    thumbnailReference.reservationId !== reservation.reservationId ||
    fullReference.messageId !== reservation.targetId ||
    thumbnailReference.messageId !== reservation.targetId
  ) failed('Upload expired.');
  if ((timestampMillis(reservation.expiresAt) ?? 0) <= Date.now()) failed('Upload expired.');
  const fullFile = admin.storage().bucket().file(fullPath);
  const thumbnailFile = admin.storage().bucket().file(thumbnailPath);
  const [fullMetadata, thumbnailMetadata] = await Promise.all([
    fullFile.getMetadata().then(([metadata]) => metadata),
    thumbnailFile.getMetadata().then(([metadata]) => metadata),
  ]);
  const fullSize = Number(fullMetadata.size);
  const thumbnailSize = Number(thumbnailMetadata.size);
  const isVersion2 = image.mediaProfileVersion === FRIEND_CHAT_IMAGE_PROFILE_V2;
  const fullMaxBytes = isVersion2 ? FRIEND_CHAT_IMAGE_V2_MAX_SIZE_BYTES : FRIEND_CHAT_IMAGE_MAX_SIZE_BYTES;
  const thumbnailMaxBytes = isVersion2
    ? FRIEND_CHAT_IMAGE_V2_THUMBNAIL_MAX_SIZE_BYTES
    : FRIEND_CHAT_IMAGE_THUMBNAIL_MAX_SIZE_BYTES;
  if (
    fullSize !== image.main.sizeBytes ||
    thumbnailSize !== image.thumbnail.sizeBytes ||
    fullMetadata.contentType !== image.main.mimeType ||
    thumbnailMetadata.contentType !== image.thumbnail.mimeType ||
    fullSize < 1 ||
    thumbnailSize < 1 ||
    fullSize > fullMaxBytes ||
    thumbnailSize > thumbnailMaxBytes
  ) failed('Uploaded image could not be verified.');
  if (isVersion2) {
    const [fullBytes, thumbnailBytes] = await Promise.all([
      fullFile.download().then(([bytes]) => bytes),
      thumbnailFile.download().then(([bytes]) => bytes),
    ]);
    const fullDimensions = readJpegDimensions(fullBytes);
    const thumbnailDimensions = readJpegDimensions(thumbnailBytes);
    if (
      fullBytes.byteLength !== image.main.sizeBytes ||
      thumbnailBytes.byteLength !== image.thumbnail.sizeBytes ||
      !fullDimensions ||
      !thumbnailDimensions ||
      fullDimensions.width !== image.main.width ||
      fullDimensions.height !== image.main.height ||
      thumbnailDimensions.width !== image.thumbnail.width ||
      thumbnailDimensions.height !== image.thumbnail.height
    ) failed('Uploaded image could not be verified.');
  }
  return {
    fullPath,
    height: image.main.height,
    mediaProfileVersion: image.mediaProfileVersion,
    mimeType: image.main.mimeType,
    sizeBytes: image.main.sizeBytes,
    sourceMimeType: image.sourceMimeType,
    sourceSizeBytes: image.sourceSizeBytes,
    thumbnailHeight: image.thumbnail.height,
    thumbnailMimeType: image.thumbnail.mimeType,
    thumbnailPath,
    thumbnailSizeBytes: image.thumbnail.sizeBytes,
    thumbnailWidth: image.thumbnail.width,
    width: image.main.width,
  };
}

async function canAccessFriendChatMedia(
  db: FirebaseFirestore.Firestore,
  userId: string,
  storagePath: string,
) {
  if (!await accountCanCommunicate(userId)) return false;
  const storageReference = parseFriendChatMediaStoragePath(storagePath);
  if (!storageReference) return false;
  const conversation = db.collection('friendConversations').doc(storageReference.conversationId);
  const messageRef = conversation.collection('messages').doc(storageReference.messageId);
  const reservationRef = db.collection('friendChatUploadReservations').doc(storageReference.reservationId);
  const [conversationSnapshot, memberSnapshot, messageSnapshot, reservationSnapshot] = await Promise.all([
    conversation.get(),
    conversation.collection('members').doc(userId).get(),
    messageRef.get(),
    reservationRef.get(),
  ]);
  const conversationData = conversationSnapshot.data();
  const message = messageSnapshot.data();
  const reservation = reservationSnapshot.data() as FriendChatMediaUploadReservation | undefined;
  if (
    !conversationSnapshot.exists ||
    !memberSnapshot.exists ||
    memberSnapshot.data()?.status !== 'active' ||
    !messageSnapshot.exists ||
    message?.status === 'removed' ||
    contentIsModerated(message) ||
    !readIds(message?.visibleToUserIds).includes(userId) ||
    !reservationSnapshot.exists ||
    reservation?.status !== 'finalized' ||
    reservation.conversationId !== storageReference.conversationId ||
    reservation.targetId !== storageReference.messageId
  ) return false;
  const participantIds = readIds(conversationData?.activeParticipantIds);
  const otherParticipantIds = participantIds.filter((id) => id !== userId);
  const blockSnapshots = await Promise.all(otherParticipantIds.flatMap((otherId) => [
    blockRef(userId, otherId).get(),
    blockRef(otherId, userId).get(),
  ]));
  if (blockSnapshots.some((snapshot) => snapshot.exists)) return false;
  if (storageReference.kind === 'voice') {
    return message?.messageType === 'voice' &&
      message?.voiceMemo?.storagePath === storagePath &&
      reservation.storagePath === storagePath;
  }
  const expectedPath = storageReference.kind === 'image'
    ? message?.image?.fullPath
    : message?.image?.thumbnailPath;
  const reservationPath = storageReference.kind === 'image'
    ? reservation.fullPath
    : reservation.thumbnailPath;
  return message?.messageType === 'image' &&
    expectedPath === storagePath &&
    reservationPath === storagePath;
}

function storagePathsForReservation(reservation: FriendChatMediaUploadReservation) {
  const paths = [
    typeof reservation.storagePath === 'string' ? reservation.storagePath : '',
    typeof reservation.fullPath === 'string' ? reservation.fullPath : '',
    typeof reservation.thumbnailPath === 'string' ? reservation.thumbnailPath : '',
  ].filter((path) => Boolean(parseFriendChatMediaStoragePath(path)));
  return Array.from(new Set(paths));
}

async function deleteFriendChatStorageObjects(storagePaths: string[]) {
  const validPaths = Array.from(new Set(storagePaths.filter((path) => Boolean(parseFriendChatMediaStoragePath(path)))));
  if (validPaths.length === 0) return 'notRequired' as const;
  await Promise.allSettled(validPaths.map(async (storagePath) => {
    const storageReference = parseFriendChatMediaStoragePath(storagePath);
    if (storageReference) {
      await uploadReservationRef(storageReference.reservationId).set({
        expiresAt: Timestamp.now(),
        status: 'deletePending',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await admin.storage().bucket().file(storagePath).delete({ ignoreNotFound: true });
  }));
  await Promise.allSettled(validPaths.map(async (storagePath) => {
    const storageReference = parseFriendChatMediaStoragePath(storagePath);
    if (storageReference) await uploadReservationRef(storageReference.reservationId).delete();
  }));
  return 'deleted' as const;
}

function parseByteRange(value: string | undefined, sizeBytes: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return 'invalid' as const;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength < 1) return 'invalid' as const;
    start = Math.max(0, sizeBytes - suffixLength);
    end = sizeBytes - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : sizeBytes - 1;
  }
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= sizeBytes
  ) return 'invalid' as const;
  return { start, end: Math.min(end, sizeBytes - 1) };
}

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
