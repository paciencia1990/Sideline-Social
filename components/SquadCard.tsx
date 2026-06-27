import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { Squad, SquadStatus, getSquadStatus } from '@/services/squadService';

// Sport emoji map (keep in sync with SquadMarker)
const SPORT_EMOJI: Record<string, string> = {
  Soccer: '⚽',
  Baseball: '⚾',
  Basketball: '🏀',
  Football: '🏈',
  Lacrosse: '🥍',
  Swimming: '🏊',
  Dance: '💃',
  Gymnastics: '🤸',
  Tennis: '🎾',
  TrackAndField: '🏃',
  Volleyball: '🏐',
  Other: '🏅',
};

const STATUS_COLORS: Record<SquadStatus, { bg: string; text: string }> = {
  active: { bg: Colors.accentGreen, text: '#FFFFFF' },
  starting_soon: { bg: Colors.accentGold, text: '#FFFFFF' },
  quiet: { bg: Colors.secondary, text: Colors.textHeading },
};

interface SquadCardProps {
  squad: Squad;
  isMember: boolean;
  isHighlighted?: boolean;
  onJoin: () => void;
  onPress: () => void;
  joining?: boolean;
}

export function SquadCard({
  squad,
  isMember,
  isHighlighted,
  onJoin,
  onPress,
  joining,
}: SquadCardProps) {
  const { t } = useTranslation();
  const emoji = SPORT_EMOJI[squad.sport] ?? '🏅';
  const status = getSquadStatus(squad);
  const statusColor = STATUS_COLORS[status];
  const distText =
    squad.distanceMiles !== undefined
      ? t('squad.distance', { distance: squad.distanceMiles.toFixed(1) })
      : '';

  const statusLabel =
    status === 'active'
      ? t('squad.activeNow')
      : status === 'starting_soon'
        ? t('squad.startingSoon')
        : t('squad.quiet');

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.card, isHighlighted && styles.highlighted]}
    >
      {/* Left: emoji */}
      <View style={styles.emojiWrap}>
        <Text style={styles.emoji}>{emoji}</Text>
      </View>

      {/* Center: info */}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {squad.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {squad.venueName}
          {distText ? ` · ${distText}` : ''}
        </Text>
        <View style={styles.row}>
          <Text style={styles.members}>
            {t('squad.membersHere', { count: squad.activeMemberCount })}
          </Text>
          <View style={[styles.statusPill, { backgroundColor: statusColor.bg }]}>
            <Text style={[styles.statusText, { color: statusColor.text }]}>{statusLabel}</Text>
          </View>
        </View>
      </View>

      {/* Right: action */}
      <View style={styles.actionWrap}>
        {isMember ? (
          <View style={styles.joinedPill}>
            <Text style={styles.joinedText}>{t('squad.joinedPill')}</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.joinButton}
            onPress={onJoin}
            disabled={joining}
            activeOpacity={0.8}
          >
            {joining ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.joinText}>{t('squad.joinButton')}</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.xs,
    ...Shadow.card,
  },
  highlighted: {
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  emojiWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 22,
  },
  info: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.textHeading,
  },
  meta: {
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
    color: Colors.textPrimary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: 2,
  },
  members: {
    fontFamily: Typography.bodyRegular,
    fontSize: 11,
    color: Colors.textPrimary,
  },
  statusPill: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusText: {
    fontFamily: Typography.bodyBold,
    fontSize: 9,
    letterSpacing: 0.5,
  },
  actionWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
    minWidth: 68,
    alignItems: 'center',
  },
  joinText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  joinedPill: {
    backgroundColor: Colors.accentGreen,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
    minWidth: 80,
    alignItems: 'center',
  },
  joinedText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
    color: '#FFFFFF',
  },
});