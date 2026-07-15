import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { auth, db, functions } from "@/config/firebase";
import { formatFriendRequestSenderName } from "@/utils/friendPrivacy";
import {
  countVisibleNotifications,
  getNotificationDestination,
  isVisibleNotification,
  normalizeNotificationId,
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
  dismissedAt: Date | null;
  hasDismissedAtField: boolean;
  dismissReason: "opened" | "clearAll" | "resolved" | null;
  status: "active" | "dismissed";
  actorUserId: string | null;
  actorDisplayName: string | null;
  teamId: string | null;
  announcementId: string | null;
  friendRequestId: string | null;
  conversationId: string | null;
  expiresAt: Date | null;
};

export type NotificationOpenTarget = {
  notificationId: string | null;
  route: string;
};

type FirestoreDate = Date | { toDate?: () => Date } | null | undefined;
type AcknowledgeStatus = "dismissed" | "alreadyDismissed" | "notFound";
const RETRY_QUEUE_KEY = "@sideline-social/notification-dismissal-retry-ids-v1";
const MAX_RETRY_IDS = 50;
const locallyHiddenNotificationKeys = new Set<string>();
const localVisibilityListeners = new Set<() => void>();
let retryInFlight: Promise<void> | null = null;

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
    dismissedAt: toDate(data.dismissedAt as FirestoreDate),
    hasDismissedAtField: Object.prototype.hasOwnProperty.call(data, "dismissedAt"),
    dismissReason: data.dismissReason === "opened" || data.dismissReason === "clearAll" || data.dismissReason === "resolved"
      ? data.dismissReason
      : null,
    status: data.status === "dismissed" ? "dismissed" : "active",
    actorUserId: typeof data.actorUserId === "string" ? data.actorUserId : null,
    actorDisplayName,
    teamId: typeof data.teamId === "string" ? data.teamId : null,
    announcementId: typeof data.announcementId === "string" ? data.announcementId : null,
    friendRequestId: typeof data.friendRequestId === "string" ? data.friendRequestId : null,
    conversationId: typeof data.conversationId === "string" ? data.conversationId : null,
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
  let latest: AppNotification[] = [];
  const emitVisible = () => onNext(latest.filter((item) => (
    isVisibleNotification(item) && !isNotificationHiddenForSession(userId, item.id)
  )));
  const snapshotUnsubscribe = onSnapshot(
    query(notificationCollection(userId), orderBy("createdAt", "desc"), limit(100)),
    (snapshot) => {
      latest = snapshot.docs
        .map(toNotification)
        .filter((item): item is AppNotification => Boolean(item));
      emitVisible();
    },
    (error) => {
      logNotificationIssue("subscribeInbox", error);
      onError?.();
    },
  );
  localVisibilityListeners.add(emitVisible);
  void retryPendingNotificationAcknowledgements();
  return () => {
    snapshotUnsubscribe();
    localVisibilityListeners.delete(emitVisible);
  };
}

export function subscribeToUnreadNotificationCount(
  userId: string,
  onNext: (count: number) => void,
): Unsubscribe {
  let latest: AppNotification[] = [];
  const emitCount = () => onNext(countVisibleNotifications(
    latest.filter((item) => !isNotificationHiddenForSession(userId, item.id)),
  ));
  const snapshotUnsubscribe = onSnapshot(
    query(notificationCollection(userId), orderBy("createdAt", "desc"), limit(100)),
    (snapshot) => {
      latest = snapshot.docs
        .map(toNotification)
        .filter((item): item is AppNotification => Boolean(item));
      emitCount();
    },
    (error) => logNotificationIssue("subscribeUnreadCount", error),
  );
  localVisibilityListeners.add(emitCount);
  return () => {
    snapshotUnsubscribe();
    localVisibilityListeners.delete(emitCount);
  };
}

export async function acknowledgeNotificationAfterOpen(notificationIdValue: unknown) {
  const notificationId = normalizeNotificationId(notificationIdValue);
  if (!notificationId) return { status: "notFound" as const, queued: false };

  hideNotificationForSession(notificationId);
  try {
    const status = await callAcknowledgeNotification(notificationId);
    await removeRetryIds([notificationId]);
    return { status, queued: false };
  } catch (error) {
    const temporary = isTemporaryNotificationError(error);
    if (temporary) await enqueueRetryId(notificationId);
    else await removeRetryIds([notificationId]);
    logNotificationIssue(temporary ? "acknowledgeQueued" : "acknowledgePermanentFailure", error);
    return { status: "notFound" as const, queued: temporary };
  }
}

