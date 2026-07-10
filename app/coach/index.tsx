import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { MessageCircle, Shield, Users, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { useApp } from "@/context/AppContext";
import { getCurrentUserTeamMemberships, isCoachRole, switchActiveMode, type TeamMembership } from "@/services/teamService";

export default function CoachHomeScreen() {
  const { t } = useTranslation();
  const { activeMode, setActiveMode } = useApp();
  const [memberships, setMemberships] = useState<TeamMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSwitchingMode, setIsSwitchingMode] = useState(false);

  const loadTeams = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMemberships(await getCurrentUserTeamMemberships());
    } catch (nextError) {
      console.warn("[CoachHome] load error:", nextError);
      setError(t("coach.home.error"));
      setMemberships([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void loadTeams();
    }, [loadTeams]),
  );

  useEffect(() => {
    const coachTeams = memberships.filter((membership) => isCoachRole(membership.role));
    if (activeMode === "coach" && coachTeams.length === 0) {
      setActiveMode("parent");
    }
  }, [activeMode, memberships, setActiveMode]);

  const coachTeams = memberships.filter((membership) => isCoachRole(membership.role));
  const parentTeams = memberships.filter((membership) => membership.role === "parent");
  const selectedMembership = coachTeams[0] ?? memberships[0] ?? null;
  const selectedTeam = selectedMembership?.team ?? null;
  const canUseCoachMode = coachTeams.length > 0;

  const switchToCoach = useCallback(async () => {
    if (!canUseCoachMode) return;
    setIsSwitchingMode(true);
    setError(null);

    try {
      await switchActiveMode("coach");
      setActiveMode("coach");
    } catch (nextError) {
      console.warn("[CoachHome] switch to coach error:", nextError);
      setError(t("coach.home.error"));
    } finally {
      setIsSwitchingMode(false);
    }
  }, [canUseCoachMode, setActiveMode, t]);

  const switchToParent = useCallback(async () => {
    const targetRoute = "/(tabs)/profile";
    setIsSwitchingMode(true);
    setError(null);

    try {
      if (__DEV__) {
        console.log("[ModeSwitch:toParent]", {
          previousMode: activeMode,
          nextMode: "parent",
          currentRoute: "/coach",
          targetRoute,
        });
      }

      await switchActiveMode("parent");
      setActiveMode("parent");
      router.dismissAll();
      router.replace(targetRoute as never);
    } catch (nextError) {
      console.warn("[CoachHome] switch to parent error:", nextError);
      setError(t("coach.home.error"));
    } finally {
      setIsSwitchingMode(false);
    }
  }, [activeMode, setActiveMode, t]);

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.kicker}>{activeMode === "coach" ? t("mode.coach") : t("mode.parent")}</Text>
          <Text style={styles.title}>{t("coach.home.title")}</Text>
          <Text style={styles.subtitle}>{t("coach.home.subtitle")}</Text>
        </View>

        {loading ? (
          <Card style={styles.centerCard}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.cardText}>{t("common.loading")}</Text>
          </Card>
        ) : null}

        {!loading && error ? <StateCard title={t("coach.home.errorTitle")} body={error} /> : null}

        {!loading && !error ? (
          <>
            <Card style={styles.modeCard}>
              <Text style={styles.cardTitle}>{activeMode === "coach" ? t("mode.viewingCoach") : t("mode.viewingParent")}</Text>
              <Text style={styles.cardText}>
                {canUseCoachMode ? t("coach.home.modeHelp") : t("coach.home.noCoachRole")}
              </Text>
              <View style={styles.buttonRow}>
                {activeMode === "coach" ? (
                  <TouchableOpacity
                    activeOpacity={0.86}
                    disabled={isSwitchingMode}
                    onPress={switchToParent}
                    style={[styles.outlineButton, isSwitchingMode && styles.disabledButton]}
                  >
                    <Text style={styles.outlineButtonText}>{t("mode.switchToParent")}</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    activeOpacity={0.86}
                    disabled={!canUseCoachMode || isSwitchingMode}
                    onPress={switchToCoach}
                    style={[styles.primaryButton, (!canUseCoachMode || isSwitchingMode) && styles.disabledButton]}
                  >
                    <Text style={styles.primaryButtonText}>{t("mode.switchToCoach")}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </Card>

            {selectedTeam ? (
              <Card style={styles.cardGap}>
                <Text style={styles.cardTitle}>{selectedTeam.name}</Text>
                <Text style={styles.cardText}>{[selectedTeam.sport, selectedTeam.ageRange, selectedTeam.division].filter(Boolean).join(" • ")}</Text>
                <Text style={styles.inviteCode}>{t("coach.team.inviteCode")}: {selectedTeam.inviteCode}</Text>
                <View style={styles.quickGrid}>
                  <QuickAction label={t("coach.home.viewTeam")} Icon={Users} onPress={() => router.push({ pathname: "/coach/team", params: { teamId: selectedTeam.id } } as never)} />
                  <QuickAction label={t("coach.home.sendMessage")} Icon={MessageCircle} onPress={() => router.push({ pathname: "/coach/messages", params: { teamId: selectedTeam.id } } as never)} />
                  <QuickAction label={t("coach.home.resources")} Icon={Shield} onPress={() => router.push("/coach/resources" as never)} />
                </View>
              </Card>
            ) : (
              <StateCard title={t("coach.home.emptyTitle")} body={t("coach.home.emptyBody")} />
            )}

            <Card style={styles.cardGap}>
              <Text style={styles.cardTitle}>{t("coach.home.getStarted")}</Text>
              <View style={styles.buttonRow}>
                <TouchableOpacity activeOpacity={0.86} onPress={() => router.push("/coach/team" as never)} style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>{t("coach.team.createTeam")}</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.86} onPress={() => router.push("/teams/join" as never)} style={styles.outlineButton}>
                  <Text style={styles.outlineButtonText}>{t("coach.team.joinTeam")}</Text>
                </TouchableOpacity>
              </View>
            </Card>

            <View style={styles.countRow}>
              <Text style={styles.countText}>{t("coach.home.coachTeams", { count: coachTeams.length })}</Text>
              <Text style={styles.countText}>{t("coach.home.parentTeams", { count: parentTeams.length })}</Text>
            </View>
          </>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function QuickAction({ Icon, label, onPress }: { Icon: LucideIcon; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.86} onPress={onPress} style={styles.quickAction}>
      <Icon size={21} color={Colors.primary} />
      <Text style={styles.quickText}>{label}</Text>
    </TouchableOpacity>
  );
}

function StateCard({ body, title }: { body: string; title: string }) {
  return (
    <Card style={styles.centerCard}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardText}>{body}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  header: { alignItems: "center", gap: Spacing.xs },
  kicker: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 12, textTransform: "uppercase" },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 31, textAlign: "center" },
  subtitle: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21, textAlign: "center" },
  cardGap: { gap: Spacing.md },
  modeCard: { gap: Spacing.md, borderLeftColor: Colors.accentGreen, borderLeftWidth: 4 },
  centerCard: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.lg },
  cardTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 18, textAlign: "center" },
  cardText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20, textAlign: "center" },
  inviteCode: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 15, textAlign: "center" },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, justifyContent: "center" },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, flexGrow: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  primaryButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  outlineButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flexGrow: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  outlineButtonText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  disabledButton: { opacity: 0.45 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  quickAction: { alignItems: "center", backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, flexBasis: "31%", flexGrow: 1, gap: Spacing.xs, justifyContent: "center", minHeight: 82, padding: Spacing.sm, ...Shadow.card },
  quickText: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 12, textAlign: "center" },
  countRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, justifyContent: "center" },
  countText: { backgroundColor: Colors.surface, borderRadius: Radius.sm, color: Colors.textPrimary, fontFamily: Typography.bodySemiBold, overflow: "hidden", paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
});
