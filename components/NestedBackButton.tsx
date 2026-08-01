import React from "react";
import { StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from "react-native";
import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Colors } from "@/constants/theme";

type NestedBackButtonProps = {
  accessibilityLabel?: string;
  fallbackRoute: string;
  style?: StyleProp<ViewStyle>;
};

export function navigateBackOrReplace(fallbackRoute: string) {
  if (router.canGoBack()) {
    router.back();
    return;
  }

  router.replace(fallbackRoute as never);
}

export function NestedBackButton({ accessibilityLabel, fallbackRoute, style }: NestedBackButtonProps) {
  const { t } = useTranslation();

  return (
    <TouchableOpacity
      accessibilityLabel={accessibilityLabel ?? t("common.back")}
      accessibilityRole="button"
      activeOpacity={0.82}
      onPress={() => navigateBackOrReplace(fallbackRoute)}
      style={[styles.button, style]}
    >
      <ArrowLeft
        accessibilityElementsHidden
        color={Colors.textHeading}
        importantForAccessibility="no-hide-descendants"
        size={22}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
});
