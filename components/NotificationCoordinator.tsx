import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { router, usePathname } from "expo-router";
import * as Notifications from "expo-notifications";

import { useAuth } from "@/context/AuthContext";
import i18n from "@/i18n";
import {
  getNotificationOpenTargetFromData,
  markNotificationRead,
  registerDeviceNotificationToken,
} from "@/services/notificationService";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowAlert: true,
  }),
});

export function NotificationCoordinator() {
  const { user } = useAuth();
  const pathname = usePathname();
  const handledResponses = useRef(new Set<string>());

  useEffect(() => {
    handledResponses.current.clear();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    void registerDeviceToken();
    const tokenSubscription = Notifications.addPushTokenListener((token) => {
      registerDeviceNotificationToken(token)
        .catch((error) => console.warn("[Notifications] token refresh error:", getErrorCode(error)));
    });
    return () => tokenSubscription.remove();
  }, [user?.uid]);

  useEffect(() => {
    // The root index owns cold-start notification routing. Waiting until it
    // leaves "/" prevents the normal signed-in redirect from winning a race.
    if (!user?.uid || pathname === "/") return;

    const openResponse = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const identifier = response.notification.request.identifier;
      if (handledResponses.current.has(identifier)) return;
      const target = getNotificationOpenTargetFromData(response.notification.request.content.data);
      if (!target) return;

      handledResponses.current.add(identifier);
      if (target.notificationId) {
        markNotificationRead(user.uid, target.notificationId)
          .catch((error) => console.warn("[Notifications] mark push read error:", getErrorCode(error)));
      }
      Notifications.clearLastNotificationResponseAsync()
        .catch((error) => console.warn("[Notifications] clear response error:", getErrorCode(error)));
      router.push(target.route as never);
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(openResponse);
    return () => subscription.remove();
  }, [pathname, user?.uid]);

  return null;
}

async function registerDeviceToken() {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("coach-updates", {
        name: i18n.t("myTeams.coachUpdates"),
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const currentPermission = await Notifications.getPermissionsAsync();
    const permission = currentPermission.status === "granted"
      ? currentPermission
      : await Notifications.requestPermissionsAsync();
    if (permission.status !== "granted") return;

    await registerDeviceNotificationToken();
  } catch (error) {
    console.warn("[Notifications] registration unavailable:", getErrorCode(error));
  }
}
function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}
