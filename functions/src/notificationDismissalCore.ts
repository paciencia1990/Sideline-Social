export type StoredNotificationLike = {
  createdAt?: unknown;
  dismissedAt?: unknown;
  expiresAt?: unknown;
  isRead?: unknown;
  readAt?: unknown;
  status?: unknown;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function normalizeNotificationId(value: unknown) {
  if (typeof value !== 'string' || !/^[^/]{1,256}$/u.test(value)) return null;
  return value;
}

export function toTimestampMillis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  return null;
}

export function isVisibleStoredNotification(notification: StoredNotificationLike, now = Date.now()) {
  if (notification.status === 'dismissed') return false;
  const expiresAt = toTimestampMillis(notification.expiresAt);
  if (expiresAt !== null && expiresAt <= now) return false;

  if (hasOwn(notification, 'dismissedAt')) return notification.dismissedAt == null;

  // Compatibility for documents written before explicit dismissal fields:
  // unread legacy alerts stay visible, while already-read alerts stay hidden.
  return notification.isRead !== true && notification.readAt == null;
}

export type NotificationCleanupReason = 'dismissed30d' | 'legacyRead30d' | 'unresolved90d' | null;

export function getNotificationCleanupReason(
  notification: StoredNotificationLike,
  now = Date.now(),
): NotificationCleanupReason {
  const dismissedAt = toTimestampMillis(notification.dismissedAt);
  if (dismissedAt !== null && dismissedAt <= now - 30 * DAY_MS) return 'dismissed30d';

  const isLegacy = !hasOwn(notification, 'dismissedAt');
  const readAt = toTimestampMillis(notification.readAt);
  if (isLegacy && notification.isRead === true && readAt !== null && readAt <= now - 30 * DAY_MS) {
    return 'legacyRead30d';
  }

  const createdAt = toTimestampMillis(notification.createdAt);
  if (notification.dismissedAt == null && createdAt !== null && createdAt <= now - 90 * DAY_MS) {
    return 'unresolved90d';
  }
  return null;
}
