import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Colors, Shadow, Spacing, Typography } from "@/constants/theme";

export function CoachResourceHeader({ accessibilityLabel, onBack, subtitle, title, titleRef }: {
  accessibilityLabel?: string;
  onBack?: () => void;
  subtitle?: string;
  title: string;
  titleRef?: React.RefObject<Text | null>;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <TouchableOpacity accessibilityLabel={accessibilityLabel ?? t("common.back")} accessibilityRole="button" onPress={onBack ?? (() => router.back())} style={styles.back}>
        <ArrowLeft accessibilityElementsHidden color={Colors.textHeading} importantForAccessibility="no-hide-descendants" size={22} />
      </TouchableOpacity>
      <View style={styles.copy}>
        <Text accessibilityRole="header" ref={titleRef} style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "flex-start", flexDirection: "row", gap: Spacing.sm },
  back: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44, ...Shadow.card },
  copy: { flex: 1, gap: Spacing.xs, minWidth: 0 },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 28, lineHeight: 35 },
  subtitle: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21 },
});
