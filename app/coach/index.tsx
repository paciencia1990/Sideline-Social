import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Archive, CalendarDays, ChevronDown, ChevronUp, MessageCircle, MessagesSquare, RotateCcw, Shield, Users, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { replaceAfterOptionalDismiss } from "@/components/NestedBackButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { PARENT_PROFILE_ROUTE } from "@/constants/routes";
import { TEAM_HISTORY_PAGE_SIZES } from "@/constants/teamHistoryPagination";
import { Colors, Radius, Shadow, Spacing, TeamCodeTypography, Typography } from "@/constants/theme";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { auth } from "@/config/firebase";
import { switchModeImmediately } from "@/utils/modeSwitch";
import {
  canManageTeamRoles,
  getArchivedCoachTeamMembershipsPage,
  getConfirmedCoachHomeTeams,
  getCoachHomeLookupDiagnostic,
  hasCoachAccess,
  hasTeamRole,
  isTeamActive,
  setTeamArchived,
  switchActiveMode,
  type TeamMembership,
} from "@/services/teamService";
import { getTeamPrivateMessageInboxPage } from "@/services/teamPrivateMessageService";
import { shouldShowPrivateMessagesCard, type PrivateInboxLoadState } from "@/utils/coachCommunicationCore";
import { createCoachHomeTeamCards } from "@/utils/coachHomeTeamCards";
import { resolveCoachResourcesAccess } from "@/utils/coachResourcesAccess";
import { loadCoachHomeData } from "@/utils/coachHomeRecovery";
import { isTransientTeamReadError, requireTeamReadReady } from "@/services/teamReadReadiness";

