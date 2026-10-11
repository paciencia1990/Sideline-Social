import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { GameEndActions } from "@/components/GameEndActions";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { useGameRoomDeparture } from "@/hooks/useGameRoomDeparture";
import type { GameType } from "@/services/gameService";

const LOBBY_ROUTE_BY_GAME: Record<GameType, string> = {
  bomb_defusal: "/(games)/bomb-defusal/Lobby",
  spot_difference: "/(games)/spot-the-difference/Lobby",
  trivia_blitz: "/(games)/trivia-blitz/Lobby",
};
const LOBBY_TYPE_BY_GAME: Record<GameType, string> = {
  bomb_defusal: "bombDefusal",
  spot_difference: "spotTheDifferences",
  trivia_blitz: "triviaBlitz",
};


function isGameType(value?: string): value is GameType {
  return value === "bomb_defusal" || value === "spot_difference" || value === "trivia_blitz";
}
export default function ResultsScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ gameType?: string; lobbyId?: string; sessionId?: string; squadId?: string }>();
  const gameType = isGameType(params.gameType) ? params.gameType : null;
  const lobbyRoute = gameType ? LOBBY_ROUTE_BY_GAME[gameType] : "/(tabs)/games";
  const roomDeparture = useGameRoomDeparture({ enabled: Boolean(params.lobbyId), lobbyId: params.lobbyId ?? "" });
  const returnToRoom = () => roomDeparture.continueWithinRoom((retainedParams) => router.replace({
    pathname: lobbyRoute as never,
    params: {
      ...retainedParams,
      ...(params.lobbyId ? { lobbyId: params.lobbyId } : {}),
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    },
  }));
  const backToLobbies = () => void roomDeparture.departAndNavigate(() => router.replace(params.squadId && gameType
    ? { pathname: "/(games)/lobbies", params: { gameType: LOBBY_TYPE_BY_GAME[gameType], squadId: params.squadId } } as never
    : "/(tabs)/games" as never));

  return (
    <ScreenWrapper>
      <View style={styles.content}>
        <View style={styles.panel}>
          <Text style={styles.title}>{t("game.results")}</Text>
          <Text style={styles.body}>{t("games.results.starsNote")}</Text>
          <GameEndActions
            departing={roomDeparture.departing}
            departureFailed={Boolean(roomDeparture.departureError)}
            onBackToLobbies={backToLobbies}
            onExitToGames={() => void roomDeparture.departAndNavigate(() => router.replace("/(tabs)/games" as never))}
            onExitToHome={() => void roomDeparture.departAndNavigate(() => router.replace("/(tabs)" as never))}
            onPlayAgain={returnToRoom}
            onRetryDeparture={roomDeparture.retryDeparture}
          />
        </View>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: "center",
    padding: Spacing.lg,
  },
  panel: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    gap: Spacing.md,
    padding: Spacing.lg,
    ...Shadow.card,
  },
  title: {
    color: Colors.textHeading,
    fontFamily: Typography.heading,
    fontSize: 30,
  },
  body: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    lineHeight: 21,
    textAlign: "center",
  },
});
