import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Stack, router, usePathname } from "expo-router";

import { COACH_MODE_ROUTE, PARENT_PROFILE_ROUTE } from "@/constants/routes";
import { Colors } from "@/constants/theme";
import { useApp } from "@/context/AppContext";

export default function CoachLayout() {
  const pathname = usePathname();
  const { activeMode, modeHydrated } = useApp();
  const shouldRedirectToParent = modeHydrated && activeMode !== "coach";

  useEffect(() => {
    if (!shouldRedirectToParent) return;

    if (__DEV__) {
      console.log("[ModeRouteGuard]", {
        activeMode,
        modeHydrated,
        currentRoute: pathname,
        parentProfileRoute: PARENT_PROFILE_ROUTE,
        coachModeRoute: COACH_MODE_ROUTE,
      });
    }

    router.replace(PARENT_PROFILE_ROUTE as never);
  }, [activeMode, modeHydrated, pathname, shouldRedirectToParent]);

  if (!modeHydrated) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (shouldRedirectToParent) {
    return null;
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
