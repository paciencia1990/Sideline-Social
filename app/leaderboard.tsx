import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { RefreshCw, Star, Trophy } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import {
  LEADERBOARD_TIERS,
  fetchLeaderboardUsers,
  getLeaderboardTierColor,
  type LeaderboardUser,
} from "@/services/leaderboardService";
import { flattenStyle } from "@/utils/flatten-style";

export default function LeaderboardScreen() {
  const { i18n, t } = useTranslation();
  const [players, setPlayers] = useState<LeaderboardUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const numberFormatter = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

  const loadLeaderboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setPlayers(await fetchLeaderboardUsers());
    } catch {
      setPlayers([]);
      setError(t("leaderboard.errorBody"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const nextPlayers = await fetchLeaderboardUsers();
        if (isMounted) setPlayers(nextPlayers);
      } catch {
        if (isMounted) {
          setPlayers([]);
          setError(t("leaderboard.errorBody"));
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    load();

    return () => {
      isMounted = false;
    };
  }, [t]);

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Trophy size={54} color={Colors.accentGold} />
          <Text style={styles.title}>{t("leaderboard.title")}</Text>
          <Text style={styles.subtitle}>{t("leaderboard.subtitle")}</Text>
        </View>

        {isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.stateText}>{t("leaderboard.loading")}</Text>
          </View>
        ) : error ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>{t("leaderboard.errorTitle")}</Text>
            <Text style={styles.stateText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} activeOpacity={0.85} onPress={loadLeaderboard}>
              <RefreshCw size={16} color="#FFFFFF" />
              <Text style={styles.retryText}>{t("leaderboard.retry")}</Text>
            </TouchableOpacity>
          </View>
        ) : players.length === 0 ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>{t("leaderboard.emptyTitle")}</Text>
            <Text style={styles.stateText}>{t("leaderboard.emptyBody")}</Text>
          </View>
        ) : (
          <View style={styles.playerList}>
            {players.map((player, index) => (
              <PlayerRow
                key={player.id}
                player={player}
                rank={index + 1}
                sidelineStarsLabel={t("leaderboard.sidelineStars")}
                tierLabel={t(`leaderboard.tiers.${player.tier}`)}
                formattedStars={numberFormatter.format(player.sidelineStars)}
              />
            ))}
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("leaderboard.tierSystem")}</Text>
        </View>
        <View style={styles.tiersCard}>
          {LEADERBOARD_TIERS.map((tier, index) => (
            <View key={tier.key} style={flattenStyle([styles.tierRow, index < LEADERBOARD_TIERS.length - 1 && styles.tierRowBorder])}>
              <View style={flattenStyle([styles.tierDot, { backgroundColor: tier.color }])} />
              <Text style={styles.tierName}>{t(`leaderboard.tiers.${tier.key}`)}</Text>
              <Text style={styles.tierMin}>
                {t("leaderboard.tierMinimum", {
                  minStars: numberFormatter.format(tier.minStars),
                })}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

function PlayerRow({
  formattedStars,
  player,
  rank,
  sidelineStarsLabel,
  tierLabel,
}: {
  formattedStars: string;
  player: LeaderboardUser;
  rank: number;
  sidelineStarsLabel: string;
  tierLabel: string;
}) {
  const isTopThree = rank <= 3;
  const tierColor = getLeaderboardTierColor(player.tier);

  return (
    <View style={flattenStyle([styles.playerCard, isTopThree && styles.playerCardTop])}>
      <View style={flattenStyle([styles.rankBadge, rank === 1 && styles.rankFirst, rank === 2 && styles.rankSecond, rank === 3 && styles.rankThird])}>
        <Text style={styles.rankText}>#{rank}</Text>
      </View>

      <View style={styles.avatarCircle}>
        <Text style={styles.avatarText}>{getInitials(player.displayName)}</Text>
      </View>

      <View style={styles.playerInfo}>
        <Text style={styles.playerName} numberOfLines={1}>{player.displayName}</Text>
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
        <Text style={styles.starsLabel}>{sidelineStarsLabel}</Text>
      </View>
    </View>
  );
}

function getInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return initials || "SP";
}

const styles = StyleSheet.create({
  scroll: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  header: {
    alignItems: "center",
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  title: {
    fontFamily: Typography.heading,
    fontSize: 30,
    color: Colors.textHeading,
    textAlign: "center",
  },
  subtitle: {
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    color: Colors.textPrimary,
    textAlign: "center",
    lineHeight: 21,
  },
  playerList: {
    gap: Spacing.sm,
  },
  playerCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    ...Shadow.card,
  },
  playerCardTop: {
    borderWidth: 1,
    borderColor: `${Colors.accentGold}66`,
  },
  rankBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  rankFirst: {
    backgroundColor: Colors.accentGold,
  },
  rankSecond: {
    backgroundColor: "#A8A9AD",
  },
  rankThird: {
    backgroundColor: "#CD7F32",
  },
  rankText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
    color: Colors.surface,
  },
  avatarCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    color: "#FFFFFF",
  },
  playerInfo: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  playerName: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.textHeading,
  },
  tierPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.sm,
    backgroundColor: `${Colors.secondary}44`,
  },
  tierPillDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  tierPillText: {
    fontFamily: Typography.bodyMedium,
    fontSize: 11,
    color: Colors.textHeading,
  },
  starsColumn: {
    alignItems: "flex-end",
    gap: 3,
  },
  starsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  starsText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.accentGold,
  },
  starsLabel: {
    fontFamily: Typography.bodyRegular,
    fontSize: 10,
    color: Colors.textPrimary,
  },
  stateCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.xl,
    alignItems: "center",
    gap: Spacing.sm,
    ...Shadow.card,
  },
  stateTitle: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.textHeading,
    textAlign: "center",
  },
  stateText: {
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    color: Colors.textPrimary,
    textAlign: "center",
    lineHeight: 21,
  },
  retryButton: {
    marginTop: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
    minHeight: 44,
  },
  retryText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    color: "#FFFFFF",
  },
  sectionHeader: {
    marginTop: Spacing.sm,
  },
  sectionTitle: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.textHeading,
  },
  tiersCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    overflow: "hidden",
    ...Shadow.card,
  },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  tierRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: `${Colors.secondary}66`,
  },
  tierDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  tierName: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.textHeading,
    flex: 1,
  },
  tierMin: {
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
    color: Colors.textPrimary,
  },
});

