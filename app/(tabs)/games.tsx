import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Bomb, Play, Search, Trophy, Users, Zap, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SquadSelector } from "@/components/SquadSelector";
import { useAuth } from "@/context/AuthContext";
import { useSquad } from "@/context/SquadContext";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { useActiveSquadGameSession } from "@/hooks/useActiveSquadGameSession";
import {
  getGameLabel,
  type GameType,
} from "@/services/gameService";
import {
  readGameJoinCodeFailureReason,
  resolveAndJoinGameByCode,
  type GameJoinCodeFailureReason,
  type GameJoinCodeType,
} from "@/services/gameJoinCodeService";
import { isCompleteGameJoinCode, normalizeGameJoinCodeInput } from "@/utils/gameJoinCode";

type GameCardConfig = {
  gameType: GameType;
  titleKey: string;
  bodyKey: string;
  route: string;
  players: string;
  duration: string;
  Icon: LucideIcon;
  supportsLocalTest?: boolean;
};

const GAME_CARDS: GameCardConfig[] = [
  {
    gameType: "bomb_defusal",
    titleKey: "games.bombDefusal.title",
    bodyKey: "games.bombDefusal.desc",
    route: "/(games)/bomb-defusal/Lobby",
    players: "2-6",
    duration: "3-8 min",
    Icon: Bomb,
  },
  {
    gameType: "spot_difference",
    titleKey: "games.spotDifference.title",
    bodyKey: "games.spotDifference.desc",
    route: "/(games)/spot-the-difference/Lobby",
    players: "4-12",
    duration: "7 min",
    Icon: Search,
  },
  {
    gameType: "trivia_blitz",
    titleKey: "games.triviaBlitz.title",
    bodyKey: "games.triviaBlitz.desc",
    route: "/(games)/trivia-blitz/Lobby",
    players: "3-20",
    duration: "5-15 min",
    Icon: Zap,
    supportsLocalTest: true,
  },
];

const ROUTE_BY_GAME: Record<GameType, string> = {
  bomb_defusal: "/(games)/bomb-defusal/Lobby",
  spot_difference: "/(games)/spot-the-difference/Lobby",
  trivia_blitz: "/(games)/trivia-blitz/Lobby",
};

const ROUTE_BY_JOIN_CODE_GAME: Record<GameJoinCodeType, string> = {
  bombDefusal: "/(games)/bomb-defusal/Lobby",
  spotTheDifferences: "/(games)/spot-the-difference/Lobby",
  triviaBlitz: "/(games)/trivia-blitz/Lobby",
};

