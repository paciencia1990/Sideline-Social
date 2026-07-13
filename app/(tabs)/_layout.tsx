import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { Gamepad2, Heart, Home, MapPin, User } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { TabIcon } from "@/components/TabIcon";
import { CHOOSE_START_MODE_ROUTE, COACH_MODE_ROUTE, SIGN_IN_ROUTE } from "@/constants/routes";
import { Colors, Typography } from "@/constants/theme";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";

export default function TabLayout() {
  const { t } = useTranslation();
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

  if (!user.modeOnboardingCompleted) {
    return <Redirect href={CHOOSE_START_MODE_ROUTE as never} />;
  }

  if (activeMode === "coach") {
    return <Redirect href={COACH_MODE_ROUTE as never} />;
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