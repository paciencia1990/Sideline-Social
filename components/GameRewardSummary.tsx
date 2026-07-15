import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Star } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import type { GameRewardResult } from "@/services/sidelineStarsService";

type Props = {
  result: GameRewardResult | null;
  loading: boolean;
  error: string | null;
  detailLines: string[];
  onRetry: () => void;
};

export function GameRewardSummary({ detailLines, error, loading, onRetry, result }: Props) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <View accessible accessibilityLiveRegion="polite" style={styles.container}>
        <ActivityIndicator color={Colors.accentGold} />
        <Text style={styles.body}>{t("rewards.awarding")}</Text>
      </View>
    );
  }
  if (error || result?.status === "notEligible") {
    return (
      <View accessible accessibilityLiveRegion="polite" style={styles.container}>
        <Text style={styles.errorTitle}>{t("rewards.awardError")}</Text>
        <Text style={styles.body}>{result?.status === "notEligible" ? t("rewards.notEligible") : error}</Text>
        <Pressable
          accessibilityLabel={t("rewards.retry")}
          accessibilityRole="button"
          onPress={onRetry}
          style={styles.retryButton}
        >
          <Text style={styles.retryText}>{t("rewards.retry")}</Text>
        </Pressable>
      </View>
    );
  }
  if (!result) return null;
  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${t("rewards.earned", { count: result.starsAwarded })} ${detailLines.join(". ")}. ${t("rewards.total", { count: result.totalSidelineStars })}`}
      style={styles.container}
    >
      <View style={styles.earnedRow}>
        <Star color={Colors.accentGold} fill={Colors.accentGold} size={22} />
        <Text style={styles.earned}>{t("rewards.earned", { count: result.starsAwarded })}</Text>
      </View>
      {result.status === "alreadyAwarded" ? <Text style={styles.status}>{t("rewards.alreadyReceived")}</Text> : null}
      {detailLines.map((line) => <Text key={line} style={styles.body}>{line}</Text>)}
      <Text style={styles.total}>{t("rewards.total", { count: result.totalSidelineStars })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: `${Colors.accentGold}14`,
    borderColor: `${Colors.accentGold}66`,
    borderRadius: Radius.card,
    borderWidth: 1,
    gap: Spacing.sm,
    padding: Spacing.md,
  },
  earnedRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, justifyContent: "center" },
  earned: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 17, textAlign: "center" },
  status: { color: Colors.accentGreen, fontFamily: Typography.bodySemiBold, fontSize: 13, textAlign: "center" },
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20, textAlign: "center" },
  total: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 15, textAlign: "center" },
  errorTitle: { color: "#C7463B", fontFamily: Typography.bodyBold, fontSize: 15, textAlign: "center" },
  retryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 44, paddingHorizontal: Spacing.md },
  retryText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 14 },
});
