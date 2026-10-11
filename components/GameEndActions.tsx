import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Colors, Radius, Spacing, Typography } from "@/constants/theme";

type GameEndActionsProps = {
  onPlayAgain: () => void | Promise<void>;
  onBackToLobbies: () => void | Promise<void>;
  onExitToGames: () => void | Promise<void>;
  onExitToHome: () => void | Promise<void>;
  departing?: boolean;
  departureFailed?: boolean;
  onRetryDeparture?: () => void;
};

export function GameEndActions({
  departing = false,
  departureFailed = false,
  onBackToLobbies,
  onExitToGames,
  onExitToHome,
  onPlayAgain,
  onRetryDeparture,
}: GameEndActionsProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.actions}>
      <Pressable disabled={departing} style={styles.primaryButton} onPress={() => void onPlayAgain()}>
        <Text style={styles.primaryText}>{t("game.playAgain")}</Text>
      </Pressable>
      <Pressable disabled={departing} style={styles.secondaryButton} onPress={() => void onBackToLobbies()}>
        <Text style={styles.secondaryText}>{departing ? t("game.leavingRoom") : t("game.backToLobbies")}</Text>
      </Pressable>
      {departureFailed ? (
        <View accessibilityLiveRegion="polite" style={styles.errorPanel}>
          <Text style={styles.errorText}>{t("game.departureFailedBody")}</Text>
          {onRetryDeparture ? (
            <Pressable accessibilityRole="button" onPress={onRetryDeparture}>
              <Text style={styles.retryText}>{t("common.retry")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={styles.navRow}>
        <Pressable disabled={departing} style={styles.navButton} onPress={() => void onExitToGames()}>
          <Text style={styles.navText}>{t("game.games")}</Text>
        </Pressable>
        <Pressable disabled={departing} style={styles.navButton} onPress={() => void onExitToHome()}>
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
  errorPanel: {
    alignItems: "center",
    gap: Spacing.xs,
  },
  errorText: {
    color: "#B42318",
    fontFamily: Typography.bodyRegular,
    textAlign: "center",
  },
  retryText: {
    color: Colors.primary,
    fontFamily: Typography.bodyBold,
    textDecorationLine: "underline",
  },
});
