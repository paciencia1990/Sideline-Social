import { createHash } from 'node:crypto';

import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as firebaseFunctions from 'firebase-functions';

import { permanentAccountFunctions } from './permanentAuth';
import { sendPushToUser } from './pushNotificationDelivery';
import {
  MAX_SCHEDULE_IMPORT_ROWS,
  MAX_SCHEDULE_RECURRENCES,
  generateWeeklyScheduleDates,
  normalizeScheduleInput,
  scheduleFingerprintCanonical,
  scheduleMaterialChange,
  type NormalizedScheduleInput,
} from './teamScheduleCore';

const functions = permanentAccountFunctions(firebaseFunctions, 'communication');
const MAX_ACTIVE_TEAM_MEMBERS = 250;
const MAX_HISTORY_ENTRIES = 25;

type ManagerContext = {
  teamName: string;
  teamRef: FirebaseFirestore.DocumentReference;
};

type SaveTransactionResult = {
  eventIds: string[];
  recurrenceGroupId: string | null;
  replayed: boolean;
  notificationKind: string;
  notificationTitle: string;
};

type NormalizedImportRow = {
  normalized: NormalizedScheduleInput;
  fingerprint: string;
  rowNumber: number;
};

function firestore() {
  return admin.firestore();
}

export const saveTeamScheduleEvent = functions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const teamId = readId(data?.teamId, 'team ID');
  const eventId = data?.eventId == null || data.eventId === '' ? null : readId(data.eventId, 'event ID');
  const operationId = readId(data?.clientOperationId, 'operation ID');
  const notifyTeam = data?.notifyTeam === true;
  const editScope = data?.editScope === 'future' ? 'future' : 'one';
  const input = normalizeClientScheduleInput(data?.event);
  const recurrence = isRecord(data?.recurrence) ? data.recurrence : null;
  if (recurrence && (eventId || input.type !== 'practice')) {
    throw invalidArgument('recurrence_invalid');
  }
  const recurrenceDates = recurrence
    ? generateClientRecurrenceDates(input.localDate, recurrence.weekdays, recurrence.endDate)
    : [input.localDate];
  const recurrenceGroupId = recurrence
    ? `rec_${hash(`${teamId}|${userId}|${operationId}`).slice(0, 28)}`
    : null;
  const operationRef = firestore().collection('teamScheduleOperations').doc(operationDocumentId(teamId, operationId));
  let futureRefs: FirebaseFirestore.DocumentReference[] = [];
  if (eventId && editScope === 'future') {
    const sourceSnapshot = await firestore().collection('teams').doc(teamId).collection('events').doc(eventId).get();
    const groupId = sourceSnapshot.data()?.recurrenceGroupId;
    if (sourceSnapshot.exists && typeof groupId === 'string' && groupId) {
      const groupSnapshot = await firestore().collection('teams').doc(teamId).collection('events')
        .where('recurrenceGroupId', '==', groupId).get();
      const sourceStart = timestampMillis(sourceSnapshot.data()?.startAt);
      futureRefs = groupSnapshot.docs
        .filter((item) => timestampMillis(item.data().startAt) >= sourceStart)
        .map((item) => item.ref)
        .slice(0, MAX_SCHEDULE_RECURRENCES);
    }
  }

  const result = await firestore().runTransaction(async (transaction): Promise<SaveTransactionResult> => {
    const replay = await transaction.get(operationRef);
    if (replay.exists) {
      const stored = replay.data() ?? {};
      return {
        eventIds: readStoredIds(stored.eventIds),
        recurrenceGroupId: typeof stored.recurrenceGroupId === 'string' ? stored.recurrenceGroupId : null,
        replayed: true,
        notificationKind: typeof stored.notificationKind === 'string' ? stored.notificationKind : 'updated',
        notificationTitle: typeof stored.notificationTitle === 'string' ? stored.notificationTitle : input.title,
      };
    }
    const manager = await assertScheduleManager(transaction, teamId, userId);
    const now = Timestamp.now();
    const eventIds: string[] = [];
    let notificationKind = eventId ? 'updated' : 'new';
    let resolvedRecurrenceGroupId = recurrenceGroupId;

    if (eventId) {
      const eventRef = manager.teamRef.collection('events').doc(eventId);
      const sourceSnapshot = await transaction.get(eventRef);
      if (!sourceSnapshot.exists) throw notFound('event_not_found');
      const source = sourceSnapshot.data() ?? {};
      if (source.sourceType === 'ics-feed') throw failedPrecondition('detach_synced_event_first');
      resolvedRecurrenceGroupId = typeof source.recurrenceGroupId === 'string' ? source.recurrenceGroupId : null;
      const refs = editScope === 'future' && futureRefs.length > 0 ? futureRefs : [eventRef];
      const snapshots = refs.length === 1 && refs[0].path === eventRef.path
        ? [sourceSnapshot]
        : await Promise.all(refs.map((item) => transaction.get(item)));
      for (const snapshot of snapshots) {
        if (!snapshot.exists) continue;
        const current = snapshot.data() ?? {};
        const occurrenceDate = editScope === 'future' && typeof current.localDate === 'string'
          ? current.localDate
          : input.localDate;
        const occurrence = normalizeClientScheduleInput({ ...(isRecord(data?.event) ? data.event : {}), date: occurrenceDate });
        notificationKind = scheduleMaterialChange(current, occurrence);
        transaction.set(snapshot.ref, eventFields({
          teamId,
          input: occurrence,
          userId,
          now,
          source: current.source === 'csv' ? 'csv' : 'manual',
          existing: current,
          recurrenceGroupId: typeof current.recurrenceGroupId === 'string' ? current.recurrenceGroupId : null,
          recurrenceIndex: Number.isInteger(current.recurrenceIndex) ? Number(current.recurrenceIndex) : null,
          clientOperationId: operationId,
        }), { merge: true });
        eventIds.push(snapshot.id);
      }
    } else {
      const refs = recurrenceDates.map((date) => manager.teamRef.collection('events').doc(
        `evt_${hash(`${teamId}|${operationId}|${date}`).slice(0, 28)}`,
      ));
      const snapshots = await Promise.all(refs.map((item) => transaction.get(item)));
      snapshots.forEach((snapshot, index) => {
        const date = recurrenceDates[index];
        if (snapshot.exists) {
          if (snapshot.data()?.clientOperationId !== operationId) throw alreadyExists('event_id_conflict');
          eventIds.push(snapshot.id);
          return;
        }
        const occurrence = normalizeClientScheduleInput({ ...(isRecord(data?.event) ? data.event : {}), date });
        transaction.create(snapshot.ref, eventFields({
          teamId,
          input: occurrence,
          userId,
          now,
          source: 'manual',
          existing: null,
          recurrenceGroupId,
          recurrenceIndex: recurrence ? index : null,
          clientOperationId: operationId,
        }));
        eventIds.push(snapshot.id);
      });
    }
    if (eventIds.length === 0) throw failedPrecondition('no_events_changed');
    transaction.create(operationRef, {
      teamId,
      operationType: eventId ? 'save' : recurrence ? 'recurrence' : 'create',
      eventIds,
      recurrenceGroupId: resolvedRecurrenceGroupId,
      notificationKind,
      notificationTitle: input.title,
      notifyTeam,
      createdBy: userId,
      createdAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + 30 * 24 * 60 * 60 * 1000),
    });
    return { eventIds, recurrenceGroupId: resolvedRecurrenceGroupId, replayed: false, notificationKind, notificationTitle: input.title };
  });
  if (!result.replayed && notifyTeam) {
    const teamSnapshot = await firestore().collection('teams').doc(teamId).get();
    await notifyScheduleMembers({
      teamId,
      teamName: typeof teamSnapshot.data()?.name === 'string' ? teamSnapshot.data()?.name : 'Team',
      actorUserId: userId,
      eventId: result.eventIds[0] ?? null,
      operationId,
      kind: result.notificationKind,
      eventTitle: result.notificationTitle,
      count: result.eventIds.length,
    });
  }
  return { eventIds: result.eventIds, recurrenceGroupId: result.recurrenceGroupId };
});

