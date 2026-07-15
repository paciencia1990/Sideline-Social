import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { COACH_MODE_ROUTE, PARENT_PROFILE_ROUTE, SIGN_IN_ROUTE } from "@/constants/routes";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { getCurrentUserTeamMemberships, hasCoachAccess, switchActiveMode } from "@/services/teamService";
import { getPublicUserProfiles, updatePublicUserProfile } from "@/services/publicProfileService";
import { flattenStyle } from "@/utils/flatten-style";

const LANGUAGE_OPTIONS = [
  { code: "en", shortLabel: "EN", labelKey: "profile.english" },
  { code: "es", shortLabel: "ES", labelKey: "profile.spanish" },
] as const;

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { activeMode, language, modeHydrated, setActiveMode, setLanguage } = useApp();
  const { loading: authLoading, refreshProfile, user, signOut } = useAuth();
  const [hasCoachRole, setHasCoachRole] = useState(false);
  const [isSwitchingMode, setIsSwitchingMode] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameStatus, setNameStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const isParentMode = activeMode === "parent";

  useEffect(() => {
    let isMounted = true;
    getCurrentUserTeamMemberships()
      .then((memberships) => {
        if (isMounted) setHasCoachRole(memberships.some(hasCoachAccess));
      })
      .catch(() => {
        if (isMounted) setHasCoachRole(false);
      });
    return () => {
      isMounted = false;
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    let active = true;
    void getPublicUserProfiles([user.uid]).then(([profile]) => {
      if (!active) return;
      if (profile?.firstName && profile?.lastName) {
        setFirstName(profile.firstName);
        setLastName(profile.lastName);
        return;
      }
      const parts = (user.displayName ?? "").trim().split(/\s+/u).filter(Boolean);
      setFirstName(parts[0] ?? "");
      setLastName(parts.slice(1).join(" "));
    }).catch(() => {
      if (!active) return;
      const parts = (user.displayName ?? "").trim().split(/\s+/u).filter(Boolean);
      setFirstName(parts[0] ?? "");
      setLastName(parts.slice(1).join(" "));
    });
    return () => { active = false; };
  }, [user?.displayName, user?.uid]);

  const handleSaveName = useCallback(async () => {
    if (isSavingName) return;
    if (!firstName.trim() || !lastName.trim()) {
      setNameStatus({ type: "error", text: t("profile.nameRequired") });
      return;
    }
    setIsSavingName(true);
    setNameStatus(null);
    try {
      await updatePublicUserProfile({ firstName: firstName.trim(), lastName: lastName.trim() });
      await refreshProfile();
      setNameStatus({ type: "success", text: t("profile.nameSaved") });
    } catch {
      setNameStatus({ type: "error", text: t("profile.nameSaveError") });
    } finally {
      setIsSavingName(false);
    }
  }, [firstName, isSavingName, lastName, refreshProfile, t]);

  const handleSignOut = useCallback(async () => {
    if (isSigningOut) return;

    setIsSigningOut(true);
    setSignOutError(null);

    try {
      await signOut();
      router.replace(SIGN_IN_ROUTE as never);
    } catch (nextError) {
      console.warn("[Profile] sign out error:", nextError);
      setSignOutError(t("profile.signOutError"));
      setIsSigningOut(false);
    }
  }, [isSigningOut, signOut, t]);
  const handleCoachPress = useCallback(async () => {
    if (activeMode !== "parent") return;

    const targetRoute = COACH_MODE_ROUTE;
    setIsSwitchingMode(true);
    setModeError(null);

    try {
      if (__DEV__) {
        console.log("[ModeSwitch:toCoach]", {
          previousMode: activeMode,
          nextMode: "coach",
          currentRoute: PARENT_PROFILE_ROUTE,
          targetRoute,
        });
      }

      await switchActiveMode("coach");
      setActiveMode("coach");
      router.dismissAll();
      router.replace(targetRoute as never);
    } catch (nextError) {
      console.warn("[Profile] switch to coach error:", nextError);
      setModeError(t("coach.home.error"));
    } finally {
      setIsSwitchingMode(false);
    }
  }, [activeMode, setActiveMode, t]);

  if (authLoading || !user || !modeHydrated || !isParentMode) {
    return (
      <ScreenWrapper>
        <View style={styles.loadingScreen}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{t("profile.title")}</Text>

        <Card style={styles.card}>
          <Text style={styles.name}>{user?.displayName || t("profile.defaultName")}</Text>
          <Text style={styles.email}>{user?.email || t("profile.notSignedIn")}</Text>
        </Card>

        <Card style={styles.languageCard}>
          <View style={styles.languageCopy}>
            <Text style={styles.cardTitle}>{t("mode.viewingParent")}</Text>
            <Text style={styles.cardText}>{hasCoachRole ? t("coach.home.modeHelp") : t("coach.home.noCoachRole")}</Text>
          </View>
          {modeError ? <Text style={styles.modeError}>{modeError}</Text> : null}
          <View style={styles.modeActions}>
            <TouchableOpacity
              activeOpacity={0.86}
              disabled={isSwitchingMode}
              onPress={handleCoachPress}
              style={flattenStyle([styles.modePrimaryButton, isSwitchingMode && styles.modeDisabledButton])}
            >
              <Text style={styles.modePrimaryText}>{t("mode.switchToCoach")}</Text>
            </TouchableOpacity>
          </View>
        </Card>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("profile.settingsTitle")}</Text>
        </View>

        <Card style={styles.languageCard}>
          <View style={styles.languageCopy}>
            <Text style={styles.cardTitle}>{t("profile.publicIdentityTitle")}</Text>
            <Text style={styles.cardText}>{t("profile.publicIdentityDescription")}</Text>
          </View>
          <Text style={styles.inputLabel}>{t("profile.firstName")}</Text>
          <TextInput
            autoCapitalize="words"
            autoComplete="given-name"
            onChangeText={setFirstName}
            style={styles.input}
            value={firstName}
          />
          <Text style={styles.inputLabel}>{t("profile.lastName")}</Text>
          <TextInput
            autoCapitalize="words"
            autoComplete="family-name"
            onChangeText={setLastName}
            style={styles.input}
            value={lastName}
          />
          <PrimaryButton
            disabled={isSavingName}
            loading={isSavingName}
            onPress={handleSaveName}
            title={t("profile.saveName")}
          />
          {nameStatus ? (
            <Text accessibilityLiveRegion="polite" style={nameStatus.type === "error" ? styles.modeError : styles.nameSuccess}>
              {nameStatus.text}
            </Text>
          ) : null}
        </Card>

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

        <View style={styles.signOutSection}>
          <PrimaryButton
            disabled={isSigningOut}
            loading={isSigningOut}
            onPress={handleSignOut}
            title={t("profile.signOut")}
          />
          {signOutError ? <Text style={styles.signOutError}>{signOutError}</Text> : null}
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
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
  signOutError: {
    color: Colors.primary,
    fontFamily: Typography.bodySemiBold,
    lineHeight: 20,
  },
  signOutSection: {
    gap: Spacing.sm,
    marginTop: Spacing.lg,
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
  inputLabel: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
  input: {
    backgroundColor: Colors.surface,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    borderWidth: 1,
    color: Colors.textHeading,
    fontFamily: Typography.bodyRegular,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: Spacing.md,
  },
  nameSuccess: {
    color: Colors.accentGreen,
    fontFamily: Typography.bodySemiBold,
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
