import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { CoachResourceHeader } from "@/components/CoachResourceHeader";
import { CoachResourceRow } from "@/components/CoachResourceRow";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Spacing, Typography } from "@/constants/theme";
import {
  getCoachCommunicationTemplates,
  localizeCoachText,
  resolveCoachResourceLocale,
} from "@/services/coachResourcesService";

const CATEGORY_ORDER = ["schedule", "parents", "message_parent", "culture"] as const;

export default function CoachCommunicationLibraryScreen() {
  const { i18n, t } = useTranslation();
  const locale = resolveCoachResourceLocale(i18n.language);
  const templates = getCoachCommunicationTemplates();
  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <CoachResourceHeader subtitle={t("coach.resources.communicationSubtitle")} title={t("coach.resources.communication")} />
        {CATEGORY_ORDER.map((category) => (
          <View key={category} style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{t(`coach.resources.communicationCategories.${category}`)}</Text>
            {templates.filter((entry) => entry.category === category).map((entry) => (
              <CoachResourceRow
                accessibilityLabel={`${localizeCoachText(entry.title, locale)}. ${t("coach.resources.opensTemplate")}`}
                description={localizeCoachText(entry.description, locale)}
                key={entry.id}
                onPress={() => router.push((
                  entry.category === "message_parent"
                    ? `/coach/resources/message-parent/${entry.id}`
                    : `/coach/resources/communication/${entry.id}`
                ) as never)}
                title={localizeCoachText(entry.title, locale)}
              />
            ))}
          </View>
        ))}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.lg, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  section: { gap: Spacing.sm },
  sectionTitle: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 12, letterSpacing: 0.8, lineHeight: 18, textTransform: "uppercase" },
});
