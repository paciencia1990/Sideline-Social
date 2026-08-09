import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { router, usePathname } from "expo-router";
import * as Notifications from "expo-notifications";

import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import i18n from "@/i18n";
import { isViewingFriendConversation } from "@/services/chatService";
import {
  getNotificationOpenTargetFromData,
  registerDeviceNotificationToken,
  retryPendingNotificationAcknowledgements,
} from "@/services/notificationService";

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const shouldShowAlert = !isViewingFriendConversation(notification.request.content.data);
    return {
      shouldPlaySound: false,
      shouldSetBadge: shouldShowAlert,
      shouldShowAlert,
      shouldShowBanner: shouldShowAlert,
      shouldShowList: shouldShowAlert,
    };
  },
});

export function NotificationCoordinator() {
  const { activeMode, modeHydrated, setActiveMode } = useApp();
  const { user } = useAuth();
  const pathname = usePathname();
  const handledResponses = useRef(new Set<string>());
  const lastResponseOpenAt = useRef(0);

  useEffect(() => {
    handledResponses.current.clear();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    void retryPendingNotificationAcknowledgements();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void retryPendingNotificationAcknowledgements();
    });
    return () => subscription.remove();
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
    if (!user?.uid || !modeHydrated || pathname === "/") return;
    void retryPendingNotificationAcknowledgements();

    const openResponse = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const openedAt = Date.now();
      if (openedAt - lastResponseOpenAt.current < 750) {
        void Notifications.clearLastNotificationResponseAsync();
        return;
      }
      const identifier = response.notification.request.identifier;
      if (handledResponses.current.has(identifier)) return;
      const target = getNotificationOpenTargetFromData(response.notification.request.content.data, { activeMode });
      if (!target) return;

      handledResponses.current.add(identifier);
      lastResponseOpenAt.current = openedAt;
      void retryPendingNotificationAcknowledgements();
      Notifications.clearLastNotificationResponseAsync()
        .catch((error) => console.warn("[Notifications] clear response error:", getErrorCode(error)));
      if (target.requiredMode && target.requiredMode !== activeMode) {
        setActiveMode(target.requiredMode);
        setTimeout(() => router.push(target.route as never), 0);
      } else {
        router.push(target.route as never);
      }
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(openResponse);
    return () => subscription.remove();
  }, [activeMode, modeHydrated, pathname, setActiveMode, user?.uid]);

  return null;
}

async function registerDeviceToken() {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("coach-updates", {
        name: i18n.t("myTeams.coachUpdates"),
        importance: Notifications.AndroidImportance.HIGH,
      });
      await Notifications.setNotificationChannelAsync("chat-messages", {
        name: i18n.t("chat.title"),
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const permission = await Notifications.getPermissionsAsync();
    if (permission.status !== "granted") return;

    await registerDeviceNotificationToken();
  } catch (error) {
    console.warn("[Notifications] registration unavailable:", getErrorCode(error));
  }
}
function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}
