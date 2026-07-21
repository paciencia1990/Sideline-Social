import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { ClipboardList, Lightbulb, MessageSquareText, Sparkles, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { CoachResourceHeader } from "@/components/CoachResourceHeader";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { getDailyCoachProTip, localizeCoachText, resolveCoachResourceLocale } from "@/services/coachResourcesService";

export default function CoachResourcesScreen() {
  const { i18n, t } = useTranslation();
  const locale = resolveCoachResourceLocale(i18n.language);
  const dailyTip = getDailyCoachProTip();

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <CoachResourceHeader subtitle={t("coach.resources.subtitle")} title={t("coach.resources.title")} />

        <ResourceCard
          body={t("coach.resources.checklistsBody")}
          Icon={ClipboardList}
          onPress={() => router.push("/coach/resources/checklists" as never)}
          title={t("coach.resources.checklists")}
        />
        <ResourceCard
          body={t("coach.resources.communicationCardBody")}
          Icon={MessageSquareText}
          onPress={() => router.push("/coach/resources/communication" as never)}
          title={t("coach.resources.communication")}
        />

        <TouchableOpacity accessibilityRole="button" activeOpacity={0.86} onPress={() => router.push("/coach/resources/tips" as never)}>
          <Card style={styles.tipCard}>
            <View style={styles.cardHeader}>
              <View style={styles.iconCircle}><Lightbulb color={Colors.accentGold} size={22} /></View>
              <Text style={styles.eyebrow}>{t("coach.resources.proTip")}</Text>
            </View>
            <Text style={styles.cardTitle}>{localizeCoachText(dailyTip.title, locale)}</Text>
            <Text style={styles.cardBody}>{localizeCoachText(dailyTip.body, locale)}</Text>
            <Text style={styles.actionText}>{t("coach.resources.seeMoreTips")}</Text>
          </Card>
        </TouchableOpacity>

        <View style={styles.helpArea}>
          <Text style={styles.helpPrompt}>{t("coach.resources.notFinding")}</Text>
          <TouchableOpacity
            accessibilityHint={FEATURE_FLAGS.coachAiEnabled ? t("coach.resources.helpHint") : t("coach.resources.coachAiUnavailableBody")}
            accessibilityRole="button"
            accessibilityState={{ disabled: !FEATURE_FLAGS.coachAiEnabled }}
            activeOpacity={0.86}
            disabled={!FEATURE_FLAGS.coachAiEnabled}
            onPress={FEATURE_FLAGS.coachAiEnabled ? () => router.push("/coach/resources/help" as never) : undefined}
            style={[styles.helpButton, !FEATURE_FLAGS.coachAiEnabled && styles.helpButtonDisabled]}
          >
            <Sparkles color={Colors.surface} size={20} />
            <Text style={styles.helpButtonText}>{FEATURE_FLAGS.coachAiEnabled ? t("coach.resources.needHelp") : t("coach.resources.coachAiComingSoon")}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

function ResourceCard({ body, Icon, onPress, title }: { body: string; Icon: LucideIcon; onPress: () => void; title: string }) {
  return (
    <TouchableOpacity accessibilityLabel={`${title}. ${body}`} accessibilityRole="button" activeOpacity={0.86} onPress={onPress}>
      <Card style={styles.resourceCard}>
        <View style={styles.iconCircle}><Icon color={Colors.primary} size={22} /></View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardBody}>{body}</Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  resourceCard: { alignItems: "center", flexDirection: "row", gap: Spacing.md, minHeight: 104 },
  tipCard: { borderLeftColor: Colors.accentGold, borderLeftWidth: 4, gap: Spacing.sm },
  cardHeader: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  iconCircle: { alignItems: "center", backgroundColor: Colors.background, borderRadius: 24, flexShrink: 0, height: 48, justifyContent: "center", width: 48 },
  cardCopy: { flex: 1, gap: Spacing.xs, minWidth: 0 },
  eyebrow: { color: Colors.accentGold, flex: 1, fontFamily: Typography.bodyBold, fontSize: 11, letterSpacing: 0.9, textTransform: "uppercase" },
  cardTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 18, lineHeight: 24 },
  cardBody: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21 },
  actionText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  helpArea: { alignItems: "center", gap: Spacing.sm, paddingTop: Spacing.md },
  helpPrompt: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 16, textAlign: "center" },
  helpButton: { alignItems: "center", backgroundColor: Colors.textHeading, borderRadius: Radius.button, flexDirection: "row", gap: Spacing.sm, justifyContent: "center", minHeight: 52, paddingHorizontal: Spacing.lg, width: "100%", ...Shadow.card },
  helpButtonDisabled: { opacity: 0.68 },
  helpButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 16, textAlign: "center" },
});
