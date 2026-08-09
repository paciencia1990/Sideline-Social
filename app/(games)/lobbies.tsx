import React, { useCallback, useEffect, useRef, useState } from "react";
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
import type { TFunction } from "i18next";
import { Plus, Users } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { NestedBackButton } from "@/components/NestedBackButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useAccountStanding } from "@/context/AccountStandingContext";
import { useAuth } from "@/context/AuthContext";
import { useSquad } from "@/context/SquadContext";
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
import {
  createEmptyGameLobbyDirectoryResult,
  resolveGameLobbyDirectoryEligibility,
  type GameLobbyDirectoryEligibilityKind,
} from "@/utils/gameLobbyDirectoryState";

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
  const { firebaseUser, loading: authLoading } = useAuth();
  const accountStanding = useAccountStanding();
  const {
    membershipError,
    membershipLoading,
    mySquadIds,
    reloadMemberships,
    selectedSquadId,
  } = useSquad();
  const params = useLocalSearchParams<{
    gameType?: string | string[];
    squadId?: string | string[];
    notice?: string | string[];
  }>();
  const gameType = readGameType(normalizeParam(params.gameType));
  const squadId = normalizeParam(params.squadId);
  const notice = normalizeParam(params.notice);
  const [directory, setDirectory] = useState(createEmptyGameLobbyDirectoryResult);
  const [directoryResolved, setDirectoryResolved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joiningLobbyId, setJoiningLobbyId] = useState<string | null>(null);
  const [leavingActiveLobby, setLeavingActiveLobby] = useState(false);
  const [directoryError, setDirectoryError] = useState<GameJoinCodeFailureReason | null>(null);
  const [actionError, setActionError] = useState<GameJoinCodeFailureReason | null>(null);
  const [creationError, setCreationError] = useState<GameJoinCodeFailureReason | null>(null);
  const createRequestKeyRef = useRef(createGameJoinIdempotencyKey());
  const createInFlightRef = useRef(false);
  const leaveInFlightRef = useRef(false);
  const directoryRequestVersionRef = useRef(0);
  const diagnosticKeyRef = useRef("");
  const hasActiveMembership = Boolean(squadId && mySquadIds.includes(squadId));
  const canLoadDirectory = Boolean(
    gameType &&
    squadId &&
    firebaseUser &&
    accountStanding.standing?.status === "active" &&
    !accountStanding.loading &&
    !accountStanding.error &&
    !membershipLoading &&
    !membershipError &&
    selectedSquadId === squadId &&
    hasActiveMembership,
  );

  const load = useCallback(async (refresh = false) => {
    const requestVersion = ++directoryRequestVersionRef.current;
    if (!canLoadDirectory || !gameType || !squadId) {
      setDirectory(createEmptyGameLobbyDirectoryResult());
      setDirectoryResolved(false);
      setDirectoryError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setDirectoryError(null);
    try {
      const result = await listGameLobbies({ gameType, squadId });
      if (requestVersion !== directoryRequestVersionRef.current) return;
      setDirectory(result);
      setDirectoryResolved(true);
    } catch (nextError) {
      if (requestVersion !== directoryRequestVersionRef.current) return;
      setDirectoryError(readGameJoinCodeFailureReason(nextError));
      setDirectoryResolved(true);
    } finally {
      if (requestVersion !== directoryRequestVersionRef.current) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [canLoadDirectory, gameType, squadId]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => {
      directoryRequestVersionRef.current += 1;
    };
  }, [load]));

  const eligibility = resolveGameLobbyDirectoryEligibility({
    authLoading,
    authenticated: Boolean(firebaseUser),
    accountLoading: accountStanding.loading,
    accountError: accountStanding.error,
    accountStatus: accountStanding.standing?.status ?? null,
    membershipLoading,
    membershipError: Boolean(membershipError),
    squadId,
    selectedSquadId,
    hasActiveMembership,
    directoryLoading: loading,
    directoryResolved,
    directoryError,
    directory,
    creating,
  });
  const { activeLobby, lobbies, maxLobbiesPerGame: maxLobbies } = directory;

  useEffect(() => {
    if (!__DEV__) return;
    const diagnostic = {
      gameType,
      authenticated: Boolean(firebaseUser),
      authLoading,
      accountStatus: accountStanding.standing?.status ?? "unresolved",
      accountLoading: accountStanding.loading,
      accountError: accountStanding.error,
      hasSquadId: Boolean(squadId),
      selectedSquadMatches: Boolean(squadId && selectedSquadId === squadId),
      membershipLoading,
      membershipUnavailable: Boolean(membershipError),
      activeMembership: hasActiveMembership,
      directoryLoading: loading,
      directoryResolved,
      creating,
      lobbyCount: lobbies.length,
      maxLobbies,
      hasActiveLobby: Boolean(activeLobby),
      activeLobbyGameType: activeLobby?.gameType ?? null,
      canCreateLobby: directory.canCreateLobby,
      creationBlockReason: directory.creationBlockReason,
      directoryError,
      eligibility: eligibility.kind,
    };
    const key = JSON.stringify(diagnostic);
    if (diagnosticKeyRef.current === key) return;
    diagnosticKeyRef.current = key;
    console.info("[GameLobbyDirectory] eligibility", diagnostic);
  }, [
    accountStanding.error,
    accountStanding.loading,
    accountStanding.standing?.status,
    activeLobby,
    authLoading,
    creating,
    directory.canCreateLobby,
    directory.creationBlockReason,
    directoryError,
    directoryResolved,
    eligibility.kind,
    firebaseUser,
    gameType,
    hasActiveMembership,
    lobbies.length,
    loading,
    maxLobbies,
    membershipError,
    membershipLoading,
    selectedSquadId,
    squadId,
  ]);

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
    if (!activeLobby || leaveInFlightRef.current) return;
    leaveInFlightRef.current = true;
    setLeavingActiveLobby(true);
    setActionError(null);
    try {
      await leaveGameLobby({ lobbyId: activeLobby.lobbyId });
      setDirectory(createEmptyGameLobbyDirectoryResult());
      setDirectoryResolved(false);
      await load();
    } catch (nextError) {
      setActionError(readGameJoinCodeFailureReason(nextError));
    } finally {
      leaveInFlightRef.current = false;
      setLeavingActiveLobby(false);
    }
  }, [activeLobby, load]);

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
    if (!gameType || !squadId || eligibility.kind !== "eligible" || createInFlightRef.current) return;
    createInFlightRef.current = true;
    setCreating(true);
    setCreationError(null);
    setActionError(null);
    try {
      const result = await createGameLobby({
        gameType,
        squadId,
        idempotencyKey: createRequestKeyRef.current,
      });
      createRequestKeyRef.current = createGameJoinIdempotencyKey();
      openLobby(result.sessionId, result.lobbyId);
    } catch (nextError) {
      setCreationError(readGameJoinCodeFailureReason(nextError));
      await load(true);
    } finally {
      createInFlightRef.current = false;
      setCreating(false);
    }
  }, [eligibility.kind, gameType, load, openLobby, squadId]);

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
    setActionError(null);
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
      setActionError(readGameJoinCodeFailureReason(nextError));
      await load(true);
    } finally {
      setJoiningLobbyId(null);
    }
  }, [activeLobby, gameType, joiningLobbyId, load, openLobby, squadId, t]);

  const title = gameType ? t(GAME_CONFIG[gameType].titleKey) : t("games.title");
  const canOfferCreate = eligibility.kind === "eligible" || eligibility.kind === "creating";
  const guidance = resolveEligibilityGuidance({
    kind: eligibility.kind,
    accountStatus: accountStanding.standing?.status ?? null,
    t,
    onAccountRetry: () => void accountStanding.refresh(),
    onBackToGames: () => router.replace("/(tabs)/games" as never),
    onDirectoryRetry: () => void load(true),
    onMembershipRetry: () => void reloadMemberships(),
  });

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

        {eligibility.kind === "activeLobby" && activeLobby ? (
          <ActiveLobbyRecoveryCard
            activeLobby={activeLobby}
            busy={leavingActiveLobby}
            onLeave={confirmLeaveActiveLobby}
            onReturn={openActiveLobby}
          />
        ) : null}

        {eligibility.kind === "checking" ? (
          <View style={styles.centered}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={styles.bodyText}>{t("games.lobbyDirectory.checkingAvailability")}</Text>
          </View>
        ) : null}

        {guidance ? (
          <GuidanceCard
            actionLabel={guidance.actionLabel}
            body={guidance.body}
            onAction={guidance.onAction}
            title={guidance.title}
          />
        ) : null}

        {eligibility.kind !== "checking" && lobbies.length > 0 ? (
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
        ) : null}

        {canOfferCreate && lobbies.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.cardTitle}>{t("games.lobbyDirectory.noLobbyTitle")}</Text>
            <Text style={styles.bodyText}>{t("games.lobbyDirectory.noLobbyBody")}</Text>
            <PrimaryAction
              busy={creating}
              label={t("games.lobbyDirectory.startLobby")}
              onPress={() => void handleCreate()}
            />
          </Card>
        ) : null}

        {creationError && canOfferCreate ? (
          <Card style={styles.errorCard}>
            <Text style={styles.cardTitle}>{t("games.lobbyDirectory.creationFailedTitle")}</Text>
            <Text accessibilityRole="alert" style={styles.errorText}>
              {t(`games.joinCode.errors.${creationError}`)}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void handleCreate()} style={styles.retryButton}>
              <Text style={styles.retryText}>{t("common.retry")}</Text>
            </Pressable>
          </Card>
        ) : null}

        {actionError ? (
          <Card style={styles.errorCard}>
            <Text accessibilityRole="alert" style={styles.errorText}>
              {t(`games.joinCode.errors.${actionError}`)}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void load(true)} style={styles.retryButton}>
              <Text style={styles.retryText}>{t("common.retry")}</Text>
            </Pressable>
          </Card>
        ) : null}

        {lobbies.length > 0 && lobbies.length < maxLobbies && canOfferCreate ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: creating }}
            disabled={creating}
            onPress={confirmAnotherLobby}
            style={({ pressed }) => [
              styles.secondaryAction,
              creating && styles.disabledAction,
              pressed && !creating && styles.secondaryActionPressed,
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

function GuidanceCard({
  actionLabel,
  body,
  onAction,
  title,
}: {
  actionLabel?: string;
  body: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <Card style={styles.guidanceCard}>
      <Text accessibilityRole="header" style={styles.cardTitle}>{title}</Text>
      <Text style={styles.bodyText}>{body}</Text>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} style={styles.retryButton}>
          <Text style={styles.retryText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

function resolveEligibilityGuidance({
  accountStatus,
  kind,
  onAccountRetry,
  onBackToGames,
  onDirectoryRetry,
  onMembershipRetry,
  t,
}: {
  accountStatus: "active" | "messagingRestricted" | "suspended" | "banned" | null;
  kind: GameLobbyDirectoryEligibilityKind;
  onAccountRetry: () => void;
  onBackToGames: () => void;
  onDirectoryRetry: () => void;
  onMembershipRetry: () => void;
  t: TFunction;
}): { title: string; body: string; actionLabel?: string; onAction?: () => void } | null {
  if (kind === "authRequired") {
    return {
      title: t("games.lobbyDirectory.authRequiredTitle"),
      body: t("games.lobbyDirectory.authRequiredBody"),
      actionLabel: t("games.lobbyDirectory.backToGames"),
      onAction: onBackToGames,
    };
  }
  if (kind === "accountUnavailable") {
    return {
      title: t("accountStanding.refresh.title"),
      body: t("accountStanding.refresh.body"),
      actionLabel: t("common.retry"),
      onAction: onAccountRetry,
    };
  }
  if (kind === "accountRestricted") {
    const standingKey = accountStatus === "active" || accountStatus === null ? "refresh" : accountStatus;
    return {
      title: t(`accountStanding.${standingKey}.title`),
      body: t(`accountStanding.${standingKey}.body`),
      actionLabel: t("common.retry"),
      onAction: onAccountRetry,
    };
  }
  if (kind === "missingSquad") {
    return {
      title: t("games.lobbyDirectory.missingSquadTitle"),
      body: t("games.lobbyDirectory.missingSquadBody"),
      actionLabel: t("games.lobbyDirectory.backToGames"),
      onAction: onBackToGames,
    };
  }
  if (kind === "membershipUnavailable") {
    return {
      title: t("games.lobbyDirectory.membershipUnavailableTitle"),
      body: t("games.lobbyDirectory.membershipUnavailableBody"),
      actionLabel: t("common.retry"),
      onAction: onMembershipRetry,
    };
  }
  if (kind === "inactiveMembership") {
    return {
      title: t("games.lobbyDirectory.inactiveMembershipTitle"),
      body: t("games.lobbyDirectory.inactiveMembershipBody"),
      actionLabel: t("games.lobbyDirectory.backToGames"),
      onAction: onBackToGames,
    };
  }
  if (kind === "lobbyLimit") {
    return {
      title: t("games.lobbyDirectory.lobbyLimitTitle"),
      body: t("games.lobbyDirectory.lobbyLimitBody"),
    };
  }
  if (kind === "directoryUnavailable") {
    return {
      title: t("games.lobbyDirectory.directoryUnavailableTitle"),
      body: t("games.lobbyDirectory.directoryUnavailableBody"),
      actionLabel: t("common.retry"),
      onAction: onDirectoryRetry,
    };
  }
  return null;
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
  guidanceCard: { gap: Spacing.sm },
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
