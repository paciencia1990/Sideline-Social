import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import * as https from 'node:https';

import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as firebaseFunctions from 'firebase-functions';

import { permanentAccountFunctions, resolveAccountStanding } from './permanentAuth';
import { notifyScheduleMembers } from './teamSchedule';
import {
  isBlockedCalendarAddress,
  MAX_ICS_BYTES,
  normalizeCalendarFeedUrl,
  parseTeamCalendarIcs,
  serializeTeamScheduleIcs,
  type ExternalCalendarEvent,
} from './teamCalendarCore';

const functions = permanentAccountFunctions(firebaseFunctions, 'communication');
const calendarFunctions = functions.region('us-central1').runWith({
  timeoutSeconds: 60,
  memory: '256MB',
  secrets: ['TEAM_CALENDAR_FEED_ENCRYPTION_KEY'],
});
const rawCalendarFunctions = firebaseFunctions.region('us-central1').runWith({ timeoutSeconds: 60, memory: '256MB' });
const INTEGRATIONS = 'teamCalendarIntegrations';
const LEASES = 'teamCalendarSyncLeases';
const SUBSCRIPTIONS = 'teamCalendarSubscriptions';
const SUBSCRIPTION_OWNERS = 'teamCalendarSubscriptionOwners';
const AUDIT = 'teamCalendarSyncAudit';
const PREVIEWS = 'teamCalendarImportPreviews';
const RATE_LIMITS = 'teamCalendarRateLimits';
const SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000;
const PREVIEW_TTL_MS = 15 * 60 * 1000;
const MAX_FEEDS_PER_JOB = 10;

type Manager = { teamRef: FirebaseFirestore.DocumentReference; teamName: string };
type FetchResult = { body: string | null; etag: string | null; lastModified: string | null; notModified: boolean };

function firestore() { return admin.firestore(); }

export const previewTeamScheduleIcs = calendarFunctions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const teamId = readId(data?.teamId);
  await assertScheduleManager(teamId, userId);
  await enforceRateLimit(userId, 'ics-preview', 10, 15 * 60 * 1000);
  const ics = readIcsText(data?.ics);
  const parsed = parseTeamCalendarIcs(ics);
  const previewId = `prev_${randomBytes(18).toString('hex')}`;
  await firestore().collection(PREVIEWS).doc(previewId).create({
    teamId,
    userId,
    sourceType: 'ics-file',
    ics,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + PREVIEW_TTL_MS),
  });
  return { previewId, events: previewEvents(parsed.events), rejectedCount: parsed.rejectedCount, warnings: parsed.warnings };
});

export const importTeamScheduleIcs = calendarFunctions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const teamId = readId(data?.teamId);
  const previewId = readId(data?.previewId);
  const manager = await assertScheduleManager(teamId, userId);
  const preview = await firestore().collection(PREVIEWS).doc(previewId).get();
  const previewData = preview.data() ?? {};
  if (!preview.exists || previewData.teamId !== teamId || previewData.userId !== userId || timestampMillis(previewData.expiresAt) <= Date.now()) {
    throw failedPrecondition('import_authorization_changed');
  }
  const parsed = parseTeamCalendarIcs(readIcsText(previewData.ics));
  const selected = selectedKeys(data?.selectedKeys, parsed.events);
  const result = await applyExternalEvents({
    teamId,
    actorUserId: userId,
    integrationId: `file_${hash(parsed.events.map((event) => event.uid).sort().join('|')).slice(0, 32)}`,
    sourceType: 'ics-file',
    events: selected,
    markRemoved: false,
  });
  if (data?.notifyTeam === true && result.created > 0) await notifyScheduleMembers({ teamId, teamName: manager.teamName, actorUserId: userId, eventId: result.eventIds[0] ?? null, operationId: previewId, kind: 'imported', eventTitle: '', count: result.created });
  await preview.ref.delete();
  return { ...result, rejected: parsed.rejectedCount + (parsed.events.length - selected.length) };
});

