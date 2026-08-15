import AsyncStorage from "@react-native-async-storage/async-storage";
import { Redirect, router } from "expo-router";
import { ClipboardList, Users } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import {
  COACH_MODE_ROUTE,
  COMPLETE_ACCOUNT_ROUTE,
  PARENT_HOME_ROUTE,
  SIGN_IN_ROUTE,
} from "@/constants/routes";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { completeModeOnboarding } from "@/services/onboardingModeService";
import type { AppMode } from "@/utils/onboardingMode";

export default function ChooseStartModeScreen() {
  const { t } = useTranslation();
  const { activeMode, modeHydrated, setActiveMode } = useApp();
  const { loading: authLoading, refreshProfile, user } = useAuth();
  const [savingMode, setSavingMode] = useState<AppMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChoice = useCallback(async (mode: AppMode) => {
    if (savingMode) return;

    setSavingMode(mode);
    setError(null);
    try {
      await completeModeOnboarding(mode);
      setActiveMode(mode);
      await refreshProfile();
      await AsyncStorage.setItem("onboardingComplete", "true").catch(() => undefined);
      router.replace((mode === "coach" ? COACH_MODE_ROUTE : PARENT_HOME_ROUTE) as never);
    } catch (nextError) {
      console.warn("[StartMode] save failed:", getErrorCode(nextError));
      setError(t("startMode.saveError"));
      setSavingMode(null);
    }
  }, [refreshProfile, savingMode, setActiveMode, t]);

  if (authLoading || !modeHydrated) {
    return (
      <ScreenWrapper>
        <View style={styles.loadingScreen}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      </ScreenWrapper>
    );
  }

  if (!user) {
    return <Redirect href={SIGN_IN_ROUTE as never} />;
  }

  if (!user.accountOnboardingCompleted) {
    return <Redirect href={COMPLETE_ACCOUNT_ROUTE as never} />;
  }

  if (user.modeOnboardingCompleted && !savingMode) {
    return <Redirect href={(activeMode === "coach" ? COACH_MODE_ROUTE : PARENT_HOME_ROUTE) as never} />;
  }

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.kicker}>{t("startMode.eyebrow")}</Text>
          <Text accessibilityRole="header" style={styles.title}>{t("startMode.title")}</Text>
        </View>

        <ModeChoiceCard
          body={t("startMode.parentBody")}
          disabled={Boolean(savingMode)}
          Icon={Users}
          loading={savingMode === "parent"}
          onPress={() => void handleChoice("parent")}
          title={t("startMode.parentTitle")}
        />
        <ModeChoiceCard
          body={t("startMode.coachBody")}
          disabled={Boolean(savingMode)}
          Icon={ClipboardList}
          loading={savingMode === "coach"}
          onPress={() => void handleChoice("coach")}
          title={t("startMode.coachTitle")}
        />

        <Text style={styles.note}>{t("startMode.switchNote")}</Text>
        {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function ModeChoiceCard({
  body,
  disabled,
  Icon,
  loading,
  onPress,
  title,
}: {
  body: string;
  disabled: boolean;
  Icon: typeof Users;
  loading: boolean;
  onPress: () => void;
  title: string;
}) {
  const { t } = useTranslation();

  return (
    <TouchableOpacity
      accessibilityLabel={`${title}. ${body}. ${t("startMode.continue")}`}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled }}
      activeOpacity={0.86}
      disabled={disabled}
      onPress={onPress}
      style={disabled ? styles.disabled : undefined}
    >
      <Card style={styles.choiceCard}>
        <View style={styles.choiceHeader}>
          <View style={styles.iconCircle}>
            <Icon color={Colors.primary} size={27} />
          </View>
          <Text style={styles.choiceTitle}>{title}</Text>
        </View>
        <Text style={styles.choiceBody}>{body}</Text>
        <View style={styles.continueButton}>
          {loading ? <ActivityIndicator color={Colors.primary} /> : <Text style={styles.continueText}>{t("startMode.continue")}</Text>}
        </View>
      </Card>
    </TouchableOpacity>
  );
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

const styles = StyleSheet.create({
  loadingScreen: { alignItems: "center", flex: 1, justifyContent: "center" },
  content: { flexGrow: 1, gap: Spacing.md, justifyContent: "center", padding: Spacing.lg, paddingBottom: Spacing.xxl },
  header: { alignItems: "center", gap: Spacing.xs, marginBottom: Spacing.sm },
  kicker: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 12, letterSpacing: 0.8, textTransform: "uppercase" },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 32, lineHeight: 39, textAlign: "center" },
  choiceCard: { borderColor: Colors.secondary, borderWidth: 1, gap: Spacing.md, minHeight: 172, ...Shadow.card },
  choiceHeader: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  iconCircle: { alignItems: "center", backgroundColor: Colors.background, borderRadius: 26, height: 52, justifyContent: "center", width: 52 },
  choiceTitle: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodyBold, fontSize: 19, lineHeight: 25, minWidth: 0 },
  choiceBody: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21 },
  continueButton: { alignItems: "center", alignSelf: "flex-start", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1.5, justifyContent: "center", minHeight: 42, minWidth: 120, paddingHorizontal: Spacing.md },
  continueText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  note: { color: Colors.textPrimary, fontFamily: Typography.bodyMedium, fontSize: 13, lineHeight: 20, paddingHorizontal: Spacing.sm, textAlign: "center" },
  error: { backgroundColor: Colors.surface, borderColor: Colors.primary, borderRadius: Radius.sm, borderWidth: 1, color: Colors.primary, fontFamily: Typography.bodySemiBold, lineHeight: 20, padding: Spacing.sm, textAlign: "center" },
  disabled: { opacity: 0.6 },
});
