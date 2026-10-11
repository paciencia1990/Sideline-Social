import React, { type ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Tabs } from "expo-router";
import { Gamepad2, Heart, Home, MapPin, User } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TabIcon } from "@/components/TabIcon";
import { Colors, Typography } from "@/constants/theme";
import { useNavigationKeyboardVisible } from "@/hooks/useNavigationKeyboardVisible";
import { PARENT_DESTINATIONS, type ParentTabName } from "@/utils/parentNavigation";
import { PARENT_TAB_BAR_CONTENT_HEIGHT } from "@/utils/safeAreaLayout";

const ICONS = { index: Home, squad: MapPin, games: Gamepad2, friends: Heart, profile: User };

export function ParentNavigationBar({ activeTab, onSelect, onLongPress }: {
  activeTab: ParentTabName;
  onSelect: (tab: ParentTabName) => void;
  onLongPress?: (tab: ParentTabName) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <View style={styles.items}>
        {PARENT_DESTINATIONS.map(destination => {
          const focused = activeTab === destination.name;
          const label = t(destination.labelKey);
          return (
            <Pressable
              key={destination.name}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: focused }}
              testID={`parent-menu-${destination.name}`}
              onPress={() => onSelect(destination.name)}
              onLongPress={onLongPress ? () => onLongPress(destination.name) : undefined}
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            >
              <View style={styles.icon}><TabIcon Icon={ICONS[destination.name]} focused={focused} isCenter={destination.name === "games"} /></View>
              <Text style={[styles.label, { color: focused ? Colors.primary : Colors.textPrimary }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

export function ParentTabsBar({ state, navigation }: TabBarProps) {
  const keyboardVisible = useNavigationKeyboardVisible();
  if (keyboardVisible) return null;
  const activeTab = state.routes[state.index].name as ParentTabName;
  return <ParentNavigationBar activeTab={activeTab} onSelect={tab => {
    const route = state.routes.find(candidate => candidate.name === tab);
    if (!route) return;
    const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (tab !== activeTab && !event.defaultPrevented) navigation.navigate(route.name, route.params);
  }} onLongPress={tab => {
    const route = state.routes.find(candidate => candidate.name === tab);
    if (route) navigation.emit({ type: "tabLongPress", target: route.key });
  }} />;
}

const styles = StyleSheet.create({
  bar: { backgroundColor: Colors.surface, borderTopColor: Colors.secondary, borderTopWidth: 1 },
  items: { flexDirection: "row", minHeight: PARENT_TAB_BAR_CONTENT_HEIGHT },
  item: { alignItems: "center", flex: 1, justifyContent: "center", minHeight: PARENT_TAB_BAR_CONTENT_HEIGHT, paddingVertical: 3 },
  icon: { alignItems: "center", height: 44, justifyContent: "center" },
  label: { fontFamily: Typography.bodySemiBold, fontSize: 10, textAlign: "center" },
  pressed: { opacity: 0.65 },
});
