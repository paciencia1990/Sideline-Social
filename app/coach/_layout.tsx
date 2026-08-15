import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect, Stack } from "expo-router";

import { CHOOSE_START_MODE_ROUTE, COMPLETE_ACCOUNT_ROUTE, PARENT_PROFILE_ROUTE, SIGN_IN_ROUTE } from "@/constants/routes";
import { Colors } from "@/constants/theme";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";

export default function CoachLayout() {
  const { activeMode, modeHydrated } = useApp();
  const { loading: authLoading, user } = useAuth();

  if (authLoading || !modeHydrated) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!user) {
    return <Redirect href={SIGN_IN_ROUTE as never} />;
  }

  if (!user.accountOnboardingCompleted) {
    return <Redirect href={COMPLETE_ACCOUNT_ROUTE as never} />;
  }

  if (!user.modeOnboardingCompleted) {
    return <Redirect href={CHOOSE_START_MODE_ROUTE as never} />;
  }

  if (activeMode !== "coach") {
    return <Redirect href={PARENT_PROFILE_ROUTE as never} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  loadingScreen: {
    alignItems: "center",
    backgroundColor: Colors.background,
    flex: 1,
    justifyContent: "center",
  },
});
