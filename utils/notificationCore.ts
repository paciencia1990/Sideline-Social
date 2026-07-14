export const APP_NOTIFICATION_TYPES = [
  "coachAnnouncement",
  "friendRequest",
  "friendRequestAccepted",
] as const;

export type AppNotificationType = (typeof APP_NOTIFICATION_TYPES)[number];

export type NotificationNavigationData = {
  type?: unknown;
  teamId?: unknown;
  announcementId?: unknown;
};

export type UnreadNotificationLike = {
  readAt?: unknown;
  isRead?: unknown;
  status?: unknown;
  expiresAt?: Date | null;
};

function isValidRouteId(value: unknown): value is string {
  return typeof value === "string" && /^[^/]{1,128}$/u.test(value);
}

export function getNotificationDestination(data: NotificationNavigationData): string | null {
  if (data.type === "coachAnnouncement" || data.type === "coach_update") {
    if (!isValidRouteId(data.teamId) || !isValidRouteId(data.announcementId)) return null;
    return `/teams/${encodeURIComponent(data.teamId)}/announcements/${encodeURIComponent(data.announcementId)}`;
  }

  if (
    data.type === "friendRequest" ||
    data.type === "friendRequestAccepted" ||
    data.type === "friend_request" ||
    data.type === "friend_accepted"
  ) {
    return "/(tabs)/friends";
  }

  return null;
}

export function isUnreadActiveNotification(notification: UnreadNotificationLike, now = Date.now()) {
  const active = notification.status === undefined || notification.status === "active";
  const unread = notification.readAt == null && notification.isRead !== true;
  const unexpired = !notification.expiresAt || notification.expiresAt.getTime() > now;
  return active && unread && unexpired;
}

export function countUnreadNotifications(notifications: UnreadNotificationLike[]) {
  return notifications.filter((notification) => isUnreadActiveNotification(notification)).length;
}

export function formatUnreadBadgeCount(count: number) {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return safeCount > 99 ? "99+" : String(safeCount);
}
