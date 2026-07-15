import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export function friendRequestNotificationId(requestId: string, createdAtMillis: number | string) {
  return `friendRequest_${requestId}_${createdAtMillis}`;
}

export async function resolveFriendRequestNotification(
  recipientUserId: string,
  requestId: string,
  explicitNotificationId?: string | null,
) {
  if (!recipientUserId || !requestId) return 0;
  const notifications = admin.firestore()
    .collection('userNotifications')
    .doc(recipientUserId)
    .collection('notifications');
  const documents = new Map<string, admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot>();

  if (explicitNotificationId) {
    const direct = await notifications.doc(explicitNotificationId).get();
    if (direct.exists) documents.set(direct.id, direct);
  }
  const legacyMatches = await notifications
    .where('friendRequestId', '==', requestId)
    .limit(20)
    .get();
  legacyMatches.docs.forEach((document) => documents.set(document.id, document));

  const active = Array.from(documents.values()).filter((document) => {
    const data = document.data() ?? {};
    return data.type === 'friendRequest' && data.dismissedAt == null && data.status !== 'dismissed';
  });
  if (active.length === 0) return 0;

  const batch = admin.firestore().batch();
  active.forEach((document) => batch.update(document.ref, {
    isRead: true,
    readAt: document.data()?.readAt ?? FieldValue.serverTimestamp(),
    dismissedAt: FieldValue.serverTimestamp(),
    dismissReason: 'resolved',
    status: 'dismissed',
  }));
  await batch.commit();
  return active.length;
}
