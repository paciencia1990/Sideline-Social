import React from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { Colors, Typography } from "@/constants/theme";
import type { GameCodeState } from "@/hooks/useGameLobby";
import type { GameJoinCodeFailureReason } from "@/services/gameJoinCodeService";
import { getFixedFooterBottomPadding } from "@/utils/safeAreaLayout";
import { spokenGameJoinCode } from "@/utils/gameJoinCode";

type LobbyPlayer = {
  id: string;
  name: string;
  ready: boolean;
  teamId?: "A" | "B";
  previousTeamId?: "A" | "B";
  teamReassignedAt?: number;
  teamAssignmentNoticeId?: string;
};

type LobbyPlayers = {
  joinCode: string;
  list: LobbyPlayer[];
  self: LobbyPlayer;
  isHost: boolean;
};

type LobbyBaseProps = {
  gameName: string;
  minPlayers: number;
  players: LobbyPlayers;
  teamSections?: {
    selfTeamMessage: string;
    reassignmentMessage?: string | null;
    teams: {
      id: "A" | "B";
      label: string;
      players: LobbyPlayer[];
    }[];
  };
  codeState: GameCodeState;
  codeError: GameJoinCodeFailureReason | null;
  isLocal: boolean;
  onRetryCode: () => void;
  onLeave: () => Promise<void>;
  onCloseLobby: () => Promise<void>;
  onRetryLifecycle: () => void;
  lifecycleAction: "leaving" | "closing" | null;
  lifecycleError: GameJoinCodeFailureReason | null;
  onReadyToggle: () => void;
  onStart: () => void;
};

