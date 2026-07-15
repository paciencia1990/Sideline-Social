import { router } from "expo-router";
import React, { useCallback } from "react";
import { StyleSheet, View } from "react-native";

import CountdownOverlay from "@/components/CountdownOverlay";
import LobbyBase from "@/components/LobbyBase";
import { useGameLobby } from "@/hooks/useGameLobby";

export default function BombDefusalLobby() {
  const { sessionId, players, toggleReady, startGame, showCountdown, setShowCountdown } =
    useGameLobby("bomb-defusal");

  const handleComplete = useCallback(() => {
    setShowCountdown(false);
    router.replace({ pathname: "/games/bomb-defusal/play", params: sessionId ? { sessionId } : {} } as never);
  }, [sessionId, setShowCountdown]);

  return (
    <View style={styles.container}>
      <LobbyBase
        gameName="Bomb Defusal"
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

