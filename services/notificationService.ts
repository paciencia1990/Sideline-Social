import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "@/config/firebase";
import { formatFriendRequestSenderName } from "@/utils/friendPrivacy";
import {
  countUnreadNotifications,
  getNotificationDestination,
  type AppNotificationType,
  type NotificationNavigationData,
} from "@/utils/notificationCore";

export type AppNotification = {
  id: string;
  recipientUserId: string;
  type: AppNotificationType;
  titleKey: string;
  bodyKey: string;
  params: Record<string, string | number>;
  createdAt: Date;
  readAt: Date | null;
  isRead: boolean;
  status: "active" | "dismissed";
  actorUserId: string | null;
  actorDisplayName: string | null;
  teamId: string | null;
  announcementId: string | null;
  friendRequestId: string | null;
  expiresAt: Date | null;
};

export type NotificationOpenTarget = {
  notificationId: string | null;
  route: string;
};

type FirestoreDate = Date | { toDate?: () => Date } | null | undefined;

function toDate(value: FirestoreDate) {
  if (value instanceof Date) return value;
  return typeof value?.toDate === "function" ? value.toDate() : null;
}

function toNotification(snapshot: QueryDocumentSnapshot<DocumentData>): AppNotification | null {
  const data = snapshot.data();
  if (
    typeof data.recipientUserId !== "string" ||
    typeof data.type !== "string" ||
    typeof data.titleKey !== "string" ||
    typeof data.bodyKey !== "string"
  ) {
    return null;
  }

  const actorDisplayName = formatFriendRequestSenderName(
    typeof data.actorDisplayName === "string" ? data.actorDisplayName : null,
    "",
  ) || null;
  const params = typeof data.params === "object" && data.params
    ? data.params as Record<string, string | number>
    : {};

  return {
    id: snapshot.id,
    recipientUserId: data.recipientUserId,
    type: data.type as AppNotificationType,
    titleKey: data.titleKey,
    bodyKey: data.bodyKey,
    params: actorDisplayName ? { ...params, actorName: actorDisplayName } : params,
    createdAt: toDate(data.createdAt as FirestoreDate) ?? new Date(0),
    readAt: toDate(data.readAt as FirestoreDate),
    isRead: data.isRead === true,
    status: data.status === "dismissed" ? "dismissed" : "active",
    actorUserId: typeof data.actorUserId === "string" ? data.actorUserId : null,
    actorDisplayName,
    teamId: typeof data.teamId === "string" ? data.teamId : null,
    announcementId: typeof data.announcementId === "string" ? data.announcementId : null,
    friendRequestId: typeof data.friendRequestId === "string" ? data.friendRequestId : null,
    expiresAt: toDate(data.expiresAt as FirestoreDate),
  };
}

function notificationCollection(userId: string) {
  return collection(db, "userNotifications", userId, "notifications");
}

export function subscribeToNotifications(
  userId: string,
  onNext: (notifications: AppNotification[]) => void,
  onError?: () => void,
): Unsubscribe {
  return onSnapshot(
    query(notificationCollection(userId), orderBy("createdAt", "desc"), limit(100)),
    (snapshot) => {
      const now = Date.now();
      const notifications = snapshot.docs
        .map(toNotification)
        .filter((item): item is AppNotification => Boolean(item))
        .filter((item) => item.status === "active" && (!item.expiresAt || item.expiresAt.getTime() > now));
      onNext(notifications);
    },
    (error) => {
      logNotificationIssue("subscribeInbox", error);
      onError?.();
    },
  );
}

export function subscribeToUnreadNotificationCount(
  userId: string,
  onNext: (count: number) => void,
): Unsubscribe {
  return onSnapshot(
    query(notificationCollection(userId), where("readAt", "==", null), limit(100)),
    (snapshot) => {
      const notifications = snapshot.docs
        .map(toNotification)
        .filter((item): item is AppNotification => Boolean(item));
      onNext(countUnreadNotifications(notifications));
    },
    (error) => logNotificationIssue("subscribeUnreadCount", error),
  );
}

export async function markNotificationRead(userId: string, notificationId: string) {
  await updateDoc(doc(db, "userNotifications", userId, "notifications", notificationId), {
    isRead: true,
    readAt: serverTimestamp(),
  });
}

export async function markAllNotificationsRead(userId: string) {
  const snapshot = await getDocs(query(notificationCollection(userId), where("readAt", "==", null), limit(100)));
  const unread = snapshot.docs
    .map((notificationDocument) => ({ notificationDocument, notification: toNotification(notificationDocument) }))
    .filter(({ notification }) => notification?.status === "active" && notification.readAt == null);
  if (unread.length === 0) return 0;

  const batch = writeBatch(db);
  unread.forEach(({ notificationDocument }) => {
    batch.update(notificationDocument.ref, { isRead: true, readAt: serverTimestamp() });
  });
  await batch.commit();
  return unread.length;
}

export function getNotificationOpenTargetFromData(
  data: (NotificationNavigationData & { notificationId?: unknown }) | null | undefined,
): NotificationOpenTarget | null {
  const route = getNotificationDestination(data ?? {});
  if (!route) return null;
  return {
    notificationId: typeof data?.notificationId === "string" ? data.notificationId : null,
    route,
  };
}

export async function getPendingNotificationOpenTarget() {
  const response = await Notifications.getLastNotificationResponseAsync();
  const target = getNotificationOpenTargetFromData(
    response?.notification.request.content.data as NotificationNavigationData & { notificationId?: unknown },
  );
  if (!target) return null;

  await Notifications.clearLastNotificationResponseAsync();
  return target;
}

// Compatibility exports for existing tests and callers while all notification
// types now share the centralized resolver above.
export function getCoachUpdateRouteFromNotificationData(data: NotificationNavigationData | null | undefined) {
  return getNotificationOpenTargetFromData(data)?.route ?? null;
}

export async function getPendingCoachUpdateRoute() {
  return (await getPendingNotificationOpenTarget())?.route ?? null;
}

export async function registerDeviceNotificationToken(token?: Notifications.DevicePushToken) {
  if (Platform.OS !== "android") return;
  const nextToken = token ?? await Notifications.getDevicePushTokenAsync();
  if (nextToken.type !== "android" || typeof nextToken.data !== "string" || !nextToken.data) return;

  const callable = httpsCallable<
    { token: string; platform: "android" },
    { registered: boolean }
  >(functions, "registerDeviceNotificationToken");
  await callable({ token: nextToken.data, platform: "android" });
}

export async function unregisterCurrentDeviceNotificationToken() {
  if (Platform.OS !== "android") return;
  const token = await Notifications.getDevicePushTokenAsync();
  if (token.type !== "android" || typeof token.data !== "string" || !token.data) return;

  const callable = httpsCallable<
    { token: string },
    { unregistered: boolean }
  >(functions, "unregisterDeviceNotificationToken");
  await callable({ token: token.data });
}

function logNotificationIssue(operation: string, error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  console.warn("[NotificationService] operation failed", { operation, code });
}
