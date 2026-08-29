import React, { type PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import CountdownOverlay from "@/components/CountdownOverlay";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { useSquad } from "@/context/SquadContext";
import { useFirebaseServerClock } from "@/hooks/useFirebaseServerClock";
import {
  acknowledgeSynchronizedGameStart,
  preloadSynchronizedGameRound,
  prepareSynchronizedGameStart,
  subscribeToSynchronizedGameStart,
} from "@/services/gameStartSynchronizationService";
import { leaveGameLobby, type GameJoinCodeType } from "@/services/gameJoinCodeService";
import {
  deriveGameStartVisiblePhase,
  serverAdjustedNow,
  type GameStartState,
} from "@/utils/gameStartSynchronization";

type SynchronizedGameStartGateProps = PropsWithChildren<{
  gameType: GameJoinCodeType;
}>;

export default function SynchronizedGameStartGate({
  children,
  gameType,
}: SynchronizedGameStartGateProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { selectedSquadId } = useSquad();
  const params = useLocalSearchParams<{
    sessionId?: string | string[];
    lobbyId?: string | string[];
    local?: string | string[];
  }>();
  const sessionId = normalizeParam(params.sessionId);
  const routeLobbyId = normalizeParam(params.lobbyId);
  const isLocal = __DEV__ && normalizeParam(params.local) === "1";
  const { offsetMs } = useFirebaseServerClock();
  const [state, setState] = useState<GameStartState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [listenerReady, setListenerReady] = useState(false);
  const [nowTick, setNowTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const preparedAttemptsRef = useRef(new Set<string>());
  const preparingAttemptsRef = useRef(new Set<string>());
  const acknowledgingAttemptsRef = useRef(new Set<string>());

  useEffect(() => {
    if (isLocal || !sessionId) return;
    return subscribeToSynchronizedGameStart(
      gameType,
      sessionId,
      (nextState) => {
        setListenerReady(true);
        setState(nextState);
      },
      () => {
        setListenerReady(true);
        setError("unavailable");
      },
    );
  }, [gameType, isLocal, sessionId]);

  useEffect(() => {
    if (isLocal) return;
    const update = () => setNowTick(Date.now());
    const interval = setInterval(update, 100);
    const subscription = AppState.addEventListener("change", update);
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [isLocal]);

  useEffect(() => {
    if (
      !state ||
      !sessionId ||
      preparedAttemptsRef.current.has(state.startAttemptId) ||
      preparingAttemptsRef.current.has(state.startAttemptId)
    ) return;
    let active = true;
    const attemptId = state.startAttemptId;
    preparingAttemptsRef.current.add(attemptId);
    void preloadSynchronizedGameRound(gameType, sessionId)
      .then(async () => {
        if (!active) return;
        if (
          (state.phase === "preparing" || state.phase === "activating") &&
          !acknowledgingAttemptsRef.current.has(attemptId)
        ) {
          acknowledgingAttemptsRef.current.add(attemptId);
          try {
            await acknowledgeSynchronizedGameStart({ gameType, sessionId, startAttemptId: attemptId });
          } finally {
            acknowledgingAttemptsRef.current.delete(attemptId);
          }
        }
        if (!active) return;
        preparedAttemptsRef.current.add(attemptId);
        setLoaded(true);
        setError(null);
      })
      .catch(() => {
        preparedAttemptsRef.current.delete(attemptId);
        if (!active) return;
        setLoaded(false);
        setError("preload");
      })
      .finally(() => preparingAttemptsRef.current.delete(attemptId));
    return () => {
      active = false;
    };
  }, [gameType, sessionId, state]);

  const serverNowMs = serverAdjustedNow(nowTick, offsetMs);
  const phase = useMemo(
    () => deriveGameStartVisiblePhase(state, serverNowMs),
    [serverNowMs, state],
  );
  const waitingCount = state ? Math.max(0, state.participantCount - state.acknowledgedCount) : 0;

  const handleRetry = useCallback(async () => {
    if (!sessionId || retrying) return;
    setRetrying(true);
    setError(null);
    setLoaded(false);
    try {
      if (state && (state.phase === "preparing" || state.phase === "activating" || state.phase === "scheduled")) {
        const attemptId = state.startAttemptId;
        preparedAttemptsRef.current.delete(attemptId);
        await preloadSynchronizedGameRound(gameType, sessionId);
        if (state.phase === "preparing" || state.phase === "activating") {
          await acknowledgeSynchronizedGameStart({
            gameType,
            sessionId,
            startAttemptId: attemptId,
          });
        }
        preparedAttemptsRef.current.add(attemptId);
        setLoaded(true);
        return;
      }
      await prepareSynchronizedGameStart({ gameType, sessionId });
    } catch {
      setError("retry");
    } finally {
      setRetrying(false);
    }
  }, [gameType, retrying, sessionId, state]);

  const handleLeave = useCallback(async () => {
    const lobbyId = state?.lobbyId || routeLobbyId;
    if (lobbyId) await leaveGameLobby({ lobbyId }).catch(() => undefined);
    if (selectedSquadId) {
      router.replace({ pathname: "/(games)/lobbies", params: { gameType, squadId: selectedSquadId } } as never);
    } else {
      router.replace("/(tabs)/games");
    }
  }, [gameType, routeLobbyId, selectedSquadId, state?.lobbyId]);

  if (isLocal) return <>{children}</>;
  if (phase === "active" && loaded) return <>{children}</>;
  if (phase === "3" || phase === "2" || phase === "1" || phase === "go") {
    return <CountdownOverlay phase={phase} />;
  }

  const timedOut = phase === "timedOut";
  const updateRequired = listenerReady && !state && !error;
  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.xl, paddingBottom: insets.bottom + Spacing.xl }]}>
      <ActivityIndicator color={Colors.primary} size="large" />
      <Text accessibilityLiveRegion="polite" style={styles.title}>
        {timedOut
          ? t("games.countdown.preparationTimeoutTitle")
          : updateRequired
            ? t("games.countdown.updateRequiredTitle")
            : t("games.countdown.gettingReady")}
      </Text>
      <Text style={styles.body}>
        {timedOut
          ? t("games.countdown.preparationTimeoutBody")
          : updateRequired
            ? t("games.countdown.updateRequiredBody")
            : error
              ? t("games.countdown.preparationError")
              : waitingCount > 0
                ? t("games.countdown.waitingForPlayers", { count: waitingCount })
                : t("games.countdown.finishingPreparation")}
      </Text>
      {(timedOut || error) && (
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" disabled={retrying} onPress={() => void handleRetry()} style={styles.primaryButton}>
            {retrying ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.primaryText}>{t("common.retry")}</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void handleLeave()} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("games.joinCode.leaveLobby")}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function normalizeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: Colors.background,
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  title: {
    color: Colors.textHeading,
    fontFamily: Typography.heading,
    fontSize: 28,
    marginTop: Spacing.lg,
    textAlign: "center",
  },
  body: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 16,
    lineHeight: 24,
    marginTop: Spacing.sm,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.xl,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 120,
    paddingHorizontal: Spacing.lg,
  },
  primaryText: {
    color: Colors.surface,
    fontFamily: Typography.bodyBold,
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: Colors.primary,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 120,
    paddingHorizontal: Spacing.lg,
  },
  secondaryText: {
    color: Colors.primary,
    fontFamily: Typography.bodyBold,
  },
});
