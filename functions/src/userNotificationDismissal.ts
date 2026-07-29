import * as admin from 'firebase-admin';
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as firebaseFunctions from 'firebase-functions';

import {
  getNotificationCleanupReason,
  isVisibleStoredNotification,
  normalizeNotificationId,
} from './notificationDismissalCore';
import { permanentAccountFunctions } from './permanentAuth';

const functions = permanentAccountFunctions(firebaseFunctions);

const notificationFunctions = functions.region('us-central1');
const PAGE_SIZE = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

export const acknowledgeNotificationOpened = notificationFunctions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in is required.');
  const notificationId = normalizeNotificationId(data?.notificationId);
  if (!notificationId) throw new functions.https.HttpsError('invalid-argument', 'A valid notificationId is required.');

  const ref = admin.firestore()
    .collection('userNotifications')
    .doc(uid)
    .collection('notifications')
    .doc(notificationId);

  return admin.firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return { status: 'notFound' as const };
    const existing = snapshot.data() ?? {};
    if (!isVisibleStoredNotification(existing)) return { status: 'alreadyDismissed' as const };

    transaction.update(ref, {
      isRead: true,
      readAt: existing.readAt ?? FieldValue.serverTimestamp(),
      dismissedAt: FieldValue.serverTimestamp(),
      dismissReason: 'opened',
    });
    return { status: 'dismissed' as const };
  });
});

export const clearUserNotifications = notificationFunctions.https.onCall(async (_data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in is required.');
  const collection = admin.firestore()
    .collection('userNotifications')
    .doc(uid)
    .collection('notifications');

  let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
  let clearedCount = 0;
  do {
    let query: admin.firestore.Query = collection.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;

    const visible = page.docs.filter((document) => isVisibleStoredNotification(document.data()));
    if (visible.length > 0) {
      const batch = admin.firestore().batch();
      visible.forEach((document) => {
        const existing = document.data();
        batch.update(document.ref, {
          isRead: true,
          readAt: existing.readAt ?? FieldValue.serverTimestamp(),
          dismissedAt: FieldValue.serverTimestamp(),
          dismissReason: 'clearAll',
        });
      });
      await batch.commit();
      clearedCount += visible.length;
    }
    cursor = page.docs.at(-1);
    if (page.size < PAGE_SIZE) break;
  } while (cursor);

  console.info('[clearUserNotifications] completed', { clearedCount });
  return { clearedCount };
});

export const cleanupExpiredUserNotifications = notificationFunctions.pubsub
  .schedule('15 3 * * *')
  .timeZone('Etc/UTC')
  .onRun(async () => {
    const now = Date.now();
    const firestore = admin.firestore();
    const counts = { dismissed30d: 0, legacyRead30d: 0, unresolved90d: 0 };

    await deleteMatchingPages(
      () => firestore.collectionGroup('notifications')
        .where('dismissedAt', '<=', Timestamp.fromMillis(now - 30 * DAY_MS)),
      'dismissedAt',
      now,
      'dismissed30d',
      counts,
    );
    await deleteMatchingPages(
      () => firestore.collectionGroup('notifications')
        .where('readAt', '<=', Timestamp.fromMillis(now - 30 * DAY_MS)),
      'readAt',
      now,
      'legacyRead30d',
      counts,
    );
    await deleteMatchingPages(
      () => firestore.collectionGroup('notifications')
        .where('createdAt', '<=', Timestamp.fromMillis(now - 90 * DAY_MS)),
      'createdAt',
      now,
      'unresolved90d',
      counts,
    );

    console.info('[cleanupExpiredUserNotifications] completed', counts);
    return counts;
  });

async function deleteMatchingPages(
  queryFactory: () => admin.firestore.Query,
  orderField: string,
  now: number,
  reason: keyof { dismissed30d: number; legacyRead30d: number; unresolved90d: number },
  counts: { dismissed30d: number; legacyRead30d: number; unresolved90d: number },
) {
  let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
  do {
    let query = queryFactory().orderBy(orderField).orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    const matches = page.docs.filter((document) => (
      isPersonalNotificationPath(document.ref.path) &&
      getNotificationCleanupReason(document.data(), now) === reason
    ));
    if (matches.length > 0) {
      const batch = admin.firestore().batch();
      matches.forEach((document) => batch.delete(document.ref));
      await batch.commit();
      counts[reason] += matches.length;
    }
    cursor = page.docs.at(-1);
    if (page.size < PAGE_SIZE) break;
  } while (cursor);
}

function isPersonalNotificationPath(path: string) {
  const segments = path.split('/');
  return segments.length === 4 && segments[0] === 'userNotifications' && segments[2] === 'notifications';
}