export const connectTeamCalendarFeed = calendarFunctions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const teamId = readId(data?.teamId);
  await assertScheduleManager(teamId, userId);
  await enforceRateLimit(userId, 'feed-connect', 5, 60 * 60 * 1000);
  const normalized = normalizeCalendarFeedUrl(data?.url);
  assertAllowedHostname(normalized.hostname);
  const fetched = await fetchCalendar(normalized.url, {});
  if (!fetched.body) throw failedPrecondition('feed_empty');
  const parsed = parseTeamCalendarIcs(fetched.body);
  const replaceIntegrationId = typeof data?.replaceIntegrationId === 'string' ? readId(data.replaceIntegrationId) : null;
  const replacement = replaceIntegrationId ? await firestore().collection(INTEGRATIONS).doc(replaceIntegrationId).get() : null;
  if (replacement && (!replacement.exists || replacement.data()?.teamId !== teamId || !['connected', 'attention'].includes(replacement.data()?.status))) throw permissionDenied('feed_access_denied');
  const integrationId = replaceIntegrationId ?? `cal_${hash(`${teamId}|${normalized.fingerprint}`).slice(0, 32)}`;
  const encrypted = encryptSecret(normalized.url.href);
  const credentialFields = replacement ? {
    pendingEncryptedUrl: encrypted.encryptedUrl,
    pendingIv: encrypted.iv,
    pendingAuthTag: encrypted.authTag,
    pendingEncryptionVersion: encrypted.encryptionVersion,
    pendingHostname: normalized.hostname,
    pendingUrlFingerprint: normalized.fingerprint,
    replacementPending: true,
  } : {
    ...encrypted,
    hostname: normalized.hostname,
    urlFingerprint: normalized.fingerprint,
    status: 'pending',
  };
  await firestore().collection(INTEGRATIONS).doc(integrationId).set({
    teamId,
    ...credentialFields,
    automaticSyncEnabled: false,
    consecutiveFailureCount: 0,
    etag: fetched.etag,
    lastModifiedHeader: fetched.lastModified,
    pendingIcs: fetched.body,
    pendingExpiresAt: Timestamp.fromMillis(Date.now() + PREVIEW_TTL_MS),
    createdBy: userId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { integrationId, hostname: normalized.hostname, events: previewEvents(parsed.events), rejectedCount: parsed.rejectedCount, warnings: parsed.warnings };
});

export const confirmTeamCalendarFeed = calendarFunctions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const teamId = readId(data?.teamId);
  const integrationId = readId(data?.integrationId);
  const manager = await assertScheduleManager(teamId, userId);
  const ref = firestore().collection(INTEGRATIONS).doc(integrationId);
  const snapshot = await ref.get();
  const integration = snapshot.data() ?? {};
  const replacing = integration.replacementPending === true;
  if (!snapshot.exists || integration.teamId !== teamId || (integration.status !== 'pending' && !replacing) || timestampMillis(integration.pendingExpiresAt) <= Date.now()) {
    throw failedPrecondition('feed_preview_expired');
  }
  const parsed = parseTeamCalendarIcs(readIcsText(integration.pendingIcs));
  const selected = selectedKeys(data?.selectedKeys, parsed.events);
  const result = await applyExternalEvents({ teamId, actorUserId: userId, integrationId, sourceType: 'ics-feed', events: selected, markRemoved: replacing });
  if (data?.notifyTeam === true && result.created > 0) await notifyScheduleMembers({ teamId, teamName: manager.teamName, actorUserId: userId, eventId: result.eventIds[0] ?? null, operationId: integrationId, kind: 'imported', eventTitle: '', count: result.created });
  const now = Timestamp.now();
  await ref.set({
    status: 'connected',
    ...(replacing ? {
      encryptedUrl: integration.pendingEncryptedUrl,
      iv: integration.pendingIv,
      authTag: integration.pendingAuthTag,
      encryptionVersion: integration.pendingEncryptionVersion,
      hostname: integration.pendingHostname,
      urlFingerprint: integration.pendingUrlFingerprint,
      pendingEncryptedUrl: FieldValue.delete(),
      pendingIv: FieldValue.delete(),
      pendingAuthTag: FieldValue.delete(),
      pendingEncryptionVersion: FieldValue.delete(),
      pendingHostname: FieldValue.delete(),
      pendingUrlFingerprint: FieldValue.delete(),
      replacementPending: FieldValue.delete(),
    } : {}),
    automaticSyncEnabled: data?.automaticSyncEnabled === true && automaticSyncFeatureEnabled(),
    pendingIcs: FieldValue.delete(),
    pendingExpiresAt: FieldValue.delete(),
    lastSuccessfulSyncAt: now,
    lastAttemptedSyncAt: now,
    nextSyncAt: Timestamp.fromMillis(now.toMillis() + jitteredSyncInterval(integrationId)),
    lastSummary: result,
    updatedAt: now,
  }, { merge: true });
  return { ...result, rejected: parsed.rejectedCount + (parsed.events.length - selected.length), automaticSyncEnabled: data?.automaticSyncEnabled === true && automaticSyncFeatureEnabled() };
});

