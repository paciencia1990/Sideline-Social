import React from "react";
import { StyleSheet } from "react-native";
import { Tabs } from "expo-router";
import { Gamepad2, Heart, Home, MapPin, User } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { TabIcon } from "@/components/TabIcon";
import { Colors, Typography } from "@/constants/theme";

export default function TabLayout() {
  const { t } = useTranslation();

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
