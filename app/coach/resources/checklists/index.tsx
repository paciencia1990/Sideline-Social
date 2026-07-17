import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";

import { CoachResourceHeader } from "@/components/CoachResourceHeader";
import { CoachResourceRow } from "@/components/CoachResourceRow";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import {
  getChecklistItemIds,
  getCoachChecklistProgress,
  getCoachChecklists,
  localizeCoachText,
  resolveCoachResourceLocale,
} from "@/services/coachResourcesService";

const CATEGORY_ORDER = ["prepare", "coaching_days", "safety_wrap_up"] as const;

export default function CoachChecklistsScreen() {
  const { i18n, t } = useTranslation();
  const { user } = useAuth();
  const locale = resolveCoachResourceLocale(i18n.language);
  const checklists = getCoachChecklists();
  const [progress, setProgress] = useState<Record<string, number>>({});

  const loadProgress = useCallback(async () => {
    if (!user?.uid) return setProgress({});
    const entries = await Promise.all(checklists.map(async (checklist) => [
      checklist.id,
      (await getCoachChecklistProgress(user.uid, checklist)).completedItemIds.length,
    ] as const));
    setProgress(Object.fromEntries(entries));
  }, [checklists, user?.uid]);

  useFocusEffect(useCallback(() => { void loadProgress(); }, [loadProgress]));

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <CoachResourceHeader subtitle={t("coach.resources.checklistsSubtitle")} title={t("coach.resources.checklists")} />
        {CATEGORY_ORDER.map((category) => (
          <View key={category} style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{t(`coach.resources.checklistCategories.${category}`)}</Text>
            {checklists.filter((entry) => entry.category === category).map((checklist) => {
              const completed = progress[checklist.id] ?? 0;
              const total = getChecklistItemIds(checklist).length;
              const status = completed > 0
                ? t("coach.resources.progress", { completed, total })
                : t("coach.resources.notStarted");
              return (
                <CoachResourceRow
                  accessibilityLabel={`${localizeCoachText(checklist.title, locale)}. ${status}. ${t("coach.resources.opensChecklist")}`}
                  description={localizeCoachText(checklist.description, locale)}
                  key={checklist.id}
                  onPress={() => router.push(`/coach/resources/checklists/${checklist.id}` as never)}
                  status={status}
                  title={localizeCoachText(checklist.title, locale)}
                />
              );
            })}
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
