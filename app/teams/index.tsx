import React, { useCallback, useMemo, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Archive, ArrowLeft, ChevronDown, ChevronRight, ChevronUp, Shield, Trash2, Users } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  getParentTeamsOverview,
  getParentPastTeamCount,
  getParentPastTeamsPage,
  groupParentTeamsByChild,
  removeParentPastTeam,
  type ArchivedParentTeamSummary,
  type ParentTeamSummary,
  getTeamChildNames,
  type ParentTeamsOverview,
} from "@/services/parentTeamService";

export default function ParentTeamsScreen() {
  const { i18n, t } = useTranslation();
  const [overview, setOverview] = useState<ParentTeamsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pastExpanded, setPastExpanded] = useState(false);
  const [pastTeams, setPastTeams] = useState<ArchivedParentTeamSummary[]>([]);
  const [pastCount, setPastCount] = useState(0);
  const [pastLoading, setPastLoading] = useState(false);
  const [pastError, setPastError] = useState<string | null>(null);
  const [pastHasMore, setPastHasMore] = useState(false);
  const [pastNextOffset, setPastNextOffset] = useState(0);
  const [removingPastTeamId, setRemovingPastTeamId] = useState<string | null>(null);

  const loadTeams = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextOverview, nextPastCount] = await Promise.all([
        getParentTeamsOverview(),
        getParentPastTeamCount(),
      ]);
      setOverview(nextOverview);
      setPastCount(nextPastCount);
    } catch (nextError) {
      console.warn("[ParentTeams] load error:", nextError);
      setError(t("myTeams.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(useCallback(() => {
    void loadTeams();
  }, [loadTeams]));

  const groups = useMemo(() => groupParentTeamsByChild(overview?.teams ?? []), [overview?.teams]);

  const loadPastTeams = useCallback(async (reset = false) => {
    if (pastLoading) return;
    setPastLoading(true);
    setPastError(null);
    try {
      const page = await getParentPastTeamsPage(reset ? 0 : pastNextOffset);
      setPastTeams((current) => reset ? page.teams : [...current, ...page.teams]);
      setPastCount(page.totalCount);
      setPastHasMore(page.hasMore);
      setPastNextOffset(page.nextOffset);
    } catch (nextError) {
      console.warn("[ParentTeams] load past teams error:", nextError);
      setPastError(t("myTeams.pastTeamsLoadError"));
    } finally {
      setPastLoading(false);
    }
  }, [pastLoading, pastNextOffset, t]);

  const togglePastTeams = useCallback(() => {
    setPastExpanded((current) => {
      const next = !current;
      if (next && pastTeams.length === 0 && pastCount > 0) {
        void loadPastTeams(true);
      }
      return next;
    });
  }, [loadPastTeams, pastCount, pastTeams.length]);

  const removePastTeam = useCallback(async (team: ArchivedParentTeamSummary) => {
    if (removingPastTeamId) return;
    setRemovingPastTeamId(team.teamId);
    setPastError(null);
    try {
      await removeParentPastTeam(team.teamId);
      setPastTeams((current) => current.filter((item) => item.teamId !== team.teamId));
      setPastCount((current) => Math.max(0, current - 1));
      await AccessibilityInfo.announceForAccessibility(t("myTeams.pastTeamsRemoveSuccess", { team: team.name }));
    } catch (nextError) {
      console.warn("[ParentTeams] remove past team error:", nextError);
      setPastError(t("myTeams.pastTeamsRemoveError"));
    } finally {
      setRemovingPastTeamId(null);
    }
  }, [removingPastTeamId, t]);

  const confirmRemovePastTeam = useCallback((team: ArchivedParentTeamSummary) => {
    if (removingPastTeamId) return;
    Alert.alert(
      t("myTeams.pastTeamsRemoveTitle", { team: team.name }),
      t("myTeams.pastTeamsRemoveBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("myTeams.pastTeamsRemoveAction"),
          style: "destructive",
          onPress: () => { void removePastTeam(team); },
        },
      ],
    );
  }, [removePastTeam, removingPastTeamId, t]);

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <TouchableOpacity accessibilityLabel={t("myTeams.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft color={Colors.textHeading} size={22} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text accessibilityRole="header" style={styles.title}>{t("myTeams.title")}</Text>
            <Text style={styles.subtitle}>{t("myTeams.subtitle")}</Text>
          </View>
          <View style={styles.headerIcon}>
            <Users color={Colors.primary} size={22} />
          </View>
        </View>

        {loading && !overview ? (
          <Card style={styles.stateCard}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.cardText}>{t("myTeams.loading")}</Text>
          </Card>
        ) : null}

        {error ? (
          <Card style={[styles.stateCard, styles.errorCard]}>
            <Text style={styles.stateTitle}>{t("myTeams.loadErrorTitle")}</Text>
            <Text style={styles.cardText}>{error}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={loadTeams} style={styles.outlineButton}>
              <Text style={styles.outlineButtonText}>{t("myTeams.tryAgain")}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {!loading && !error && overview?.totalTeams === 0 ? (
          <Card style={styles.stateCard}>
            <Users color={Colors.secondary} size={34} />
            <Text style={styles.stateTitle}>{t("myTeams.noTeams")}</Text>
            <Text style={styles.cardText}>{t("myTeams.noTeamsBody")}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => router.push("/teams/join" as never)} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{t("myTeams.joinTeam")}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {!loading && !error && overview && overview.totalTeams > 0 ? (
          <TouchableOpacity accessibilityRole="button" onPress={() => router.push("/teams/join" as never)} style={styles.outlineButton}>
            <Text style={styles.outlineButtonText}>{t("myTeams.joinAnotherTeam")}</Text>
          </TouchableOpacity>
        ) : null}
        {!error ? groups.map((group) => (
          <View key={group.key} style={styles.group}>
            <View style={styles.childHeader}>
              <Text style={styles.childLabel}>{t("myTeams.child")}</Text>
              <Text accessibilityRole="header" style={styles.childName}>{group.childName ?? t("myTeams.childNotSpecified")}</Text>
            </View>
            {group.teams.map((team) => (
              <ParentTeamCard key={team.teamId} locale={i18n.language} summary={team} />
            ))}
          </View>
        )) : null}

        {!error && pastCount > 0 ? (
          <PastTeamsSection
            count={pastCount}
            expanded={pastExpanded}
            hasMore={pastHasMore}
            loading={pastLoading}
            removingTeamId={removingPastTeamId}
            teams={pastTeams}
            error={pastError}
            locale={i18n.language}
            onLoadMore={() => { void loadPastTeams(false); }}
            onRemove={confirmRemovePastTeam}
            onRetry={() => { void loadPastTeams(pastTeams.length === 0); }}
            onToggle={togglePastTeams}
          />
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function PastTeamsSection({
  count,
  error,
  expanded,
  hasMore,
  loading,
  locale,
  onLoadMore,
  onRemove,
  onRetry,
  onToggle,
  removingTeamId,
  teams,
}: {
  count: number;
  error: string | null;
  expanded: boolean;
  hasMore: boolean;
  loading: boolean;
  locale: string;
  onLoadMore: () => void;
  onRemove: (team: ArchivedParentTeamSummary) => void;
  onRetry: () => void;
  onToggle: () => void;
  removingTeamId: string | null;
  teams: ArchivedParentTeamSummary[];
}) {
  const { t } = useTranslation();
  return (
    <Card style={styles.pastTeamsCard}>
      <TouchableOpacity
        accessibilityLabel={t(expanded ? "myTeams.pastTeamsCollapse" : "myTeams.pastTeamsExpand", { count })}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        activeOpacity={0.82}
        onPress={onToggle}
        style={styles.pastTeamsHeader}
      >
        <View style={styles.pastTeamsTitleRow}>
          <Archive color={Colors.primary} size={20} />
          <View style={styles.pastTeamsTitleCopy}>
            <Text accessibilityRole="header" style={styles.cardTitle}>{t("myTeams.pastTeamsTitle")}</Text>
            <Text style={styles.cardText}>{t("myTeams.pastTeamsCount", { count })}</Text>
          </View>
        </View>
        {expanded ? <ChevronUp color={Colors.textHeading} size={22} /> : <ChevronDown color={Colors.textHeading} size={22} />}
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.pastTeamsBody}>
          {teams.map((team) => (
            <PastTeamCard
              key={team.teamId}
              locale={locale}
              removing={removingTeamId === team.teamId}
              team={team}
              onRemove={() => onRemove(team)}
            />
          ))}

          {loading ? (
            <View accessibilityLiveRegion="polite" style={styles.inlineState}>
              <ActivityIndicator color={Colors.primary} />
              <Text style={styles.cardText}>{t("myTeams.pastTeamsLoading")}</Text>
            </View>
          ) : null}

          {!loading && error ? (
            <View accessibilityLiveRegion="polite" style={styles.inlineState}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity accessibilityRole="button" onPress={onRetry} style={styles.outlineButton}>
                <Text style={styles.outlineButtonText}>{t("myTeams.tryAgain")}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {!loading && !error && teams.length === 0 ? (
            <Text style={styles.emptyUpdates}>{t("myTeams.pastTeamsEmpty")}</Text>
          ) : null}

          {!loading && !error && hasMore ? (
            <TouchableOpacity accessibilityRole="button" onPress={onLoadMore} style={styles.outlineButton}>
              <Text style={styles.outlineButtonText}>{t("myTeams.pastTeamsLoadMore")}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function PastTeamCard({
  locale,
  onRemove,
  removing,
  team,
}: {
  locale: string;
  onRemove: () => void;
  removing: boolean;
  team: ArchivedParentTeamSummary;
}) {
  const { t } = useTranslation();
  const details = [team.sport, team.season || team.division || team.ageRange].filter(Boolean).join(" - ");
  return (
    <View style={styles.pastTeamRow}>
      <View style={styles.pastTeamCopy}>
        <Text style={styles.teamName}>{team.name}</Text>
        {details ? <Text style={styles.teamDetails}>{details}</Text> : null}
        <Text style={styles.archivedMeta}>{t("myTeams.pastTeamsArchivedOn", { date: formatPastTeamDate(team.archivedAtDate, locale) })}</Text>
      </View>
      <TouchableOpacity
        accessibilityLabel={t("myTeams.pastTeamsRemoveAccessibility", { team: team.name })}
        accessibilityRole="button"
        accessibilityState={{ busy: removing, disabled: removing }}
        disabled={removing}
        onPress={onRemove}
        style={[styles.removePastButton, removing && styles.disabledButton]}
      >
        {removing ? <ActivityIndicator color={Colors.primary} size="small" /> : <Trash2 color={Colors.primary} size={18} />}
        <Text style={styles.removePastText}>{removing ? t("myTeams.pastTeamsRemoving") : t("myTeams.pastTeamsRemoveAction")}</Text>
      </TouchableOpacity>
    </View>
  );
}

function ParentTeamCard({ locale, summary }: { locale: string; summary: ParentTeamSummary }) {
  const { t } = useTranslation();
  const latest = summary.latestAnnouncement;
  const details = [summary.team.sport, summary.team.season || summary.team.division || summary.team.ageRange].filter(Boolean).join(" · ");
  const totalUnread = summary.unreadCount + summary.privateUnreadCount;

  return (
    <TouchableOpacity
      accessibilityLabel={t("myTeams.openTeam", { team: summary.team.name })}
      accessibilityRole="button"
      activeOpacity={0.86}
      onPress={() => router.push({
        pathname: "/teams/[teamId]",
        params: {
          teamId: summary.teamId,
        },
      } as never)}
    >
      <Card style={styles.teamCard}>
        <View style={styles.teamTopRow}>
          <View style={styles.teamIcon}>
            <Shield color={Colors.primary} size={21} />
          </View>
          <View style={styles.teamCopy}>
            <Text style={styles.teamName}>{summary.team.name}</Text>
            {details ? <Text style={styles.teamDetails}>{details}</Text> : null}
          </View>
          {totalUnread > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{totalUnread}</Text>
            </View>
          ) : null}
          <ChevronRight color={Colors.textPrimary} size={20} />
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{t("myTeams.child")}: {formatChildLabel(summary, t)}</Text>
          <Text style={styles.metaLabel}>{t("myTeams.coach")}: {summary.coachName ?? t(summary.coachProfileState === "deleted" ? "common.formerMember" : "common.sidelineSocialMember")}</Text>
        </View>
        {summary.privateUnreadCount > 0 ? <Text style={styles.privateUnread}>{t("teamMessages.unread", { count: summary.privateUnreadCount })} · {t("teamMessages.title")}</Text> : null}
        {latest ? (
          <View style={[styles.preview, !latest.isRead && styles.previewUnread]}>
            {latest.isDeleted
              ? <Text style={styles.previewTitle}>{t("teamMessages.messageDeleted")}</Text>
              : latest.title
                ? <Text style={styles.previewTitle}>{latest.title}</Text>
                : null}
            <Text numberOfLines={2} style={styles.previewBody}>{latest.isDeleted ? t("teamMessages.messageDeleted") : latest.body}</Text>
            <Text style={styles.previewTime}>{formatRelativeTime(latest.createdAtDate, locale, t)}</Text>
          </View>
        ) : (
          <Text style={styles.emptyUpdates}>{t("myTeams.noUpdates")}</Text>
        )}
      </Card>
    </TouchableOpacity>
  );
}


function formatChildLabel(
  summary: ParentTeamSummary,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const names = getTeamChildNames(summary);
  if (names.length === 0) return t("myTeams.childNotSpecified");
  if (names.length === 1) return names[0];
  if (names.length === 2) return t("myTeams.twoChildrenNames", { first: names[0], second: names[1] });
  return t("myTeams.childrenCount", { count: names.length });
}
function formatRelativeTime(date: Date | null, locale: string, t: (key: string, options?: Record<string, unknown>) => string) {
  if (!date) return "";
  const difference = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(difference / 60000);
  if (minutes < 1) return t("home.justNow");
  if (minutes < 60) return t("home.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("home.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("home.daysAgo", { count: days });
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
}

function formatPastTeamDate(date: Date | null, locale: string) {
  if (!date) return "";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  headerRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  headerCopy: { flex: 1 },
  backButton: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  headerIcon: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 30 },
  subtitle: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 19 },
  stateCard: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.xl },
  errorCard: { borderLeftColor: Colors.primary, borderLeftWidth: 4 },
  stateTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17, textAlign: "center" },
  cardTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17, textAlign: "center" },
  cardText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20, textAlign: "center" },
  primaryButton: { backgroundColor: Colors.primary, borderRadius: Radius.button, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  primaryButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold },
  outlineButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  outlineButtonText: { color: Colors.primary, fontFamily: Typography.bodySemiBold },
  group: { gap: Spacing.sm },
  childHeader: { gap: 2, paddingHorizontal: Spacing.xs, paddingTop: Spacing.sm },
  childLabel: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 11, textTransform: "uppercase" },
  childName: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 23 },
  teamCard: { borderLeftColor: Colors.textHeading, borderLeftWidth: 4, gap: Spacing.sm },
  teamTopRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  teamIcon: { alignItems: "center", backgroundColor: Colors.background, borderRadius: 20, height: 40, justifyContent: "center", width: 40 },
  teamCopy: { flex: 1, gap: 2 },
  teamName: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 16 },
  teamDetails: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12 },
  badge: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: 12, minWidth: 24, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { color: Colors.surface, fontFamily: Typography.bodyBold, fontSize: 12 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  metaLabel: { color: Colors.textPrimary, fontFamily: Typography.bodyMedium, fontSize: 12 },
  preview: { backgroundColor: Colors.background, borderRadius: Radius.sm, gap: 3, padding: Spacing.sm },
  previewUnread: { borderColor: Colors.accentGold, borderWidth: 1 },
  previewTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  previewBody: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 18 },
  previewTime: { color: Colors.primary, fontFamily: Typography.bodyMedium, fontSize: 11 },
  emptyUpdates: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, fontStyle: "italic" },
  privateUnread: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 12 },
  pastTeamsCard: { gap: Spacing.md },
  pastTeamsHeader: { alignItems: "center", flexDirection: "row", gap: Spacing.sm, justifyContent: "space-between" },
  pastTeamsTitleRow: { alignItems: "center", flex: 1, flexDirection: "row", gap: Spacing.sm },
  pastTeamsTitleCopy: { flex: 1, gap: 2 },
  pastTeamsBody: { gap: Spacing.sm },
  pastTeamRow: { alignItems: "center", borderTopColor: Colors.secondary, borderTopWidth: 1, flexDirection: "row", gap: Spacing.sm, paddingTop: Spacing.md },
  pastTeamCopy: { flex: 1, gap: 3 },
  archivedMeta: { color: Colors.primary, fontFamily: Typography.bodyMedium, fontSize: 11 },
  removePastButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 42, paddingHorizontal: Spacing.sm },
  removePastText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 12 },
  inlineState: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.sm },
  errorText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  disabledButton: { opacity: 0.55 },
});
