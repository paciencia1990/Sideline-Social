import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, LogBox, StyleSheet, View } from "react-native";

import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";

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

const styles = StyleSheet.create({
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
