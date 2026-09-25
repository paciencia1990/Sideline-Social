import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, Stack } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useCoachResourcesAccess } from "@/hooks/useCoachResourcesAccess";

export default function CoachResourcesLayout() {
  const { t } = useTranslation();
  const { refresh, status } = useCoachResourcesAccess();

  if (status === "allowed") {
    return <Stack screenOptions={{ headerShown: false }} />;
  }

  if (status === "loading") {
    return (
      <ScreenWrapper>
        <View accessibilityLiveRegion="polite" style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
          <Text style={styles.body}>{t("coach.resources.accessLoading")}</Text>
        </View>
      </ScreenWrapper>
    );
  }

  const failed = status === "error";
  return (
    <ScreenWrapper>
      <View style={styles.center}>
        <Card style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>
            {t(failed ? "coach.resources.accessUnavailableTitle" : "coach.resources.accessRequiredTitle")}
          </Text>
          <Text style={styles.body}>
            {t(failed ? "coach.resources.accessUnavailableBody" : "coach.resources.accessRequiredBody")}
          </Text>
          {failed ? (
            <TouchableOpacity accessibilityRole="button" onPress={() => { void refresh(); }} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{t("common.retry")}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity accessibilityRole="button" onPress={() => router.replace("/coach" as never)} style={styles.outlineButton}>
            <Text style={styles.outlineButtonText}>{t("coach.resources.backToCoachMode")}</Text>
          </TouchableOpacity>
        </Card>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", flex: 1, gap: Spacing.sm, justifyContent: "center", padding: Spacing.lg },
  card: { gap: Spacing.md, maxWidth: 520, width: "100%" },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 26, textAlign: "center" },
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 15, lineHeight: 22, textAlign: "center" },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  primaryButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  outlineButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  outlineButtonText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14 },
});
