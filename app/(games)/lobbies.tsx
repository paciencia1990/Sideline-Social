import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Plus, Users } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { NestedBackButton } from "@/components/NestedBackButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  createGameJoinIdempotencyKey,
  createGameLobby,
  joinGameLobbyById,
  joinGameLobbyNextRound,
  leaveGameLobby,
  listGameLobbies,
  readGameJoinCodeFailureReason,
  type GameJoinCodeFailureReason,
  type GameJoinCodeType,
  type GameLobbyDirectoryResult,
  type GameLobbySummary,
} from "@/services/gameJoinCodeService";

type ActiveLobby = NonNullable<GameLobbyDirectoryResult["activeLobby"]>;

const GAME_CONFIG: Record<GameJoinCodeType, { titleKey: string; lobbyRoute: string }> = {
  bombDefusal: {
    titleKey: "games.bombDefusal.title",
    lobbyRoute: "/(games)/bomb-defusal/Lobby",
  },
  spotTheDifferences: {
    titleKey: "games.spotDifference.title",
    lobbyRoute: "/(games)/spot-the-difference/Lobby",
  },
  triviaBlitz: {
    titleKey: "games.triviaBlitz.title",
    lobbyRoute: "/(games)/trivia-blitz/Lobby",
  },
};

export default function GameLobbyDirectoryScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    gameType?: string | string[];
    squadId?: string | string[];
    notice?: string | string[];
  }>();
  const gameType = readGameType(normalizeParam(params.gameType));
  const squadId = normalizeParam(params.squadId);
  const notice = normalizeParam(params.notice);
  const [lobbies, setLobbies] = useState<GameLobbySummary[]>([]);
  const [activeLobby, setActiveLobby] = useState<ActiveLobby | null>(null);
  const [canCreateLobby, setCanCreateLobby] = useState(false);
  const [maxLobbies, setMaxLobbies] = useState(3);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joiningLobbyId, setJoiningLobbyId] = useState<string | null>(null);
  const [leavingActiveLobby, setLeavingActiveLobby] = useState(false);
  const [error, setError] = useState<GameJoinCodeFailureReason | null>(null);
  const createRequestKeyRef = useRef(createGameJoinIdempotencyKey());

  const load = useCallback(async (refresh = false) => {
    if (!gameType || !squadId) {
      setError("not_authorized");
      setLoading(false);
      return;
    }
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await listGameLobbies({ gameType, squadId });
      setLobbies(result.lobbies);
      setActiveLobby(result.activeLobby);
      setCanCreateLobby(result.canCreateLobby);
      setMaxLobbies(result.maxLobbiesPerGame);
    } catch (nextError) {
      setError(readGameJoinCodeFailureReason(nextError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [gameType, squadId]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const openLobby = useCallback((sessionId: string, lobbyId: string) => {
    if (!gameType) return;
    router.push({
      pathname: GAME_CONFIG[gameType].lobbyRoute as never,
      params: { sessionId, lobbyId },
    });
  }, [gameType]);

  const openActiveLobby = useCallback(() => {
    if (!activeLobby) return;
    router.push({
      pathname: GAME_CONFIG[activeLobby.gameType].lobbyRoute as never,
      params: { sessionId: activeLobby.sessionId, lobbyId: activeLobby.lobbyId },
    });
  }, [activeLobby]);

  const handleLeaveActiveLobby = useCallback(async () => {
    if (!activeLobby || leavingActiveLobby) return;
    setLeavingActiveLobby(true);
    setError(null);
    try {
      await leaveGameLobby({ lobbyId: activeLobby.lobbyId });
      setActiveLobby(null);
      await load(true);
    } catch (nextError) {
      setError(readGameJoinCodeFailureReason(nextError));
    } finally {
      setLeavingActiveLobby(false);
    }
  }, [activeLobby, leavingActiveLobby, load]);

  const confirmLeaveActiveLobby = useCallback(() => {
    if (!activeLobby || leavingActiveLobby) return;
    const closesEmptyLobby = activeLobby.activePlayerCount === 1;
    Alert.alert(
      closesEmptyLobby
        ? t("games.joinCode.leaveAndCloseTitle")
        : t("games.joinCode.leaveLobbyTitle"),
      closesEmptyLobby
        ? t("games.joinCode.leaveAndCloseBody")
        : activeLobby.callerIsHost
          ? t("games.joinCode.leaveLobbyHostBody")
          : t("games.joinCode.leaveLobbyBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("games.joinCode.leaveLobby"),
          style: "destructive",
          onPress: () => void handleLeaveActiveLobby(),
        },
      ],
    );
  }, [activeLobby, handleLeaveActiveLobby, leavingActiveLobby, t]);

  const handleCreate = useCallback(async () => {
    if (!gameType || !squadId || creating || activeLobby || !canCreateLobby) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createGameLobby({
        gameType,
        squadId,
        idempotencyKey: createRequestKeyRef.current,
      });
      createRequestKeyRef.current = createGameJoinIdempotencyKey();
      openLobby(result.sessionId, result.lobbyId);
    } catch (nextError) {
      setError(readGameJoinCodeFailureReason(nextError));
      await load(true);
    } finally {
      setCreating(false);
    }
  }, [activeLobby, canCreateLobby, creating, gameType, load, openLobby, squadId]);

  const confirmAnotherLobby = useCallback(() => {
    Alert.alert(
      t("games.lobbyDirectory.startAnotherTitle"),
      t("games.lobbyDirectory.startAnotherBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("games.lobbyDirectory.startNewLobby"), onPress: () => void handleCreate() },
      ],
    );
  }, [handleCreate, t]);

  const handleJoin = useCallback(async (lobby: GameLobbySummary) => {
    if (!gameType || !squadId || joiningLobbyId) return;
    if (activeLobby && activeLobby.lobbyId !== lobby.lobbyId) return;
    setJoiningLobbyId(lobby.lobbyId);
    setError(null);
    try {
      if (lobby.joinAction === "joinNextRound") {
        await joinGameLobbyNextRound({ gameType, squadId, lobbyId: lobby.lobbyId });
        Alert.alert(
          t("games.lobbyDirectory.queuedTitle"),
          t("games.lobbyDirectory.queuedBody"),
        );
        await load(true);
        return;
      }
      if (lobby.joinAction === "queued" || lobby.joinAction === "full" || lobby.joinAction === "unavailable") {
        return;
      }
      const result = await joinGameLobbyById({ gameType, squadId, lobbyId: lobby.lobbyId });
      openLobby(result.sessionId, result.lobbyId);
    } catch (nextError) {
      setError(readGameJoinCodeFailureReason(nextError));
      await load(true);
    } finally {
      setJoiningLobbyId(null);
    }
  }, [activeLobby, gameType, joiningLobbyId, load, openLobby, squadId, t]);

  const title = gameType ? t(GAME_CONFIG[gameType].titleKey) : t("games.title");
  const canOfferCreate = Boolean(gameType && squadId && lobbies.length < maxLobbies);
  const createBlocked = !canCreateLobby || activeLobby !== null;

  return (
    <ScreenWrapper>
      <View style={styles.header}>
        <NestedBackButton accessibilityLabel={t("common.back")} fallbackRoute="/(tabs)/games" />
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.title}>
            {t("games.lobbyDirectory.title", { game: title })}
          </Text>
          <Text style={styles.subtitle}>{t("games.lobbyDirectory.subtitle")}</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={Colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {notice === "lobbyClosed" ? (
          <Card style={styles.noticeCard}>
            <Text accessibilityRole="alert" style={styles.noticeText}>
              {t("games.lobbyDirectory.lobbyClosed")}
            </Text>
          </Card>
        ) : null}

        {activeLobby ? (
          <ActiveLobbyRecoveryCard
            activeLobby={activeLobby}
            busy={leavingActiveLobby}
            onLeave={confirmLeaveActiveLobby}
            onReturn={openActiveLobby}
          />
        ) : null}

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={styles.bodyText}>{t("games.lobbyDirectory.loading")}</Text>
          </View>
        ) : lobbies.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.cardTitle}>{t("games.lobbyDirectory.noLobbyTitle")}</Text>
            <Text style={styles.bodyText}>{t("games.lobbyDirectory.noLobbyBody")}</Text>
            {gameType && squadId ? (
              <PrimaryAction
                busy={creating}
                disabled={!canOfferCreate || createBlocked}
                label={t("games.lobbyDirectory.startLobby")}
                onPress={() => void handleCreate()}
              />
            ) : null}
          </Card>
        ) : (
          <View style={styles.lobbyList}>
            {lobbies.map((lobby) => (
              <LobbyCard
                blocked={Boolean(activeLobby && activeLobby.lobbyId !== lobby.lobbyId)}
                busy={joiningLobbyId === lobby.lobbyId}
                key={lobby.lobbyId}
                lobby={lobby}
                onJoin={() => void handleJoin(lobby)}
              />
            ))}
          </View>
        )}

        {error ? (
          <Card style={styles.errorCard}>
            <Text accessibilityRole="alert" style={styles.errorText}>
              {t(`games.joinCode.errors.${error}`)}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void load(true)} style={styles.retryButton}>
              <Text style={styles.retryText}>{t("common.retry")}</Text>
            </Pressable>
          </Card>
        ) : null}

        {!loading && lobbies.length > 0 && canOfferCreate ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: creating || createBlocked }}
            disabled={creating || createBlocked}
            onPress={confirmAnotherLobby}
            style={({ pressed }) => [
              styles.secondaryAction,
              (creating || createBlocked) && styles.disabledAction,
              pressed && !createBlocked && styles.secondaryActionPressed,
            ]}
          >
            {creating ? <ActivityIndicator color={Colors.primary} /> : <Plus color={Colors.primary} size={19} />}
            <Text style={styles.secondaryActionText}>{t("games.lobbyDirectory.startAnotherLobby")}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function LobbyCard({
  blocked,
  busy,
  lobby,
  onJoin,
}: {
  blocked: boolean;
  busy: boolean;
  lobby: GameLobbySummary;
  onJoin: () => void;
}) {
  const { t } = useTranslation();
  const lobbyName = lobby.isMain
    ? t("games.lobbyDirectory.mainLobby")
    : t("games.lobbyDirectory.numberedLobby", { number: lobby.lobbyNumber });
  const status = t(`games.lobbyDirectory.status.${lobby.status}`);
  const playerCount = t("games.lobbyDirectory.playerCount", { count: lobby.activePlayerCount });
  const queueCount = lobby.queuedPlayerCount > 0
    ? t("games.lobbyDirectory.waitingCount", { count: lobby.queuedPlayerCount })
    : null;
  const full = lobby.joinAction === "full";
  const unavailable = blocked || lobby.joinAction === "unavailable" || lobby.joinAction === "queued";
  const actionLabel = lobby.joinAction === "joinNextRound"
    ? t("games.lobbyDirectory.joinNextRound")
    : lobby.joinAction === "queued"
      ? t("games.lobbyDirectory.waitingForNextRound")
      : full
        ? t("games.lobbyDirectory.lobbyFull")
        : lobby.joinAction === "reconnect"
          ? t("games.lobbyDirectory.returnToLobby")
          : t("games.lobbyDirectory.joinGame");
  const accessibilityLabel = t("games.lobbyDirectory.cardAccessibility", {
    lobby: lobbyName,
    host: lobby.hostDisplayName,
    status,
    players: playerCount,
    queue: queueCount ?? t("games.lobbyDirectory.noWaitingPlayers"),
    capacity: lobby.capacity,
    action: actionLabel,
  });

  return (
    <Card style={styles.lobbyCard}>
      <View accessible accessibilityLabel={accessibilityLabel}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderCopy}>
            <Text style={styles.cardTitle}>{lobbyName}</Text>
            <Text style={styles.hostText}>{t("games.lobbyDirectory.hostedBy", { name: lobby.hostDisplayName })}</Text>
          </View>
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>{status}</Text>
          </View>
        </View>
        <View style={styles.countRow}>
          <Users color={Colors.textHeading} size={17} />
          <Text style={styles.countText}>{playerCount}</Text>
          <Text style={styles.capacityText}>{t("games.lobbyDirectory.capacity", { count: lobby.capacity })}</Text>
        </View>
        {queueCount ? <Text style={styles.queueText}>{queueCount}</Text> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || full || unavailable }}
        disabled={busy || full || unavailable}
        onPress={onJoin}
        style={[styles.joinAction, (full || unavailable) && styles.disabledAction]}
      >
        {busy ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.joinActionText}>{actionLabel}</Text>}
      </Pressable>
    </Card>
  );
}

