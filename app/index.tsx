import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, LogBox, StyleSheet, View } from "react-native";

import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SIGN_IN_ROUTE } from "@/constants/routes";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";

import { getPendingNotificationOpenTarget, markNotificationRead } from "@/services/notificationService";
LogBox.ignoreAllLogs(false);

export default function Index() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    let mounted = true;

    async function routeUser() {
      const onboardingComplete = await AsyncStorage.getItem("onboardingComplete");
      if (!mounted) return;

      if (user) {
        try {
          const pendingTarget = await getPendingNotificationOpenTarget();
          if (!mounted) return;
          if (pendingTarget) {
            if (pendingTarget.notificationId) {
              await markNotificationRead(user.uid, pendingTarget.notificationId).catch((error) => {
                console.warn("[Notifications] initial mark read error:", getErrorCode(error));
              });
            }
            if (!mounted) return;
            router.replace(pendingTarget.route as never);
            return;
          }
        } catch (error) {
          console.warn("[Notifications] initial route error:", getErrorCode(error));
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
  }, [loading, user]);

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