export const importTeamScheduleEvents = functions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const teamId = readId(data?.teamId, 'team ID');
  const operationId = readId(data?.clientOperationId, 'operation ID');
  const notifyTeam = data?.notifyTeam === true;
  const rows: unknown[] = Array.isArray(data?.rows) ? data.rows : [];
  if (rows.length === 0 || rows.length > MAX_SCHEDULE_IMPORT_ROWS) throw invalidArgument('import_row_limit');
  const seen = new Set<string>();
  let duplicateCount = 0;
  const normalizedRows: NormalizedImportRow[] = rows.map((row: unknown, index: number) => {
    const record = isRecord(row) ? row : {};
    const normalized = normalizeClientScheduleInput(record.draft);
    const fingerprint = hash(scheduleFingerprintCanonical(normalized));
    if (seen.has(fingerprint)) duplicateCount += 1;
    seen.add(fingerprint);
    return { normalized, fingerprint, rowNumber: Number.isInteger(record.rowNumber) ? Number(record.rowNumber) : index + 2 };
  }).filter((row: NormalizedImportRow, index: number, all: NormalizedImportRow[]) =>
    all.findIndex((candidate: NormalizedImportRow) => candidate.fingerprint === row.fingerprint) === index);
  const operationRef = firestore().collection('teamScheduleOperations').doc(operationDocumentId(teamId, operationId));
  const result = await firestore().runTransaction(async (transaction) => {
    const replay = await transaction.get(operationRef);
    if (replay.exists) {
      const stored = replay.data() ?? {};
      return {
        createdCount: Number(stored.createdCount) || 0,
        unchangedCount: Number(stored.unchangedCount) || 0,
        duplicateCount: Number(stored.duplicateCount) || 0,
        eventIds: readStoredIds(stored.eventIds),
        replayed: true,
      };
    }
    const manager = await assertScheduleManager(transaction, teamId, userId);
    const refs = normalizedRows.map((row) => manager.teamRef.collection('events').doc(`csv_${row.fingerprint.slice(0, 28)}`));
    const snapshots = await Promise.all(refs.map((item) => transaction.get(item)));
    const now = Timestamp.now();
    const eventIds: string[] = [];
    let createdCount = 0;
    let unchangedCount = 0;
    snapshots.forEach((snapshot, index) => {
      const row = normalizedRows[index];
      if (snapshot.exists) {
        unchangedCount += 1;
        return;
      }
      transaction.create(snapshot.ref, {
        ...eventFields({
          teamId,
          input: row.normalized,
          userId,
          now,
          source: 'csv',
          existing: null,
          recurrenceGroupId: null,
          recurrenceIndex: null,
          clientOperationId: operationId,
        }),
        importFingerprint: row.fingerprint,
        importRowNumber: row.rowNumber,
      });
      createdCount += 1;
      eventIds.push(snapshot.id);
    });
    transaction.create(operationRef, {
      teamId,
      operationType: 'csvImport',
      eventIds,
      createdCount,
      unchangedCount,
      duplicateCount,
      notifyTeam,
      createdBy: userId,
      createdAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + 30 * 24 * 60 * 60 * 1000),
    });
    return { createdCount, unchangedCount, duplicateCount, eventIds, replayed: false };
  });
  if (!result.replayed && notifyTeam && result.createdCount > 0) {
    const teamSnapshot = await firestore().collection('teams').doc(teamId).get();
    await notifyScheduleMembers({
      teamId,
      teamName: typeof teamSnapshot.data()?.name === 'string' ? teamSnapshot.data()?.name : 'Team',
      actorUserId: userId,
      eventId: result.eventIds[0] ?? null,
      operationId,
      kind: 'imported',
      eventTitle: '',
      count: result.createdCount,
    });
  }
  return {
    createdCount: result.createdCount,
    unchangedCount: result.unchangedCount,
    duplicateCount: result.duplicateCount,
    eventIds: result.eventIds,
  };
});

