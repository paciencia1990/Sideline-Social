import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  AppState,
  Alert,
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography, Spacing, Shadow, Radius } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import {
  subscribeToSession,
  joinGameSession,
  setPlayerReady,
  setPlayerConnected,
  startCountdown,
  startGame,
  removePlayer,
  deleteSession,
  getGameLabel,
  getGameEmoji,
  GameSession,
  GamePlayer,
  GAME_CONFIG,
} from '@/services/gameService';

type LobbyPhase = 'lobby' | 'countdown' | 'active' | 'completed' | 'failed';

export default function LobbyScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ sessionId: string; isHost: string }>();

  const sessionId = params.sessionId;
  const isHost = params.isHost === '1';

  const [session, setSession] = useState<GameSession | null>(null);
  const [phase, setPhase] = useState<LobbyPhase>('lobby');
  const [countdownValue, setCountdownValue] = useState(3);
  const [showCountdown, setShowCountdown] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  // Track disconnection timers per player
  const disconnectTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const uid = user?.uid ?? 'stub-user-123';
  const displayName = user?.displayName ?? 'Parent';
  const avatarUrl = user?.photoURL ?? null;

  // ---------------------------------------------------------------------------
  // Subscribe to session
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!sessionId) return;

    // Join session if not host
    if (!isHost) {
      joinGameSession(sessionId, uid, displayName, avatarUrl).catch((err) =>
        console.warn('[Lobby] join error:', err)
      );
    }

    // Set connected on mount
    setPlayerConnected(sessionId, uid, true);

    // Start real-time listener
    unsubscribeRef.current = subscribeToSession(sessionId, (s) => {
      if (!s) {
        // Session was deleted
        router.replace('/(tabs)/games');
        return;
      }
      setSession(s);

      // Phase transitions
      if (s.status === 'countdown' && phase !== 'countdown') {
        setPhase('countdown');
        runCountdown();
      } else if (s.status === 'active' && phase !== 'active') {
        setPhase('active');
        navigateToGame(s.gameType);
      } else if (s.status === 'completed' || s.status === 'failed') {
        setPhase(s.status);
        router.replace({
          pathname: '/(games)/results' as any,
          params: { sessionId },
        });
      }

      // Handle disconnected players — 60s removal timer
      Object.entries(s.players ?? {}).forEach(([playerId, player]) => {
        if (!player.isConnected) {
          if (!disconnectTimers.current[playerId]) {
            disconnectTimers.current[playerId] = setTimeout(() => {
              removePlayer(sessionId, playerId);
              delete disconnectTimers.current[playerId];
            }, 60000);
          }
        } else {
          // Player reconnected — clear timer
          if (disconnectTimers.current[playerId]) {
            clearTimeout(disconnectTimers.current[playerId]);
            delete disconnectTimers.current[playerId];
          }
        }
      });
    });

    // Handle AppState for connection tracking
    const appStateSub = AppState.addEventListener('change', (state) => {
      setPlayerConnected(sessionId, uid, state === 'active');
    });

    return () => {
      unsubscribeRef.current?.();
      appStateSub.remove();
      setPlayerConnected(sessionId, uid, false);
      // Clear all disconnect timers
      Object.values(disconnectTimers.current).forEach(clearTimeout);
    };
  }, [sessionId]);

  // ---------------------------------------------------------------------------
  // Countdown sequence
  // ---------------------------------------------------------------------------

  const runCountdown = useCallback(() => {
    setShowCountdown(true);
    let count = 3;
    setCountdownValue(count);

    const tick = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (count <= 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setShowCountdown(false);
        // Trigger game start on host side
        if (isHost) {
          startGame(sessionId).catch(console.warn);
        }
        return;
      }
      setCountdownValue(count);
      count--;
      setTimeout(tick, 1000);
    };

    tick();
  }, [isHost, sessionId]);

  const navigateToGame = (gameType: string) => {
    const routeMap: Record<string, string> = {
      bomb_defusal: '/(games)/bomb-defusal',
      spot_difference: '/(games)/spot-difference',
      trivia_blitz: '/(games)/trivia-blitz',
    };
    const route = routeMap[gameType];
    if (route) {
      router.replace({ pathname: route as any, params: { sessionId } });
    }
  };

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleReady = async () => {
    if (!session) return;
    const myStatus = session.players[uid]?.isReady;
    await setPlayerReady(sessionId, uid, !myStatus);
  };

  const handleStartGame = async () => {
    if (!session || isStarting) return;
    const players = Object.values(session.players);
    const config = GAME_CONFIG[session.gameType];

    if (players.length < config.minPlayers) {
      Alert.alert(
        t('games.lobby.notEnoughPlayers'),
        t('games.lobby.needMorePlayers', { count: config.minPlayers })
      );
      return;
    }

    const allReady = players.every((p) => p.isReady);
    if (!allReady) {
      Alert.alert(t('games.lobby.notAllReady'), t('games.lobby.waitForReady'));
      return;
    }

    setIsStarting(true);
    try {
      await startCountdown(sessionId);
    } catch (err) {
      Alert.alert(t('games.lobby.startError'), t('games.tryAgain'));
      setIsStarting(false);
    }
  };

  const handleLeave = async () => {
    Alert.alert(t('games.lobby.leaveTitle'), t('games.lobby.leaveBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('games.lobby.leave'),
        style: 'destructive',
        onPress: async () => {
          if (isHost) {
            await deleteSession(sessionId);
          } else {
            await removePlayer(sessionId, uid);
          }
          router.replace('/(tabs)/games');
        },
      },
    ]);
  };

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  if (!session) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>{t('common.loading')}</Text>
      </View>
    );
  }

  const players = Object.entries(session.players ?? {}) as [string, GamePlayer][];
  const myPlayer = session.players[uid];
  const isMyReady = myPlayer?.isReady ?? false;
  const allReady = players.every(([, p]) => p.isReady && p.isConnected);
  const config = GAME_CONFIG[session.gameType];
  const canStart = isHost && allReady && players.length >= config.minPlayers && !isStarting;
  const gameEmoji = getGameEmoji(session.gameType);
  const gameLabel = getGameLabel(session.gameType);

  // ---------------------------------------------------------------------------
  // Countdown overlay
  // ---------------------------------------------------------------------------

  if (showCountdown) {
    return (
      <View style={styles.countdownContainer}>
        <CountdownNumber value={countdownValue} />
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* Game Header */}
        <View style={styles.gameHeader}>
          <Text style={styles.gameEmoji}>{gameEmoji}</Text>
          <Text style={styles.gameTitle}>{gameLabel}</Text>
          <Text style={styles.lobbyLabel}>{t('games.lobby.title')}</Text>
        </View>

        {/* Join Code */}
        <View style={styles.codeCard}>
          <Text style={styles.codeHint}>{t('games.lobby.joinCode')}</Text>
          <Text style={styles.codeValue}>{session.joinCode}</Text>
          <Text style={styles.codeSubhint}>{t('games.lobby.codeHint')}</Text>
        </View>

        {/* Player Count */}
        <View style={styles.playerMeta}>
          <Text style={styles.playerCount}>
            {t('games.lobby.playerCount', { count: players.length, max: config.maxPlayers })}
          </Text>
          {players.length < config.minPlayers && (
            <Text style={styles.minPlayersWarning}>
              {t('games.lobby.needMin', { count: config.minPlayers })}
            </Text>
          )}
        </View>

        {/* Player List */}
        <View style={styles.playerList}>
          {players.map(([playerId, player]) => (
            <PlayerCard
              key={playerId}
              player={player}
              isMe={playerId === uid}
              isHost={playerId === session.hostUserId}
            />
          ))}
        </View>

        {/* Ready / Start buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[
              styles.readyButton,
              isMyReady && styles.readyButtonActive,
            ]}
            onPress={handleReady}
            activeOpacity={0.85}
          >
            <Text style={[styles.readyButtonText, isMyReady && styles.readyButtonTextActive]}>
              {isMyReady ? t('games.lobby.readyDone') : t('games.lobby.readyUp')}
            </Text>
          </TouchableOpacity>
        </View>

        {isHost && (
          <TouchableOpacity
            style={[styles.startButton, !canStart && styles.startButtonDisabled]}
            onPress={handleStartGame}
            activeOpacity={0.85}
            disabled={!canStart}
          >
            <Text style={styles.startButtonText}>{t('games.lobby.startGame')}</Text>
          </TouchableOpacity>
        )}

        {/* Leave */}
        <TouchableOpacity style={styles.leaveButton} onPress={handleLeave}>
          <Text style={styles.leaveText}>
            {isHost ? t('games.lobby.cancelGame') : t('games.lobby.leave')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// PlayerCard
// ---------------------------------------------------------------------------

function PlayerCard({
  player,
  isMe,
  isHost,
}: {
  player: GamePlayer;
  isMe: boolean;
  isHost: boolean;
}) {
  const { t } = useTranslation();
  const isDisconnected = !player.isConnected;

  return (
    <View
      style={[
        styles.playerCard,
        player.isReady && styles.playerCardReady,
        isDisconnected && styles.playerCardDisconnected,
      ]}
    >
      {/* Avatar */}
      <View style={[styles.playerAvatar, player.isReady && styles.playerAvatarReady]}>
        {player.avatarUrl ? (
          <Image source={{ uri: player.avatarUrl }} style={styles.avatarImg} />
        ) : (
          <Text style={styles.avatarInitials}>{player.displayName?.[0] ?? '?'}</Text>
        )}
      </View>

      {/* Name + badges */}
      <View style={styles.playerInfo}>
        <View style={styles.playerNameRow}>
          <Text style={styles.playerName}>{player.displayName}</Text>
          {isMe && (
            <View style={styles.youPill}>
              <Text style={styles.youPillText}>{t('games.lobby.you')}</Text>
            </View>
          )}
          {isHost && (
            <View style={styles.hostPill}>
              <Text style={styles.hostPillText}>{t('games.lobby.host')}</Text>
            </View>
          )}
        </View>
        {isDisconnected && (
          <Text style={styles.disconnectedText}>{t('games.lobby.disconnected')}</Text>
        )}
      </View>

      {/* Ready Indicator */}
      <View style={[styles.readyIndicator, player.isReady && styles.readyIndicatorOn]}>
        {player.isReady && <Text style={{ fontSize: 12 }}>✓</Text>}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// CountdownNumber — animated big number
// ---------------------------------------------------------------------------

function CountdownNumber({ value }: { value: number }) {
  const scale = useSharedValue(1.5);
  const opacity = useSharedValue(0);

  useEffect(() => {
    scale.value = 1.5;
    opacity.value = 0;
    scale.value = withTiming(1, { duration: 800 });
    opacity.value = withSequence(
      withTiming(1, { duration: 150 }),
      withDelay(600, withTiming(0, { duration: 250 }))
    );
  }, [value]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const isGo = value <= 0;

  return (
    <Animated.Text style={[styles.countdownText, animatedStyle]}>
      {isGo ? 'GO!' : value.toString()}
    </Animated.Text>
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
  loadingContainer: {
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
    paddingBottom: 48,
  },
  gameHeader: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.xs,
  },
  gameEmoji: {
    fontSize: 48,
  },
  gameTitle: {
    fontFamily: Typography.heading,
    fontSize: 24,
    color: Colors.textHeading,
    textAlign: 'center',
  },
  lobbyLabel: {
    fontFamily: Typography.bodyMedium,
    fontSize: 13,
    color: Colors.textPrimary,
    opacity: 0.65,
    textAlign: 'center',
  },
  codeCard: {
    backgroundColor: Colors.textHeading,
    borderRadius: 16,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.xs,
    ...Shadow.card,
  },
  codeHint: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 11,
    color: Colors.secondary,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  codeValue: {
    fontFamily: Typography.heading,
    fontSize: 36,
    color: Colors.primary,
    letterSpacing: 12,
  },
  codeSubhint: {
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
    color: Colors.background,
    opacity: 0.7,
    textAlign: 'center',
  },
  playerMeta: {
    gap: 4,
  },
  playerCount: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.textHeading,
  },
  minPlayersWarning: {
    fontFamily: Typography.bodyMedium,
    fontSize: 12,
    color: Colors.accentGold,
  },
  playerList: {
    gap: Spacing.sm,
  },
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: Spacing.md,
    gap: Spacing.md,
    borderWidth: 1.5,
    borderColor: Colors.secondary,
    ...Shadow.card,
  },
  playerCardReady: {
    borderColor: Colors.accentGreen,
  },
  playerCardDisconnected: {
    opacity: 0.5,
  },
  playerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.secondary,
  },
  playerAvatarReady: {
    borderColor: Colors.accentGreen,
  },
  avatarImg: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarInitials: {
    fontFamily: Typography.bodyBold,
    fontSize: 16,
    color: Colors.textHeading,
  },
  playerInfo: {
    flex: 1,
    gap: 2,
  },
  playerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },
  playerName: {
    fontFamily: Typography.bodyMedium,
    fontSize: 14,
    color: Colors.textPrimary,
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
  hostPill: {
    backgroundColor: `${Colors.textHeading}22`,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  hostPillText: {
    fontFamily: Typography.bodyBold,
    fontSize: 10,
    color: Colors.textHeading,
  },
  disconnectedText: {
    fontFamily: Typography.bodyRegular,
    fontSize: 11,
    color: Colors.accentGold,
  },
  readyIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyIndicatorOn: {
    borderColor: Colors.accentGreen,
    backgroundColor: Colors.accentGreen,
  },
  actionRow: {
    marginTop: Spacing.xs,
  },
  readyButton: {
    borderWidth: 2,
    borderColor: Colors.accentGreen,
    borderRadius: Radius.button,
    paddingVertical: 14,
    alignItems: 'center',
  },
  readyButtonActive: {
    backgroundColor: Colors.accentGreen,
  },
  readyButtonText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.accentGreen,
  },
  readyButtonTextActive: {
    color: 'white',
  },
  startButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    paddingVertical: 14,
    alignItems: 'center',
    ...Shadow.card,
  },
  startButtonDisabled: {
    opacity: 0.4,
  },
  startButtonText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 15,
    color: 'white',
  },
  leaveButton: {
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  leaveText: {
    fontFamily: Typography.bodyMedium,
    fontSize: 13,
    color: Colors.textPrimary,
    opacity: 0.55,
    textDecorationLine: 'underline',
  },
  // Countdown
  countdownContainer: {
    flex: 1,
    backgroundColor: Colors.textHeading,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownText: {
    fontFamily: Typography.heading,
    fontSize: 120,
    color: Colors.primary,
    textAlign: 'center',
  },
});