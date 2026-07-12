import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { httpsCallable } from "firebase/functions";

import { functions } from "@/config/firebase";
import { getCoachUpdateRoute } from "@/services/parentTeamService";

type CoachUpdateNotificationData = {
  type?: unknown;
  teamId?: unknown;
  announcementId?: unknown;
};

export function getCoachUpdateRouteFromNotificationData(data: CoachUpdateNotificationData | null | undefined) {
  if (
    data?.type !== "coach_update" ||
    typeof data.teamId !== "string" ||
    typeof data.announcementId !== "string"
  ) {
    return null;
  }

  return getCoachUpdateRoute(data.teamId, data.announcementId);
}

export async function getPendingCoachUpdateRoute() {
  const response = await Notifications.getLastNotificationResponseAsync();
  const route = getCoachUpdateRouteFromNotificationData(
    response?.notification.request.content.data as CoachUpdateNotificationData | undefined,
  );
  if (!route) return null;

  await Notifications.clearLastNotificationResponseAsync();
  return route;
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
