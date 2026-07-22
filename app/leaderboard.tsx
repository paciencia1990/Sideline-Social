import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { CalendarDays, RefreshCw, Star, Trophy } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { AuthenticatedRouteGate } from "@/components/AuthenticatedRouteGate";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SquadIdentity } from "@/components/SquadIdentity";
import { SquadSelector } from "@/components/SquadSelector";
import { LEADERBOARD_TIERS, getLeaderboardTierColor } from "@/constants/sidelineStars";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { useSquad } from "@/context/SquadContext";
import {
  getSquadLeaderboard,
  type SquadLeaderboardEntry,
  type SquadLeaderboardResult,
  type SquadSeasonSummary,
} from "@/services/leaderboardService";
import { flattenStyle } from "@/utils/flatten-style";
import { formatSeasonDateRange, formatSpokenDateKey, formatUsDateKey } from "@/utils/squadSeasonDate";

type SeasonView = "current" | "past";

export default function ProtectedLeaderboardScreen() {
  return (
    <AuthenticatedRouteGate>
      <LeaderboardScreen />
    </AuthenticatedRouteGate>
  );
}

function LeaderboardScreen() {
  const { i18n, t } = useTranslation();
  const { currentSquad, membershipLoading, mySquads, selectedSquadId } = useSquad();
  const [result, setResult] = useState<SquadLeaderboardResult | null>(null);
  const [seasonView, setSeasonView] = useState<SeasonView>("current");
  const [pastSeasonId, setPastSeasonId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const language = i18n.language;

  useEffect(() => {
    requestIdRef.current += 1;
    setResult(null);
    setSeasonView("current");
    setPastSeasonId(null);
  }, [selectedSquadId]);

  const loadLeaderboard = useCallback(async (refresh = false) => {
    const requestId = ++requestIdRef.current;
    if (membershipLoading) return;
    if (!selectedSquadId) {
      setResult(null);
      setError(null);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }
    if (seasonView === "past" && !pastSeasonId) {
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }
    if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);
    try {
      const nextResult = await getSquadLeaderboard(
        selectedSquadId,
        seasonView === "past" ? pastSeasonId ?? undefined : undefined,
      );
      if (requestId === requestIdRef.current) setResult(nextResult);
    } catch {
      if (requestId === requestIdRef.current) {
        setError(t("leaderboard.errorBody"));
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [membershipLoading, pastSeasonId, seasonView, selectedSquadId, t]);

  useFocusEffect(useCallback(() => {
    void loadLeaderboard();
    return () => { requestIdRef.current += 1; };
  }, [loadLeaderboard]));

  const closedSeasons = useMemo(
    () => result?.availableSeasons.filter((season) => season.status === "closed") ?? [],
    [result?.availableSeasons],
  );
  const selectCurrent = useCallback(() => {
    setSeasonView("current");
    setPastSeasonId(null);
  }, []);
  const selectPast = useCallback(() => {
    setSeasonView("past");
    setPastSeasonId((current) => current ?? closedSeasons[0]?.seasonId ?? null);
  }, [closedSeasons]);

  const pinnedCurrentUser = result?.currentUserEntry &&
    !result.entries.some((entry) => entry.userId === result.currentUserEntry?.userId)
    ? result.currentUserEntry
    : null;
  const identity = result?.squad ?? currentSquad;
  const showingNoPastSeasons = seasonView === "past" && closedSeasons.length === 0;

  return (
    <ScreenWrapper>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            accessibilityLabel={t("leaderboard.pullToRefresh")}
            refreshing={isRefreshing}
            onRefresh={() => void loadLeaderboard(true)}
            tintColor={Colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Trophy size={40} color={Colors.accentGold} />
          <Text style={styles.title}>{t("leaderboard.squadTitle")}</Text>
        </View>

        {mySquads.length > 1 ? <SquadSelector /> : null}
        {identity ? (
          <View style={styles.identityCard}>
            <SquadIdentity
              venueName={identity.venueName}
              sportId={identity.sportId}
              sportDisplayName={identity.sportDisplayName}
            />
          </View>
        ) : null}

        {selectedSquadId ? (
          <View accessibilityRole="tablist" style={styles.segment}>
            <SeasonTab label={t("season.currentSeason")} onPress={selectCurrent} selected={seasonView === "current"} />
            <SeasonTab label={t("season.pastSeasons")} onPress={selectPast} selected={seasonView === "past"} />
          </View>
        ) : null}

        {seasonView === "past" && closedSeasons.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View accessibilityRole="tablist" style={styles.pastSeasonList}>
              {closedSeasons.map((season) => (
                <TouchableOpacity
                  accessibilityRole="tab"
                  accessibilityState={{ selected: pastSeasonId === season.seasonId }}
                  key={season.seasonId}
                  onPress={() => setPastSeasonId(season.seasonId)}
                  style={[styles.pastSeasonButton, pastSeasonId === season.seasonId && styles.pastSeasonButtonSelected]}
                >
                  <Text style={[styles.pastSeasonText, pastSeasonId === season.seasonId && styles.pastSeasonTextSelected]}>{season.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        ) : null}

        {membershipLoading || isLoading ? (
          <StateCard body={t("leaderboard.loading")} loading />
        ) : !selectedSquadId ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>{t("leaderboard.noSquadTitle")}</Text>
            <Text style={styles.stateText}>{t("leaderboard.noSquadBody")}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => router.push("/(tabs)/squad" as never)} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{t("leaderboard.findSquad")}</Text>
            </TouchableOpacity>
          </View>
        ) : error ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>{t("leaderboard.errorTitle")}</Text>
            <Text style={styles.stateText}>{error}</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.primaryButton} onPress={() => void loadLeaderboard()}>
              <RefreshCw size={16} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>{t("leaderboard.retry")}</Text>
            </TouchableOpacity>
          </View>
        ) : showingNoPastSeasons ? (
          <StateCard title={t("season.noPastSeasons")} body={t("season.noPastSeasonsBody")} />
        ) : seasonView === "current" && !result?.season ? (
          <NoActiveSeason
            canManage={result?.canManageSeasons === true}
            lifetimeStars={numberFormatter.format(result?.currentUserLifetimeStars ?? 0)}
            nextSeason={result?.nextSeason ?? null}
            language={language}
            onSetup={() => router.push(`/(social)/squad-detail?squadId=${selectedSquadId}` as never)}
            t={t}
          />
        ) : result?.season ? (
          <>
            <SeasonHeader language={language} season={result.season} t={t} />
            <View style={styles.summaryCard}>
              <SummaryLine
                label={t("season.yourSeasonStars")}
                value={numberFormatter.format(result.currentUserEntry?.seasonStars ?? 0)}
              />
              <SummaryLine
                label={t("season.lifetimeSidelineStars")}
                secondary
                value={numberFormatter.format(result.currentUserLifetimeStars)}
              />
            </View>
            {result.entries.length === 0 ? (
              <StateCard title={t("leaderboard.emptyTitle")} body={t("leaderboard.noMembersBody")} />
            ) : (
              <>
                <View style={styles.countRow}>
                  <Text style={styles.countText}>{t("leaderboard.memberCount", { count: result.totalMemberCount })}</Text>
                </View>
                <View style={styles.playerList}>
                  {result.entries.map((player) => (
                    <PlayerRow
                      key={player.userId}
                      player={player}
                      displayName={player.displayName ?? t("leaderboard.neutralName")}
                      formattedStars={numberFormatter.format(player.seasonStars)}
                      seasonStarsLabel={t("season.seasonStars")}
                      tierLabel={t(`leaderboard.tiers.${player.lifetimeTier}`)}
                      youLabel={t("leaderboard.you")}
                      rankLabel={t("leaderboard.rank")}
                    />
                  ))}
                </View>
                {pinnedCurrentUser ? (
                  <View style={styles.pinnedWrap}>
                    <Text style={styles.sectionTitle}>{t("leaderboard.yourRank")}</Text>
                    <PlayerRow
                      player={pinnedCurrentUser}
                      displayName={pinnedCurrentUser.displayName ?? t("leaderboard.neutralName")}
                      formattedStars={numberFormatter.format(pinnedCurrentUser.seasonStars)}
                      seasonStarsLabel={t("season.seasonStars")}
                      tierLabel={t(`leaderboard.tiers.${pinnedCurrentUser.lifetimeTier}`)}
                      youLabel={t("leaderboard.you")}
                      rankLabel={t("leaderboard.rank")}
                    />
                  </View>
                ) : null}
              </>
            )}
          </>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("leaderboard.tierSystem")}</Text>
          <Text style={styles.tierHelp}>{t("season.lifetimeTierHelp")}</Text>
        </View>
        <View style={styles.tiersCard}>
          {LEADERBOARD_TIERS.map((tier, index) => (
            <View key={tier.key} style={flattenStyle([styles.tierRow, index < LEADERBOARD_TIERS.length - 1 && styles.tierRowBorder])}>
              <View style={flattenStyle([styles.tierDot, { backgroundColor: tier.color }])} />
              <Text style={styles.tierName}>{t(`leaderboard.tiers.${tier.key}`)}</Text>
              <Text style={styles.tierMin}>{t("leaderboard.tierMinimum", { minStars: numberFormatter.format(tier.minStars) })}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

function SeasonTab({ label, onPress, selected }: { label: string; onPress: () => void; selected: boolean }) {
  return (
    <TouchableOpacity
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.segmentButton, selected && styles.segmentButtonSelected]}
    >
      <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

function SeasonHeader({
  language,
  season,
  t,
}: {
  language: string;
  season: SquadSeasonSummary;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const range = formatSeasonDateRange(season);
  if (!season.detailsAvailable || !range) {
    return <StateCard title={t("season.detailsUnavailable")} body={t("season.detailsUnavailableBody")} />;
  }
  const spokenRange = `${formatSpokenDateKey(season.startDateKey, language)} – ${formatSpokenDateKey(season.endDateKey, language)}`;
  const final = season.status === "closed";
  return (
    <View
      accessible
      accessibilityLabel={`${season.name}. ${t(`season.status.${season.status}`)}. ${spokenRange}.`}
      style={styles.seasonCard}
    >
      <Text style={styles.seasonStatus}>{final ? t("season.finalStandings") : t("season.currentSeason")}</Text>
      <Text style={styles.seasonName}>{season.name}</Text>
      <Text style={styles.seasonDates}>{range}</Text>
    </View>
  );
}

function NoActiveSeason({
  canManage,
  lifetimeStars,
  language,
  nextSeason,
  onSetup,
  t,
}: {
  canManage: boolean;
  lifetimeStars: string;
  language: string;
  nextSeason: SquadSeasonSummary | null;
  onSetup: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <>
      <View style={styles.stateCard}>
        <CalendarDays color={Colors.primary} size={28} />
        <Text style={styles.stateTitle}>{t("season.noActiveSeason")}</Text>
        <Text style={styles.stateText}>{t("season.noActiveSeasonBody")}</Text>
        {canManage ? (
          <TouchableOpacity accessibilityRole="button" onPress={onSetup} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{t("season.setUpSeason")}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {nextSeason?.detailsAvailable ? (
        <View accessible accessibilityLabel={`${t("season.nextSeason")}. ${nextSeason.name}. ${t("season.starts", { date: formatSpokenDateKey(nextSeason.startDateKey, language) })}.`} style={styles.nextCard}>
          <Text style={styles.seasonStatus}>{t("season.nextSeason")}</Text>
          <Text style={styles.seasonName}>{nextSeason.name}</Text>
          <Text style={styles.seasonDates}>{t("season.starts", { date: formatUsDateKey(nextSeason.startDateKey) })}</Text>
        </View>
      ) : nextSeason ? (
        <StateCard title={t("season.detailsUnavailable")} body={t("season.detailsUnavailableBody")} />
      ) : null}
      <View style={styles.lifetimeOnlyCard}>
        <Text style={styles.summaryLabel}>{t("season.lifetimeSidelineStars")}</Text>
        <Text style={styles.lifetimeValue}>{lifetimeStars}</Text>
      </View>
    </>
  );
}

function SummaryLine({ label, secondary, value }: { label: string; secondary?: boolean; value: string }) {
  return (
    <View style={styles.summaryLine}>
      <Text style={[styles.summaryLabel, secondary && styles.summarySecondary]}>{label}</Text>
      <Text style={[styles.summaryValue, secondary && styles.summarySecondaryValue]}>{value}</Text>
    </View>
  );
}

function StateCard({ body, loading, title }: { body: string; loading?: boolean; title?: string }) {
  return (
    <View style={styles.stateCard}>
      {loading ? <ActivityIndicator color={Colors.primary} /> : null}
      {title ? <Text style={styles.stateTitle}>{title}</Text> : null}
      <Text style={styles.stateText}>{body}</Text>
    </View>
  );
}

function PlayerRow({
  displayName,
  formattedStars,
  player,
  rankLabel,
  seasonStarsLabel,
  tierLabel,
  youLabel,
}: {
  displayName: string;
  formattedStars: string;
  player: SquadLeaderboardEntry;
  rankLabel: string;
  seasonStarsLabel: string;
  tierLabel: string;
  youLabel: string;
}) {
  const isTopThree = player.rank <= 3;
  const tierColor = getLeaderboardTierColor(player.lifetimeTier);
  return (
    <View
      accessible
      accessibilityLabel={`${rankLabel} ${player.rank}. ${player.isCurrentUser ? `${youLabel}. ` : ""}${displayName}. ${tierLabel}. ${formattedStars} ${seasonStarsLabel}.`}
      style={flattenStyle([styles.playerCard, isTopThree && styles.playerCardTop, player.isCurrentUser && styles.currentPlayerCard])}
    >
      <View style={flattenStyle([styles.rankBadge, player.rank === 1 && styles.rankFirst, player.rank === 2 && styles.rankSecond, player.rank === 3 && styles.rankThird])}>
        <Text style={styles.rankText}>#{player.rank}</Text>
      </View>
      <View style={styles.avatarCircle}><Text style={styles.avatarText}>{getInitials(displayName)}</Text></View>
      <View style={styles.playerInfo}>
        <View style={styles.nameRow}>
          <Text style={styles.playerName}>{displayName}</Text>
          {player.isCurrentUser ? <Text style={styles.youPill}>{youLabel}</Text> : null}
        </View>
        <View style={styles.tierPill}>
          <View style={flattenStyle([styles.tierPillDot, { backgroundColor: tierColor }])} />
          <Text style={styles.tierPillText}>{tierLabel}</Text>
        </View>
      </View>
      <View style={styles.starsColumn}>
        <View style={styles.starsRow}>
          <Star size={15} color={Colors.accentGold} fill={Colors.accentGold} />
          <Text style={styles.starsText}>{formattedStars}</Text>
        </View>
        <Text style={styles.starsLabel}>{seasonStarsLabel}</Text>
      </View>
    </View>
  );
}

function getInitials(displayName: string): string {
  return displayName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "SS";
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.lg, gap: Spacing.md },
  header: { alignItems: "center", paddingVertical: Spacing.xs, gap: Spacing.xs },
  title: { fontFamily: Typography.heading, fontSize: 28, color: Colors.textHeading, textAlign: "center" },
  identityCard: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.md, ...Shadow.card },
  segment: { backgroundColor: `${Colors.secondary}55`, borderRadius: Radius.button, flexDirection: "row", padding: 3 },
  segmentButton: { alignItems: "center", borderRadius: Radius.button, flex: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: Spacing.sm },
  segmentButtonSelected: { backgroundColor: Colors.surface, ...Shadow.card },
  segmentText: { color: Colors.textPrimary, fontFamily: Typography.bodyMedium, fontSize: 13, textAlign: "center" },
  segmentTextSelected: { color: Colors.primary, fontFamily: Typography.bodySemiBold },
  pastSeasonList: { flexDirection: "row", gap: Spacing.sm },
  pastSeasonButton: { borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: Spacing.md },
  pastSeasonButtonSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pastSeasonText: { color: Colors.textHeading, fontFamily: Typography.bodyMedium, fontSize: 13 },
  pastSeasonTextSelected: { color: "#FFFFFF" },
  seasonCard: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: Radius.card, gap: Spacing.xs, padding: Spacing.md, ...Shadow.card },
  nextCard: { backgroundColor: `${Colors.secondary}33`, borderRadius: Radius.card, gap: Spacing.xs, padding: Spacing.md },
  seasonStatus: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 11, textTransform: "uppercase" },
  seasonName: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 19, textAlign: "center", flexShrink: 1 },
  seasonDates: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20, textAlign: "center", flexShrink: 1 },
  summaryCard: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.md, gap: Spacing.sm, ...Shadow.card },
  summaryLine: { alignItems: "center", flexDirection: "row", gap: Spacing.md, justifyContent: "space-between" },
  summaryLabel: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  summaryValue: { color: Colors.accentGold, fontFamily: Typography.bodyBold, fontSize: 18 },
  summarySecondary: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13 },
  summarySecondaryValue: { color: Colors.textHeading, fontSize: 15 },
  lifetimeOnlyCard: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: Radius.card, flexDirection: "row", gap: Spacing.md, justifyContent: "space-between", padding: Spacing.md, ...Shadow.card },
  lifetimeValue: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 16 },
  countRow: { alignItems: "flex-end" },
  countText: { color: Colors.textPrimary, fontFamily: Typography.bodyMedium, fontSize: 12 },
  playerList: { gap: Spacing.sm },
  playerCard: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.md, flexDirection: "row", alignItems: "center", gap: Spacing.sm, ...Shadow.card },
  playerCardTop: { borderWidth: 1, borderColor: `${Colors.accentGold}66` },
  currentPlayerCard: { backgroundColor: `${Colors.secondary}44`, borderColor: Colors.primary, borderWidth: 1.5 },
  rankBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.secondary, alignItems: "center", justifyContent: "center" },
  rankFirst: { backgroundColor: Colors.accentGold },
  rankSecond: { backgroundColor: "#A8A9AD" },
  rankThird: { backgroundColor: "#CD7F32" },
  rankText: { fontFamily: Typography.bodySemiBold, fontSize: 12, color: Colors.surface },
  avatarCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: Typography.bodySemiBold, fontSize: 13, color: "#FFFFFF" },
  playerInfo: { flex: 1, minWidth: 0, gap: 5 },
  nameRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  playerName: { flexShrink: 1, fontFamily: Typography.bodySemiBold, fontSize: 15, color: Colors.textHeading },
  youPill: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 10, textTransform: "uppercase" },
  tierPill: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5, paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.sm, backgroundColor: `${Colors.secondary}44` },
  tierPillDot: { width: 7, height: 7, borderRadius: 4 },
  tierPillText: { fontFamily: Typography.bodyMedium, fontSize: 11, color: Colors.textHeading },
  starsColumn: { alignItems: "flex-end", gap: 3, flexShrink: 0, maxWidth: 90 },
  starsRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  starsText: { fontFamily: Typography.bodySemiBold, fontSize: 14, color: Colors.accentGold },
  starsLabel: { fontFamily: Typography.bodyRegular, fontSize: 10, color: Colors.textPrimary, textAlign: "right", flexShrink: 1 },
  stateCard: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.xl, alignItems: "center", gap: Spacing.sm, ...Shadow.card },
  stateTitle: { fontFamily: Typography.bodySemiBold, fontSize: 17, color: Colors.textHeading, textAlign: "center", flexShrink: 1 },
  stateText: { fontFamily: Typography.bodyRegular, fontSize: 14, color: Colors.textPrimary, textAlign: "center", lineHeight: 21, flexShrink: 1 },
  primaryButton: { marginTop: Spacing.sm, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.button, paddingHorizontal: Spacing.md, minHeight: 44 },
  primaryButtonText: { fontFamily: Typography.bodySemiBold, fontSize: 14, color: "#FFFFFF", textAlign: "center" },
  pinnedWrap: { gap: Spacing.sm, marginTop: Spacing.sm },
  sectionHeader: { marginTop: Spacing.sm, gap: Spacing.xs },
  sectionTitle: { fontFamily: Typography.bodySemiBold, fontSize: 16, color: Colors.textHeading },
  tierHelp: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 18 },
  tiersCard: { backgroundColor: Colors.surface, borderRadius: Radius.card, overflow: "hidden", ...Shadow.card },
  tierRow: { flexDirection: "row", alignItems: "center", padding: Spacing.md, gap: Spacing.sm },
  tierRowBorder: { borderBottomWidth: 1, borderBottomColor: `${Colors.secondary}66` },
  tierDot: { width: 12, height: 12, borderRadius: 6 },
  tierName: { fontFamily: Typography.bodySemiBold, fontSize: 14, color: Colors.textHeading, flex: 1 },
  tierMin: { fontFamily: Typography.bodyRegular, fontSize: 12, color: Colors.textPrimary },
});