export const getTeamCalendarConnection = calendarFunctions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const teamId = readId(data?.teamId);
  await assertScheduleManager(teamId, userId);
  const snapshot = await firestore().collection(INTEGRATIONS).where('teamId', '==', teamId).limit(5).get();
  const connected = snapshot.docs.find((document) => ['connected', 'attention'].includes(document.data().status));
  if (!connected) return { connection: null, automaticSyncAvailable: automaticSyncFeatureEnabled() };
  const value = connected.data();
  return {
    connection: {
      integrationId: connected.id,
      hostname: value.hostname,
      status: value.status,
      automaticSyncEnabled: value.automaticSyncEnabled === true,
      lastSuccessfulSyncAt: timestampMillis(value.lastSuccessfulSyncAt) || null,
      lastAttemptedSyncAt: timestampMillis(value.lastAttemptedSyncAt) || null,
      nextSyncAt: timestampMillis(value.nextSyncAt) || null,
      summary: isRecord(value.lastSummary) ? value.lastSummary : null,
    },
    automaticSyncAvailable: automaticSyncFeatureEnabled(),
  };
});

export const syncTeamCalendarFeedNow = calendarFunctions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const teamId = readId(data?.teamId);
  const integrationId = readId(data?.integrationId);
  await assertScheduleManager(teamId, userId);
  await enforceRateLimit(`${userId}_${teamId}`, 'manual-sync', 4, 60 * 60 * 1000);
  return syncIntegration(integrationId, userId, true);
});

export const setTeamCalendarAutomaticSync = calendarFunctions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const teamId = readId(data?.teamId);
  const integrationId = readId(data?.integrationId);
  await assertScheduleManager(teamId, userId);
  const enabled = data?.enabled === true;
  if (enabled && !automaticSyncFeatureEnabled()) throw failedPrecondition('automatic_sync_not_approved');
  const ref = firestore().collection(INTEGRATIONS).doc(integrationId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.teamId !== teamId) throw permissionDenied('feed_access_denied');
  await ref.set({ automaticSyncEnabled: enabled, nextSyncAt: Timestamp.fromMillis(Date.now() + jitteredSyncInterval(integrationId)), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { automaticSyncEnabled: enabled };
});

export const disconnectTeamCalendarFeed = calendarFunctions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const teamId = readId(data?.teamId);
  const integrationId = readId(data?.integrationId);
  await assertScheduleManager(teamId, userId);
  const removeEvents = data?.removeEvents === true;
  const ref = firestore().collection(INTEGRATIONS).doc(integrationId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.teamId !== teamId) throw permissionDenied('feed_access_denied');
  const events = await firestore().collection('teams').doc(teamId).collection('events').where('sourceIntegrationId', '==', integrationId).limit(250).get();
  const now = Timestamp.now();
  for (let offset = 0; offset < events.docs.length; offset += 400) {
    const batch = firestore().batch();
    events.docs.slice(offset, offset + 400).forEach((event) => batch.set(event.ref, removeEvents ? {
      status: 'cancelled', archivedFromSchedule: true, cancelledAt: now, sourceDisconnectedAt: now, updatedAt: now,
    } : {
      sourceType: 'manual', sourceIntegrationId: null, externalUid: null, recurrenceId: null, detachedFromSourceAt: now, updatedAt: now,
    }, { merge: true }));
    await batch.commit();
  }
  await ref.set({ status: 'disconnected', automaticSyncEnabled: false, encryptedUrl: FieldValue.delete(), iv: FieldValue.delete(), authTag: FieldValue.delete(), disconnectedAt: now, updatedAt: now }, { merge: true });
  return { affectedEvents: events.size, removed: removeEvents };
});

export const createTeamCalendarSubscription = calendarFunctions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const teamId = readId(data?.teamId);
  const team = await assertScheduleMember(teamId, userId);
  await enforceRateLimit(`${userId}_${teamId}`, 'subscription-create', 5, 24 * 60 * 60 * 1000);
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hash(token);
  const ownerId = `${teamId}_${userId}`;
  const ownerRef = firestore().collection(SUBSCRIPTION_OWNERS).doc(ownerId);
  const owner = await ownerRef.get();
  const previousHash = typeof owner.data()?.tokenHash === 'string' ? owner.data()?.tokenHash : null;
  const batch = firestore().batch();
  if (previousHash) batch.set(firestore().collection(SUBSCRIPTIONS).doc(previousHash), { status: 'revoked', revokedAt: FieldValue.serverTimestamp() }, { merge: true });
  batch.set(firestore().collection(SUBSCRIPTIONS).doc(tokenHash), { tokenHash, teamId, userId, status: 'active', createdAt: FieldValue.serverTimestamp(), lastAccessedAt: null });
  batch.set(ownerRef, { teamId, userId, tokenHash, status: 'active', updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  const httpsUrl = subscriptionUrl(token);
  return { httpsUrl, webcalUrl: httpsUrl.replace(/^https:/u, 'webcal:'), teamName: team.teamName };
});