export default function LobbyBase({
  gameName,
  minPlayers,
  players,
  teamSections,
  codeState,
  codeError,
  isLocal,
  onRetryCode,
  onLeave,
  onCloseLobby,
  onRetryLifecycle,
  lifecycleAction,
  lifecycleError,
  onReadyToggle,
  onStart,
}: LobbyBaseProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const readyCount = players.list.filter((player) => player.ready).length;
  const totalPlayers = players.list.length;
  const canStart = totalPlayers >= minPlayers && readyCount === totalPlayers;
  const spokenCode = spokenGameJoinCode(players.joinCode);

  const handleShareCode = async () => {
    if (codeState !== "ready" || !players.joinCode) return;
    await Share.share({ message: t("games.joinCode.shareText", { code: players.joinCode }) });
  };

  const handleLeave = () => {
    const closesEmptyLobby = players.list.length === 1;
    Alert.alert(
      closesEmptyLobby
        ? t("games.joinCode.leaveAndCloseTitle")
        : t("games.joinCode.leaveLobbyTitle"),
      closesEmptyLobby
        ? t("games.joinCode.leaveAndCloseBody")
        : players.isHost
        ? t("games.joinCode.leaveLobbyHostBody")
        : t("games.joinCode.leaveLobbyBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("games.joinCode.leaveLobby"), style: "destructive", onPress: () => void onLeave() },
      ],
    );
  };

  const handleCloseLobby = () => {
    Alert.alert(
      t("games.joinCode.closeLobbyTitle"),
      t("games.joinCode.closeLobbyBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("games.joinCode.closeLobbyForEveryone"), style: "destructive", onPress: () => void onCloseLobby() },
      ],
    );
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 28) }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{gameName}</Text>
        <View style={styles.joinCodePanel}>
          <Text style={styles.joinCodeLabel}>{t("games.joinCode.gameCode")}</Text>
          {codeState === "loading" ? (
            <View accessibilityLabel={t("games.joinCode.waiting")} style={styles.codeLoading}>
              <ActivityIndicator color={Colors.primary} size="small" />
              <Text style={styles.codeStatus}>{t("games.joinCode.waiting")}</Text>
            </View>
          ) : codeState === "error" ? (
            <View style={styles.codeErrorWrap}>
              <Text style={styles.codeError}>
                {t(`games.joinCode.errors.${codeError ?? "code_reservation_failed"}`)}
              </Text>
              <Pressable accessibilityRole="button" onPress={onRetryCode} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>{t("games.joinCode.retry")}</Text>
              </Pressable>
            </View>
          ) : isLocal ? (
            <Text accessibilityLabel={t("games.joinCode.localTest")} style={styles.localTest}>
              {t("games.joinCode.localTest")}
            </Text>
          ) : (
            <>
              <Text
                accessibilityLabel={t("games.joinCode.accessibilityLabel", { code: spokenCode })}
                adjustsFontSizeToFit
                maxFontSizeMultiplier={1.5}
                numberOfLines={1}
                style={styles.joinCode}
              >
                {spokenCode}
              </Text>
              <Text style={styles.codeHelp}>{t("games.joinCode.shareHelp")}</Text>
              <Pressable accessibilityRole="button" onPress={() => void handleShareCode()} style={styles.shareButton}>
                <Text style={styles.shareButtonText}>{t("games.joinCode.shareCode")}</Text>
              </Pressable>
            </>
          )}
        </View>
        <Text style={styles.readySummary}>
          {t("games.joinCode.readySummary", { ready: readyCount, total: totalPlayers })}
        </Text>
        {totalPlayers < minPlayers ? (
          <Text accessibilityLiveRegion="polite" style={styles.readySummary}>
            {t("games.joinCode.minimumPlayers", { count: minPlayers })}
          </Text>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.playerList}
        showsVerticalScrollIndicator={false}
      >
        {teamSections ? (
          <View style={styles.teamBoard}>
            <Text accessibilityLiveRegion="polite" style={styles.selfTeamMessage}>
              {teamSections.selfTeamMessage}
            </Text>
            {teamSections.reassignmentMessage ? (
              <Text accessibilityLiveRegion="polite" style={styles.reassignmentMessage}>
                {teamSections.reassignmentMessage}
              </Text>
            ) : null}
            <View style={styles.teamColumns}>
              {teamSections.teams.map((team) => (
                <View
                  accessibilityLabel={team.label}
                  key={team.id}
                  style={styles.teamColumn}
                >
                  <Text style={styles.teamTitle}>{team.label}</Text>
                  <View style={styles.teamRoster}>
                    {team.players.length > 0 ? team.players.map((player) => {
                      const isSelf = player.id === players.self.id;
                      return (
                        <View key={player.id} style={styles.teamPlayerRow}>
                          <Text numberOfLines={1} style={styles.teamPlayerName}>
                            {player.name}
                            {isSelf ? ` ${t("games.joinCode.youSuffix")}` : ""}
                          </Text>
                          <Text style={styles.teamReadyText}>
                            {player.ready ? t("games.joinCode.ready") : t("games.joinCode.notReady")}
                          </Text>
                        </View>
                      );
                    }) : (
                      <Text style={styles.teamEmpty}>{t("games.joinCode.teamWaiting")}</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : players.list.map((player) => {
          const isSelf = player.id === players.self.id;

          return (
            <View key={player.id} style={styles.playerRow}>
              <View style={styles.playerIdentity}>
                <Text style={styles.playerName} numberOfLines={1}>
                  {player.name}
                  {isSelf ? ` ${t("games.joinCode.youSuffix")}` : ""}
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
                  {player.ready ? t("games.joinCode.ready") : t("games.joinCode.notReady")}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View
        style={[
          styles.actionFooter,
          { paddingBottom: getFixedFooterBottomPadding(insets.bottom) },
        ]}
      >
        {lifecycleError ? (
          <View style={styles.lifecycleErrorPanel}>
            <Text accessibilityRole="alert" style={styles.lifecycleErrorText}>
              {t(`games.joinCode.errors.${lifecycleError}`)}
            </Text>
            <Pressable accessibilityRole="button" onPress={onRetryLifecycle} style={styles.retryLifecycleButton}>
              <Text style={styles.retryLifecycleText}>{t("common.retry")}</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={lifecycleAction !== null}
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
              {players.self.ready ? t("games.joinCode.unready") : t("games.joinCode.ready")}
            </Text>
          </Pressable>

          {players.isHost && (
            <Pressable
              accessibilityState={{ disabled: !canStart }}
              accessibilityRole="button"
              disabled={!canStart || lifecycleAction !== null}
              style={[styles.button, styles.primaryButton, !canStart && styles.disabledButton]}
              onPress={onStart}
            >
              <Text style={[styles.buttonText, styles.primaryButtonText]}>{t("games.joinCode.startGame")}</Text>
            </Pressable>
          )}
        </View>
        {!isLocal ? (
          <View style={styles.lifecycleActions}>
            <Pressable
              accessibilityRole="button"
              disabled={lifecycleAction !== null}
              onPress={handleLeave}
              style={styles.cancelLobbyButton}
            >
              {lifecycleAction === "leaving" ? (
                <ActivityIndicator color={Colors.primary} size="small" />
              ) : (
                <Text style={styles.cancelLobbyButtonText}>{t("games.joinCode.leaveLobby")}</Text>
              )}
            </Pressable>
            {players.isHost ? (
              <Pressable
                accessibilityRole="button"
                disabled={lifecycleAction !== null}
                onPress={handleCloseLobby}
                style={styles.closeLobbyButton}
              >
                {lifecycleAction === "closing" ? (
                  <ActivityIndicator color={Colors.primary} size="small" />
                ) : (
                  <Text style={styles.closeLobbyButtonText}>{t("games.joinCode.closeLobbyForEveryone")}</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export type { LobbyBaseProps, LobbyPlayer, LobbyPlayers };

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
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
    letterSpacing: 5,
    marginTop: 2,
    textAlign: "center",
  },
  codeLoading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 46,
  },
  codeStatus: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyMedium,
    fontSize: 13,
  },
  codeErrorWrap: {
    alignItems: "center",
    gap: 8,
    maxWidth: 280,
    paddingTop: 8,
  },
  codeError: {
    color: Colors.primary,
    fontFamily: Typography.bodyMedium,
    fontSize: 13,
    textAlign: "center",
  },
  retryButton: {
    borderColor: Colors.primary,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  retryButtonText: {
    color: Colors.primary,
    fontFamily: Typography.bodyBold,
    fontSize: 13,
  },
  localTest: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
    fontSize: 22,
    marginTop: 8,
  },
  codeHelp: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
    marginTop: 6,
    textAlign: "center",
  },
  shareButton: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    justifyContent: "center",
    marginTop: 10,
    minHeight: 42,
    paddingHorizontal: 18,
  },
  shareButtonText: {
    color: Colors.surface,
    fontFamily: Typography.bodyBold,
    fontSize: 13,
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
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  teamBoard: {
    alignItems: "center",
    gap: 14,
    maxWidth: 520,
    width: "100%",
  },
  selfTeamMessage: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
    fontSize: 18,
    textAlign: "center",
  },
  reassignmentMessage: {
    backgroundColor: `${Colors.accentGold}22`,
    borderColor: Colors.accentGold,
    borderRadius: 8,
    borderWidth: 1,
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 8,
    textAlign: "center",
  },
  teamColumns: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  teamColumn: {
    backgroundColor: Colors.surface,
    borderColor: Colors.secondary,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minWidth: 0,
    padding: 12,
  },
  teamTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
    fontSize: 16,
    marginBottom: 10,
    textAlign: "center",
  },
  teamRoster: {
    gap: 8,
  },
  teamPlayerRow: {
    backgroundColor: `${Colors.accentGreen}18`,
    borderColor: `${Colors.accentGreen}55`,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    minHeight: 52,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  teamPlayerName: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
  teamReadyText: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyMedium,
    fontSize: 11,
  },
  teamEmpty: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyMedium,
    fontSize: 13,
    minHeight: 42,
    textAlign: "center",
    textAlignVertical: "center",
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
  actionFooter: {
    backgroundColor: Colors.background,
    borderTopColor: Colors.secondary,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
  },
  lifecycleErrorPanel: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.primary,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
    padding: 10,
  },
  lifecycleErrorText: {
    color: Colors.textHeading,
    flex: 1,
    fontFamily: Typography.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
  },
  retryLifecycleButton: {
    alignItems: "center",
    borderColor: Colors.primary,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 14,
  },
  retryLifecycleText: {
    color: Colors.primary,
    fontFamily: Typography.bodyBold,
    fontSize: 13,
  },
  lifecycleActions: {
    gap: 2,
    marginTop: 4,
  },
  cancelLobbyButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  cancelLobbyButtonText: {
    color: Colors.primary,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
  closeLobbyButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  closeLobbyButtonText: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
    textDecorationLine: "underline",
  },
  button: {
    alignItems: "center",
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
    minHeight: 52,
    maxWidth: 220,
    minWidth: 0,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  disabledButton: {
    opacity: 0.5,
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
