import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Colors, Typography } from "@/constants/theme";

type LobbyPlayer = {
  id: string;
  name: string;
  ready: boolean;
};

type LobbyPlayers = {
  joinCode: string;
  list: LobbyPlayer[];
  self: LobbyPlayer;
  isHost: boolean;
};

type LobbyBaseProps = {
  gameName: string;
  players: LobbyPlayers;
  onReadyToggle: () => void;
  onStart: () => void;
};

export default function LobbyBase({
  gameName,
  players,
  onReadyToggle,
  onStart,
}: LobbyBaseProps) {
  const readyCount = players.list.filter((player) => player.ready).length;
  const totalPlayers = players.list.length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{gameName}</Text>
        <View style={styles.joinCodePanel}>
          <Text style={styles.joinCodeLabel}>Join Code</Text>
          <Text style={styles.joinCode}>{players.joinCode}</Text>
        </View>
        <Text style={styles.readySummary}>
          {readyCount} of {totalPlayers} ready
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.playerList}
        showsVerticalScrollIndicator={false}
      >
        {players.list.map((player) => {
          const isSelf = player.id === players.self.id;

          return (
            <View key={player.id} style={styles.playerRow}>
              <View style={styles.playerIdentity}>
                <Text style={styles.playerName} numberOfLines={1}>
                  {player.name}
                  {isSelf ? " (You)" : ""}
                </Text>
              </View>
              <View
                style={[
                  styles.readyBadge,
                  player.ready ? styles.readyBadgeActive : styles.readyBadgeInactive,
                ]}
              >
                <Text
                  style={[
                    styles.readyBadgeText,
                    player.ready
                      ? styles.readyBadgeTextActive
                      : styles.readyBadgeTextInactive,
                  ]}
                >
                  {player.ready ? "Ready" : "Not Ready"}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          style={[
            styles.button,
            players.self.ready ? styles.secondaryButton : styles.primaryButton,
          ]}
          onPress={onReadyToggle}
        >
          <Text
            style={[
              styles.buttonText,
              players.self.ready ? styles.secondaryButtonText : styles.primaryButtonText,
            ]}
          >
            {players.self.ready ? "Unready" : "Ready"}
          </Text>
        </Pressable>

        {players.isHost && (
          <Pressable
            accessibilityRole="button"
            style={[styles.button, styles.primaryButton]}
            onPress={onStart}
          >
            <Text style={[styles.buttonText, styles.primaryButtonText]}>Start Game</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export type { LobbyBaseProps, LobbyPlayer, LobbyPlayers };

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 20,
  },
  header: {
    alignItems: "center",
    gap: 12,
  },
  title: {
    color: Colors.textHeading,
    fontFamily: Typography.heading,
    fontSize: 30,
    textAlign: "center",
  },
  joinCodePanel: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.secondary,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 12,
    minWidth: 180,
  },
  joinCodeLabel: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
    textTransform: "uppercase",
  },
  joinCode: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
    fontSize: 26,
    marginTop: 2,
  },
  readySummary: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyMedium,
    fontSize: 14,
  },
  playerList: {
    alignItems: "center",
    flexGrow: 1,
    gap: 10,
    justifyContent: "center",
    paddingVertical: 24,
  },
  playerRow: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.secondary,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    maxWidth: 420,
    minHeight: 58,
    paddingHorizontal: 14,
    width: "100%",
  },
  playerIdentity: {
    flex: 1,
    minWidth: 0,
  },
  playerName: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
  },
  readyBadge: {
    alignItems: "center",
    borderRadius: 8,
    minWidth: 86,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  readyBadgeActive: {
    backgroundColor: Colors.accentGreen,
  },
  readyBadgeInactive: {
    backgroundColor: Colors.secondary,
  },
  readyBadgeText: {
    fontFamily: Typography.bodyBold,
    fontSize: 12,
  },
  readyBadgeTextActive: {
    color: Colors.surface,
  },
  readyBadgeTextInactive: {
    color: Colors.textHeading,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
  },
  button: {
    alignItems: "center",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 52,
    minWidth: 132,
    paddingHorizontal: 18,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
  },
  secondaryButton: {
    backgroundColor: Colors.surface,
    borderColor: Colors.primary,
    borderWidth: 1,
  },
  buttonText: {
    fontFamily: Typography.bodyBold,
    fontSize: 15,
  },
  primaryButtonText: {
    color: Colors.surface,
  },
  secondaryButtonText: {
    color: Colors.primary,
  },
});
