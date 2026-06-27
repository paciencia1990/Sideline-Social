import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MoreVertical, MessageSquare, MapPin, Users } from 'lucide-react-native';

import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { ScreenWrapper } from '@/components/ScreenWrapper';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useSquad } from '@/context/SquadContext';
import { useAuth } from '@/context/AuthContext';
import { fetchSquadDetail, SquadDetail, getSquadStatus } from '@/services/squadService';

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

export default function SquadDetailScreen() {
  const { t } = useTranslation();
  const { squadId } = useLocalSearchParams<{ squadId: string }>();
  const { user } = useAuth();
  const { leaveSquad, mySquadIds } = useSquad();

  const [squadDetail, setSquadDetail] = useState<SquadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState(false);

  const isMember = mySquadIds.includes(squadId ?? '');
  const emoji = SPORT_EMOJI[squadDetail?.sport ?? ''] ?? '🏅';

  useEffect(() => {
    if (!squadId) return;
    (async () => {
      setLoading(true);
      const detail = await fetchSquadDetail(squadId);
      setSquadDetail(detail);
      setLoading(false);
    })();
  }, [squadId]);

  const handleLeave = useCallback(() => {
    Alert.alert(
      t('squad.leaveConfirmTitle'),
      t('squad.leaveConfirmBody'),
      [
        { text: t('squad.leaveConfirmNo'), style: 'cancel' },
        {
          text: t('squad.leaveConfirmYes'),
          style: 'destructive',
          onPress: async () => {
            if (!user?.uid || !squadId) return;
            setLeaving(true);
            try {
              await leaveSquad(squadId);
              router.back();
            } catch {
              Alert.alert('', t('squad.errorLeaving'));
            } finally {
              setLeaving(false);
            }
          },
        },
      ]
    );
  }, [squadId, user, leaveSquad, t]);

  const handleOpenChat = useCallback(() => {
    router.push(`/(social)/squad-chat?squadId=${squadId}`);
  }, [squadId]);

  if (loading) {
    return (
      <ScreenWrapper>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </ScreenWrapper>
    );
  }

  if (!squadDetail) {
    return (
      <ScreenWrapper>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Squad not found.</Text>
        </View>
      </ScreenWrapper>
    );
  }

  const status = getSquadStatus(squadDetail);
  const statusLabel =
    status === 'active'
      ? t('squad.activeNow')
      : status === 'starting_soon'
        ? t('squad.startingSoon')
        : t('squad.quiet');
  const statusColor =
    status === 'active'
      ? Colors.accentGreen
      : status === 'starting_soon'
        ? Colors.accentGold
        : Colors.secondary;

  return (
    <ScreenWrapper>
      <Stack.Screen
        options={{
          title: squadDetail.name,
          headerRight: isMember
            ? () => (
                <TouchableOpacity
                  onPress={handleLeave}
                  style={{ marginRight: Spacing.sm }}
                  disabled={leaving}
                >
                  {leaving ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <MoreVertical size={22} color={Colors.textHeading} />
                  )}
                </TouchableOpacity>
              )
            : undefined,
        }}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero header */}
        <View style={styles.heroCard}>
          <Text style={styles.heroEmoji}>{emoji}</Text>
          <Text style={styles.heroName}>{squadDetail.name}</Text>

          <View style={styles.heroMeta}>
            <MapPin size={14} color={Colors.textPrimary} />
            <Text style={styles.heroMetaText}>{squadDetail.venueName}</Text>
          </View>

          <View style={[styles.statusPill, { backgroundColor: statusColor }]}>
            <Text style={styles.statusText}>{statusLabel}</Text>
          </View>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Users size={20} color={Colors.primary} />
            <Text style={styles.statValue}>{squadDetail.memberIds.length}</Text>
            <Text style={styles.statLabel}>{t('squad.members')}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{squadDetail.activeMemberCount}</Text>
            <Text style={styles.statLabel}>Active Now</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{squadDetail.sport}</Text>
            <Text style={styles.statLabel}>{t('squad.sport')}</Text>
          </View>
        </View>

        {/* Member Avatars */}
        {squadDetail.members.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('squad.members')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.avatarRow}>
                {squadDetail.members.map((member) => (
                  <View key={member.uid} style={styles.avatarWrap}>
                    {member.photoURL ? (
                      <Image source={{ uri: member.photoURL }} style={styles.avatar} />
                    ) : (
                      <View style={[styles.avatar, styles.avatarPlaceholder]}>
                        <Text style={styles.avatarInitial}>
                          {(member.displayName ?? '?')[0].toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </View>
                ))}
                {squadDetail.extraMemberCount > 0 && (
                  <View style={[styles.avatar, styles.avatarExtra]}>
                    <Text style={styles.avatarExtraText}>
                      {t('squad.moreMembers', { count: squadDetail.extraMemberCount })}
                    </Text>
                  </View>
                )}
              </View>
            </ScrollView>
          </View>
        )}

        {/* Actions */}
        <View style={styles.actionsSection}>
          <PrimaryButton
            title={t('squad.detailChat')}
            onPress={handleOpenChat}
            style={styles.chatBtn}
          />

          {isMember && (
            <TouchableOpacity style={styles.leaveBtn} onPress={handleLeave} disabled={leaving}>
              <Text style={styles.leaveBtnText}>{t('squad.detailLeave')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  scroll: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  heroCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadow.card,
  },
  heroEmoji: {
    fontSize: 48,
    lineHeight: 56,
  },
  heroName: {
    fontFamily: Typography.heading,
    fontSize: 22,
    color: Colors.textHeading,
    textAlign: 'center',
  },
  heroMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  heroMetaText: {
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  statusPill: {
    borderRadius: 6,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    marginTop: Spacing.xs,
  },
  statusText: {
    fontFamily: Typography.bodyBold,
    fontSize: 11,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    alignItems: 'center',
    justifyContent: 'space-around',
    ...Shadow.card,
  },
  statItem: {
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  statValue: {
    fontFamily: Typography.bodyBold,
    fontSize: 18,
    color: Colors.textHeading,
  },
  statLabel: {
    fontFamily: Typography.bodyRegular,
    fontSize: 11,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: Colors.secondary,
  },
  section: {
    gap: Spacing.sm,
  },
  sectionTitle: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.textHeading,
  },
  avatarRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  avatarWrap: {},
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarPlaceholder: {
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: Typography.bodyBold,
    fontSize: 18,
    color: '#FFFFFF',
  },
  avatarExtra: {
    backgroundColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 48,
    borderRadius: 24,
    paddingHorizontal: 6,
  },
  avatarExtraText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 11,
    color: Colors.textHeading,
  },
  actionsSection: {
    gap: Spacing.md,
    paddingTop: Spacing.sm,
  },
  chatBtn: {},
  leaveBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  leaveBtnText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.primary,
    textDecorationLine: 'underline',
  },
});