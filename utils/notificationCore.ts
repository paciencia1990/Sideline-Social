export const APP_NOTIFICATION_TYPES = [
  "coachAnnouncement",
  "teamPrivateMessage",
  "teamScheduleEvent",
  "friendChatMessage",
  "friendRequest",
  "friendRequestAccepted",
  "chatGroupInvitation",
  "squadAdminInvitation",
  "squadAdminInvitationAccepted",
  "squadAdminRecoveryRequested",
] as const;

export type AppNotificationType = (typeof APP_NOTIFICATION_TYPES)[number];

export type NotificationDestinationMode = "parent" | "coach";

export type NotificationNavigationData = {
  type?: unknown;
  teamId?: unknown;
  announcementId?: unknown;
  eventId?: unknown;
  conversationId?: unknown;
  conversationType?: unknown;
  activeMode?: unknown;
  squadId?: unknown;
  squadAdminInvitationId?: unknown;
};

export type UnreadNotificationLike = {
  dismissedAt?: unknown;
  hasDismissedAtField?: boolean;
  readAt?: unknown;
  isRead?: unknown;
  status?: unknown;
  expiresAt?: Date | null;
};

export type VisibleNotificationLike = UnreadNotificationLike;

function isValidRouteId(value: unknown): value is string {
  return typeof value === "string" && /^[^/]{1,128}$/u.test(value);
}

function readNotificationMode(value: unknown): NotificationDestinationMode | null {
  return value === "parent" || value === "coach" ? value : null;
}

function getPrivateMessageRecipientMode(data: NotificationNavigationData) {
  return readNotificationMode(data.conversationType) ?? readNotificationMode(data.activeMode) ?? "parent";
}

export function normalizeNotificationId(value: unknown) {
  return typeof value === "string" && /^[^/]{1,256}$/u.test(value) ? value : null;
}

export function getNotificationDestination(data: NotificationNavigationData): string | null {
  if (data.type === "coachAnnouncement" || data.type === "coach_update") {
    if (!isValidRouteId(data.teamId) || !isValidRouteId(data.announcementId)) return null;
    return `/teams/${encodeURIComponent(data.teamId)}/announcements/${encodeURIComponent(data.announcementId)}`;
  }

  if (data.type === "teamPrivateMessage") {
    if (!isValidRouteId(data.teamId)) return null;
    const teamId = encodeURIComponent(data.teamId);
    if (getPrivateMessageRecipientMode(data) === "coach") {
      return `/coach/team-messages?teamId=${teamId}&focus=privateMessages`;
    }
    return `/teams/${teamId}?focus=privateMessages`;
  }

  if (data.type === "teamScheduleEvent") {
    if (!isValidRouteId(data.teamId)) return null;
    const base = `/teams/${encodeURIComponent(data.teamId)}/schedule`;
    return isValidRouteId(data.eventId) ? `${base}/${encodeURIComponent(data.eventId)}` : base;
  }

  if (
    data.type === "friendRequest" ||
    data.type === "friendRequestAccepted" ||
    data.type === "friend_request" ||
    data.type === "friend_accepted"
  ) {
    return "/(tabs)/friends";
  }

  if (data.type === "chatGroupInvitation") {
    if (!isValidRouteId(data.conversationId)) return null;
    return `/(social)/chat/invitation/${encodeURIComponent(data.conversationId)}`;
  }

  if (
    data.type === "squadAdminInvitation" ||
    data.type === "squadAdminInvitationAccepted" ||
    data.type === "squadAdminRecoveryRequested"
  ) {
    if (!isValidRouteId(data.squadId)) return null;
    return `/(social)/squad-detail?squadId=${encodeURIComponent(data.squadId)}`;
  }

  if (data.type === "friendChatMessage") {
    if (!isValidRouteId(data.conversationId)) return null;
    return `/(social)/chat/${encodeURIComponent(data.conversationId)}`;
  }

  return null;
}

export function getNotificationDestinationMode(data: NotificationNavigationData): NotificationDestinationMode | null {
  if (data.type === "teamPrivateMessage" && isValidRouteId(data.teamId)) {
    return getPrivateMessageRecipientMode(data);
  }
  if (data.type === "teamScheduleEvent" && isValidRouteId(data.teamId)) {
    return readNotificationMode(data.activeMode);
  }
  return null;
}

export function isUnreadActiveNotification(notification: UnreadNotificationLike, now = Date.now()) {
  return isVisibleNotification(notification, now) && notification.readAt == null && notification.isRead !== true;
}

export function isVisibleNotification(notification: VisibleNotificationLike, now = Date.now()) {
  const active = notification.status === undefined || notification.status === "active";
  const unexpired = !notification.expiresAt || notification.expiresAt.getTime() > now;
  if (!active || !unexpired) return false;

  if (notification.hasDismissedAtField === true) return notification.dismissedAt == null;
  if (notification.dismissedAt != null) return false;

  // Legacy documents did not have dismissedAt. Preserve the old behavior:
  // unread legacy alerts are visible and read legacy alerts are hidden.
  return notification.readAt == null && notification.isRead !== true;
}

export function countUnreadNotifications(notifications: UnreadNotificationLike[]) {
  return notifications.filter((notification) => isUnreadActiveNotification(notification)).length;
}

export function countVisibleNotifications(notifications: VisibleNotificationLike[]) {
  return notifications.filter((notification) => isVisibleNotification(notification)).length;
}

export function formatUnreadBadgeCount(count: number) {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return safeCount > 99 ? "99+" : String(safeCount);
}