export const revokeTeamCalendarSubscription = calendarFunctions.https.onCall(async (data, context) => {
  const userId = authenticatedUserId(context);
  const teamId = readId(data?.teamId);
  await assertScheduleMember(teamId, userId);
  const ownerRef = firestore().collection(SUBSCRIPTION_OWNERS).doc(`${teamId}_${userId}`);
  const owner = await ownerRef.get();
  const tokenHash = owner.data()?.tokenHash;
  const batch = firestore().batch();
  if (typeof tokenHash === 'string') batch.set(firestore().collection(SUBSCRIPTIONS).doc(tokenHash), { status: 'revoked', revokedAt: FieldValue.serverTimestamp() }, { merge: true });
  batch.set(ownerRef, { status: 'revoked', tokenHash: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  return { revoked: true };
});

export const teamCalendarSubscription = rawCalendarFunctions.https.onRequest(async (request, response) => {
  response.set('X-Content-Type-Options', 'nosniff');
  response.set('Referrer-Policy', 'no-referrer');
  response.set('Cache-Control', 'private, max-age=300, must-revalidate');
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.status(405).send('Method not allowed'); return; }
  const token = typeof request.query.token === 'string' ? request.query.token : '';
  if (!/^[A-Za-z0-9_-]{40,64}$/u.test(token)) { response.status(404).send('Calendar unavailable'); return; }
  const tokenHash = hash(token);
  const subscription = await firestore().collection(SUBSCRIPTIONS).doc(tokenHash).get();
  const value = subscription.data() ?? {};
  if (!subscription.exists || value.status !== 'active') { response.status(404).send('Calendar unavailable'); return; }
  if (!(await subscriptionAccessAllowed(value.teamId, value.userId))) { response.status(404).send('Calendar unavailable'); return; }
  if (!(await consumePublicRateLimit(tokenHash))) { response.set('Retry-After', '900'); response.status(429).send('Try again later'); return; }
  const [team, events] = await Promise.all([
    firestore().collection('teams').doc(value.teamId).get(),
    firestore().collection('teams').doc(value.teamId).collection('events').orderBy('startAt', 'asc').limit(500).get(),
  ]);
  const body = serializeTeamScheduleIcs({
    calendarName: typeof team.data()?.name === 'string' ? `${team.data()?.name} - Sideline Social` : 'Sideline Social Team Schedule',
    domain: 'calendar.sidelinesocial.app',
    events: events.docs.filter((event) => event.data().archivedFromSchedule !== true).map((event) => ({
      id: event.id,
      title: safeString(event.data().title, 'Team event'),
      startAtMillis: timestampMillis(event.data().startAt),
      endAtMillis: timestampMillis(event.data().endAt),
      timezone: safeString(event.data().timezone, 'UTC'),
      isAllDay: event.data().isAllDay === true,
      location: [event.data().venueName, event.data().field, event.data().address].filter((part) => typeof part === 'string' && part.trim()).join(' - ') || null,
      notes: typeof event.data().notes === 'string' ? event.data().notes : null,
      status: event.data().status,
      revision: event.data().revision,
      updatedAtMillis: timestampMillis(event.data().updatedAt),
    })).filter((event) => event.startAtMillis > 0 && event.endAtMillis > event.startAtMillis),
  });
  const etag = `"${hash(body)}"`;
  if (request.get('if-none-match') === etag) { response.status(304).end(); return; }
  response.set('Content-Type', 'text/calendar; charset=utf-8');
  response.set('ETag', etag);
  response.set('Last-Modified', new Date(Math.max(team.updateTime?.toMillis() ?? 0, ...events.docs.map((event) => timestampMillis(event.data().updatedAt)))).toUTCString());
  await subscription.ref.set({ lastAccessedAt: FieldValue.serverTimestamp() }, { merge: true });
  if (request.method === 'HEAD') response.status(200).end(); else response.status(200).send(body);
});

export const syncTeamCalendarFeeds = calendarFunctions.pubsub.schedule('every 4 hours').onRun(async () => {
  if (!automaticSyncFeatureEnabled()) return null;
  const due = await firestore().collection(INTEGRATIONS)
    .where('automaticSyncEnabled', '==', true)
    .where('nextSyncAt', '<=', Timestamp.now())
    .orderBy('nextSyncAt', 'asc')
    .limit(MAX_FEEDS_PER_JOB)
    .get();
  for (const integration of due.docs) {
    try { await syncIntegration(integration.id, 'scheduled-sync', false); } catch { /* privacy-safe status is recorded by syncIntegration */ }
  }
  return null;
});

async function syncIntegration(integrationId: string, actorUserId: string, manual: boolean) {
  const leaseId = integrationId;
  const leaseRef = firestore().collection(LEASES).doc(leaseId);
  const leaseToken = randomBytes(12).toString('hex');
  const acquired = await firestore().runTransaction(async (transaction) => {
    const lease = await transaction.get(leaseRef);
    if (lease.exists && timestampMillis(lease.data()?.expiresAt) > Date.now()) return false;
    transaction.set(leaseRef, { integrationId, leaseToken, acquiredAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 2 * 60 * 1000) });
    return true;
  });
  if (!acquired) throw failedPrecondition('sync_in_progress');
  const ref = firestore().collection(INTEGRATIONS).doc(integrationId);
  const attemptedAt = Timestamp.now();
  try {
    const snapshot = await ref.get();
    const value = snapshot.data() ?? {};
    if (!snapshot.exists || !['connected', 'attention'].includes(value.status)) throw failedPrecondition('feed_not_connected');
    if (!manual && value.automaticSyncEnabled !== true) throw failedPrecondition('automatic_sync_disabled');
    const url = new URL(decryptSecret(value));
    const fetched = await fetchCalendar(url, { etag: safeString(value.etag), lastModified: safeString(value.lastModifiedHeader) });
    const result = fetched.notModified
      ? { created: 0, updated: 0, cancelled: 0, unchanged: 0, rejected: 0 }
      : await applyExternalEvents({
        teamId: readId(value.teamId),
        actorUserId,
        integrationId,
        sourceType: 'ics-feed',
        events: parseTeamCalendarIcs(readIcsText(fetched.body)).events,
        markRemoved: true,
      });
    const completedAt = Timestamp.now();
    await ref.set({
      status: 'connected',
      consecutiveFailureCount: 0,
      lastAttemptedSyncAt: attemptedAt,
      lastSuccessfulSyncAt: completedAt,
      nextSyncAt: Timestamp.fromMillis(completedAt.toMillis() + jitteredSyncInterval(integrationId)),
      etag: fetched.etag ?? value.etag ?? null,
      lastModifiedHeader: fetched.lastModified ?? value.lastModifiedHeader ?? null,
      lastSummary: result,
      updatedAt: completedAt,
    }, { merge: true });
    await recordSyncAudit(integrationId, value.teamId, 'success', result);
    return result;
  } catch (error) {
    const snapshot = await ref.get();
    const failures = Math.min(10, Number(snapshot.data()?.consecutiveFailureCount ?? 0) + 1);
    const classification = safeSyncError(error);
    await ref.set({
      status: failures >= 5 ? 'attention' : snapshot.data()?.status ?? 'attention',
      automaticSyncEnabled: failures >= 5 ? false : snapshot.data()?.automaticSyncEnabled === true,
      consecutiveFailureCount: failures,
      lastAttemptedSyncAt: attemptedAt,
      nextSyncAt: Timestamp.fromMillis(Date.now() + retryDelay(failures, integrationId)),
      lastErrorClassification: classification,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await recordSyncAudit(integrationId, snapshot.data()?.teamId, classification, null);
    throw failedPrecondition(classification);
  } finally {
    const lease = await leaseRef.get();
    if (lease.data()?.leaseToken === leaseToken) await leaseRef.delete();
  }
}

async function applyExternalEvents(input: { teamId: string; actorUserId: string; integrationId: string; sourceType: 'ics-file' | 'ics-feed'; events: ExternalCalendarEvent[]; markRemoved: boolean }) {
  const teamRef = firestore().collection('teams').doc(input.teamId);
  const existing = await teamRef.collection('events').where('sourceIntegrationId', '==', input.integrationId).limit(250).get();
  const byExternalKey = new Map(existing.docs.map((document) => [safeString(document.data().externalKey), document]));
  const seen = new Set<string>();
  const now = Timestamp.now();
  let created = 0; let updated = 0; let cancelled = 0; let unchanged = 0;
  const eventIds: string[] = [];
  const writes: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> = [];
  input.events.forEach((event) => {
    seen.add(event.key);
    const previous = byExternalKey.get(event.key);
    if (previous && previous.data().sourceHash === event.sourceHash) { unchanged += 1; return; }
    const ref = previous?.ref ?? teamRef.collection('events').doc(`ics_${hash(`${input.integrationId}|${event.key}`).slice(0, 32)}`);
    eventIds.push(ref.id);
    if (!previous) created += 1; else updated += 1;
    if (event.status === 'cancelled' && previous?.data().status !== 'cancelled') cancelled += 1;
    writes.push({ ref, data: externalEventFields(input, event, previous?.data() ?? null, now) });
  });
  if (input.markRemoved) existing.docs.forEach((document) => {
    if (seen.has(safeString(document.data().externalKey)) || document.data().status === 'cancelled') return;
    cancelled += 1;
    writes.push({ ref: document.ref, data: { status: 'cancelled', removedFromSourceAt: now, cancelledAt: document.data().cancelledAt ?? now, updatedAt: now, sourceUpdatedAt: now, revision: Number(document.data().revision ?? 0) + 1 } });
  });
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = firestore().batch();
    writes.slice(offset, offset + 400).forEach((write) => batch.set(write.ref, write.data, { merge: true }));
    await batch.commit();
  }
  return { created, updated, cancelled, unchanged, rejected: 0, eventIds };
}

function externalEventFields(input: { teamId: string; actorUserId: string; integrationId: string; sourceType: 'ics-file' | 'ics-feed' }, event: ExternalCalendarEvent, existing: FirebaseFirestore.DocumentData | null, now: Timestamp) {
  return {
    teamId: input.teamId,
    type: event.type,
    title: event.title,
    localDate: formatDate(event.startAtMillis, event.timezone),
    startAt: Timestamp.fromMillis(event.startAtMillis),
    endAt: Timestamp.fromMillis(event.endAtMillis),
    arrivalAt: null,
    timezone: event.timezone,
    isAllDay: event.isAllDay,
    opponentName: null,
    homeAway: null,
    venueName: event.location,
    field: null,
    address: null,
    status: event.status,
    teamScore: existing?.teamScore ?? null,
    opponentScore: existing?.opponentScore ?? null,
    notes: existing?.notes ?? null,
    sourceDescription: event.description,
    localMetadata: existing?.localMetadata ?? null,
    sourceType: input.sourceType,
    source: input.sourceType === 'ics-file' ? 'ics-file' : 'ics-feed',
    sourceIntegrationId: input.integrationId,
    externalKey: event.key,
    externalUid: event.uid,
    recurrenceId: event.recurrenceId,
    sourceSequence: event.sequence,
    sourceHash: event.sourceHash,
    sourceLastModifiedAt: event.lastModifiedMillis ? Timestamp.fromMillis(event.lastModifiedMillis) : null,
    sourceUpdatedAt: now,
    importFingerprint: null,
    createdBy: existing?.createdBy ?? input.actorUserId,
    updatedBy: input.actorUserId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    cancelledAt: event.status === 'cancelled' ? existing?.cancelledAt ?? now : null,
    revision: Number(existing?.revision ?? 0) + 1,
  };
}

async function fetchCalendar(initialUrl: URL, conditional: { etag?: string; lastModified?: string }, redirects = 0): Promise<FetchResult> {
  const normalized = normalizeCalendarFeedUrl(initialUrl.href);
  assertAllowedHostname(normalized.hostname);
  const addresses = await lookup(normalized.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => isBlockedCalendarAddress(entry.address))) throw failedPrecondition('feed_address_blocked');
  const pinned = addresses[0];
  const result = await requestPinned(normalized.url, pinned.address, pinned.family, conditional);
  if (result.redirect) {
    if (redirects >= 2) throw failedPrecondition('feed_redirect_limit');
    return fetchCalendar(new URL(result.redirect, normalized.url), conditional, redirects + 1);
  }
  if (result.status === 304) return { body: null, etag: result.etag, lastModified: result.lastModified, notModified: true };
  if (result.status < 200 || result.status >= 300) throw failedPrecondition('feed_http_error');
  const contentType = result.contentType.toLocaleLowerCase('en-US');
  if (!contentType.includes('text/calendar') && !contentType.includes('application/ics') && !/^\s*BEGIN:VCALENDAR/iu.test(result.body)) throw failedPrecondition('feed_content_type_invalid');
  return { body: result.body, etag: result.etag, lastModified: result.lastModified, notModified: false };
}