export const deleteTeamScheduleEvent = functions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const teamId = readId(data?.teamId, 'team ID');
  const eventId = readId(data?.eventId, 'event ID');
  const eventRef = firestore().collection('teams').doc(teamId).collection('events').doc(eventId);
  await firestore().runTransaction(async (transaction) => {
    await assertScheduleManager(transaction, teamId, userId);
    const snapshot = await transaction.get(eventRef);
    if (!snapshot.exists) return;
    if (snapshot.data()?.sourceType === 'ics-feed') throw failedPrecondition('detach_synced_event_first');
    const now = Timestamp.now();
    const auditRef = firestore().collection('teamScheduleAudit').doc(
      `delete_${hash(`${teamId}|${eventId}|${now.toMillis()}`).slice(0, 32)}`,
    );
    transaction.create(auditRef, {
      action: 'deleted',
      teamId,
      eventId,
      actorUserId: userId,
      eventSnapshot: snapshot.data(),
      createdAt: now,
    });
    transaction.delete(eventRef);
  });
  return { deleted: true };
});

export const detachTeamScheduleEvent = functions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const teamId = readId(data?.teamId, 'team ID');
  const eventId = readId(data?.eventId, 'event ID');
  const eventRef = firestore().collection('teams').doc(teamId).collection('events').doc(eventId);
  await firestore().runTransaction(async (transaction) => {
    await assertScheduleManager(transaction, teamId, userId);
    const snapshot = await transaction.get(eventRef);
    if (!snapshot.exists) throw notFound('event_not_found');
    const value = snapshot.data() ?? {};
    if (value.sourceType !== 'ics-feed') return;
    transaction.set(eventRef, {
      source: 'manual',
      sourceType: 'manual',
      sourceIntegrationId: null,
      detachedExternalUid: value.externalUid ?? null,
      externalUid: null,
      externalKey: null,
      recurrenceId: null,
      detachedFromSourceAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      updatedBy: userId,
      revision: Number.isInteger(value.revision) ? Number(value.revision) + 1 : 1,
    }, { merge: true });
  });
  return { detached: true };
});

