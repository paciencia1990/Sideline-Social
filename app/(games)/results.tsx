import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { GameEndActions } from "@/components/GameEndActions";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import type { GameType } from "@/services/gameService";

const LOBBY_ROUTE_BY_GAME: Record<GameType, string> = {
  bomb_defusal: "/(games)/bomb-defusal/Lobby",
  spot_difference: "/(games)/spot-the-difference/Lobby",
  trivia_blitz: "/(games)/trivia-blitz/Lobby",
};


function isGameType(value?: string): value is GameType {
  return value === "bomb_defusal" || value === "spot_difference" || value === "trivia_blitz";
}
export default function ResultsScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ gameType?: string }>();
  const lobbyRoute = isGameType(params.gameType) ? LOBBY_ROUTE_BY_GAME[params.gameType] : "/(tabs)/games";

  return (
    <ScreenWrapper>
      <View style={styles.content}>
        <View style={styles.panel}>
          <Text style={styles.title}>{t("game.results")}</Text>
          <Text style={styles.body}>{t("games.results.starsNote")}</Text>
          <GameEndActions onPlayAgain={() => router.replace(lobbyRoute as never)} lobbyRoute={lobbyRoute} />
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