function requestPinned(url: URL, address: string, family: number, conditional: { etag?: string; lastModified?: string }): Promise<{ status: number; body: string; contentType: string; etag: string | null; lastModified: string | null; redirect: string | null }> {
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: 'https:', hostname: url.hostname, servername: url.hostname, port: 443, path: `${url.pathname}${url.search}`, method: 'GET',
      headers: { Accept: 'text/calendar, application/ics;q=0.9', 'User-Agent': 'Sideline-Social-Calendar/1.0', ...(conditional.etag ? { 'If-None-Match': conditional.etag } : {}), ...(conditional.lastModified ? { 'If-Modified-Since': conditional.lastModified } : {}) },
      lookup: (_hostname, _options, callback) => callback(null, address, family as 4 | 6),
    }, (response) => {
      const chunks: Buffer[] = []; let bytes = 0;
      response.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_ICS_BYTES) { request.destroy(calendarError('feed_response_too_large')); return; } chunks.push(chunk); });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), contentType: safeHeader(response.headers['content-type']), etag: safeHeader(response.headers.etag) || null, lastModified: safeHeader(response.headers['last-modified']) || null, redirect: safeHeader(response.headers.location) || null }));
    });
    request.setTimeout(10_000, () => request.destroy(calendarError('feed_timeout')));
    request.on('error', reject);
    request.end();
  });
}