async function assertScheduleManager(
  transaction: FirebaseFirestore.Transaction,
  teamId: string,
  userId: string,
): Promise<ManagerContext> {
  const teamRef = firestore().collection('teams').doc(teamId);
  const memberRef = teamRef.collection('members').doc(userId);
  const [teamSnapshot, memberSnapshot] = await Promise.all([
    transaction.get(teamRef),
    transaction.get(memberRef),
  ]);
  if (!teamSnapshot.exists || !memberSnapshot.exists) throw permissionDenied('team_access_denied');
  const team = teamSnapshot.data() ?? {};
  const membership = memberSnapshot.data() ?? {};
  if (membership.status !== 'active' || !hasCoachAccess(membership)) throw permissionDenied('team_access_denied');
  if (team.status === 'archived') throw failedPrecondition('team_archived');
  return {
    teamName: typeof team.name === 'string' && team.name.trim() ? team.name.trim() : 'Team',
    teamRef,
  };
}

function eventFields(input: {
  teamId: string;
  input: NormalizedScheduleInput;
  userId: string;
  now: Timestamp;
  source: 'manual' | 'csv';
  existing: Record<string, unknown> | null;
  recurrenceGroupId: string | null;
  recurrenceIndex: number | null;
  clientOperationId: string;
}) {
  const previousHistory = Array.isArray(input.existing?.statusHistory)
    ? input.existing.statusHistory.slice(-(MAX_HISTORY_ENTRIES - 1))
    : [];
  const statusChanged = !input.existing || input.existing.status !== input.input.status;
  const statusHistory = statusChanged
    ? [...previousHistory, { status: input.input.status, changedAt: input.now, changedBy: input.userId }]
    : previousHistory;
  return {
    teamId: input.teamId,
    type: input.input.type,
    title: input.input.title,
    localDate: input.input.localDate,
    startAt: Timestamp.fromMillis(input.input.startAtMillis),
    endAt: Timestamp.fromMillis(input.input.endAtMillis),
    arrivalAt: input.input.arrivalAtMillis === null ? null : Timestamp.fromMillis(input.input.arrivalAtMillis),
    timezone: input.input.timezone,
    isAllDay: input.input.isAllDay,
    opponentName: input.input.opponentName,
    homeAway: input.input.homeAway,
    venueName: input.input.venueName,
    field: input.input.field,
    address: input.input.address,
    status: input.input.status,
    teamScore: input.input.teamScore,
    opponentScore: input.input.opponentScore,
    notes: input.input.notes,
    source: input.source,
    externalId: input.existing?.externalId ?? null,
    importFingerprint: input.source === 'csv' ? input.existing?.importFingerprint ?? null : null,
    sourceUpdatedAt: input.now,
    recurrenceGroupId: input.recurrenceGroupId,
    recurrenceIndex: input.recurrenceIndex,
    clientOperationId: input.clientOperationId,
    createdBy: input.existing?.createdBy ?? input.userId,
    updatedBy: input.userId,
    createdAt: input.existing?.createdAt ?? input.now,
    updatedAt: input.now,
    cancelledAt: input.input.status === 'cancelled' ? input.existing?.cancelledAt ?? input.now : null,
    revision: Number.isInteger(input.existing?.revision) ? Number(input.existing?.revision) + 1 : 1,
    statusHistory,
  };
}

