import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { Colors, Radius, Spacing, Typography } from "@/constants/theme";

type GameEndActionsProps = {
  onPlayAgain: () => void | Promise<void>;
  lobbyRoute: string;
  lobbyParams?: Record<string, string>;
  onBackToLobby?: () => void;
};

export function GameEndActions({ lobbyParams, lobbyRoute, onBackToLobby, onPlayAgain }: GameEndActionsProps) {
  const { t } = useTranslation();
  const handleBackToLobby = () => {
    if (onBackToLobby) {
      onBackToLobby();
      return;
    }
    router.replace(lobbyParams
      ? { pathname: lobbyRoute as never, params: lobbyParams }
      : lobbyRoute as never);
  };

  return (
    <View style={styles.actions}>
      <Pressable style={styles.primaryButton} onPress={() => void onPlayAgain()}>
        <Text style={styles.primaryText}>{t("game.playAgain")}</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={handleBackToLobby}>
        <Text style={styles.secondaryText}>{t("game.backToLobby")}</Text>
      </Pressable>
      <View style={styles.navRow}>
        <Pressable style={styles.navButton} onPress={() => router.replace("/(tabs)/games" as never)}>
          <Text style={styles.navText}>{t("game.games")}</Text>
        </Pressable>
        <Pressable style={styles.navButton} onPress={() => router.replace("/(tabs)" as never)}>
          <Text style={styles.navText}>{t("game.home")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: Spacing.sm,
    width: "100%",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: Spacing.md,
  },
  primaryText: {
    color: Colors.surface,
    fontFamily: Typography.bodyBold,
    fontSize: 15,
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: Colors.primary,
    borderRadius: Radius.button,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: Spacing.md,
  },
  secondaryText: {
    color: Colors.primary,
    fontFamily: Typography.bodyBold,
    fontSize: 15,
  },
  navRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  navButton: {
    alignItems: "center",
    backgroundColor: Colors.background,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: Spacing.sm,
  },
  navText: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
});
