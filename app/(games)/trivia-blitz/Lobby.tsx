import { router } from "expo-router";
import React, { useCallback } from "react";
import { StyleSheet, View } from "react-native";

import CountdownOverlay from "@/components/CountdownOverlay";
import LobbyBase from "@/components/LobbyBase";
import { useGameLobby } from "@/hooks/useGameLobby";

export default function TriviaBlitzLobby() {
  const { players, toggleReady, startGame, showCountdown, setShowCountdown } =
    useGameLobby("trivia-blitz");

  const handleComplete = useCallback(() => {
    setShowCountdown(false);
    router.replace({ pathname: "/games/trivia-blitz/play", params: { start: "1" } } as never);
  }, [setShowCountdown]);

  return (
    <View style={styles.container}>
      <LobbyBase
        gameName="Trivia Blitz"
        players={players}
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

