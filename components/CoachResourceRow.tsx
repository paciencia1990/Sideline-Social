import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ChevronRight } from "lucide-react-native";

import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";

export function CoachResourceRow({
  accessibilityLabel,
  description,
  onPress,
  status,
  title,
}: {
  accessibilityLabel: string;
  description?: string;
  onPress: () => void;
  status?: string;
  title: string;
}) {
  return (
    <TouchableOpacity accessibilityLabel={accessibilityLabel} accessibilityRole="button" activeOpacity={0.86} onPress={onPress} style={styles.row}>
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
        {status ? <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text> : null}
      </View>
      <ChevronRight accessibilityElementsHidden color={Colors.textHeading} importantForAccessibility="no-hide-descendants" size={21} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "center", backgroundColor: Colors.surface, borderColor: Colors.secondary, borderRadius: Radius.card, borderWidth: 1, flexDirection: "row", gap: Spacing.sm, minHeight: 76, padding: Spacing.md, ...Shadow.card },
  copy: { flex: 1, gap: 3, minWidth: 0 },
  title: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 16, lineHeight: 22 },
  description: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 19 },
  status: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 12, lineHeight: 17 },
});