export default function CoachHomeScreen() {
  const { t } = useTranslation();
  const { activeMode, modeHydrated, setActiveMode } = useApp();
  const { user } = useAuth();
  const currentUserId = useRef(user?.uid);
  currentUserId.current = user?.uid;
  const [memberships, setMemberships] = useState<TeamMembership[]>([]);
  const [teamDataOwner, setTeamDataOwner] = useState<string | null>(null);
  const confirmedTeamOwner = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isSwitchingMode = useRef(false);
  const loadVersion = useRef(0);
  const loadAbort = useRef<AbortController | null>(null);
  const [archiveCountUnavailable, setArchiveCountUnavailable] = useState(false);
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
  const teamReadConfirmed = Boolean(user?.uid) && teamDataOwner === user?.uid;

  const loadTeams = useCallback(async () => {
    loadAbort.current?.abort();
    const controller = new AbortController();
    loadAbort.current = controller;
    const version = ++loadVersion.current;
    const requestUserId = user?.uid;
    const isCurrentLoad = () => !controller.signal.aborted && version === loadVersion.current && requestUserId === currentUserId.current;
    setLoading(true);
    if (!requestUserId || confirmedTeamOwner.current !== requestUserId) {
      confirmedTeamOwner.current = null;
      setTeamDataOwner(null);
      setMemberships([]);
    }
    setError(null);
    setLifecycleError(null);
    setArchivedTeams([]);
    setArchivedExpanded(false);
    setArchivedCount(0);
    setArchivedLoading(false);
    setArchivedError(null);
    setArchivedHasMore(false);
    setArchivedNextOffset(0);
    setArchiveCountUnavailable(false);
    try {
      // Security startup has its own bound; the team-data deadline begins only
      // after readiness, rather than consuming the read budget during startup.
      await requireTeamReadReady(requestUserId ?? "");
      if (!isCurrentLoad()) return;
      const confirmedTeams = getConfirmedCoachHomeTeams(requestUserId ?? "", { signal: controller.signal });
      const next = await loadCoachHomeData({
        memberships: async () => (await confirmedTeams).memberships,
        archivedCount: async () => {
          const count = (await confirmedTeams).archivedCount;
          if (count === null) throw new Error("Archive count unconfirmed");
          return count;
        },
      });
      if (!isCurrentLoad()) return;
      if (!requestUserId || auth.currentUser?.uid !== requestUserId) {
        throw new Error("Coach session changed");
      }
      setMemberships(next.memberships);
      setArchivedCount(next.archivedCount);
      setArchiveCountUnavailable(next.archiveCountUnavailable);
      confirmedTeamOwner.current = requestUserId;
      setTeamDataOwner(requestUserId);
      if (next.memberships.length === 0) {
        console.info("[CoachHome] team lookup confirmed", { reason: "verified_empty", serverConfirmed: true, sessionCurrent: true });
      }
    } catch (nextError) {
      if (!isCurrentLoad()) return;
      const diagnostic = !requestUserId || auth.currentUser?.uid !== requestUserId
        ? { reason: "session_unconfirmed" as const, serverConfirmed: false, code: "team-read/session-unconfirmed" }
        : getCoachHomeLookupDiagnostic(nextError);
      console.warn("[CoachHome] team lookup unconfirmed", {
        ...diagnostic, sessionCurrent: Boolean(requestUserId && auth.currentUser?.uid === requestUserId),
      });
      setError(t(diagnostic.reason === "session_unconfirmed" ? "coach.home.sessionUnconfirmed" : "coach.home.teamLoadUnconfirmed"));
      if (confirmedTeamOwner.current !== requestUserId || !isTransientTeamReadError({ code: diagnostic.code })) {
        confirmedTeamOwner.current = null;
        setTeamDataOwner(null);
        setMemberships([]);
      }
    } finally {
      if (isCurrentLoad()) setLoading(false);
      if (loadAbort.current === controller) loadAbort.current = null;
      controller.abort();
    }
  }, [t, user?.uid]);

  useFocusEffect(
    useCallback(() => {
      isSwitchingMode.current = false;
      void loadTeams();
      return () => { loadVersion.current += 1; loadAbort.current?.abort(); loadAbort.current = null; };
    }, [loadTeams]),
  );

  const coachTeams = memberships.filter((membership) => hasCoachAccess(membership) && isTeamActive(membership.team));
  const visibleArchivedTeams = archivedTeams.filter((membership) =>
    canManageTeamRoles(membership, membership.team),
  );

  const loadArchivedTeams = useCallback(async (reset = false) => {
    if (archivedLoading || !teamReadConfirmed) return;
    const requestUserId = user?.uid;
    const version = loadVersion.current;
    const isCurrent = () => version === loadVersion.current && requestUserId === currentUserId.current && auth.currentUser?.uid === requestUserId;
    setArchivedLoading(true);
    setArchivedError(null);
    try {
      const page = await getArchivedCoachTeamMembershipsPage(reset ? 0 : archivedNextOffset, TEAM_HISTORY_PAGE_SIZES.archivedTeams, { throwOnError: true });
      if (!isCurrent()) return;
      setArchivedTeams((current) => reset ? page.memberships : [...current, ...page.memberships]);
      setArchivedCount(page.totalCount);
      setArchivedHasMore(page.hasMore);
      setArchivedNextOffset(page.nextOffset);
    } catch (nextError) {
      if (!isCurrent()) return;
      console.warn("[CoachHome] archived teams load error:", getErrorCode(nextError));
      setArchivedError(t("coach.team.archivedTeamsLoadError"));
    } finally {
      if (isCurrent()) setArchivedLoading(false);
    }
  }, [archivedLoading, archivedNextOffset, t, teamReadConfirmed, user?.uid]);

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
      const requestUserId = user?.uid;
      setPrivateInbox({ conversationCount: 0, loadState: "loading", unreadCount: 0 });
      void getTeamPrivateMessageInboxPage("coach", undefined, null, 50).then((page) => {
        if (!active || requestUserId !== currentUserId.current) return;
        setPrivateInbox({
          conversationCount: page.conversations.length,
          loadState: "loaded",
          unreadCount: page.conversations.reduce((total, conversation) => total + conversation.unreadCount, 0),
        });
      }).catch((nextError) => {
        if (!active || requestUserId !== currentUserId.current) return;
        console.info("[CoachHome] private inbox unavailable", { code: getErrorCode(nextError) });
        setPrivateInbox({ conversationCount: 0, loadState: "error", unreadCount: 0 });
      });
      return () => { active = false; };
    }, [user?.uid]),
  );
  const parentTeams = memberships.filter((membership) =>
    hasTeamRole(membership, "parent") && isTeamActive(membership.team),
  );
  const teamCards = createCoachHomeTeamCards(coachTeams);
  const hasTeams = coachTeams.length > 0;
  const teamSectionTitle = hasTeams ? t("coach.home.addTeam") : t("coach.home.getStarted");
  const teamActionLabel = hasTeams ? t("coach.home.addTeam") : t("coach.team.createTeam");
  const showPrivateMessages = shouldShowPrivateMessagesCard({
    ...privateInbox,
    hasActiveTeam: teamCards.length > 0,
  });
  const showCoachResources = resolveCoachResourcesAccess({
    activeMode: modeHydrated ? activeMode : null,
    authenticatedUserId: user?.uid,
    loadState: loading ? "loading" : error || !teamReadConfirmed ? "error" : "loaded",
    memberships,
  }) === "allowed";

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
    if (!user?.uid) return;
    const userId = user.uid;
    try {
      await switchModeImmediately({
        inFlight: isSwitchingMode,
        mode: "parent",
        isCurrentAccount: () => auth.currentUser?.uid === userId,
        setMode: (mode) => { loadVersion.current += 1; setActiveMode(mode); },
        navigate: () => replaceAfterOptionalDismiss(PARENT_PROFILE_ROUTE),
        persist: switchActiveMode,
        onPersistenceError: () => Alert.alert(t("mode.preferenceUnavailableTitle"), t("mode.preferenceUnavailableBody")),
      });
    } catch (nextError) {
      console.warn("[CoachHome] mode preference unavailable:", getErrorCode(nextError));
    }
  }, [setActiveMode, t, user?.uid]);

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

        {!loading && error ? (
          <Card style={styles.centerCard}>
            <Text accessibilityLiveRegion="polite" style={styles.cardTitle}>{t("coach.home.teamLoadUnconfirmedTitle")}</Text>
            <Text style={styles.cardText}>{error}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => { void loadTeams(); }} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{t("common.retry")}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {(loading || error) && teamReadConfirmed && coachTeams.length > 0 ? (
          <Card style={styles.centerCard}>
            <Text accessibilityLiveRegion="polite" style={styles.cardText}>{t("coach.home.lastConfirmedTeams")}</Text>
            {teamCards.map((teamCard) => <Text key={teamCard.teamId} style={styles.cardTitle}>{teamCard.name}</Text>)}
          </Card>
        ) : null}

        <Card style={styles.modeCard}>
          <Text style={styles.cardTitle}>{loading || error || !teamReadConfirmed ? t("mode.coach") : hasTeams ? t("mode.viewingCoach") : t("startMode.coachWelcome")}</Text>
          <Text style={styles.cardText}>{loading || error || !teamReadConfirmed ? t("coach.home.recoveryHelp") : hasTeams ? t("coach.home.modeHelp") : t("startMode.coachWelcomeBody")}</Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              activeOpacity={0.86}
              accessibilityRole="button"
              onPress={switchToParent}
              style={styles.outlineButton}
            >
              <Text style={styles.outlineButtonText}>{t("mode.switchToParent")}</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {teamReadConfirmed && !loading && !error ? (
          <>
            {archiveCountUnavailable ? (
              <Card style={styles.centerCard}>
                <Text accessibilityLiveRegion="polite" style={styles.cardText}>{t("coach.home.archiveUnavailable")}</Text>
                <TouchableOpacity accessibilityRole="button" onPress={() => { void loadTeams(); }} style={styles.outlineButton}>
                  <Text style={styles.outlineButtonText}>{t("common.retry")}</Text>
                </TouchableOpacity>
              </Card>
            ) : null}
            {showCoachResources ? <Card style={styles.resourceCard}>
              <View style={styles.resourceHeading}>
                <Shield color={Colors.primary} size={24} />
                <View style={styles.resourceCopy}>
                  <Text style={styles.cardTitle}>{t("coach.home.resources")}</Text>
                  <Text style={styles.cardText}>{t("coach.resources.subtitle")}</Text>
                </View>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                activeOpacity={0.86}
                onPress={() => router.push("/coach/resources" as never)}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>{t("coach.home.resources")}</Text>
              </TouchableOpacity>
            </Card> : null}

            {teamCards.map((teamCard) => (
              <Card key={teamCard.teamId} style={styles.cardGap}>
                <Text style={styles.cardTitle}>{teamCard.name}</Text>
                <Text style={styles.cardText}>{[teamCard.sport, teamCard.ageRange, teamCard.division].filter(Boolean).join(" - ")}</Text>
                <View style={styles.inviteBlock}>
                  <Text style={styles.inviteLabel}>{t("coach.team.inviteCode")}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.inviteCode}>{teamCard.inviteCode}</Text>
                </View>
                <View style={styles.quickGrid}>
                  <QuickAction label={t("coach.home.viewTeam")} Icon={Users} onPress={() => router.push({ pathname: "/coach/team", params: { teamId: teamCard.teamId } } as never)} />
                  <QuickAction label={t("coach.home.sendMessage")} Icon={MessageCircle} onPress={() => router.push({ pathname: "/coach/messages", params: { teamId: teamCard.teamId } } as never)} />
                  <QuickAction label={t("schedule.title")} Icon={CalendarDays} onPress={() => router.push({ pathname: "/teams/[teamId]/schedule", params: { teamId: teamCard.teamId } } as never)} />
                  {showPrivateMessages ? <QuickAction badge={privateInbox.unreadCount > 0 ? t("teamMessages.unread", { count: privateInbox.unreadCount }) : undefined} label={t("teamMessages.title")} Icon={MessagesSquare} onPress={() => router.push({ pathname: "/coach/team-messages", params: { teamId: teamCard.teamId } } as never)} /> : null}
                </View>
              </Card>
            ))}

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
                        <View style={styles.archivedActions}>
                          <TouchableOpacity accessibilityRole="button" onPress={() => router.push({ pathname: "/coach/messages", params: { teamId: membership.teamId } } as never)} style={styles.archivedScheduleButton}>
                            <MessageCircle color={Colors.communicationLink} size={17} />
                            <Text style={styles.archivedScheduleText}>{t("coach.messages.threadList")}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity accessibilityRole="button" onPress={() => router.push({ pathname: "/coach/team-messages", params: { teamId: membership.teamId } } as never)} style={styles.archivedScheduleButton}>
                            <MessagesSquare color={Colors.communicationLink} size={17} />
                            <Text style={styles.archivedScheduleText}>{t("teamMessages.title")}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity accessibilityRole="button" onPress={() => router.push({ pathname: "/teams/[teamId]/schedule", params: { teamId: membership.teamId } } as never)} style={styles.archivedScheduleButton}>
                            <CalendarDays color={Colors.communicationLink} size={17} />
                            <Text style={styles.archivedScheduleText}>{t("schedule.title")}</Text>
                          </TouchableOpacity>
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
  archivedActions: { gap: Spacing.xs },
  archivedScheduleButton: { alignItems: "center", borderColor: Colors.communicationLink, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 42, paddingHorizontal: Spacing.sm },
  archivedScheduleText: { color: Colors.communicationLink, fontFamily: Typography.bodySemiBold, fontSize: 12 },
  modeCard: { gap: Spacing.md, borderLeftColor: Colors.accentGreen, borderLeftWidth: 4 },
  resourceCard: { gap: Spacing.md },
  resourceCopy: { flex: 1, gap: Spacing.xs },
  resourceHeading: { alignItems: "flex-start", flexDirection: "row", gap: Spacing.sm },
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
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  return /^(?:(?:firestore|functions)\/)?(?:aborted|already-exists|cancelled|deadline-exceeded|failed-precondition|internal|invalid-argument|not-found|permission-denied|resource-exhausted|unauthenticated|unavailable|unknown)$/.test(code) ? code : "unknown";
}
