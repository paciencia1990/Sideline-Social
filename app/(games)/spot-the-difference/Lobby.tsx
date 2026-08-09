import { router } from "expo-router";
import React, { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import CountdownOverlay from "@/components/CountdownOverlay";
import LobbyBase from "@/components/LobbyBase";
import { useGameLobby } from "@/hooks/useGameLobby";

const TEAM_IDS = ["A", "B"] as const;

export default function SpotTheDifferenceLobby() {
  const { t } = useTranslation();
  const {
    sessionId,
    lobbyId,
    minPlayers,
    players,
    codeState,
    codeError,
    isLocal,
    retryCode,
    leaveGame,
    closeLobby,
    retryLifecycleAction,
    lifecycleAction,
    lifecycleError,
    toggleReady,
    startGame,
    showCountdown,
    setShowCountdown,
  } =
    useGameLobby("spot-the-difference");
  const selfTeamId = players.self.teamId ?? "A";
  const teamSections = {
    selfTeamMessage: t("spot.teamYouAreOn", { team: t(`spot.teams.${selfTeamId}`) }),
    reassignmentMessage: players.self.previousTeamId && players.self.teamReassignedAt
      ? t("spot.teamReassigned", { team: t(`spot.teams.${selfTeamId}`) })
      : null,
    teams: TEAM_IDS.map((teamId) => ({
      id: teamId,
      label: t(`spot.teams.${teamId}`),
      players: players.list.filter((player) => player.teamId === teamId),
    })),
  };

  const handleComplete = useCallback(() => {
    setShowCountdown(false);
    router.replace({
      pathname: "/games/spot-the-difference/play",
      params: sessionId ? { sessionId, ...(lobbyId ? { lobbyId } : {}) } : {},
    } as never);
  }, [lobbyId, sessionId, setShowCountdown]);

  return (
    <View style={styles.container}>
      <LobbyBase
        gameName={t("games.spotDifference.title")}
        minPlayers={minPlayers}
        players={players}
        codeState={codeState}
        codeError={codeError}
        isLocal={isLocal}
        teamSections={teamSections}
        onRetryCode={retryCode}
        onLeave={leaveGame}
        onCloseLobby={closeLobby}
        onRetryLifecycle={retryLifecycleAction}
        lifecycleAction={lifecycleAction}
        lifecycleError={lifecycleError}
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

