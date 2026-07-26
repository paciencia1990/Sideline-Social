import React from "react";
import { KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { CoachResourceHeader } from "@/components/CoachResourceHeader";
import { PrivateTeamMessageThread } from "@/components/PrivateTeamMessageThread";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Spacing } from "@/constants/theme";
import { useCoachBackNavigation } from "@/hooks/useCoachBackNavigation";

export default function CoachPrivateTeamMessageScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigateBack = useCoachBackNavigation();
  const params = useLocalSearchParams<{
    conversationId?: string | string[];
    initialText?: string | string[];
    source?: string | string[];
  }>();
  const conversationId = Array.isArray(params.conversationId) ? params.conversationId[0] ?? "" : params.conversationId ?? "";
  const initialText = Array.isArray(params.initialText) ? params.initialText[0] ?? "" : params.initialText ?? "";
  const source = Array.isArray(params.source) ? params.source[0] ?? "" : params.source ?? "";
  return <ScreenWrapper><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "android" ? -insets.bottom : 0} style={styles.content}><CoachResourceHeader accessibilityLabel={t("teamMessages.back")} onBack={navigateBack} title={t("teamMessages.title")} /><PrivateTeamMessageThread conversationId={conversationId} initialText={initialText} isTemplateDraft={source === "message-parent"} role="coach" /></KeyboardAvoidingView></ScreenWrapper>;
}

const styles = StyleSheet.create({ content: { flex: 1, gap: Spacing.md, padding: Spacing.lg } });
