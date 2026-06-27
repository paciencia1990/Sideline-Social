import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Trophy } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography, Spacing, Shadow, Radius } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useSquad } from '@/context/SquadContext';
import {
  fetchActiveSquadSession,
  fetchSessionByCode,
  createGameSession,
  getGameLabel,
  getGameEmoji,
  GameSession,
  GameType,
} from '@/services/gameService';

// ---------------------------------------------------------------------------
// Game Definitions
// ---------------------------------------------------------------------------

interface GameDef {
  type: GameType;
  emoji: string;
  titleKey: string;
  descKey: string;
  players: string;
  time: string;
  difficulty: number; // 1–3 dots
}

const GAMES: GameDef[] = [
  {
    type: 'bomb_defusal',
    emoji: '💣',
    titleKey: 'games.bombDefusal.title',
    descKey: 'games.bombDefusal.desc',
    players: '2–6',
    time: '3–8 min',
    difficulty: 3,
  },
  {
    type: 'spot_difference',
    emoji: '🔍',
    titleKey: 'games.spotDifference.title',
    descKey: 'games.spotDifference.desc',
    players: '4–12',
    time: '7 min',
    difficulty: 2,
  },
  {
    type: 'trivia_blitz',
    emoji: '⚡',
    titleKey: 'games.triviaBlitz.title',
    descKey: 'games.triviaBlitz.desc',
    players: '3–20',
    time: '5–15 min',
    difficulty: 1,
  },
];

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function GamesScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { mySquadIds } = useSquad();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [activeSession, setActiveSession] = useState<GameSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [creatingGame, setCreatingGame] = useState<GameType | null>(null);

  const [showJoinCode, setShowJoinCode] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joiningByCode, setJoiningByCode] = useState(false);

  // Check for active squad game on mount
  const checkActiveSession = useCallback(async () => {
    if (mySquadIds.length === 0) return;
    setLoadingSession(true);
    try {
      const session = await fetchActiveSquadSession(mySquadIds[0]);
      setActiveSession(session);
    } catch (err) {
      console.warn('[GamesScreen] checkActiveSession error:', err);
    } finally {
      setLoadingSession(false);
    }
  }, [mySquadIds]);

  useEffect(() => {
    checkActiveSession();
  }, [checkActiveSession]);

  const handlePlayNow = async (gameType: GameType) => {
    if (!user) {
      Alert.alert(t('games.signInRequired'), t('games.signInToPlay'));
      return;
    }
    if (mySquadIds.length === 0) {
      Alert.alert(t('games.noSquadTitle'), t('games.noSquadDesc'));
      return;
    }

    setCreatingGame(gameType);
    try {
      const session = await createGameSession({
        gameType,
        squadId: mySquadIds[0],
        hostUserId: user.uid,
        hostDisplayName: user.displayName ?? 'Parent',
        hostAvatarUrl: user.photoURL ?? null,
      });
      router.push({
        pathname: '/(games)/lobby' as any,
        params: { sessionId: session.sessionId, isHost: '1' },
      });
    } catch (err) {
      Alert.alert(t('games.errorCreating'), t('games.tryAgain'));
    } finally {
      setCreatingGame(null);
    }
  };

  const handleJoinActive = () => {
    if (!activeSession) return;
    router.push({
      pathname: '/(games)/lobby' as any,
      params: { sessionId: activeSession.sessionId, isHost: '0' },
    });
  };

  const handleJoinByCode = async () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (code.length !== 4) {
      Alert.alert(t('games.invalidCode'), t('games.codeHint'));
      return;
    }
    setJoiningByCode(true);
    try {
      const session = await fetchSessionByCode(code);
      if (!session) {
        Alert.alert(t('games.codeNotFound'), t('games.checkCode'));
        return;
      }
      router.push({
        pathname: '/(games)/lobby' as any,
        params: { sessionId: session.sessionId, isHost: '0' },
      });
    } catch (err) {
      Alert.alert(t('games.errorJoining'), t('games.tryAgain'));
    } finally {
      setJoiningByCode(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{t('games.title')}</Text>
          <Text style={styles.subtitle}>{t('games.subtitle')}</Text>
        </View>

        {/* Active Game Banner */}
        {activeSession && (
          <View style={styles.activeBanner}>
            <View style={styles.activeBannerLeft}>
              <Text style={styles.activeBannerEmoji}>{getGameEmoji(activeSession.gameType)}</Text>
              <Text style={styles.activeBannerText}>
                {t('games.squadPlaying', { game: getGameLabel(activeSession.gameType) })}
              </Text>
            </View>
            <TouchableOpacity style={styles.joinBannerButton} onPress={handleJoinActive}>
              <Text style={styles.joinBannerText}>{t('games.joinGame')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Game Cards */}
        {GAMES.map((game) => {
          const hasActiveGame = activeSession?.gameType === game.type;
          const isCreating = creatingGame === game.type;

          return (
            <View key={game.type} style={styles.gameCard}>
              {/* Icon + Info */}
              <View style={styles.cardTop}>
                <View style={styles.emojiBox}>
                  <Text style={styles.gameEmoji}>{game.emoji}</Text>
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.gameName}>{t(game.titleKey)}</Text>
                  <Text style={styles.gameDesc}>{t(game.descKey)}</Text>
                </View>
              </View>

              {/* Meta row */}
              <View style={styles.metaRow}>
                <MetaPill icon="👥" label={`${game.players} ${t('games.players')}`} />
                <MetaPill icon="⏱" label={game.time} />
                <DifficultyDots count={game.difficulty} />
              </View>

              {/* Buttons */}
              <View style={styles.cardButtons}>
                <TouchableOpacity
                  style={[styles.playButton, isCreating && styles.playButtonDisabled]}
                  onPress={() => handlePlayNow(game.type)}
                  disabled={isCreating}
                  activeOpacity={0.85}
                >
                  {isCreating ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <Text style={styles.playButtonText}>{t('games.playNow')}</Text>
                  )}
                </TouchableOpacity>

                {hasActiveGame && (
                  <TouchableOpacity
                    style={styles.joinActiveButton}
                    onPress={handleJoinActive}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.joinActiveText}>{t('games.joinActiveGame')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}

        {/* Join by Code */}
        <View style={styles.joinCodeSection}>
          {!showJoinCode ? (
            <TouchableOpacity onPress={() => setShowJoinCode(true)}>
              <Text style={styles.joinCodeLink}>{t('games.haveCode')}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.joinCodeBox}>
              <Text style={styles.joinCodeLabel}>{t('games.enterCode')}</Text>
              <View style={styles.joinCodeRow}>
                <TextInput
                  style={styles.joinCodeInput}
                  value={joinCodeInput}
                  onChangeText={(v) => setJoinCodeInput(v.toUpperCase())}
                  placeholder="XXXX"
                  placeholderTextColor={Colors.secondary}
                  maxLength={4}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={[styles.joinCodeButton, joiningByCode && { opacity: 0.6 }]}
                  onPress={handleJoinByCode}
                  disabled={joiningByCode}
                >
                  {joiningByCode ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <Text style={styles.joinCodeButtonText}>{t('games.join')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Leaderboard Row */}
        <TouchableOpacity
          style={styles.leaderboardRow}
          onPress={() => router.push('/leaderboard')}
          activeOpacity={0.8}
        >
          <View style={styles.leaderboardLeft}>
            <Trophy size={22} color={Colors.accentGold} />
            <Text style={styles.leaderboardText}>{t('games.viewLeaderboard')}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetaPill({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={styles.metaPill}>
      <Text style={styles.metaPillIcon}>{icon}</Text>
      <Text style={styles.metaPillLabel}>{label}</Text>
    </View>
  );
}

function DifficultyDots({ count }: { count: number }) {
  return (
    <View style={styles.diffRow}>
      {[1, 2, 3].map((i) => (
        <View
          key={i}
          style={[
            styles.diffDot,
            { backgroundColor: i <= count ? Colors.accentGold : Colors.secondary },
          ]}
        />
      ))}
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
  scroll: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  header: {
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  title: {
    fontFamily: Typography.display,
    fontSize: 28,
    color: Colors.textHeading,
  },
  subtitle: {
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
    color: Colors.textPrimary,
    marginTop: 2,
  },
  activeBanner: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.card,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  activeBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  activeBannerEmoji: {
    fontSize: 20,
  },
  activeBannerText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.surface,
    flex: 1,
  },
  joinBannerButton: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
  },
  joinBannerText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.primary,
  },
  gameCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.card,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  emojiBox: {
    width: 56,
    height: 56,
    backgroundColor: `${Colors.secondary}55`,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameEmoji: {
    fontSize: 28,
  },
  cardInfo: {
    flex: 1,
    gap: 4,
  },
  gameName: {
    fontFamily: Typography.bodyBold,
    fontSize: 16,
    color: Colors.textHeading,
  },
  gameDesc: {
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
    color: Colors.textPrimary,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.background,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  metaPillIcon: {
    fontSize: 11,
  },
  metaPillLabel: {
    fontFamily: Typography.bodyMedium,
    fontSize: 11,
    color: Colors.textPrimary,
  },
  diffRow: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  diffDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cardButtons: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: 4,
  },
  playButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    paddingVertical: 10,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 110,
  },
  playButtonDisabled: {
    opacity: 0.65,
  },
  playButtonText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    color: 'white',
  },
  joinActiveButton: {
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: Radius.button,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinActiveText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.primary,
  },
  joinCodeSection: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  joinCodeLink: {
    fontFamily: Typography.bodyMedium,
    fontSize: 13,
    color: Colors.textHeading,
    textDecorationLine: 'underline',
    opacity: 0.7,
  },
  joinCodeBox: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.card,
  },
  joinCodeLabel: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.textHeading,
  },
  joinCodeRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  joinCodeInput: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontFamily: Typography.heading,
    fontSize: 20,
    color: Colors.primary,
    letterSpacing: 6,
    textAlign: 'center',
    backgroundColor: Colors.background,
  },
  joinCodeButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 72,
  },
  joinCodeButtonText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    color: 'white',
  },
  leaderboardRow: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...Shadow.card,
  },
  leaderboardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  leaderboardText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.textHeading,
  },
  chevron: {
    fontSize: 22,
    color: Colors.textPrimary,
    opacity: 0.5,
  },
});