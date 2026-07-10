import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { getCurrentUserTeamMemberships, isCoachRole, switchActiveMode } from "@/services/teamService";
import { flattenStyle } from "@/utils/flatten-style";

const LANGUAGE_OPTIONS = [
  { code: "en", shortLabel: "EN", labelKey: "profile.english" },
  { code: "es", shortLabel: "ES", labelKey: "profile.spanish" },
] as const;

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { activeMode, language, setActiveMode, setLanguage } = useApp();
  const { user, signOut } = useAuth();
  const [canUseCoachMode, setCanUseCoachMode] = useState(false);
  const [isSwitchingMode, setIsSwitchingMode] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const isParentMode = activeMode === "parent";
  const isCoachMode = activeMode === "coach";

  useEffect(() => {
    let isMounted = true;
    getCurrentUserTeamMemberships()
      .then((memberships) => {
        if (isMounted) setCanUseCoachMode(memberships.some((membership) => isCoachRole(membership.role)));
      })
      .catch(() => {
        if (isMounted) setCanUseCoachMode(false);
      });
    return () => {
      isMounted = false;
    };
  }, [user?.uid]);

  const handleSwitchToParent = useCallback(async () => {
    const targetRoute = "/(tabs)/profile";
    setIsSwitchingMode(true);
    setModeError(null);

    try {
      if (__DEV__) {
        console.log("[ModeSwitch:toParent]", {
          previousMode: activeMode,
          nextMode: "parent",
          currentRoute: "/(tabs)/profile",
          targetRoute,
        });
      }

      await switchActiveMode("parent");
      setActiveMode("parent");
      router.dismissAll();
      router.replace(targetRoute as never);
    } catch (nextError) {
      console.warn("[Profile] switch to parent error:", nextError);
      setModeError(t("coach.home.error"));
    } finally {
      setIsSwitchingMode(false);
    }
  }, [activeMode, setActiveMode, t]);

  const handleCoachPress = useCallback(async () => {
    setIsSwitchingMode(true);
    setModeError(null);

    try {
      if (canUseCoachMode) {
        await switchActiveMode("coach");
        setActiveMode("coach");
      }
      router.push("/coach" as never);
    } catch (nextError) {
      console.warn("[Profile] switch to coach error:", nextError);
      setModeError(t("coach.home.error"));
    } finally {
      setIsSwitchingMode(false);
    }
  }, [canUseCoachMode, setActiveMode, t]);

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{t("profile.title")}</Text>

        <Card style={styles.card}>
          <Text style={styles.name}>{user?.displayName || t("profile.defaultName")}</Text>
          <Text style={styles.email}>{user?.email || t("profile.notSignedIn")}</Text>
          <PrimaryButton title={t("profile.signOut")} onPress={signOut} disabled={!user} />
        </Card>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("profile.settingsTitle")}</Text>
        </View>

        <Card style={styles.languageCard}>
          <View style={styles.languageCopy}>
            <Text style={styles.cardTitle}>{t("profile.language")}</Text>
            <Text style={styles.cardText}>{t("profile.languageDescription")}</Text>
          </View>

          <View style={styles.languageToggle}>
            {LANGUAGE_OPTIONS.map((option) => {
              const isSelected = language === option.code;

              return (
                <TouchableOpacity
                  key={option.code}
                  accessibilityLabel={t(option.labelKey)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  activeOpacity={0.85}
                  onPress={() => setLanguage(option.code)}
                  style={flattenStyle([styles.languageButton, isSelected && styles.languageButtonActive])}
                >
                  <Text style={flattenStyle([styles.languageButtonText, isSelected && styles.languageButtonTextActive])}>
                    {option.shortLabel}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        <Card style={styles.languageCard}>
          <View style={styles.languageCopy}>
            <Text style={styles.cardTitle}>{isCoachMode ? t("mode.viewingCoach") : t("mode.viewingParent")}</Text>
            <Text style={styles.cardText}>{isParentMode && !canUseCoachMode ? t("coach.home.noCoachRole") : t("coach.home.modeHelp")}</Text>
          </View>
          {modeError ? <Text style={styles.modeError}>{modeError}</Text> : null}
          <View style={styles.modeActions}>
            {isCoachMode ? (
              <TouchableOpacity
                activeOpacity={0.86}
                disabled={isSwitchingMode}
                onPress={handleSwitchToParent}
                style={flattenStyle([styles.modeOutlineButton, isSwitchingMode && styles.modeDisabledButton])}
              >
                <Text style={styles.modeOutlineText}>{t("mode.switchToParent")}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                activeOpacity={0.86}
                disabled={isSwitchingMode}
                onPress={handleCoachPress}
                style={flattenStyle([styles.modePrimaryButton, isSwitchingMode && styles.modeDisabledButton])}
              >
                <Text style={styles.modePrimaryText}>{canUseCoachMode ? t("mode.switchToCoach") : t("coach.team.createTeam")}</Text>
              </TouchableOpacity>
            )}
          </View>
        </Card>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  title: {
    fontFamily: Typography.heading,
    fontSize: 30,
    color: Colors.textHeading,
  },
  card: {
    gap: Spacing.md,
  },
  name: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 18,
    color: Colors.textHeading,
  },
  email: {
    fontFamily: Typography.bodyRegular,
    color: Colors.textPrimary,
  },
  sectionHeader: {
    marginTop: Spacing.xs,
  },
  sectionTitle: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.textHeading,
  },
  languageCard: {
    gap: Spacing.md,
  },
  languageCopy: {
    gap: 4,
  },
  cardTitle: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 18,
    color: Colors.textHeading,
  },
  cardText: {
    fontFamily: Typography.bodyRegular,
    color: Colors.textPrimary,
    lineHeight: 20,
  },
  languageToggle: {
    flexDirection: "row",
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    overflow: "hidden",
  },
  languageButton: {
    minWidth: 72,
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface,
  },
  languageButtonActive: {
    backgroundColor: Colors.primary,
  },
  languageButtonText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  languageButtonTextActive: {
    color: "#FFFFFF",
  },
  modeActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  modeError: {
    color: Colors.primary,
    fontFamily: Typography.bodySemiBold,
  },
  modePrimaryButton: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: Spacing.md,
  },
  modePrimaryText: {
    color: Colors.surface,
    fontFamily: Typography.bodySemiBold,
  },
  modeOutlineButton: {
    alignItems: "center",
    borderColor: Colors.primary,
    borderRadius: Radius.button,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: Spacing.md,
  },
  modeOutlineText: {
    color: Colors.primary,
    fontFamily: Typography.bodySemiBold,
  },
  modeDisabledButton: {
    opacity: 0.55,
  },
});