function ActiveLobbyRecoveryCard({
  activeLobby,
  busy,
  onLeave,
  onReturn,
}: {
  activeLobby: ActiveLobby;
  busy: boolean;
  onLeave: () => void;
  onReturn: () => void;
}) {
  const { t } = useTranslation();
  const gameName = t(GAME_CONFIG[activeLobby.gameType].titleKey);
  return (
    <Card style={styles.recoveryCard}>
      <Text accessibilityRole="header" style={styles.cardTitle}>
        {t("games.lobbyDirectory.activeElsewhereTitle", { game: gameName })}
      </Text>
      <Text style={styles.bodyText}>{t("games.lobbyDirectory.activeElsewhereBody")}</Text>
      <View style={styles.recoveryActions}>
        <PrimaryAction
          busy={false}
          disabled={busy || activeLobby.state === "leaving"}
          label={t("games.lobbyDirectory.returnToGameLobby", { game: gameName })}
          onPress={onReturn}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onLeave}
          style={[styles.retryButton, busy && styles.disabledAction]}
        >
          {busy ? (
            <ActivityIndicator color={Colors.primary} size="small" />
          ) : (
            <Text style={styles.retryText}>{t("games.lobbyDirectory.leaveGameLobby", { game: gameName })}</Text>
          )}
        </Pressable>
      </View>
    </Card>
  );
}