function encryptSecret(value: string) {
  const key = encryptionKey(); const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { encryptedUrl: encrypted.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), encryptionVersion: 1 };
}
function decryptSecret(value: Record<string, unknown>) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(readCipherPart(value.iv), 'base64'));
  decipher.setAuthTag(Buffer.from(readCipherPart(value.authTag), 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(readCipherPart(value.encryptedUrl), 'base64')), decipher.final()]).toString('utf8');
}
function encryptionKey() { const encoded = process.env.TEAM_CALENDAR_FEED_ENCRYPTION_KEY ?? ''; const key = Buffer.from(encoded, 'base64'); if (key.length !== 32) throw failedPrecondition('feed_encryption_not_configured'); return key; }
function readCipherPart(value: unknown) { if (typeof value !== 'string' || value.length > 4096) throw failedPrecondition('feed_credential_invalid'); return value; }

async function assertScheduleManager(teamId: string, userId: string): Promise<Manager> {
  const manager = await assertScheduleMember(teamId, userId);
  if (manager.teamStatus === 'archived' || !manager.canManage) throw permissionDenied('team_access_denied');
  return { teamRef: manager.teamRef, teamName: manager.teamName };
}
async function assertScheduleMember(teamId: string, userId: string) {
  const teamRef = firestore().collection('teams').doc(teamId);
  const [team, member] = await Promise.all([teamRef.get(), teamRef.collection('members').doc(userId).get()]);
  const membership = member.data() ?? {}; const roles = isRecord(membership.roles) ? membership.roles : {};
  if (!team.exists || !member.exists || membership.status !== 'active') throw permissionDenied('team_access_denied');
  return { teamRef, teamName: safeString(team.data()?.name, 'Team'), teamStatus: team.data()?.status === 'archived' ? 'archived' : 'active', canManage: roles.coach === true || roles.staff === true || ['coach', 'assistantCoach', 'teamParent'].includes(safeString(membership.role)) };
}

