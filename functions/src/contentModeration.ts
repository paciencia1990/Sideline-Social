import { createHash } from 'node:crypto';

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions';

import { canAccessTeamAnnouncement, isTeamActive } from './teamMembershipCore';
import { isExplicitConversationParticipant } from './teamVoiceMessagingCore';

type ReportKind = 'announcement' | 'announcementReply' | 'privateTeamMessage';
type ReportReason = 'offensive' | 'harassment' | 'privacy' | 'spam' | 'other';

const moderationFunctions = functions.region('us-central1').runWith({ timeoutSeconds: 60, memory: '256MB' });

export const reportTeamContent = moderationFunctions.https.onCall(async (data, context) => {
  const reporterUserId = context.auth?.uid;
  if (!reporterUserId) throw new functions.https.HttpsError('unauthenticated', 'Sign in to report content.');

  const kind = readKind(data?.kind);
  const reason = readReason(data?.reason);
  const teamId = readId(data?.teamId, 'team');
  const parentId = readId(data?.parentId, kind === 'privateTeamMessage' ? 'conversation' : 'announcement');
  const contentId = kind === 'announcement' ? parentId : readId(data?.contentId, 'content');
  const firestore = admin.firestore();
  const teamRef = firestore.collection('teams').doc(teamId);
  const memberRef = teamRef.collection('members').doc(reporterUserId);
  const [team, member] = await Promise.all([teamRef.get(), memberRef.get()]);
  if (!team.exists || !isTeamActive(team.data())) {
    throw new functions.https.HttpsError('failed-precondition', 'This team is unavailable.');
  }
  if (!member.exists || member.data()?.status !== 'active') {
    throw new functions.https.HttpsError('permission-denied', 'An active team membership is required.');
  }

  let reportedUserId: string | null = null;
  let snapshot: { contentType: string; text: string };
  if (kind === 'privateTeamMessage') {
    const conversationRef = firestore.collection('teamPrivateConversations').doc(parentId);
    const [conversation, message] = await Promise.all([
      conversationRef.get(),
      conversationRef.collection('messages').doc(contentId).get(),
    ]);
    if (!conversation.exists || conversation.data()?.teamId !== teamId ||
      !isExplicitConversationParticipant(conversation.data(), reporterUserId)) {
      throw new functions.https.HttpsError('permission-denied', 'This conversation is unavailable.');
    }
    if (!message.exists) throw new functions.https.HttpsError('not-found', 'Message unavailable.');
    reportedUserId = readOptionalUserId(message.data()?.senderUserId);
    snapshot = {
      contentType: message.data()?.contentType === 'voice' ? 'voice' : 'text',
      text: boundedSnapshot([message.data()?.text, message.data()?.caption]),
    };
  } else {
    const announcementRef = teamRef.collection('announcements').doc(parentId);
    const announcement = await announcementRef.get();
    if (!announcement.exists || !canAccessTeamAnnouncement(member.data(), announcement.data()?.audience)) {
      throw new functions.https.HttpsError('permission-denied', 'This announcement is unavailable.');
    }
    if (kind === 'announcement') {
      reportedUserId = readOptionalUserId(announcement.data()?.createdBy);
      snapshot = {
        contentType: announcement.data()?.contentType === 'voice' ? 'voice' : 'text',
        text: boundedSnapshot([announcement.data()?.title, announcement.data()?.body]),
      };
    } else {
      const reply = await announcementRef.collection('replies').doc(contentId).get();
      if (!reply.exists) throw new functions.https.HttpsError('not-found', 'Reply unavailable.');
      reportedUserId = readOptionalUserId(reply.data()?.userId);
      snapshot = { contentType: 'text', text: boundedSnapshot([reply.data()?.body]) };
    }
  }

  if (!reportedUserId || reportedUserId === reporterUserId) {
    throw new functions.https.HttpsError('failed-precondition', 'Only another user’s content can be reported.');
  }

  const reportId = createHash('sha256')
    .update(`${reporterUserId}\u001f${kind}\u001f${teamId}\u001f${parentId}\u001f${contentId}`)
    .digest('hex');
  const reportRef = firestore.collection('contentModerationReports').doc(reportId);
  let alreadyReported = false;
  await firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(reportRef);
    if (existing.exists) {
      alreadyReported = true;
      return;
    }
    transaction.create(reportRef, {
      reportId,
      reporterUserId,
      reportedUserId,
      kind,
      reason,
      teamId,
      parentId,
      contentId,
      contentSnapshot: snapshot,
      status: 'open',
      createdAt: Timestamp.now(),
      reviewedAt: null,
      reviewedBy: null,
      resolution: null,
    });
  });
  functions.logger.info('team_content_report_recorded', { alreadyReported, kind, reason });
  return { alreadyReported, reported: true };
});

function readKind(value: unknown): ReportKind {
  if (value === 'announcement' || value === 'announcementReply' || value === 'privateTeamMessage') return value;
  throw new functions.https.HttpsError('invalid-argument', 'A supported report type is required.');
}

function readReason(value: unknown): ReportReason {
  if (value === 'offensive' || value === 'harassment' || value === 'privacy' || value === 'spam' || value === 'other') return value;
  throw new functions.https.HttpsError('invalid-argument', 'A report reason is required.');
}

function readId(value: unknown, label: string) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,200}$/u.test(id)) {
    throw new functions.https.HttpsError('invalid-argument', `A valid ${label} reference is required.`);
  }
  return id;
}

function readOptionalUserId(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/u.test(value) ? value : null;
}

function boundedSnapshot(values: unknown[]) {
  return values.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => value.trim())
    .join('\n\n')
    .slice(0, 2200);
}