export default function GamesScreen() {
  const { t } = useTranslation();
  const { loading: authLoading, user } = useAuth();
  const { membershipLoading, selectedSquadId } = useSquad();
  const params = useLocalSearchParams<{ join?: string }>();
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<GameJoinCodeFailureReason | null>(null);
  const [showJoinCode, setShowJoinCode] = useState(params.join === "1");

  const {
    retry: retryActiveSession,
    session: activeSession,
    state: activeSessionState,
  } = useActiveSquadGameSession({
    diagnosticLabel: "GamesScreen",
    enabled: !authLoading && !membershipLoading,
    squadId: selectedSquadId,
    userId: user?.uid ?? null,
  });
  const loadingSession = activeSessionState.status === "loading" && !activeSession;
  const sessionLoadFailed = activeSessionState.status === "permission-error" || activeSessionState.status === "network-error";

  const activeGameName = useMemo(() => {
    return activeSession ? getGameLabel(activeSession.gameType) : "";
  }, [activeSession]);

  useEffect(() => {
    if (params.join === "1") {
      setShowJoinCode(true);
    }
  }, [params.join]);

  const openGameLobby = useCallback((route: string, sessionId?: string, local = false) => {
    if (sessionId) {
      router.push({ pathname: route as never, params: { sessionId } });
      return;
    }

    router.push({ pathname: route as never, params: local ? { local: "1" } : { host: "1" } });
  }, []);

  const handleJoinCode = useCallback(async () => {
    if (!isCompleteGameJoinCode(joinCode) || joining) {
      setJoinError("invalid_code_format");
      return;
    }

    setJoining(true);
    setJoinError(null);
    try {
      const session = await resolveAndJoinGameByCode(joinCode);
      openGameLobby(ROUTE_BY_JOIN_CODE_GAME[session.gameType], session.sessionId);
    } catch (error) {
      setJoinError(readGameJoinCodeFailureReason(error));
    } finally {
      setJoining(false);
    }
  }, [joinCode, joining, openGameLobby]);

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.kicker}>{t("app.name")}</Text>
          <Text style={styles.title}>{t("games.title")}</Text>
          <Text style={styles.subtitle}>{t("games.subtitle")}</Text>
        </View>

        <SquadSelector />

        {loadingSession ? (
          <Card style={styles.loadingCard}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.cardText}>{t("common.loading")}</Text>
          </Card>
        ) : activeSession ? (
          <TouchableOpacity
            activeOpacity={0.86}
            onPress={() => openGameLobby(ROUTE_BY_GAME[activeSession.gameType], activeSession.sessionId)}
            style={styles.activeBanner}
          >
            <Play size={22} color={Colors.surface} fill={Colors.surface} />
            <View style={styles.bannerCopy}>
              <Text style={styles.bannerEyebrow}>{t("games.activeNow")}</Text>
              <Text style={styles.bannerText}>{t("games.squadPlaying", { game: activeGameName })}</Text>
            </View>
          </TouchableOpacity>
        ) : null}

        {sessionLoadFailed ? (
          <Card style={styles.serviceErrorCard}>
            <Text accessibilityLiveRegion="polite" style={styles.cardText}>{t("games.servicesUnavailable")}</Text>
            <TouchableOpacity
              accessibilityLabel={t("games.retryServices")}
              accessibilityRole="button"
              onPress={retryActiveSession}
              style={styles.serviceRetryButton}
            >
              <Text style={styles.serviceRetryText}>{t("common.retry")}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        <Card style={styles.joinCard}>
          <View style={styles.joinHeader}>
            <View style={styles.joinCopy}>
              <Text style={styles.cardTitle}>{t("games.haveCode")}</Text>
              <Text style={styles.cardText}>{t("games.joinCodeBody")}</Text>
            </View>
            <TouchableOpacity activeOpacity={0.86} onPress={() => setShowJoinCode((value) => !value)} style={styles.smallToggle}>
              <Text style={styles.smallToggleText}>{showJoinCode ? t("games.hideCode") : t("games.enterCode")}</Text>
            </TouchableOpacity>
          </View>
          {showJoinCode ? (
            <View style={styles.joinRow}>
              <TextInput
                accessibilityLabel={t("games.joinCode.enterGameCode")}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={9}
                onChangeText={(value) => {
                  setJoinCode(normalizeGameJoinCodeInput(value));
                  setJoinError(null);
                }}
                onSubmitEditing={() => {
                  if (isCompleteGameJoinCode(joinCode) && !joining) void handleJoinCode();
                }}
                placeholder="A3KX"
                placeholderTextColor={Colors.textPrimary}
                returnKeyType="go"
                style={styles.joinInput}
                value={joinCode}
              />
              <TouchableOpacity
                accessibilityRole="button"
                activeOpacity={0.86}
                disabled={joining || !isCompleteGameJoinCode(joinCode)}
                onPress={() => void handleJoinCode()}
                style={[styles.joinButton, (joining || !isCompleteGameJoinCode(joinCode)) && styles.joinButtonDisabled]}
              >
                {joining ? <ActivityIndicator color={Colors.surface} size="small" /> : <Text style={styles.joinButtonText}>{t("games.joinCode.joinGame")}</Text>}
              </TouchableOpacity>
              {joinError ? (
                <Text accessibilityRole="alert" style={styles.joinError}>
                  {t(`games.joinCode.errors.${joinError}`)}
                </Text>
              ) : null}
            </View>
          ) : null}
        </Card>

        <View style={styles.gameList}>
          {GAME_CARDS.map((game) => (
            <GameCard
              key={game.gameType}
              config={game}
              onLocalTest={() => openGameLobby(game.route, undefined, true)}
              onOpen={() => openGameLobby(game.route)}
            />
          ))}
        </View>

        <TouchableOpacity activeOpacity={0.86} onPress={() => router.push("/leaderboard" as never)} style={styles.leaderboardCard}>
          <View style={styles.leaderIcon}>
            <Trophy size={24} color={Colors.accentGold} />
          </View>
          <View style={styles.bannerCopy}>
            <Text style={styles.cardTitle}>{t("games.leaderboard")}</Text>
            <Text style={styles.cardText}>{t("games.viewLeaderboard")}</Text>
          </View>
        </TouchableOpacity>
      </KeyboardAwareScrollView>
    </ScreenWrapper>
  );
}

