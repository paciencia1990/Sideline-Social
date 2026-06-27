import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Image,
  Dimensions,
} from 'react-native';
import { Bell, Trophy, Zap, Heart, Star, Users } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography, Spacing, Shadow, Radius } from '@/constants/theme';
import { ScreenWrapper } from '@/components/ScreenWrapper';
import { useAuth } from '@/context/AuthContext';
import { useSquad } from '@/context/SquadContext';
import {
  fetchUserSquadsDetail,
  fetchActiveChallenge,
  fetchConnectionPrompt,
  subscribeToActivityFeed,
  subscribeLiveSquadCard,
  fetchUnreadNotificationCount,
  updateChallengeStatus,
  fetchUserFriendIds,
  SquadDetail,
  Challenge,
  ConnectionPrompt,
  ActivityItem,
  LiveSquadData,
} from '@/services/homeFeedService';

const { width } = Dimensions.get('window');

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { mySquadIds } = useSquad();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [squadsDetail, setSquadsDetail] = useState<SquadDetail[]>([]);
  const [liveSquad, setLiveSquad] = useState<LiveSquadData | null>(null);
  const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<'accepted' | 'complete' | null>(null);
  const [connectionPrompt, setConnectionPrompt] = useState<ConnectionPrompt | null>(null);
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const [friendIds, setFriendIds] = useState<string[]>([]);

  // Refs for listeners
  const activityUnsub = useRef<(() => void) | null>(null);
  const liveSquadUnsub = useRef<(() => void) | null>(null);

  const loadData = useCallback(async () => {
    // If no user yet (auth stub), we can either skip or use a mock user
    const uid = user?.uid || 'stub-user-123';

    try {
      // 1. Fetch friend IDs
      const friends = await fetchUserFriendIds(uid);
      setFriendIds(friends);

      // 2. Fetch squad details
      const details = await fetchUserSquadsDetail(mySquadIds);
      setSquadsDetail(details);

      // 3. Fetch active challenge
      const challenge = await fetchActiveChallenge();
      setActiveChallenge(challenge);

      // 4. Fetch connection prompt
      const prompt = await fetchConnectionPrompt();
      setConnectionPrompt(prompt);

      // 5. Fetch notification count
      const count = await fetchUnreadNotificationCount(uid);
      setUnreadCount(count);

      // 6. Subscriptions
      activityUnsub.current?.();
      activityUnsub.current = subscribeToActivityFeed(mySquadIds, friends, (items) => {
        setActivityFeed(items);
        if (__DEV__ && items.length === 0) {
          // Fallback mock data in dev
          setActivityFeed(MOCK_ACTIVITY);
        }
      });

      liveSquadUnsub.current?.();
      liveSquadUnsub.current = subscribeLiveSquadCard(mySquadIds, (squad) => {
        setLiveSquad(squad);
      });

      // Mock data fallback for squads/challenges in dev if none found
      if (__DEV__ && details.length === 0 && mySquadIds.length === 0) {
        setSquadsDetail(MOCK_SQUAD_DETAILS);
      }
      if (__DEV__ && !challenge) {
        setActiveChallenge(MOCK_CHALLENGE);
      }
      if (__DEV__ && !prompt) {
        setConnectionPrompt(MOCK_PROMPT);
      }

    } catch (err) {
      console.warn('[HomeScreen] loadData error:', err);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [user?.uid, mySquadIds]);

  useEffect(() => {
    loadData();
    return () => {
      activityUnsub.current?.();
      liveSquadUnsub.current?.();
    };
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleAcceptChallenge = async () => {
    if (!user?.uid || !activeChallenge) return;
    try {
      await updateChallengeStatus(user.uid, activeChallenge.challengeId, 'accepted');
      setChallengeStatus('accepted');
    } catch (err) {
      console.error('Failed to accept challenge:', err);
    }
  };

  const handleCompleteChallenge = async () => {
    if (!user?.uid || !activeChallenge) return;
    try {
      await updateChallengeStatus(user.uid, activeChallenge.challengeId, 'complete');
      setChallengeStatus('complete');
    } catch (err) {
      console.error('Failed to complete challenge:', err);
    }
  };

  return (
    <View style={styles.container}>
      <HomeHeader unreadCount={unreadCount} insets={insets} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
        contentContainerStyle={styles.scrollContent}
      >
        {isLoading ? (
          <HomeSkeleton />
        ) : (
          <>
            <SidelineThisWeekSection squads={squadsDetail} />

            {liveSquad && (
              <LiveSquadCard
                squad={liveSquad}
                onPress={() => router.push({ pathname: '/(social)/squad-chat', params: { squadId: liveSquad.squadId } })}
              />
            )}

            {activeChallenge && (
              <WeeklyChallengeCard
                challenge={activeChallenge}
                status={challengeStatus}
                onAccept={handleAcceptChallenge}
                onComplete={handleCompleteChallenge}
                lang={i18n.language}
              />
            )}

            <ActivityFeedSection items={activityFeed} lang={i18n.language} />

            {connectionPrompt && (
              <ConnectionPromptCard
                prompt={connectionPrompt}
                lang={i18n.language}
                onShare={() => router.push('/(tabs)/squad')}
              />
            )}

            <View style={{ height: 40 }} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function HomeHeader({ unreadCount, insets }: { unreadCount: number; insets: any }) {
  const { t } = useTranslation();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <View style={styles.headerLeft}>
        <View style={styles.logoMark}>
          <Text style={{ fontSize: 14 }}>⚾</Text>
        </View>
        <Text style={styles.headerTitle}>{t('home.headerTitle')}</Text>
      </View>
      <TouchableOpacity style={styles.bellButton} onPress={() => {}}>
        <Bell size={22} color={Colors.textHeading} />
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount}</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

function SidelineThisWeekSection({ squads }: { squads: SquadDetail[] }) {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{t('home.sidelineThisWeek')}</Text>
      {squads.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipScroll}
        >
          {squads.map((s) => (
            <TouchableOpacity
              key={s.squadId}
              style={styles.squadChip}
              onPress={() => router.push({ pathname: '/(social)/squad-detail', params: { squadId: s.squadId } })}
            >
              <Text style={styles.chipEmoji}>{s.sport}</Text>
              <Text style={styles.chipName}>{s.name}</Text>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: s.activeMemberCount > 0 ? Colors.accentGreen : Colors.secondary },
                ]}
              />
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.nudgeCard}>
          <Text style={styles.nudgeText}>{t('home.noSquadsYet')}</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/squad')}>
            <Text style={styles.nudgeLink}>{t('home.findSquadsNearby')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function LiveSquadCard({ squad, onPress }: { squad: LiveSquadData; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.liveCard}>
      <View style={styles.liveBorder} />
      <View style={styles.liveContent}>
        <View style={styles.liveRow}>
          <Text style={styles.liveSquadName}>{squad.name}</Text>
          <View style={styles.livePill}>
            <Text style={styles.livePillText}>{t('home.live')}</Text>
          </View>
        </View>
        <Text style={styles.liveVenue}>{squad.venueName}</Text>
        <Text style={styles.liveActiveCount}>
          {t('home.parentsActiveNow', { count: squad.activeMemberCount })}
        </Text>

        <View style={styles.avatarRow}>
          {squad.memberAvatars.map((m, i) => (
            <View key={m.userId} style={[styles.avatarCircle, i > 0 && { marginLeft: -8 }]}>
              {m.avatarUrl ? (
                <Image source={{ uri: m.avatarUrl }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarInitials}>{m.displayName[0]}</Text>
              )}
            </View>
          ))}
          {squad.activeMemberCount > 5 && (
            <View style={[styles.avatarCircle, { marginLeft: -8, backgroundColor: Colors.secondary }]}>
              <Text style={styles.avatarMore}>+{squad.activeMemberCount - 5}</Text>
            </View>
          )}
        </View>

        <TouchableOpacity style={styles.joinChatButton} onPress={onPress}>
          <Text style={styles.joinChatText}>{t('home.joinChat')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function WeeklyChallengeCard({
  challenge,
  status,
  onAccept,
  onComplete,
  lang,
}: {
  challenge: Challenge;
  status: 'accepted' | 'complete' | null;
  onAccept: () => void;
  onComplete: () => void;
  lang: string;
}) {
  const { t } = useTranslation();
  const title = lang === 'es' ? challenge.title_es : challenge.title;
  const description = lang === 'es' ? challenge.description_es : challenge.description;

  return (
    <View style={styles.challengeCard}>
      <View style={styles.challengeBorder} />
      <View style={styles.challengeContent}>
        <Text style={styles.challengeLabel}>{t('home.thisWeeksChallenge')}</Text>
        <Text style={styles.challengeTitle}>{title}</Text>
        <Text style={styles.challengeDesc}>{description}</Text>

        <View style={styles.progressBarBg}>
          <View
            style={[
              styles.progressBarFill,
              { width: status === 'complete' ? '100%' : status === 'accepted' ? '50%' : '0%' },
            ]}
          />
        </View>

        {!status ? (
          <TouchableOpacity style={styles.challengeButton} onPress={onAccept}>
            <Text style={styles.challengeButtonText}>{t('home.acceptChallenge')}</Text>
          </TouchableOpacity>
        ) : status === 'accepted' ? (
          <TouchableOpacity style={styles.challengeButton} onPress={onComplete}>
            <Text style={styles.challengeButtonText}>{t('home.markComplete')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.challengeButton, { backgroundColor: Colors.accentGreen }]}>
            <Text style={styles.challengeButtonText}>{t('home.completed')}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function ActivityFeedSection({ items, lang }: { items: ActivityItem[]; lang: string }) {
  const { t } = useTranslation();

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{t('home.whatsHappening')}</Text>
      {items.length === 0 ? (
        <View style={styles.emptyFeed}>
          <Text style={{ fontSize: 40 }}>⚽</Text>
          <Text style={styles.emptyTitle}>{t('home.emptyFeedTitle')}</Text>
          <Text style={styles.emptySubtitle}>{t('home.emptyFeedSubtitle')}</Text>
        </View>
      ) : (
        items.map((item) => (
          <View key={item.activityId} style={styles.activityCard}>
            <View style={styles.activityAvatar}>
              {item.avatarUrl ? (
                <Image source={{ uri: item.avatarUrl }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarInitials}>{item.displayName[0]}</Text>
              )}
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.activityMsg}>
                {lang === 'es' ? item.message_es : item.message}
              </Text>
              <Text style={styles.activityTime}>{formatRelativeTime(item.createdAt, t)}</Text>
            </View>
            <Text style={{ fontSize: 18 }}>{getActivityIcon(item.type)}</Text>
          </View>
        ))
      )}
    </View>
  );
}

function ConnectionPromptCard({
  prompt,
  lang,
  onShare,
}: {
  prompt: ConnectionPrompt;
  lang: string;
  onShare: () => void;
}) {
  const { t } = useTranslation();
  const text = lang === 'es' ? prompt.promptText_es : prompt.promptText;

  return (
    <View style={styles.promptCard}>
      <Text style={styles.promptText}>{text}</Text>
      <TouchableOpacity style={styles.promptButton} onPress={onShare}>
        <Text style={styles.promptButtonText}>{t('home.shareInSquadChat')}</Text>
      </TouchableOpacity>
    </View>
  );
}

function HomeSkeleton() {
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.8, { duration: 1200 }), -1, true);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <View style={{ paddingHorizontal: 20 }}>
      {/* Horizontal Chips Skeleton */}
      <View style={{ height: 20, width: 120, backgroundColor: Colors.secondary, borderRadius: 4, marginBottom: 12 }} />
      <Animated.View style={[{ flexDirection: 'row', gap: 8, marginBottom: 20 }, animatedStyle]}>
        {[1, 2, 3].map((i) => (
          <View key={i} style={{ width: 100, height: 36, backgroundColor: Colors.secondary, borderRadius: 18 }} />
        ))}
      </Animated.View>

      {/* Cards Skeleton */}
      <Animated.View style={[{ height: 160, backgroundColor: Colors.secondary, borderRadius: 16, marginBottom: 16 }, animatedStyle]} />
      <Animated.View style={[{ height: 200, backgroundColor: Colors.secondary, borderRadius: 16, marginBottom: 24 }, animatedStyle]} />

      {/* List Skeleton */}
      <View style={{ height: 20, width: 140, backgroundColor: Colors.secondary, borderRadius: 4, marginBottom: 12 }} />
      {[1, 2, 3].map((i) => (
        <Animated.View
          key={i}
          style={[{ height: 70, backgroundColor: Colors.secondary, borderRadius: 12, marginBottom: 12 }, animatedStyle]}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(date: Date, t: any): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (mins < 1) return t('home.justNow');
  if (mins < 60) return t('home.minutesAgo', { count: mins });
  if (hours < 24) return t('home.hoursAgo', { count: hours });
  return t('home.daysAgo', { count: days });
}

function getActivityIcon(type: ActivityItem['type']): string {
  switch (type) {
    case 'earn_badge': return '🏆';
    case 'play_game': return '⚡';
    case 'new_friend': return '❤️';
    case 'complete_challenge': return '⭐';
    default: return '👥';
  }
}

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const MOCK_ACTIVITY: ActivityItem[] = [
  {
    activityId: 'm1',
    type: 'join_squad',
    userId: 'u1',
    displayName: 'Maria Garcia',
    avatarUrl: null,
    squadId: 's1',
    message: 'Maria joined Tigers Soccer Squad',
    message_es: 'Maria se unió al equipo de Fútbol Tigres',
    createdAt: new Date(Date.now() - 120000),
  },
  {
    activityId: 'm2',
    type: 'earn_badge',
    userId: 'u2',
    displayName: 'James Smith',
    avatarUrl: null,
    squadId: null,
    message: 'James earned the Bomb Squad badge',
    message_es: 'James ganó la insignia de Bomb Squad',
    createdAt: new Date(Date.now() - 3600000),
  },
  {
    activityId: 'm3',
    type: 'complete_challenge',
    userId: 'u3',
    displayName: 'Lisa Wong',
    avatarUrl: null,
    squadId: null,
    message: "Lisa completed this week's challenge!",
    message_es: '¡Lisa completó el reto de esta semana!',
    createdAt: new Date(Date.now() - 7200000),
  },
];

const MOCK_SQUAD_DETAILS: SquadDetail[] = [
  {
    squadId: 's1',
    name: 'Tigers Soccer',
    sport: '⚽',
    venueName: 'West Park',
    activeMemberCount: 3,
    lastActivityAt: new Date(),
  },
  {
    squadId: 's2',
    name: 'Little League',
    sport: '⚾',
    venueName: 'Diamond Field',
    activeMemberCount: 0,
    lastActivityAt: null,
  },
];

const MOCK_CHALLENGE: Challenge = {
  challengeId: 'c1',
  title: 'Social Sideline',
  title_es: 'Sideline Social',
  description: 'Say hello to one new parent you don’t know yet.',
  description_es: 'Di hola a un nuevo padre que aún no conozcas.',
  type: 'social',
  starsReward: 200,
  weekStart: new Date(),
  weekEnd: new Date(Date.now() + 604800000),
  isActive: true,
};

const MOCK_PROMPT: ConnectionPrompt = {
  promptId: 'p1',
  promptText: "What's something you love about watching your kid play?",
  promptText_es: '¿Qué es algo que amas de ver a tu hijo jugar?',
  weekOf: new Date(),
  isActive: true,
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.secondary,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoMark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: Typography.heading,
    fontSize: 18,
    color: Colors.textHeading,
  },
  bellButton: {
    padding: 4,
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: Colors.primary,
    width: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surface,
  },
  badgeText: {
    color: 'white',
    fontSize: 8,
    fontFamily: Typography.bodyBold,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sectionLabel: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.textHeading,
    marginBottom: 12,
  },
  chipScroll: {
    gap: 8,
  },
  squadChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.secondary,
  },
  chipEmoji: {
    fontSize: 14,
  },
  chipName: {
    fontFamily: Typography.bodyMedium,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  nudgeCard: {
    padding: 16,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.secondary,
    gap: 4,
  },
  nudgeText: {
    fontFamily: Typography.bodyMedium,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  nudgeLink: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.primary,
  },
  liveCard: {
    marginHorizontal: 20,
    marginVertical: 8,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    ...Shadow.card,
  },
  liveBorder: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: Colors.accentGreen,
  },
  liveContent: {
    padding: 16,
    paddingLeft: 20,
  },
  liveRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  liveSquadName: {
    fontFamily: Typography.heading,
    fontSize: 16,
    color: Colors.textHeading,
  },
  livePill: {
    backgroundColor: Colors.accentGreen,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  livePillText: {
    fontFamily: Typography.bodyBold,
    fontSize: 10,
    color: 'white',
  },
  liveVenue: {
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
    color: Colors.textPrimary,
    marginTop: 2,
  },
  liveActiveCount: {
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
    color: Colors.textPrimary,
    marginTop: 2,
  },
  avatarRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  avatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  avatarImg: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
  },
  avatarInitials: {
    fontFamily: Typography.bodyBold,
    fontSize: 12,
    color: Colors.textHeading,
  },
  avatarMore: {
    fontFamily: Typography.bodyMedium,
    fontSize: 10,
    color: Colors.textHeading,
  },
  joinChatButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  joinChatText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    color: 'white',
  },
  challengeCard: {
    marginHorizontal: 20,
    marginVertical: 8,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    ...Shadow.card,
  },
  challengeBorder: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: Colors.accentGold,
  },
  challengeContent: {
    padding: 16,
    paddingLeft: 20,
  },
  challengeLabel: {
    fontFamily: Typography.bodyBold,
    fontSize: 10,
    color: Colors.accentGold,
    letterSpacing: 1,
  },
  challengeTitle: {
    fontFamily: Typography.heading,
    fontSize: 18,
    color: Colors.textHeading,
    marginTop: 4,
  },
  challengeDesc: {
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
    color: Colors.textPrimary,
    marginTop: 6,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: Colors.secondary,
    borderRadius: 3,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.accentGold,
    borderRadius: 3,
  },
  challengeButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  challengeButtonText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    color: 'white',
  },
  emptyFeed: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: Typography.bodyMedium,
    fontSize: 14,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
    color: Colors.textPrimary,
    opacity: 0.6,
    textAlign: 'center',
  },
  activityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    ...Shadow.card,
  },
  activityAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityMsg: {
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
    color: Colors.textPrimary,
  },
  activityTime: {
    fontFamily: Typography.bodyRegular,
    fontSize: 10,
    color: Colors.textPrimary,
    opacity: 0.5,
    marginTop: 2,
  },
  promptCard: {
    marginHorizontal: 20,
    marginVertical: 8,
    backgroundColor: Colors.textHeading,
    borderRadius: 16,
    padding: 20,
    ...Shadow.card,
  },
  promptText: {
    fontFamily: 'Caveat_700Bold',
    fontSize: 22,
    color: Colors.background,
    lineHeight: 30,
  },
  promptButton: {
    borderWidth: 1,
    borderColor: Colors.background,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignSelf: 'flex-start',
    marginTop: 16,
  },
  promptButtonText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.background,
  },
});