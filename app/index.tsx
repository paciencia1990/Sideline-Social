import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, LogBox, StyleSheet, View } from "react-native";

import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";

import { getPendingCoachUpdateRoute } from "@/services/notificationService";
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
          const pendingRoute = await getPendingCoachUpdateRoute();
          if (!mounted) return;
          if (pendingRoute) {
            router.replace(pendingRoute as never);
            return;
          }
        } catch (error) {
          console.warn("[Notifications] initial route error:", getErrorCode(error));
        }

        router.replace("/(tabs)");
        return;
      }

      router.replace(onboardingComplete === "true" ? "/(auth)/sign-in" : "/splash");
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