function PrimaryAction({
  busy,
  disabled = false,
  label,
  onPress,
}: {
  busy: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy || disabled }}
      disabled={busy || disabled}
      onPress={onPress}
      style={[styles.joinAction, (busy || disabled) && styles.disabledAction]}
    >
      {busy ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.joinActionText}>{label}</Text>}
    </Pressable>
  );
}

function readGameType(value: string): GameJoinCodeType | null {
  return value === "bombDefusal" || value === "spotTheDifferences" || value === "triviaBlitz"
    ? value
    : null;
}

function normalizeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const styles = StyleSheet.create({
  header: {
    alignItems: "flex-start",
    backgroundColor: Colors.surface,
    borderBottomColor: Colors.secondary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: Spacing.sm,
    minHeight: 72,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  headerCopy: { flex: 1, gap: 2, minWidth: 0 },
  headerSpacer: { width: 44 },
  title: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 19, lineHeight: 25 },
  subtitle: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 18 },
  scroll: { gap: Spacing.md, padding: Spacing.md, paddingBottom: Spacing.xxl },
  centered: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.xxl },
  emptyCard: { gap: Spacing.md },
  lobbyList: { gap: Spacing.md },
  lobbyCard: { gap: Spacing.md },
  cardHeader: { alignItems: "flex-start", flexDirection: "row", gap: Spacing.sm, justifyContent: "space-between" },
  cardHeaderCopy: { flex: 1, gap: 3, minWidth: 0 },
  cardTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 17 },
  hostText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13 },
  statusBadge: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: 6, borderWidth: 1, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
  statusText: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 11 },
  countRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  countText: { color: Colors.textHeading, fontFamily: Typography.bodyMedium, fontSize: 13 },
  capacityText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12 },
  queueText: { color: Colors.textPrimary, fontFamily: Typography.bodyMedium, fontSize: 12 },
  bodyText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20 },
  joinAction: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  joinActionText: { color: Colors.surface, fontFamily: Typography.bodyBold, fontSize: 15, textAlign: "center" },
  disabledAction: { opacity: 0.55 },
  secondaryAction: { alignItems: "center", alignSelf: "stretch", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1.5, flexDirection: "row", gap: Spacing.sm, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  secondaryActionPressed: { backgroundColor: Colors.background },
  secondaryActionText: { color: Colors.primary, flexShrink: 1, fontFamily: Typography.bodySemiBold, fontSize: 14, textAlign: "center" },
  errorCard: { gap: Spacing.sm },
  noticeCard: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderWidth: 1 },
  noticeText: { color: Colors.textHeading, fontFamily: Typography.bodyMedium, fontSize: 14, lineHeight: 20 },
  recoveryCard: { borderColor: Colors.secondary, borderWidth: 1, gap: Spacing.sm },
  recoveryActions: { gap: Spacing.sm },
  errorText: { color: Colors.primary, fontFamily: Typography.bodyMedium, fontSize: 13, lineHeight: 19 },
  retryButton: { alignItems: "center", alignSelf: "flex-start", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: Spacing.md },
  retryText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13 },
});