export async function clearAllNotifications(visibleNotificationIds: string[] = []) {
  const callable = httpsCallable<Record<string, never>, { clearedCount: number }>(functions, "clearUserNotifications");
  const result = await callable({});
  visibleNotificationIds.forEach(hideNotificationForSession);
  return Number.isFinite(result.data.clearedCount) ? Math.max(0, result.data.clearedCount) : 0;
}

export function retryPendingNotificationAcknowledgements() {
  if (retryInFlight) return retryInFlight;
  retryInFlight = retryQueuedAcknowledgements().finally(() => {
    retryInFlight = null;
  });
  return retryInFlight;
}

export function getNotificationOpenTargetFromData(
  data: (NotificationNavigationData & { notificationId?: unknown }) | null | undefined,
): NotificationOpenTarget | null {
  const route = getNotificationDestination(data ?? {});
  if (!route) return null;
  const notificationId = normalizeNotificationId(data?.notificationId);
  return {
    notificationId,
    route: notificationId
      ? `${route}${route.includes("?") ? "&" : "?"}notificationId=${encodeURIComponent(notificationId)}`
      : route,
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

function hideNotificationForSession(notificationId: string) {
  const userId = auth.currentUser?.uid;
  if (!userId) return;
  locallyHiddenNotificationKeys.add(`${userId}:${notificationId}`);
  localVisibilityListeners.forEach((listener) => listener());
}

function isNotificationHiddenForSession(userId: string, notificationId: string) {
  return locallyHiddenNotificationKeys.has(`${userId}:${notificationId}`);
}

async function callAcknowledgeNotification(notificationId: string) {
  const callable = httpsCallable<{ notificationId: string }, { status: AcknowledgeStatus }>(
    functions,
    "acknowledgeNotificationOpened",
  );
  const result = await callable({ notificationId });
  return result.data.status;
}

async function retryQueuedAcknowledgements() {
  const ids = await readRetryIds();
  if (ids.length === 0) return;
  const removable: string[] = [];
  for (const notificationId of ids) {
    try {
      await callAcknowledgeNotification(notificationId);
      hideNotificationForSession(notificationId);
      removable.push(notificationId);
    } catch (error) {
      if (!isTemporaryNotificationError(error)) removable.push(notificationId);
      logNotificationIssue("retryAcknowledgement", error);
    }
  }
  await removeRetryIds(removable);
}

async function readRetryIds() {
  try {
    const queueKey = getRetryQueueKey();
    if (!queueKey) return [];
    const stored = await AsyncStorage.getItem(queueKey);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.map(normalizeNotificationId).filter((id): id is string => Boolean(id))))
      .slice(-MAX_RETRY_IDS);
  } catch (error) {
    logNotificationIssue("readRetryQueue", error);
    return [];
  }
}

async function enqueueRetryId(notificationId: string) {
  const queueKey = getRetryQueueKey();
  if (!queueKey) return;
  const ids = (await readRetryIds()).filter((id) => id !== notificationId);
  ids.push(notificationId);
  await AsyncStorage.setItem(queueKey, JSON.stringify(ids.slice(-MAX_RETRY_IDS)));
}

async function removeRetryIds(notificationIds: string[]) {
  if (notificationIds.length === 0) return;
  const queueKey = getRetryQueueKey();
  if (!queueKey) return;
  const removing = new Set(notificationIds);
  const remaining = (await readRetryIds()).filter((id) => !removing.has(id));
  if (remaining.length === 0) await AsyncStorage.removeItem(queueKey);
  else await AsyncStorage.setItem(queueKey, JSON.stringify(remaining));
}

function getRetryQueueKey() {
  const userId = auth.currentUser?.uid;
  return userId ? `${RETRY_QUEUE_KEY}:${userId}` : null;
}

function isTemporaryNotificationError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  return [
    "functions/cancelled",
    "functions/deadline-exceeded",
    "functions/internal",
    "functions/resource-exhausted",
    "functions/unavailable",
    "functions/unknown",
    "auth/network-request-failed",
  ].includes(code);
}
