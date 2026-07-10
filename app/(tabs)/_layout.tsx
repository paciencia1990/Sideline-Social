import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Tabs, router, usePathname } from "expo-router";
import { Gamepad2, Heart, Home, MapPin, User } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { TabIcon } from "@/components/TabIcon";
import { COACH_MODE_ROUTE, PARENT_PROFILE_ROUTE } from "@/constants/routes";
import { Colors, Typography } from "@/constants/theme";
import { useApp } from "@/context/AppContext";

export default function TabLayout() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { activeMode, modeHydrated } = useApp();
  const shouldRedirectToCoach = modeHydrated && activeMode === "coach";

  useEffect(() => {
    if (!shouldRedirectToCoach) return;

    if (__DEV__) {
      console.log("[ModeRouteGuard]", {
        activeMode,
        modeHydrated,
        currentRoute: pathname,
        parentProfileRoute: PARENT_PROFILE_ROUTE,
        coachModeRoute: COACH_MODE_ROUTE,
      });
    }

    router.replace(COACH_MODE_ROUTE as never);
  }, [activeMode, modeHydrated, pathname, shouldRedirectToCoach]);

  if (!modeHydrated) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (shouldRedirectToCoach) {
    return null;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textPrimary,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("tabs.home"), tabBarIcon: ({ focused }) => <TabIcon Icon={Home} focused={focused} /> }} />
      <Tabs.Screen name="squad" options={{ title: t("tabs.squad"), tabBarIcon: ({ focused }) => <TabIcon Icon={MapPin} focused={focused} /> }} />
      <Tabs.Screen name="games" options={{ title: t("tabs.games"), tabBarIcon: ({ focused }) => <TabIcon Icon={Gamepad2} focused={focused} isCenter /> }} />
      <Tabs.Screen name="friends" options={{ title: t("tabs.friends"), tabBarIcon: ({ focused }) => <TabIcon Icon={Heart} focused={focused} /> }} />
      <Tabs.Screen name="profile" options={{ title: t("tabs.profile"), tabBarIcon: ({ focused }) => <TabIcon Icon={User} focused={focused} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    alignItems: "center",
    backgroundColor: Colors.background,
    flex: 1,
    justifyContent: "center",
  },
  tabBar: {
    backgroundColor: Colors.surface,
    borderTopColor: Colors.secondary,
    borderTopWidth: 1,
    height: 62,
  },
  tabLabel: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 10,
  },
});
