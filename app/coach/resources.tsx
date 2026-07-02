import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Spacing, Typography } from "@/constants/theme";

const RESOURCE_KEYS = [
  "firstPractice",
  "gameDay",
  "positiveTips",
  "templates",
  "whatToSay",
  "communication",
] as const;

export default function CoachResourcesScreen() {
  const { t } = useTranslation();

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>{t("coach.resources.title")}</Text>
          <Text style={styles.subtitle}>{t("coach.resources.subtitle")}</Text>
        </View>

        {RESOURCE_KEYS.map((key) => (
          <Card key={key} style={styles.card}>
            <Text style={styles.cardTitle}>{t(`coach.resources.${key}`)}</Text>
            <Text style={styles.cardText}>{t(`coach.resources.${key}Body`)}</Text>
          </Card>
        ))}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  header: { alignItems: "center", gap: Spacing.xs },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 31, textAlign: "center" },
  subtitle: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, lineHeight: 21, textAlign: "center" },
  card: { gap: Spacing.sm },
  cardTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 18 },
  cardText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21 },
});