async function subscriptionAccessAllowed(teamIdValue: unknown, userIdValue: unknown) {
  try {
    const teamId = readId(teamIdValue); const userId = readId(userIdValue);
    const [member, team, standing] = await Promise.all([firestore().collection('teams').doc(teamId).collection('members').doc(userId).get(), firestore().collection('teams').doc(teamId).get(), resolveAccountStanding(userId)]);
    return member.exists && member.data()?.status === 'active' && team.exists && ['active', 'archived'].includes(team.data()?.status ?? 'active') && ['active', 'messagingRestricted'].includes(standing.effective);
  } catch { return false; }
}

async function enforceRateLimit(subject: string, action: string, maximum: number, windowMs: number) {
  const id = hash(`${subject}|${action}`); const ref = firestore().collection(RATE_LIMITS).doc(id); const now = Date.now();
  const allowed = await firestore().runTransaction(async (transaction) => { const snapshot = await transaction.get(ref); const value = snapshot.data() ?? {}; const start = timestampMillis(value.windowStartedAt); const reset = !start || start + windowMs <= now; const count = reset ? 0 : Number(value.count ?? 0); if (count >= maximum) return false; transaction.set(ref, { action, subjectHash: hash(subject), windowStartedAt: Timestamp.fromMillis(reset ? now : start), count: count + 1, expiresAt: Timestamp.fromMillis(now + windowMs * 2) }); return true; });
  if (!allowed) throw new firebaseFunctions.https.HttpsError('resource-exhausted', 'Rate limit reached.', { reason: 'calendar_rate_limited' });
}
async function consumePublicRateLimit(tokenHash: string) { try { await enforceRateLimit(tokenHash, 'subscription-read', 120, 60 * 60 * 1000); return true; } catch { return false; } }