export async function notifyScheduleMembers(input: {
  teamId: string;
  teamName: string;
  actorUserId: string;
  eventId: string | null;
  operationId: string;
  kind: string;
  eventTitle: string;
  count: number;
}) {
  const bodyKeyByKind: Record<string, string> = {
    new: 'notifications.types.teamScheduleNewBody',
    timeChanged: 'notifications.types.teamScheduleTimeChangedBody',
    venueChanged: 'notifications.types.teamScheduleVenueChangedBody',
    postponed: 'notifications.types.teamSchedulePostponedBody',
    cancelled: 'notifications.types.teamScheduleCancelledBody',
  };
  const bodyKey = input.kind === 'imported'
    ? 'notifications.types.teamScheduleImportBody'
    : bodyKeyByKind[input.kind] ?? 'notifications.types.teamScheduleUpdatedBody';
  const membersSnapshot = await firestore().collection('teams').doc(input.teamId).collection('members')
    .where('status', '==', 'active').limit(MAX_ACTIVE_TEAM_MEMBERS).get();
  const members = membersSnapshot.docs.filter((item) => item.id !== input.actorUserId);
  for (let offset = 0; offset < members.length; offset += 200) {
    const batch = firestore().batch();
    members.slice(offset, offset + 200).forEach((member) => {
      const membership = member.data();
      const activeMode = hasCoachAccess(membership) ? 'coach' : 'parent';
      const notificationId = `teamSchedule_${hash(`${input.teamId}|${input.operationId}|${member.id}`).slice(0, 40)}`;
      batch.set(firestore().collection('userNotifications').doc(member.id).collection('notifications').doc(notificationId), {
        recipientUserId: member.id,
        type: 'teamScheduleEvent',
        titleKey: input.kind === 'imported' ? 'notifications.types.teamScheduleImportTitle' : 'notifications.types.teamScheduleTitle',
        bodyKey,
        params: {
          teamName: input.teamName,
          eventTitle: input.eventTitle,
          count: input.count,
        },
        teamId: input.teamId,
        eventId: input.eventId,
        activeMode,
        actorUserId: input.actorUserId,
        createdAt: FieldValue.serverTimestamp(),
        readAt: null,
        isRead: false,
        dismissedAt: null,
        dismissReason: null,
        status: 'active',
        expiresAt: Timestamp.fromMillis(Date.now() + 180 * 24 * 60 * 60 * 1000),
      });
    });
    await batch.commit();
  }
  await Promise.allSettled(members.map((member) => sendPushToUser(member.id, {
    type: 'teamScheduleEvent',
    teamId: input.teamId,
    eventId: input.eventId ?? '',
    activeMode: hasCoachAccess(member.data()) ? 'coach' : 'parent',
    notificationId: `teamSchedule_${hash(`${input.teamId}|${input.operationId}|${member.id}`).slice(0, 40)}`,
  })));
}

function authenticatedUserId(context: firebaseFunctions.https.CallableContext) {
  const userId = context.auth?.uid;
  if (!userId) throw new functions.https.HttpsError('unauthenticated', 'Sign in to manage a Team schedule.');
  return userId;
}

function normalizeClientScheduleInput(value: unknown) {
  try {
    return normalizeScheduleInput(value);
  } catch (error) {
    throw invalidArgument(validationReason(error));
  }
}

function generateClientRecurrenceDates(startDate: string, weekdays: unknown, endDate: unknown) {
  try {
    return generateWeeklyScheduleDates(startDate, weekdays, endDate);
  } catch (error) {
    throw invalidArgument(validationReason(error));
  }
}

function validationReason(error: unknown) {
  const reason = error instanceof Error ? error.message : "schedule_validation_failed";
  return /^[a-z0-9_]{1,80}$/u.test(reason) ? reason : "schedule_validation_failed";
}

function hasCoachAccess(membership: Record<string, unknown>) {
  const roles = isRecord(membership.roles) ? membership.roles : {};
  return roles.coach === true || roles.staff === true || membership.role === 'coach' || membership.role === 'assistantCoach' || membership.role === 'teamParent';
}

function readId(value: unknown, label: string) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) throw invalidArgument(`invalid_${label.replace(/\s+/gu, '_')}`);
  return id;
}

function operationDocumentId(teamId: string, operationId: string) {
  return `schedule_${hash(`${teamId}|${operationId}`).slice(0, 48)}`;
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function timestampMillis(value: unknown) {
  return value instanceof Timestamp ? value.toMillis() : 0;
}

function readStoredIds(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidArgument(reason: string) {
  return new functions.https.HttpsError('invalid-argument', 'The schedule information is invalid.', { reason });
}

function permissionDenied(reason: string) {
  return new functions.https.HttpsError('permission-denied', 'This Team schedule is unavailable.', { reason });
}

function failedPrecondition(reason: string) {
  return new functions.https.HttpsError('failed-precondition', 'The schedule change cannot be completed.', { reason });
}

function notFound(reason: string) {
  return new functions.https.HttpsError('not-found', 'The schedule event could not be found.', { reason });
}

function alreadyExists(reason: string) {
  return new functions.https.HttpsError('already-exists', 'The schedule event already exists.', { reason });
}
