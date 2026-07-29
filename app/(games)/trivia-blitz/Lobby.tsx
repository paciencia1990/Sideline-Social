import { router } from "expo-router";
import React, { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import CountdownOverlay from "@/components/CountdownOverlay";
import LobbyBase from "@/components/LobbyBase";
import { useGameLobby } from "@/hooks/useGameLobby";

export default function TriviaBlitzLobby() {
  const { t } = useTranslation();
  const { sessionId, minPlayers, players, codeState, codeError, isLocal, retryCode, cancelGame, toggleReady, startGame, showCountdown, setShowCountdown } =
    useGameLobby("trivia-blitz");

  const handleComplete = useCallback(() => {
    setShowCountdown(false);
    router.replace({
      pathname: "/games/trivia-blitz/play",
      params: sessionId ? { sessionId } : { start: "1", local: "1" },
    } as never);
  }, [sessionId, setShowCountdown]);

  return (
    <View style={styles.container}>
      <LobbyBase
        gameName={t("games.triviaBlitz.title")}
        minPlayers={minPlayers}
        players={players}
        codeState={codeState}
        codeError={codeError}
        isLocal={isLocal}
        onRetryCode={retryCode}
        onCancel={cancelGame}
        onReadyToggle={toggleReady}
        onStart={startGame}
      />
      {showCountdown && <CountdownOverlay onComplete={handleComplete} onCancel={() => setShowCountdown(false)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

