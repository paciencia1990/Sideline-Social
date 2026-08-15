import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, LogBox, StyleSheet, View } from "react-native";

import { ScreenWrapper } from "@/components/ScreenWrapper";
import { COMPLETE_ACCOUNT_ROUTE, SIGN_IN_ROUTE } from "@/constants/routes";
import { Colors } from "@/constants/theme";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";

import { getPendingNotificationOpenTarget } from "@/services/notificationService";
import { consumeSystemReturnRoute } from "@/services/systemRouteResumeService";
LogBox.ignoreAllLogs(false);

export default function Index() {
  const { activeMode, modeHydrated, setActiveMode } = useApp();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !modeHydrated) return;

    let mounted = true;

    async function routeUser() {
      const onboardingComplete = await AsyncStorage.getItem("onboardingComplete");
      if (!mounted) return;

      if (user) {
        if (!user.accountOnboardingCompleted) {
          router.replace(COMPLETE_ACCOUNT_ROUTE as never);
          return;
        }
        try {
          const pendingTarget = await getPendingNotificationOpenTarget({ activeMode });
          if (!mounted) return;
          if (pendingTarget) {
            if (pendingTarget.requiredMode && pendingTarget.requiredMode !== activeMode) {
              setActiveMode(pendingTarget.requiredMode);
              setTimeout(() => router.replace(pendingTarget.route as never), 0);
            } else {
              router.replace(pendingTarget.route as never);
            }
            return;
          }
        } catch (error) {
          console.warn("[Notifications] initial route error:", getErrorCode(error));
        }

        const systemReturnRoute = await consumeSystemReturnRoute().catch(() => null);
        if (!mounted) return;
        if (systemReturnRoute) {
          router.replace(systemReturnRoute as never);
          return;
        }

        router.replace("/(tabs)");
        return;
      }

      router.replace(onboardingComplete === "true" ? SIGN_IN_ROUTE : "/splash");
    }

    routeUser();

    return () => {
      mounted = false;
    };
  }, [activeMode, loading, modeHydrated, setActiveMode, user]);

  return (
    <ScreenWrapper>
      <View style={styles.content}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    </ScreenWrapper>
  );
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
