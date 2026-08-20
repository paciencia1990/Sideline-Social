import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Archive, ArrowLeft, CalendarDays, CalendarPlus, ChevronDown, ChevronUp, WifiOff } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { TeamScheduleEventCard } from "@/components/TeamScheduleEventCard";
import { getSyntheticTeamSchedule } from "@/constants/teamSchedulePreview";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  getMoreUpcomingTeamSchedule,
  getPastTeamSchedulePage,
  getTeamScheduleAccess,
  subscribeToUpcomingTeamSchedule,
  type TeamScheduleAccess,
  type TeamScheduleEvent,
} from "@/services/teamScheduleService";
import type { TeamHistoryCursor } from "@/constants/teamHistoryPagination";
import { groupScheduleEvents, splitScheduleEvents, type ScheduleMonthGroup } from "@/utils/teamScheduleCore";

export default function TeamScheduleScreen() {
  const { i18n, t } = useTranslation();
  const params = useLocalSearchParams<{ teamId?: string | string[] }>();
  const teamId = normalizeParam(params.teamId);
  const [access, setAccess] = useState<TeamScheduleAccess | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<TeamScheduleEvent[]>([]);
  const [pastEvents, setPastEvents] = useState<TeamScheduleEvent[]>([]);
  const [upcomingCursor, setUpcomingCursor] = useState<TeamHistoryCursor | null>(null);
  const [pastCursor, setPastCursor] = useState<TeamHistoryCursor | null>(null);
  const [hasMoreUpcoming, setHasMoreUpcoming] = useState(false);
  const [hasMorePast, setHasMorePast] = useState(true);
  const [loadingMoreUpcoming, setLoadingMoreUpcoming] = useState(false);
  const [pastLoading, setPastLoading] = useState(false);
  const [pastError, setPastError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pastExpanded, setPastExpanded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => undefined;
    setLoading(true);
    setError(null);
    void getTeamScheduleAccess(teamId)
      .then((nextAccess) => {
        if (!active) return;
        setAccess(nextAccess);
        unsubscribe = subscribeToUpcomingTeamSchedule(
          teamId,
          (page, fromCache) => {
            if (!active) return;
            const syntheticUpcoming = splitScheduleEvents(getSyntheticTeamSchedule(teamId)).upcoming;
            setUpcomingEvents(page.events.length > 0 ? page.events : syntheticUpcoming);
            setUpcomingCursor(page.nextCursor);
            setHasMoreUpcoming(page.hasMore);
            setOffline(fromCache);
            setLoading(false);
            setRefreshing(false);
          },
          () => {
            if (!active) return;
            setError(t("schedule.errors.load"));
            setLoading(false);
            setRefreshing(false);
          },
        );
      })
      .catch(() => {
        if (!active) return;
        setAccess(null);
        setError(t("schedule.errors.unauthorized"));
        setLoading(false);
        setRefreshing(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [reloadKey, t, teamId]);

  const upcomingGroups = useMemo(() => groupScheduleEvents(upcomingEvents), [upcomingEvents]);
  const pastGroups = useMemo(() => groupScheduleEvents(pastEvents), [pastEvents]);
  const canManage = access?.canManage === true && access.teamStatus === "active";
  const refresh = useCallback(() => {
    setPastEvents([]);
    setPastCursor(null);
    setHasMorePast(true);
    setPastExpanded(false);
    setRefreshing(true);
    setReloadKey((value) => value + 1);
  }, []);

  const loadMoreUpcoming = useCallback(async () => {
    if (!upcomingCursor || !hasMoreUpcoming || loadingMoreUpcoming) return;
    setLoadingMoreUpcoming(true);
    try {
      const page = await getMoreUpcomingTeamSchedule(teamId, upcomingCursor);
      setUpcomingEvents((current) => mergeScheduleEvents(current, page.events, "asc"));
      setUpcomingCursor(page.nextCursor);
      setHasMoreUpcoming(page.hasMore);
    } catch {
      setError(t("schedule.errors.load"));
    } finally {
      setLoadingMoreUpcoming(false);
    }
  }, [hasMoreUpcoming, loadingMoreUpcoming, t, teamId, upcomingCursor]);

  const loadPast = useCallback(async () => {
    if (pastLoading || (!hasMorePast && pastEvents.length > 0)) return;
    setPastLoading(true);
    setPastError(null);
    try {
      const page = await getPastTeamSchedulePage(teamId, pastCursor);
      setPastEvents((current) => mergeScheduleEvents(current, page.events, "desc"));
      setPastCursor(page.nextCursor);
      setHasMorePast(page.hasMore);
    } catch {
      setPastError(t("schedule.errors.load"));
    } finally {
      setPastLoading(false);
    }
  }, [hasMorePast, pastCursor, pastEvents.length, pastLoading, t, teamId]);

  const togglePast = useCallback(() => {
    setPastExpanded((expanded) => {
      if (!expanded && pastEvents.length === 0) void loadPast();
      return !expanded;
    });
  }, [loadPast, pastEvents.length]);

  return (
    <ScreenWrapper>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity accessibilityLabel={t("schedule.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.iconButton}>
            <ArrowLeft color={Colors.textHeading} size={22} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text accessibilityRole="header" style={styles.title}>{t("schedule.title")}</Text>
            <Text style={styles.subtitle}>
              {access?.teamName ? t("schedule.teamSchedule", { teamName: access.teamName }) : t("schedule.title")}
            </Text>
          </View>
        </View>

        {access?.teamStatus === "archived" ? (
          <Card style={styles.archivedCard}>
            <Archive color={Colors.primary} size={22} />
            <View style={styles.stateCopy}>
              <Text style={styles.stateTitle}>{t("schedule.archivedTitle")}</Text>
              <Text style={styles.stateText}>{t("schedule.archivedBody")}</Text>
            </View>
          </Card>
        ) : null}

        {offline ? (
          <View accessibilityLiveRegion="polite" style={styles.offlineRow}>
            <WifiOff color={Colors.primary} size={17} />
            <Text style={styles.offlineText}>{t("schedule.offline")}</Text>
          </View>
        ) : null}

        {canManage ? (
          <View style={styles.actionRow}>
            <TouchableOpacity accessibilityHint={t("schedule.addSchedule.intro")} accessibilityRole="button" onPress={() => router.push({ pathname: "/teams/[teamId]/schedule/add", params: { teamId } } as never)} style={styles.primaryAction}>
              <CalendarPlus color={Colors.surface} size={19} />
              <Text style={styles.primaryActionText}>{t("schedule.addSchedule.title")}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {access ? (
          <TouchableOpacity accessibilityHint={t("schedule.subscription.body")} accessibilityRole="button" onPress={() => router.push({ pathname: "/teams/[teamId]/schedule/subscribe", params: { teamId } } as never)} style={styles.secondaryAction}>
            <CalendarDays color={Colors.communicationLink} size={19} />
            <Text style={styles.secondaryActionText}>{t("schedule.subscription.title")}</Text>
          </TouchableOpacity>
        ) : null}

        {loading ? (
          <Card style={styles.stateCard}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.stateText}>{t("schedule.loading")}</Text>
          </Card>
        ) : null}

        {!loading && error ? (
          <Card style={styles.stateCard}>
            <Text style={styles.stateTitle}>{t("schedule.unavailable")}</Text>
            <Text style={styles.stateText}>{error}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={refresh} style={styles.retryButton}>
              <Text style={styles.retryText}>{t("common.retry")}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {!loading && !error && upcomingEvents.length === 0 ? (
          <Card style={styles.stateCard}>
            <CalendarPlus color={Colors.accentGreen} size={30} />
            <Text style={styles.stateTitle}>{t("schedule.emptyTitle")}</Text>
            <Text style={styles.stateText}>{t(canManage ? "schedule.emptyCoachBody" : "schedule.emptyParentBody")}</Text>
          </Card>
        ) : null}

        {!loading && !error && upcomingGroups.length > 0 ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{t("schedule.upcoming")}</Text>
            <ScheduleGroups groups={upcomingGroups} locale={i18n.language} teamId={teamId} />
            {hasMoreUpcoming ? (
              <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy: loadingMoreUpcoming }} disabled={loadingMoreUpcoming} onPress={() => { void loadMoreUpcoming(); }} style={styles.retryButton}>
                {loadingMoreUpcoming ? <ActivityIndicator color={Colors.primary} /> : <Text style={styles.retryText}>{t("schedule.loadMoreUpcoming")}</Text>}
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {!loading && !error ? (
          <View style={styles.section}>
            <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: pastExpanded }} onPress={togglePast} style={styles.pastHeader}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>{t("schedule.pastEvents", { count: pastEvents.length })}</Text>
              {pastExpanded ? <ChevronUp color={Colors.textHeading} size={22} /> : <ChevronDown color={Colors.textHeading} size={22} />}
            </TouchableOpacity>
            {pastExpanded ? (
              <View style={styles.section}>
                <ScheduleGroups groups={pastGroups} locale={i18n.language} teamId={teamId} />
                {pastLoading ? <ActivityIndicator accessibilityLabel={t("schedule.loading")} color={Colors.primary} /> : null}
                {pastError ? <Text accessibilityLiveRegion="polite" style={styles.stateText}>{pastError}</Text> : null}
                {!pastLoading && !pastError && hasMorePast ? (
                  <TouchableOpacity accessibilityRole="button" onPress={() => { void loadPast(); }} style={styles.retryButton}>
                    <Text style={styles.retryText}>{t("schedule.loadMorePast")}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function ScheduleGroups({ groups, locale, teamId }: {
  groups: ScheduleMonthGroup<TeamScheduleEvent>[];
  locale: string;
  teamId: string;
}) {
  return <>{groups.map((month) => (
    <View key={month.monthKey} style={styles.month}>
      <Text style={styles.monthTitle}>{formatMonth(month.monthKey, locale)}</Text>
      {month.days.map((day) => (
        <View key={day.dateKey} style={styles.day}>
          <Text style={styles.dayTitle}>{formatDay(day.dateKey, locale)}</Text>
          {day.events.map((event) => (
            <TeamScheduleEventCard
              key={event.id}
              event={event}
              locale={locale}
              onPress={() => router.push({ pathname: "/teams/[teamId]/schedule/[eventId]", params: { teamId, eventId: event.id } } as never)}
            />
          ))}
        </View>
      ))}
    </View>
  ))}</>;
}

function formatMonth(value: string, locale: string) {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function formatDay(value: string, locale: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function normalizeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function mergeScheduleEvents(current: TeamScheduleEvent[], incoming: TeamScheduleEvent[], direction: "asc" | "desc") {
  const byId = new Map(current.map((event) => [event.id, event]));
  incoming.forEach((event) => byId.set(event.id, event));
  return Array.from(byId.values()).sort((first, second) => {
    const time = first.startAt.getTime() - second.startAt.getTime();
    const stable = time || first.id.localeCompare(second.id);
    return direction === "asc" ? stable : -stable;
  });
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  header: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  headerCopy: { flex: 1 },
  iconButton: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 28 },
  subtitle: { color: Colors.communicationLink, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  archivedCard: { alignItems: "center", borderLeftColor: Colors.primary, borderLeftWidth: 4, flexDirection: "row", gap: Spacing.sm },
  stateCopy: { flex: 1, gap: 3 },
  offlineRow: { alignItems: "center", backgroundColor: "#F8EACF", borderRadius: Radius.sm, flexDirection: "row", gap: Spacing.xs, padding: Spacing.sm },
  offlineText: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodyMedium, fontSize: 12 },
  actionRow: { flexDirection: "row", gap: Spacing.sm },
  primaryAction: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, flex: 1, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.sm },
  primaryActionText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  secondaryAction: { alignItems: "center", backgroundColor: Colors.surface, borderColor: Colors.communicationLink, borderRadius: Radius.button, borderWidth: 1, flex: 1, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.sm },
  secondaryActionText: { color: Colors.communicationLink, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  stateCard: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.xl },
  stateTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17, textAlign: "center" },
  stateText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20, textAlign: "center" },
  retryButton: { borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, minHeight: 42, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  retryText: { color: Colors.primary, fontFamily: Typography.bodySemiBold },
  section: { gap: Spacing.sm },
  sectionTitle: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 23 },
  pastHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 44 },
  month: { gap: Spacing.sm },
  monthTitle: { color: Colors.communicationLink, fontFamily: Typography.bodyBold, fontSize: 14, textTransform: "uppercase" },
  day: { gap: Spacing.sm },
  dayTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 14 },
});
