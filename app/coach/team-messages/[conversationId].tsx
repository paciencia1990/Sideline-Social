import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { CoachResourceHeader } from "@/components/CoachResourceHeader";
import { PrivateTeamMessageThread } from "@/components/PrivateTeamMessageThread";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Spacing } from "@/constants/theme";
import { useCoachBackNavigation } from "@/hooks/useCoachBackNavigation";

export default function CoachPrivateTeamMessageScreen() {
  const { t } = useTranslation();
  const navigateBack = useCoachBackNavigation();
  const params = useLocalSearchParams<{ conversationId?: string | string[] }>();
  const conversationId = Array.isArray(params.conversationId) ? params.conversationId[0] ?? "" : params.conversationId ?? "";
  return <ScreenWrapper><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><CoachResourceHeader accessibilityLabel={t("teamMessages.back")} onBack={navigateBack} title={t("teamMessages.title")} /><PrivateTeamMessageThread conversationId={conversationId} role="coach" /></ScrollView></ScreenWrapper>;
}

const styles = StyleSheet.create({ content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl } });
