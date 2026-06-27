import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography, Spacing, Shadow, Radius } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import {
  subscribeToSession,
  getGameLabel,
  getGameEmoji,
  GameSession,
  GamePlayer,
  GAME_CONFIG,
} from '@/services/gameService';

// Stars per game type on completion
const STARS_REWARD: Record<string, number> = {
  bomb_defusal: 300,
  spot_difference: 200,
  trivia_blitz: 150,
};

export default function ResultsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ sessionId: string }>();

  const sessionId = params.sessionId;
  const uid = user?.uid ?? 'stub-user-123';

  const [session, setSession] = useState<GameSession | null>(null);

  // Entry animations
  const headerScale = useSharedValue(0);
  const listOpacity = useSharedValue(0);

  useEffect(() => {
    if (!sessionId) return;
    const unsub = subscribeToSession(sessionId, (s) => {
      if (s) setSession(s);
    });
    return unsub;
  }, [sessionId]);

  useEffect(() => {
    if (!session) return;
    // Animate in
    Haptics.notificationAsync(
      session.status === 'completed'
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Error
    );
    headerScale.value = withSpring(1, { damping: 12, stiffness: 150 });
    listOpacity.value = withDelay(400, withTiming(1, { duration: 600 }));
  }, [session?.status]);

  const headerAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: headerScale.value }],
  }));
  const listAnimStyle = useAnimatedStyle(() => ({
    opacity: listOpacity.value,
  }));

  if (!session) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>{t('common.loading')}</Text>
      </View>
    );
  }

  const isWin = session.status === 'completed';
  const players = Object.entries(session.players ?? {}) as [string, GamePlayer][];
  const sorted = [...players].sort(([, a], [, b]) => b.score - a.score);
  const myPlayer = session.players[uid];
  const starsEarned = isWin ? (STARS_REWARD[session.gameType] ?? 150) : 0;
  const gameEmoji = getGameEmoji(session.gameType);
  const gameLabel = getGameLabel(session.gameType);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* Result Header */}
        <Animated.View style={[styles.resultHeader, headerAnimStyle]}>
          <Text style={styles.resultEmoji}>{isWin ? '🏆' : '💥'}</Text>
          <Text style={[styles.resultTitle, { color: isWin ? Colors.accentGold : Colors.primary }]}>
            {isWin ? t('games.results.won') : t('games.results.lost')}
          </Text>
          <Text style={styles.gameName}>
            {gameEmoji} {gameLabel}
          </Text>

          {isWin && starsEarned > 0 && (
            <View style={styles.starsEarned}>
              <Text style={styles.starsEmoji}>⭐</Text>
              <Text style={styles.starsText}>
                +{starsEarned} {t('games.results.stars')}
              </Text>
              <Text style={styles.starsNote}>{t('games.results.starsNote')}</Text>
            </View>
          )}
        </Animated.View>

        {/* Leaderboard */}
        <Animated.View style={listAnimStyle}>
          <Text style={styles.sectionLabel}>{t('games.results.scores')}</Text>
          <View style={styles.scoreList}>
            {sorted.map(([playerId, player], index) => (
              <ScoreRow
                key={playerId}
                rank={index + 1}
                player={player}
                isMe={playerId === uid}
                isTop={index === 0 && isWin}
              />
            ))}
          </View>

          {/* My result summary */}
          {myPlayer && (
            <View style={styles.myResult}>
              <Text style={styles.myResultLabel}>{t('games.results.yourScore')}</Text>
              <Text style={styles.myResultScore}>{myPlayer.score}</Text>
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.playAgainButton}
              onPress={() => {
                router.replace('/(tabs)/games');
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.playAgainText}>{t('games.results.playAgain')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.replace('/(tabs)/games')}
              activeOpacity={0.85}
            >
              <Text style={styles.backText}>{t('games.results.backToGames')}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ScoreRow
// ---------------------------------------------------------------------------

function ScoreRow({
  rank,
  player,
  isMe,
  isTop,
}: {
  rank: number;
  player: GamePlayer;
  isMe: boolean;
  isTop: boolean;
}) {
  const rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
  const { t } = useTranslation();

  return (
    <View style={[styles.scoreRow, isMe && styles.scoreRowMe]}>
      <Text style={styles.rankText}>{rankEmoji}</Text>

      <View style={styles.playerAvatar}>
        {player.avatarUrl ? (
          <Image source={{ uri: player.avatarUrl }} style={styles.avatarImg} />
        ) : (
          <Text style={styles.avatarInitials}>{player.displayName?.[0] ?? '?'}</Text>
        )}
      </View>

      <Text style={[styles.scoreName, isMe && styles.scoreNameMe]}>{player.displayName}</Text>

      {isMe && (
        <View style={styles.youPill}>
          <Text style={styles.youPillText}>{t('games.lobby.you')}</Text>
        </View>
      )}

      <Text style={[styles.scoreValue, isTop && styles.scoreValueTop]}>
        {player.score}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  loadingText: {
    fontFamily: Typography.bodyMedium,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  scroll: {
    padding: Spacing.md,
    gap: Spacing.md,
    paddingBottom: 60,
  },
  resultHeader: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadow.card,
  },
  resultEmoji: {
    fontSize: 64,
  },
  resultTitle: {
    fontFamily: Typography.heading,
    fontSize: 32,
    textAlign: 'center',
  },
  gameName: {
    fontFamily: Typography.bodyMedium,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  starsEarned: {
    alignItems: 'center',
    marginTop: Spacing.xs,
    gap: 2,
  },
  starsEmoji: {
    fontSize: 28,
  },
  starsText: {
    fontFamily: Typography.bodyBold,
    fontSize: 22,
    color: Colors.accentGold,
  },
  starsNote: {
    fontFamily: Typography.bodyRegular,
    fontSize: 11,
    color: Colors.textPrimary,
    opacity: 0.6,
    textAlign: 'center',
  },
  sectionLabel: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.textHeading,
    marginBottom: 8,
  },
  scoreList: {
    gap: Spacing.sm,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.card,
  },
  scoreRowMe: {
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  rankText: {
    fontFamily: Typography.bodyBold,
    fontSize: 18,
    width: 36,
    textAlign: 'center',
  },
  playerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarInitials: {
    fontFamily: Typography.bodyBold,
    fontSize: 14,
    color: Colors.textHeading,
  },
  scoreName: {
    flex: 1,
    fontFamily: Typography.bodyMedium,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  scoreNameMe: {
    fontFamily: Typography.bodySemiBold,
    color: Colors.textHeading,
  },
  youPill: {
    backgroundColor: `${Colors.primary}22`,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  youPillText: {
    fontFamily: Typography.bodyBold,
    fontSize: 10,
    color: Colors.primary,
  },
  scoreValue: {
    fontFamily: Typography.bodyBold,
    fontSize: 18,
    color: Colors.textHeading,
    minWidth: 40,
    textAlign: 'right',
  },
  scoreValueTop: {
    color: Colors.accentGold,
  },
  myResult: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
    gap: 4,
    ...Shadow.card,
  },
  myResultLabel: {
    fontFamily: Typography.bodyMedium,
    fontSize: 12,
    color: Colors.textPrimary,
    opacity: 0.7,
  },
  myResultScore: {
    fontFamily: Typography.heading,
    fontSize: 40,
    color: Colors.textHeading,
  },
  actions: {
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  playAgainButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    paddingVertical: 14,
    alignItems: 'center',
    ...Shadow.card,
  },
  playAgainText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 15,
    color: 'white',
  },
  backButton: {
    borderWidth: 1.5,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    paddingVertical: 14,
    alignItems: 'center',
  },
  backText: {
    fontFamily: Typography.bodyMedium,
    fontSize: 14,
    color: Colors.textPrimary,
  },
});