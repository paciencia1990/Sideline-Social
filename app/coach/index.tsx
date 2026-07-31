import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Archive, ChevronDown, ChevronUp, MessageCircle, MessagesSquare, RotateCcw, Shield, Users, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { PARENT_PROFILE_ROUTE } from "@/constants/routes";
import { Colors, Radius, Shadow, Spacing, TeamCodeTypography, Typography } from "@/constants/theme";
import { useApp } from "@/context/AppContext";
import {
  canManageTeamRoles,
  getArchivedCoachTeamCount,
  getArchivedCoachTeamMembershipsPage,
  getCurrentUserTeamMemberships,
  hasCoachAccess,
  hasTeamRole,
  isTeamActive,
  setTeamArchived,
  switchActiveMode,
  type TeamMembership,
} from "@/services/teamService";
import { getTeamPrivateMessageInboxPage } from "@/services/teamPrivateMessageService";
import { shouldShowPrivateMessagesCard, type PrivateInboxLoadState } from "@/utils/coachCommunicationCore";

export default function CoachHomeScreen() {
  const { t } = useTranslation();
  const { activeMode, modeHydrated, setActiveMode } = useApp();
  const [memberships, setMemberships] = useState<TeamMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSwitchingMode, setIsSwitchingMode] = useState(false);
  const [restoringTeamId, setRestoringTeamId] = useState<string | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [archivedTeams, setArchivedTeams] = useState<TeamMembership[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [archivedHasMore, setArchivedHasMore] = useState(false);
  const [archivedNextOffset, setArchivedNextOffset] = useState(0);
  const [privateInbox, setPrivateInbox] = useState<{
    conversationCount: number;
    loadState: PrivateInboxLoadState;
    unreadCount: number;
  }>({ conversationCount: 0, loadState: "loading", unreadCount: 0 });

  const loadTeams = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLifecycleError(null);
    try {
      const [nextMemberships, nextArchivedCount] = await Promise.all([
        getCurrentUserTeamMemberships(),
        getArchivedCoachTeamCount(),
      ]);
      setMemberships(nextMemberships);
      setArchivedCount(nextArchivedCount);
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

  const coachTeams = memberships.filter((membership) => hasCoachAccess(membership) && isTeamActive(membership.team));
  const visibleArchivedTeams = archivedTeams.filter((membership) =>
    canManageTeamRoles(membership, membership.team),
  );

  const loadArchivedTeams = useCallback(async (reset = false) => {
    if (archivedLoading) return;
    setArchivedLoading(true);
    setArchivedError(null);
    try {
      const page = await getArchivedCoachTeamMembershipsPage(reset ? 0 : archivedNextOffset, 8, { throwOnError: true });
      setArchivedTeams((current) => reset ? page.memberships : [...current, ...page.memberships]);
      setArchivedCount(page.totalCount);
      setArchivedHasMore(page.hasMore);
      setArchivedNextOffset(page.nextOffset);
    } catch (nextError) {
      console.warn("[CoachHome] archived teams load error:", getErrorCode(nextError));
      setArchivedError(t("coach.team.archivedTeamsLoadError"));
    } finally {
      setArchivedLoading(false);
    }
  }, [archivedLoading, archivedNextOffset, t]);

  const toggleArchivedTeams = useCallback(() => {
    setArchivedExpanded((current) => {
      const next = !current;
      if (next && archivedTeams.length === 0 && archivedCount > 0) {
        void loadArchivedTeams(true);
      }
      return next;
    });
  }, [archivedCount, archivedTeams.length, loadArchivedTeams]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setPrivateInbox((current) => ({ ...current, loadState: "loading" }));
      void getTeamPrivateMessageInboxPage("coach", undefined, 0, 50).then((page) => {
        if (!active) return;
        setPrivateInbox({
          conversationCount: page.conversations.length,
          loadState: "loaded",
          unreadCount: page.conversations.reduce((total, conversation) => total + conversation.unreadCount, 0),
        });
      }).catch((nextError) => {
        if (!active) return;
        console.info("[CoachHome] private inbox unavailable", { code: getErrorCode(nextError) });
        setPrivateInbox({ conversationCount: 0, loadState: "error", unreadCount: 0 });
      });
      return () => { active = false; };
    }, []),
  );
  const parentTeams = memberships.filter((membership) =>
    hasTeamRole(membership, "parent") && isTeamActive(membership.team),
  );
  const selectedMembership = coachTeams[0] ?? null;
  const selectedTeam = selectedMembership?.team ?? null;
  const hasTeams = coachTeams.length > 0;
  const teamSectionTitle = hasTeams ? t("coach.home.addTeam") : t("coach.home.getStarted");
  const teamActionLabel = hasTeams ? t("coach.home.addTeam") : t("coach.team.createTeam");
  const showPrivateMessages = shouldShowPrivateMessagesCard({
    ...privateInbox,
    hasActiveTeam: Boolean(selectedTeam),
  });

  useEffect(() => {
    if (!__DEV__ || loading || activeMode !== "coach") return;

    console.log("[CoachMode:teamSection]", {
      teamsLoading: loading,
      teamCount: coachTeams.length,
      hasTeams,
      sectionTitle: hasTeams ? "Add Team" : "Get Started",
    });
  }, [activeMode, coachTeams.length, hasTeams, loading]);

  const switchToParent = useCallback(async () => {
    const targetRoute = PARENT_PROFILE_ROUTE;
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

  const restoreTeam = useCallback(async (membership: TeamMembership) => {
    if (!membership.team || restoringTeamId) return;
    setRestoringTeamId(membership.teamId);
    setLifecycleError(null);
    try {
      await setTeamArchived(membership.teamId, false);
      await loadTeams();
      setArchivedTeams([]);
      setArchivedNextOffset(0);
      setArchivedHasMore(false);
      if (archivedExpanded) {
        await loadArchivedTeams(true);
      }
      Alert.alert(t("coach.team.restoreSuccessTitle"), t("coach.team.restoreSuccessBody"));
    } catch (nextError) {
      console.warn("[CoachHome] restore error:", getErrorCode(nextError));
      setLifecycleError(t("coach.team.restoreError"));
    } finally {
      setRestoringTeamId(null);
    }
  }, [archivedExpanded, loadArchivedTeams, loadTeams, restoringTeamId, t]);

  const confirmRestore = useCallback((membership: TeamMembership) => {
    if (!membership.team || restoringTeamId) return;
    Alert.alert(
      t("coach.team.restoreTitle", { teamName: membership.team.name }),
      t("coach.team.restoreBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("coach.team.restoreTeam"), onPress: () => { void restoreTeam(membership); } },
      ],
    );
  }, [restoreTeam, restoringTeamId, t]);

  if (!modeHydrated || activeMode !== "coach") {
    return (
      <ScreenWrapper>
        <View style={styles.centerScreen}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.kicker}>{t("mode.coach")}</Text>
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
              <Text style={styles.cardTitle}>{hasTeams ? t("mode.viewingCoach") : t("startMode.coachWelcome")}</Text>
              <Text style={styles.cardText}>{hasTeams ? t("coach.home.modeHelp") : t("startMode.coachWelcomeBody")}</Text>
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  activeOpacity={0.86}
                  disabled={isSwitchingMode}
                  onPress={switchToParent}
                  style={[styles.outlineButton, isSwitchingMode && styles.disabledButton]}
                >
                  <Text style={styles.outlineButtonText}>{t("mode.switchToParent")}</Text>
                </TouchableOpacity>
              </View>
            </Card>

            {selectedTeam ? (
              <Card style={styles.cardGap}>
                <Text style={styles.cardTitle}>{selectedTeam.name}</Text>
                <Text style={styles.cardText}>{[selectedTeam.sport, selectedTeam.ageRange, selectedTeam.division].filter(Boolean).join(" - ")}</Text>
                <View style={styles.inviteBlock}>
                  <Text style={styles.inviteLabel}>{t("coach.team.inviteCode")}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.inviteCode}>{selectedTeam.inviteCode}</Text>
                </View>
                <View style={styles.quickGrid}>
                  <QuickAction label={t("coach.home.viewTeam")} Icon={Users} onPress={() => router.push({ pathname: "/coach/team", params: { teamId: selectedTeam.id } } as never)} />
                  <QuickAction label={t("coach.home.sendMessage")} Icon={MessageCircle} onPress={() => router.push({ pathname: "/coach/messages", params: { teamId: selectedTeam.id } } as never)} />
                  {showPrivateMessages ? <QuickAction badge={privateInbox.unreadCount > 0 ? t("teamMessages.unread", { count: privateInbox.unreadCount }) : undefined} label={t("teamMessages.title")} Icon={MessagesSquare} onPress={() => router.push("/coach/team-messages" as never)} /> : null}
                  <QuickAction label={t("coach.home.resources")} Icon={Shield} onPress={() => router.push("/coach/resources" as never)} />
                </View>
              </Card>
            ) : null}

            {archivedCount > 0 ? (
              <Card style={styles.cardGap}>
                <TouchableOpacity
                  accessibilityLabel={t(archivedExpanded ? "coach.team.archivedTeamsCollapse" : "coach.team.archivedTeamsExpand", { count: archivedCount })}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: archivedExpanded }}
                  activeOpacity={0.82}
                  onPress={toggleArchivedTeams}
                  style={styles.archivedHeader}
                >
                  <View style={styles.archivedTitleRow}>
                    <Archive color={Colors.primary} size={20} />
                    <View style={styles.archivedTitleCopy}>
                      <Text style={styles.cardTitle}>{t("coach.team.archivedTeams")}</Text>
                      <Text style={styles.cardText}>{t("coach.team.archivedTeamsCount", { count: archivedCount })}</Text>
                    </View>
                  </View>
                  {archivedExpanded ? <ChevronUp color={Colors.textHeading} size={22} /> : <ChevronDown color={Colors.textHeading} size={22} />}
                </TouchableOpacity>
                {archivedExpanded ? (
                  <View style={styles.archivedBody}>
                    {visibleArchivedTeams.map((membership) => (
                      <View key={membership.teamId} style={styles.archivedRow}>
                        <View style={styles.archivedCopy}>
                          <Text style={styles.archivedName}>{membership.team?.name}</Text>
                          <Text style={styles.cardText}>{membership.team?.sport}</Text>
                          <Text style={styles.archivedStatus}>{t("coach.team.archivedStatus")}</Text>
                        </View>
                        <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityState={{ busy: restoringTeamId === membership.teamId, disabled: Boolean(restoringTeamId) }}
                          disabled={Boolean(restoringTeamId)}
                          onPress={() => confirmRestore(membership)}
                          style={[styles.restoreButton, Boolean(restoringTeamId) && styles.disabledButton]}
                        >
                          {restoringTeamId === membership.teamId
                            ? <ActivityIndicator color={Colors.surface} size="small" />
                            : <RotateCcw color={Colors.surface} size={17} />}
                          <Text style={styles.primaryButtonText}>
                            {restoringTeamId === membership.teamId ? t("coach.team.restoring") : t("coach.team.restoreTeam")}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    {archivedLoading ? (
                      <View accessibilityLiveRegion="polite" style={styles.centerInline}>
                        <ActivityIndicator color={Colors.primary} />
                        <Text style={styles.cardText}>{t("coach.team.archivedTeamsLoading")}</Text>
                      </View>
                    ) : null}
                    {!archivedLoading && archivedError ? (
                      <View accessibilityLiveRegion="polite" style={styles.centerInline}>
                        <Text style={styles.errorText}>{archivedError}</Text>
                        <TouchableOpacity accessibilityRole="button" onPress={() => { void loadArchivedTeams(visibleArchivedTeams.length === 0); }} style={styles.outlineButton}>
                          <Text style={styles.outlineButtonText}>{t("common.retry")}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                    {!archivedLoading && !archivedError && archivedHasMore ? (
                      <TouchableOpacity accessibilityRole="button" onPress={() => { void loadArchivedTeams(false); }} style={styles.outlineButton}>
                        <Text style={styles.outlineButtonText}>{t("coach.team.archivedTeamsLoadMore")}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
                {lifecycleError ? <Text accessibilityLiveRegion="polite" style={styles.errorText}>{lifecycleError}</Text> : null}
              </Card>
            ) : null}

            <Card style={styles.cardGap}>
              <Text style={styles.cardTitle}>{teamSectionTitle}</Text>
              <View style={styles.buttonRow}>
                <TouchableOpacity activeOpacity={0.86} onPress={() => router.push("/coach/create-team" as never)} style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>{teamActionLabel}</Text>
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

function QuickAction({ Icon, badge, label, onPress }: { Icon: LucideIcon; badge?: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.86} onPress={onPress} style={styles.quickAction}>
      <Icon size={21} color={Colors.primary} />
      <Text style={styles.quickText}>{label}</Text>
      {badge ? <Text style={styles.quickBadge}>{badge}</Text> : null}
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
  centerScreen: { alignItems: "center", flex: 1, justifyContent: "center" },
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  header: { alignItems: "center", gap: Spacing.xs },
  kicker: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 12, textTransform: "uppercase" },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 31, textAlign: "center" },
  subtitle: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21, textAlign: "center" },
  cardGap: { gap: Spacing.md },
  archivedHeader: { alignItems: "center", flexDirection: "row", gap: Spacing.sm, justifyContent: "space-between" },
  archivedTitleRow: { alignItems: "center", flex: 1, flexDirection: "row", gap: Spacing.sm },
  archivedTitleCopy: { flex: 1, gap: 2 },
  archivedBody: { gap: Spacing.sm },
  archivedRow: { alignItems: "center", borderTopColor: Colors.secondary, borderTopWidth: 1, flexDirection: "row", gap: Spacing.sm, paddingTop: Spacing.md },
  archivedCopy: { flex: 1, gap: 2 },
  archivedName: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 16 },
  archivedStatus: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 11, textTransform: "uppercase" },
  modeCard: { gap: Spacing.md, borderLeftColor: Colors.accentGreen, borderLeftWidth: 4 },
  centerCard: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.lg },
  centerInline: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.sm },
  cardTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 18, textAlign: "center" },
  cardText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21, textAlign: "center" },
  inviteBlock: { alignItems: "center", gap: 3 },
  inviteLabel: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 12, textAlign: "center", textTransform: "uppercase" },
  inviteCode: { ...TeamCodeTypography, color: Colors.primary, fontSize: 18 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  quickAction: { alignItems: "center", backgroundColor: Colors.surface, borderColor: Colors.secondary, borderRadius: Radius.card, borderWidth: 1, flexBasis: "31%", flexGrow: 1, gap: Spacing.xs, minHeight: 86, justifyContent: "center", padding: Spacing.sm, ...Shadow.card },
  quickText: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 12, textAlign: "center" },
  quickBadge: { backgroundColor: Colors.primary, borderRadius: Radius.button, color: Colors.surface, fontFamily: Typography.bodyBold, fontSize: 10, overflow: "hidden", paddingHorizontal: Spacing.xs, paddingVertical: 2 },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, justifyContent: "center" },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, flexGrow: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  primaryButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  outlineButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flexGrow: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  outlineButtonText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  disabledButton: { opacity: 0.6 },
  restoreButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 42, paddingHorizontal: Spacing.md },
  errorText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  countRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm, justifyContent: "center" },
  countText: { color: Colors.textPrimary, fontFamily: Typography.bodySemiBold, fontSize: 12 },
});

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}
