import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MoreVertical, Settings, Users } from 'lucide-react-native';

import { Colors, Typography, Spacing, Radius, Shadow } from '@/constants/theme';
import { ScreenWrapper } from '@/components/ScreenWrapper';
import { NestedBackButton, navigateBackOrReplace } from '@/components/NestedBackButton';
import { OutlineButton } from '@/components/OutlineButton';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Card } from '@/components/Card';
import { SquadIdentity } from '@/components/SquadIdentity';
import { SquadSeasonManager } from '@/components/SquadSeasonManager';
import {
  SquadAdministrationCard,
  type SquadAdministrationCardHandle,
} from '@/components/SquadAdministrationCard';
import { useSquad } from '@/context/SquadContext';
import { useAuth } from '@/context/AuthContext';
import {
  fetchSquadDetail,
  getSquadAdminErrorReason,
  getSquadStatus,
  type SquadAdministration,
  type SquadDetail,
} from '@/services/squadService';
import { getSquadSportOption, getSquadSportTranslationKey } from '@/constants/sports';

export default function SquadDetailScreen() {
  const { t } = useTranslation();
  const { squadId } = useLocalSearchParams<{ squadId: string }>();
  const { user } = useAuth();
  const { joinSquad, leaveSquad, mySquadIds } = useSquad();

  const [squadDetail, setSquadDetail] = useState<SquadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [joining, setJoining] = useState(false);
  const [administration, setAdministration] = useState<SquadAdministration | null>(null);
  const [adminSelectionRequestKey, setAdminSelectionRequestKey] = useState(0);
  const [adminSectionY, setAdminSectionY] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const administrationCardRef = useRef<SquadAdministrationCardHandle>(null);
  const currentScrollYRef = useRef(0);
  const pendingAdministrationFocusRef = useRef(false);
  const administrationScrollTargetRef = useRef<number | null>(null);

  const isMember =
    mySquadIds.includes(squadId ?? '') &&
    squadDetail?.viewerIsMember === true;
  const emoji = getSquadSportOption(squadDetail?.sportId).emoji;

  const loadSquadDetail = useCallback(async () => {
    if (!squadId) {
      setSquadDetail(null);
      setLoadError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const detail = await fetchSquadDetail(squadId);
      setSquadDetail(detail);
    } catch {
      setSquadDetail(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [squadId]);

  useEffect(() => {
    void loadSquadDetail();
  }, [loadSquadDetail]);

  const focusAdministrationHeading = useCallback(() => {
    if (!pendingAdministrationFocusRef.current || !administrationCardRef.current) return;
    pendingAdministrationFocusRef.current = false;
    administrationScrollTargetRef.current = null;
    administrationCardRef.current.focusHeading();
  }, []);

  const scrollToAdministrationPosition = useCallback((sectionY: number) => {
    const targetY = Math.max(0, sectionY - Spacing.lg);
    administrationScrollTargetRef.current = targetY;
    if (Math.abs(currentScrollYRef.current - targetY) <= 4) {
      focusAdministrationHeading();
      return;
    }
    scrollRef.current?.scrollTo({ animated: true, y: targetY });
  }, [focusAdministrationHeading]);

  const scrollToAdministration = useCallback(() => {
    pendingAdministrationFocusRef.current = true;
    if (adminSectionY != null) scrollToAdministrationPosition(adminSectionY);
  }, [adminSectionY, scrollToAdministrationPosition]);

  const openAdminSelector = useCallback(() => {
    setAdminSelectionRequestKey((value) => value + 1);
    scrollToAdministration();
  }, [scrollToAdministration]);

  const handleAdministrationLayout = useCallback((event: LayoutChangeEvent) => {
    const sectionY = event.nativeEvent.layout.y;
    setAdminSectionY(sectionY);
    if (pendingAdministrationFocusRef.current) scrollToAdministrationPosition(sectionY);
  }, [scrollToAdministrationPosition]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const scrollY = event.nativeEvent.contentOffset.y;
    currentScrollYRef.current = scrollY;
    const targetY = administrationScrollTargetRef.current;
    if (pendingAdministrationFocusRef.current && targetY != null && Math.abs(scrollY - targetY) <= 4) {
      focusAdministrationHeading();
    }
  }, [focusAdministrationHeading]);

  const showLastAdminExplanation = useCallback(() => {
    Alert.alert(
      t('squadAdmin.chooseNewAdmin'),
      t('squadAdmin.lastAdminExplanation'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('squadAdmin.chooseNewAdmin'), onPress: openAdminSelector },
      ],
    );
  }, [openAdminSelector, t]);

  const handleLeave = useCallback(() => {
    if (administration?.callerIsAdmin && administration.activeAdminCount <= 1) {
      showLastAdminExplanation();
      return;
    }
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
              navigateBackOrReplace('/(tabs)/squad');
            } catch (error) {
              if (getSquadAdminErrorReason(error) === 'last_active_admin') showLastAdminExplanation();
              else Alert.alert('', t('squad.errorLeaving'));
            } finally {
              setLeaving(false);
            }
          },
        },
      ]
    );
  }, [administration?.activeAdminCount, administration?.callerIsAdmin, leaveSquad, showLastAdminExplanation, squadId, t, user]);

  const handleJoin = useCallback(async () => {
    if (!squadId) return;
    setJoining(true);
    try {
      await joinSquad(squadId);
    } catch {
      Alert.alert(t('squad.joinErrorTitle'), t('squad.errorJoining'));
    } finally {
      setJoining(false);
    }
  }, [joinSquad, squadId, t]);

  if (loading) {
    return (
      <ScreenWrapper>
        <SquadDetailHeader title={t('tabs.squad')} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </ScreenWrapper>
    );
  }

  if (loadError) {
    return (
      <ScreenWrapper>
        <SquadDetailHeader title={t('tabs.squad')} />
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>{t('squad.detailUnavailableTitle')}</Text>
          <Text style={styles.errorText}>{t('squad.detailUnavailableBody')}</Text>
          <View style={styles.errorActions}>
            <PrimaryButton title={t('common.retry')} onPress={() => void loadSquadDetail()} />
            <OutlineButton title={t('common.back')} onPress={() => navigateBackOrReplace('/(tabs)/squad')} />
          </View>
        </View>
      </ScreenWrapper>
    );
  }

  if (!squadDetail) {
    return (
      <ScreenWrapper>
        <SquadDetailHeader title={t('tabs.squad')} />
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>{t('squad.detailNotFoundTitle')}</Text>
          <Text style={styles.errorText}>{t('squad.detailNotFoundBody')}</Text>
          <View style={styles.errorActions}>
            <OutlineButton title={t('common.back')} onPress={() => navigateBackOrReplace('/(tabs)/squad')} />
          </View>
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
  const sportName = t(getSquadSportTranslationKey(squadDetail.sportId));
  const squadAccessibilityName = [squadDetail.venueName, sportName].filter(Boolean).join(' ');

  return (
    <ScreenWrapper>
      <SquadDetailHeader
        leaving={leaving}
        onLeave={handleLeave}
        showLeave={isMember}
        title={squadDetail.venueName}
      />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        onMomentumScrollEnd={focusAdministrationHeading}
        onScroll={handleScroll}
        onScrollEndDrag={focusAdministrationHeading}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero header */}
        <View style={styles.heroCard}>
          <Text style={styles.heroEmoji}>{emoji}</Text>
          <SquadIdentity
            venueName={squadDetail.venueName}
            sportId={squadDetail.sportId}
            sportDisplayName={squadDetail.sportDisplayName}
            style={styles.heroIdentity}
          />

          <View style={[styles.statusPill, { backgroundColor: statusColor }]}>
            <Text style={styles.statusText}>{statusLabel}</Text>
          </View>
        </View>

        {administration?.callerIsAdmin === true ? (
          <Card style={styles.manageSquadCard}>
            <Text style={styles.adminRoleLabel}>{t('squadAdmin.administratorStatus')}</Text>
            <Text style={styles.manageSquadDescription}>{t('squadAdmin.manageDescription')}</Text>
            <TouchableOpacity
              accessibilityLabel={t('squadAdmin.manageAccessibility', { squadName: squadAccessibilityName })}
              accessibilityRole="button"
              activeOpacity={0.84}
              onPress={scrollToAdministration}
              style={styles.manageSquadButton}
            >
              <Settings color={Colors.primary} size={19} />
              <Text style={styles.manageSquadButtonText}>{t('squadAdmin.manageSquad')}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Users size={20} color={Colors.primary} />
            <Text style={styles.statValue}>{squadDetail.memberCount}</Text>
            <Text style={styles.statLabel}>{t('squad.members')}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{squadDetail.activeMemberCount}</Text>
            <Text style={styles.statLabel}>{t('squad.activeNow')}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{sportName}</Text>
            <Text style={styles.statLabel}>{t('squad.sport')}</Text>
          </View>
        </View>

        {/* Member Avatars */}
        {isMember && squadDetail.members.length > 0 && (
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

        {isMember ? (
          <View onLayout={handleAdministrationLayout}>
            <SquadAdministrationCard
              ref={administrationCardRef}
              onStateChange={setAdministration}
              selectionRequestKey={adminSelectionRequestKey}
              squadId={squadDetail.squadId}
            />
          </View>
        ) : null}

        {isMember ? (
          <SquadSeasonManager
            key={`${squadDetail.squadId}:${administration?.callerIsAdmin ? 'admin' : 'member'}`}
            squadId={squadDetail.squadId}
          />
        ) : null}

        {/* Actions */}
        <View style={styles.actionsSection}>
          {!isMember ? (
            <PrimaryButton loading={joining} title={t('squad.joinThisSquad')} onPress={() => void handleJoin()} style={styles.chatBtn} />
          ) : null}

          {isMember && (
            <TouchableOpacity
              accessibilityLabel={t('squad.detailLeave')}
              accessibilityRole="button"
              accessibilityState={{ busy: leaving, disabled: leaving }}
              style={styles.leaveBtn}
              onPress={handleLeave}
              disabled={leaving}
            >
              <Text style={styles.leaveBtnText}>{t('squad.detailLeave')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

function SquadDetailHeader({
  leaving = false,
  onLeave,
  showLeave = false,
  title,
}: {
  leaving?: boolean;
  onLeave?: () => void;
  showLeave?: boolean;
  title: string;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.detailHeader}>
      <NestedBackButton
        accessibilityLabel={t('common.back')}
        fallbackRoute="/(tabs)/squad"
        style={styles.detailBackButton}
      />
      <Text accessibilityRole="header" numberOfLines={1} style={styles.detailHeaderTitle}>{title}</Text>
      {showLeave && onLeave ? (
        <TouchableOpacity
          accessibilityLabel={t('squad.detailLeave')}
          accessibilityRole="button"
          accessibilityState={{ busy: leaving, disabled: leaving }}
          activeOpacity={0.82}
          disabled={leaving}
          onPress={onLeave}
          style={styles.detailHeaderAction}
        >
          {leaving ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <MoreVertical size={22} color={Colors.textHeading} />
          )}
        </TouchableOpacity>
      ) : (
        <View style={styles.detailHeaderSpacer} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  detailHeader: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderBottomColor: Colors.secondary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: Spacing.sm,
  },
  detailBackButton: {
    marginRight: Spacing.xs,
  },
  detailHeaderTitle: {
    color: Colors.textHeading,
    flex: 1,
    fontFamily: Typography.bodySemiBold,
    fontSize: 17,
    minWidth: 0,
  },
  detailHeaderAction: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  detailHeaderSpacer: {
    width: 44,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  errorActions: { gap: Spacing.sm, maxWidth: 360, width: '100%' },
  errorTitle: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 26, textAlign: 'center' },
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
  heroIdentity: { alignItems: 'center' },
  heroMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  heroMetaText: {
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
    color: Colors.textPrimary,
    lineHeight: 21,
    textAlign: 'center',
  },
  manageSquadCard: {
    gap: Spacing.sm,
  },
  adminRoleLabel: {
    color: Colors.textHeading,
    flexShrink: 1,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
  manageSquadDescription: {
    color: Colors.textPrimary,
    flexShrink: 1,
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
    lineHeight: 19,
  },
  manageSquadButton: {
    alignItems: 'center',
    borderColor: Colors.primary,
    borderRadius: Radius.button,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  manageSquadButtonText: {
    color: Colors.primary,
    flexShrink: 1,
    fontFamily: Typography.bodySemiBold,
    fontSize: 15,
    textAlign: 'center',
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