function GameCard({ config, onLocalTest, onOpen }: { config: GameCardConfig; onLocalTest: () => void; onOpen: () => void }) {
  const { t } = useTranslation();
  const Icon = config.Icon;

  return (
    <Card style={styles.gameCard}>
      <View style={styles.gameHeader}>
        <View style={styles.gameIconBox}>
          <Icon size={30} color={Colors.primary} />
        </View>
        <View style={styles.bannerCopy}>
          <Text style={styles.gameTitle}>{t(config.titleKey)}</Text>
          <Text style={styles.cardText}>{t(config.bodyKey)}</Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaPill}>
          <Users size={13} color={Colors.textHeading} />
          <Text style={styles.metaText}>{config.players} {t("games.players")}</Text>
        </View>
        <View style={styles.metaPill}>
          <Text style={styles.metaText}>{config.duration}</Text>
        </View>
      </View>

      <TouchableOpacity activeOpacity={0.86} onPress={onOpen} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>{t("games.playNow")}</Text>
      </TouchableOpacity>
      {config.supportsLocalTest ? (
        <TouchableOpacity activeOpacity={0.86} onPress={onLocalTest} style={styles.localTestButton}>
          <Text style={styles.localTestButtonText}>{t("games.joinCode.localTest")}</Text>
        </TouchableOpacity>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  scroll: {
    gap: Spacing.md,
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  header: {
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
  },
  kicker: {
    color: Colors.primary,
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
    textTransform: "uppercase",
  },
  title: {
    color: Colors.textHeading,
    fontFamily: Typography.heading,
    fontSize: 31,
    textAlign: "center",
  },
  subtitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  loadingCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.sm,
  },
  serviceErrorCard: {
    gap: Spacing.sm,
  },
  serviceRetryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: Colors.primary,
    borderRadius: Radius.button,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  serviceRetryText: {
    color: Colors.primary,
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
  },
  activeBanner: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: Radius.card,
    flexDirection: "row",
    gap: Spacing.md,
    padding: Spacing.md,
    ...Shadow.card,
  },
  bannerCopy: {
    flex: 1,
    gap: 3,
  },
  bannerEyebrow: {
    color: Colors.surface,
    fontFamily: Typography.bodyBold,
    fontSize: 11,
    textTransform: "uppercase",
  },
  bannerText: {
    color: Colors.surface,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    lineHeight: 20,
  },
  joinCard: {
    gap: Spacing.md,
  },
  joinHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
    justifyContent: "space-between",
  },
  joinCopy: {
    flex: 1,
    gap: 3,
    minWidth: 180,
  },
  smallToggle: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: Colors.primary,
    borderRadius: Radius.button,
    borderWidth: 1,
    flexShrink: 1,
    maxWidth: "100%",
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: Spacing.sm,
  },
  smallToggleText: {
    color: Colors.primary,
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
    textAlign: "center",
  },
  joinRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  joinInput: {
    backgroundColor: Colors.background,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    borderWidth: 1,
    color: Colors.primary,
    flex: 1,
    fontFamily: Typography.heading,
    fontSize: 20,
    letterSpacing: 5,
    minHeight: 48,
    minWidth: 140,
    paddingHorizontal: Spacing.md,
    textAlign: "center",
  },
  joinButton: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    flexShrink: 0,
    minHeight: 48,
    justifyContent: "center",
    minWidth: 76,
    paddingHorizontal: Spacing.md,
  },
  joinButtonText: {
    color: Colors.surface,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
  joinButtonDisabled: {
    opacity: 0.5,
  },
  joinError: {
    color: Colors.primary,
    flexBasis: "100%",
    fontFamily: Typography.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
  },
  gameList: {
    gap: Spacing.md,
  },
  gameCard: {
    gap: Spacing.md,
  },
  gameHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.md,
  },
  gameIconBox: {
    alignItems: "center",
    backgroundColor: Colors.background,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    borderWidth: 1,
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  gameTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
    fontSize: 17,
  },
  cardTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
  },
  cardText: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
    lineHeight: 19,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  metaPill: {
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: Radius.button,
    flexDirection: "row",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  metaText: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyMedium,
    fontSize: 12,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  primaryButtonText: {
    color: Colors.surface,
    fontFamily: Typography.bodySemiBold,
    fontSize: 15,
  },
  localTestButton: {
    alignItems: "center",
    borderColor: Colors.primary,
    borderRadius: Radius.button,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  localTestButtonText: {
    color: Colors.primary,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
  leaderboardCard: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    flexDirection: "row",
    gap: Spacing.md,
    padding: Spacing.md,
    ...Shadow.card,
  },
  leaderIcon: {
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: 24,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
});
