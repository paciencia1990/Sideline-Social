import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Lightbulb } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { CoachResourceHeader } from "@/components/CoachResourceHeader";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  getCoachProTips,
  getDailyCoachProTip,
  localizeCoachText,
  resolveCoachResourceLocale,
} from "@/services/coachResourcesService";
import type { CoachProTipCategory } from "@/types/coachResources";

type Filter = "all" | CoachProTipCategory;

export default function CoachProTipsScreen() {
  const { i18n, t } = useTranslation();
  const locale = resolveCoachResourceLocale(i18n.language);
  const tips = getCoachProTips();
  const today = getDailyCoachProTip();
  const [filter, setFilter] = useState<Filter>("all");
  const categories = useMemo(() => Array.from(new Set(tips.map((entry) => entry.category))), [tips]);
  const visibleTips = filter === "all" ? tips : tips.filter((entry) => entry.category === filter);

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <CoachResourceHeader subtitle={t("coach.resources.tipsSubtitle")} title={t("coach.resources.proTipsTitle")} />

        <Card style={styles.todayCard}>
          <View style={styles.todayHeading}>
            <Lightbulb color={Colors.accentGold} size={22} />
            <Text accessibilityRole="header" style={styles.eyebrow}>{t("coach.resources.todayTip")}</Text>
          </View>
          <Text style={styles.tipTitle}>{localizeCoachText(today.title, locale)}</Text>
          <Text style={styles.tipBody}>{localizeCoachText(today.body, locale)}</Text>
          {today.tryThis ? (
            <View style={styles.tryBox}>
              <Text accessibilityRole="header" style={styles.tryLabel}>{t("coach.resources.tryThis")}</Text>
              <Text style={styles.tipBody}>{localizeCoachText(today.tryThis, locale)}</Text>
            </View>
          ) : null}
        </Card>

        <ScrollView accessibilityRole="radiogroup" contentContainerStyle={styles.filters} horizontal showsHorizontalScrollIndicator={false}>
          <FilterButton label={t("coach.resources.allTips")} onPress={() => setFilter("all")} selected={filter === "all"} />
          {categories.map((category) => (
            <FilterButton key={category} label={t(`coach.resources.tipCategories.${category}`)} onPress={() => setFilter(category)} selected={filter === category} />
          ))}
        </ScrollView>

        <View style={styles.list}>
          {visibleTips.map((entry) => {
            const isToday = entry.id === today.id;
            return (
              <Card key={entry.id} style={[styles.tipCard, isToday && styles.tipCardToday]}>
                {isToday ? <Text style={styles.todayBadge}>{t("coach.resources.today")}</Text> : null}
                <Text accessibilityRole="header" style={styles.tipTitle}>{localizeCoachText(entry.title, locale)}</Text>
                <Text style={styles.tipBody}>{localizeCoachText(entry.body, locale)}</Text>
                {entry.tryThis ? (
                  <View style={styles.tryBox}>
                    <Text accessibilityRole="header" style={styles.tryLabel}>{t("coach.resources.tryThis")}</Text>
                    <Text style={styles.tipBody}>{localizeCoachText(entry.tryThis, locale)}</Text>
                  </View>
                ) : null}
              </Card>
            );
          })}
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

function FilterButton({ label, onPress, selected }: { label: string; onPress: () => void; selected: boolean }) {
  return (
    <TouchableOpacity accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={[styles.filter, selected && styles.filterSelected]}>
      <Text style={[styles.filterText, selected && styles.filterTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  todayCard: { borderLeftColor: Colors.accentGold, borderLeftWidth: 4, gap: Spacing.sm },
  todayHeading: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  eyebrow: { color: Colors.accentGold, fontFamily: Typography.bodyBold, fontSize: 11, letterSpacing: 0.9, textTransform: "uppercase" },
  filters: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  filter: { borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: Spacing.md },
  filterSelected: { backgroundColor: Colors.primary },
  filterText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 12 },
  filterTextSelected: { color: Colors.surface },
  list: { gap: Spacing.md },
  tipCard: { gap: Spacing.sm },
  tipCardToday: { borderColor: Colors.accentGold, borderWidth: 1 },
  todayBadge: { alignSelf: "flex-start", backgroundColor: Colors.accentGold, borderRadius: Radius.sm, color: Colors.surface, fontFamily: Typography.bodyBold, fontSize: 10, overflow: "hidden", paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, textTransform: "uppercase" },
  tipTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17, lineHeight: 23 },
  tipBody: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21 },
  tryBox: { backgroundColor: Colors.background, borderRadius: Radius.sm, gap: Spacing.xs, padding: Spacing.sm },
  tryLabel: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 11, letterSpacing: 0.7, textTransform: "uppercase" },
});