async function recordSyncAudit(integrationId: string, teamId: unknown, classification: string, summary: unknown) { await firestore().collection(AUDIT).add({ integrationId, teamId: safeString(teamId), classification, summary: isRecord(summary) ? summary : null, createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 180 * 24 * 60 * 60 * 1000) }); }
function selectedKeys(value: unknown, events: ExternalCalendarEvent[]) { const allowed = new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []); if (allowed.size === 0 || allowed.size > events.length) throw invalidArgument('no_events_selected'); return events.filter((event) => allowed.has(event.key)); }
function previewEvents(events: ExternalCalendarEvent[]) { return events.map((event) => ({ key: event.key, title: event.title, startAtMillis: event.startAtMillis, endAtMillis: event.endAtMillis, timezone: event.timezone, isAllDay: event.isAllDay, location: event.location, status: event.status, type: event.type })); }
function readIcsText(value: unknown) { if (typeof value !== 'string') throw invalidArgument('ics_invalid_calendar'); if (Buffer.byteLength(value, 'utf8') > MAX_ICS_BYTES) throw invalidArgument('ics_file_too_large'); return value; }
function assertAllowedHostname(hostname: string) { const hosts = (process.env.TEAM_CALENDAR_FEED_ALLOWED_HOSTS ?? '').split(',').map((value) => value.trim().toLocaleLowerCase('en-US')).filter(Boolean); if (!hosts.includes(hostname)) throw failedPrecondition('feed_host_not_approved'); }
function automaticSyncFeatureEnabled() { return process.env.TEAM_CALENDAR_AUTOMATIC_SYNC_ENABLED === 'true'; }
function subscriptionUrl(token: string) { const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT; if (!project) throw failedPrecondition('subscription_endpoint_unavailable'); return `https://us-central1-${project}.cloudfunctions.net/teamCalendarSubscription?token=${encodeURIComponent(token)}`; }
function jitteredSyncInterval(seed: string) { const jitter = Number.parseInt(hash(seed).slice(0, 8), 16) % (30 * 60 * 1000); return SYNC_INTERVAL_MS + jitter; }
function retryDelay(failures: number, seed: string) { return Math.min(24 * 60 * 60 * 1000, (2 ** Math.min(failures, 6)) * 15 * 60 * 1000) + (Number.parseInt(hash(`${seed}|${failures}`).slice(0, 6), 16) % (10 * 60 * 1000)); }
function safeSyncError(error: unknown) { const value = error instanceof Error ? error.message : ''; return /^(feed|ics|automatic|sync)_[a-z_]+$/u.test(value) ? value : 'feed_sync_failed'; }
function authenticatedUserId(context: firebaseFunctions.https.CallableContext) { const userId = context.auth?.uid; if (!userId) throw new firebaseFunctions.https.HttpsError('unauthenticated', 'Sign in is required.'); return userId; }
function readId(value: unknown) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) throw invalidArgument('invalid_identifier'); return value; }
function safeString(value: unknown, fallback = '') { return typeof value === 'string' && value.trim() ? value.trim() : fallback; }
function safeHeader(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? '' : value ?? ''; }
function timestampMillis(value: unknown) { if (value instanceof Timestamp) return value.toMillis(); if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis(); return 0; }
function formatDate(value: number, timezone: string) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)); const map = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${map.year}-${map.month}-${map.day}`; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function calendarError(code: string) { const error = new Error(code); (error as { code?: string }).code = code; return error; }
function invalidArgument(reason: string) { return new firebaseFunctions.https.HttpsError('invalid-argument', 'Calendar request is invalid.', { reason }); }
function failedPrecondition(reason: string) { return new firebaseFunctions.https.HttpsError('failed-precondition', 'Calendar operation is unavailable.', { reason }); }
function permissionDenied(reason: string) { return new firebaseFunctions.https.HttpsError('permission-denied', 'Calendar access denied.', { reason }); }
