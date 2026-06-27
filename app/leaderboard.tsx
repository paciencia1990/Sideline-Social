import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Trophy, Star } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { ScreenWrapper } from '@/components/ScreenWrapper';
import { flattenStyle } from '@/utils/flatten-style';

const TIERS = [
  { name: 'Bronze', color: '#CD7F32', min: 0 },
  { name: 'Silver', color: '#A8A9AD', min: 500 },
  { name: 'Gold', color: '#E8A84C', min: 1500 },
  { name: 'Platinum', color: '#8AA3B2', min: 3000 },
  { name: 'Legend', color: '#C7463B', min: 5000 },
];

const TOP_THREE = [
  { rank: 1, initials: 'AJ', name: 'Alex J.', stars: 2840 },
  { rank: 2, initials: 'SM', name: 'Sam M.', stars: 2610 },
  { rank: 3, initials: 'TC', name: 'Taylor C.', stars: 2390 },
];

export default function LeaderboardScreen() {
  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Trophy size={56} color={Colors.accentGold} />
          <Text style={styles.title}>Leaderboard</Text>
          <Text style={styles.subtitle}>Top Sideline Stars this week</Text>
        </View>

        {/* Top 3 */}
        {TOP_THREE.map((player) => (
          <View key={player.rank} style={styles.playerCard}>
            <View style={flattenStyle([styles.rankBadge, player.rank === 1 && styles.rankFirst])}>
              <Text style={styles.rankText}>#{player.rank}</Text>
            </View>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{player.initials}</Text>
            </View>
            <Text style={styles.playerName}>{player.name}</Text>
            <View style={styles.starsRow}>
              <Star size={14} color={Colors.accentGold} />
              <Text style={styles.starsText}>{player.stars.toLocaleString()}</Text>
            </View>
          </View>
        ))}

        {/* Tier System */}
        <Text style={styles.sectionTitle}>Tier System</Text>
        <View style={styles.tiersCard}>
          {TIERS.map((tier, index) => (
            <View key={tier.name} style={flattenStyle([styles.tierRow, index < TIERS.length - 1 && styles.tierRowBorder])}>
              <View style={flattenStyle([styles.tierDot, { backgroundColor: tier.color }])} />
              <Text style={styles.tierName}>{tier.name}</Text>
              <Text style={styles.tierMin}>{tier.min.toLocaleString()}+ stars</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  header: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  title: {
    fontFamily: Typography.heading,
    fontSize: 28,
    color: Colors.textHeading,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  playerCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadow.card,
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankFirst: {
    backgroundColor: Colors.accentGold,
  },
  rankText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
    color: Colors.surface,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    color: '#FFFFFF',
  },
  playerName: {
    fontFamily: Typography.bodyMedium,
    fontSize: 14,
    color: Colors.textHeading,
    flex: 1,
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  starsText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.accentGold,
  },
  sectionTitle: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.textHeading,
  },
  tiersCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    overflow: 'hidden',
    ...Shadow.card,
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  tierRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: `${Colors.secondary}60`,
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