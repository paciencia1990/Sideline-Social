import { router } from "expo-router";
import React, { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import CountdownOverlay from "@/components/CountdownOverlay";
import LobbyBase from "@/components/LobbyBase";
import { useGameLobby } from "@/hooks/useGameLobby";

export default function BombDefusalLobby() {
  const { t } = useTranslation();
  const { sessionId, lobbyId, minPlayers, players, codeState, codeError, isLocal, retryCode, leaveGame, toggleReady, startGame, showCountdown, setShowCountdown } =
    useGameLobby("bomb-defusal");

  const handleComplete = useCallback(() => {
    setShowCountdown(false);
    router.replace({
      pathname: "/games/bomb-defusal/play",
      params: sessionId ? { sessionId, ...(lobbyId ? { lobbyId } : {}) } : {},
    } as never);
  }, [lobbyId, sessionId, setShowCountdown]);

  return (
    <View style={styles.container}>
      <LobbyBase
        gameName={t("games.bombDefusal.title")}
        minPlayers={minPlayers}
        players={players}
        codeState={codeState}
        codeError={codeError}
        isLocal={isLocal}
        onRetryCode={retryCode}
        onLeave={leaveGame}
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

