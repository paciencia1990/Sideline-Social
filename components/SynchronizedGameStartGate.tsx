import React, { type PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import CountdownOverlay from "@/components/CountdownOverlay";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { useSquad } from "@/context/SquadContext";
import { useFirebaseServerClock } from "@/hooks/useFirebaseServerClock";
import { useGameRoomDeparture } from "@/hooks/useGameRoomDeparture";
import {
  acknowledgeSynchronizedGameStart,
  preloadSynchronizedGameRound,
  prepareSynchronizedGameStart,
  subscribeToSynchronizedGameStart,
} from "@/services/gameStartSynchronizationService";
import { type GameJoinCodeType } from "@/services/gameJoinCodeService";
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
  const [loadedAttempt, setLoadedAttempt] = useState<string | null>(null);
  const [listenerReady, setListenerReady] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now);
  const [foreground, setForeground] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const preparingAttemptsRef = useRef(new Map<string, Promise<void>>());
  const mounted = useRef(true);
  const lifecycle = useRef(0);
  const retryInFlight = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const currentScope = useRef({ gameType, sessionId, state });
  currentScope.current = { gameType, sessionId, state };
  const attemptId = state?.gameType === gameType && state.sessionId === sessionId ? state.startAttemptId : "";
  const attemptKey = JSON.stringify([gameType, sessionId, attemptId]);
  const loaded = Boolean(attemptId && loadedAttempt === attemptKey);

  useEffect(() => {
    mounted.current = true;
    const attempts = preparingAttemptsRef.current;
    return () => { mounted.current = false; lifecycle.current += 1; attempts.clear(); retryInFlight.current = null; };
  }, []);
  useEffect(() => {
    setState(null); setLoadedAttempt(null); setListenerReady(false); setError(null); setRetrying(false);
    if (isLocal || !sessionId) return;
    let active = true;
    const unsubscribe = subscribeToSynchronizedGameStart(gameType, sessionId, (nextState) => {
      if (!active || currentScope.current.sessionId !== sessionId || currentScope.current.gameType !== gameType) return;
      setNowTick(Date.now()); setListenerReady(true); setState(nextState);
    }, () => { if (active) { setListenerReady(true); setError("unavailable"); } });
    return () => { active = false; unsubscribe(); };
  }, [gameType, isLocal, sessionId]);

  const prepareAttempt = useCallback((force = false): Promise<void> => {
    if (isLocal || !sessionId || !attemptId) return Promise.resolve();
    const pending = preparingAttemptsRef.current.get(attemptKey);
    if (pending) return pending;
    if (!force && loadedAttempt === attemptKey) return Promise.resolve();
    const startedIn = lifecycle.current;
    const isCurrent = () => mounted.current && lifecycle.current === startedIn
      && currentScope.current.gameType === gameType && currentScope.current.sessionId === sessionId
      && currentScope.current.state?.startAttemptId === attemptId && currentScope.current.state.phase !== "failed";
    const request = Promise.resolve().then(async () => {
      if (!isCurrent()) return;
      await preloadSynchronizedGameRound(gameType, sessionId);
      if (!isCurrent()) return;
      const latest = currentScope.current.state!;
      if (latest.phase === "preparing" || latest.phase === "activating") {
        await acknowledgeSynchronizedGameStart({ gameType, sessionId, startAttemptId: attemptId });
      }
      if (!isCurrent()) return;
      setLoadedAttempt(attemptKey); setError(null);
    }).catch((error) => {
      if (isCurrent()) { setLoadedAttempt(null); setError("preload"); }
      throw error;
    }).finally(() => {
      if (preparingAttemptsRef.current.get(attemptKey) === request) preparingAttemptsRef.current.delete(attemptKey);
    });
    preparingAttemptsRef.current.set(attemptKey, request);
    return request;
  }, [attemptId, attemptKey, gameType, isLocal, loadedAttempt, sessionId]);
  useEffect(() => {
    // Progress snapshots for the same attempt must not cancel local preparation.
    if (attemptId) void prepareAttempt().catch(() => {});
  }, [attemptId, prepareAttempt]);

  const serverNowMs = serverAdjustedNow(nowTick, offsetMs);
  const visibleState = attemptId ? state : null;
  const phase = useMemo(() => deriveGameStartVisiblePhase(visibleState, serverNowMs), [serverNowMs, visibleState]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setForeground(nextState === "active"); setNowTick(Date.now());
    });
    return () => subscription.remove();
  }, []);
  const needsClock = !isLocal && foreground && Boolean(attemptId) && ["preparing", "3", "2", "1", "go"].includes(phase);
  useEffect(() => {
    if (!needsClock) return;
    const update = () => setNowTick(Date.now());
    update(); const interval = setInterval(update, 100);
    return () => clearInterval(interval);
  }, [needsClock]);

  const waitingCount = visibleState ? Math.max(0, visibleState.participantCount - visibleState.acknowledgedCount) : 0;
  const activeLobbyId = visibleState?.lobbyId || routeLobbyId;
  const roomDeparture = useGameRoomDeparture({
    enabled: Boolean(activeLobbyId) && !(phase === "active" && loaded),
    lobbyId: activeLobbyId,
  });

  const handleRetry = useCallback(() => {
    const key = JSON.stringify([gameType, sessionId, state?.startAttemptId]);
    if (retryInFlight.current?.key === key) return retryInFlight.current.promise;
    if (!sessionId) return Promise.resolve();
    const startedIn = lifecycle.current;
    const scope = currentScope.current;
    const isCurrent = () => mounted.current && lifecycle.current === startedIn
      && currentScope.current.gameType === scope.gameType && currentScope.current.sessionId === scope.sessionId
      && currentScope.current.state?.startAttemptId === scope.state?.startAttemptId;
    setRetrying(true); setError(null); setLoadedAttempt(null);
    const request = Promise.resolve().then(async () => {
      if (!isCurrent()) return;
      if (state && (state.phase === "preparing" || state.phase === "activating" || state.phase === "scheduled")) {
        await prepareAttempt(true);
      } else {
        await prepareSynchronizedGameStart({ gameType, sessionId });
      }
    }).catch(() => { if (isCurrent()) setError("retry"); })
      .finally(() => {
        if (retryInFlight.current?.promise === request) {
          retryInFlight.current = null;
          if (mounted.current && lifecycle.current === startedIn && currentScope.current.gameType === scope.gameType && currentScope.current.sessionId === scope.sessionId) setRetrying(false);
        }
      });
    retryInFlight.current = { key, promise: request };
    return request;
  }, [gameType, prepareAttempt, sessionId, state]);

  const handleLeave = useCallback(async () => {
    await roomDeparture.departAndNavigate(() => {
      if (selectedSquadId) {
        router.replace({ pathname: "/(games)/lobbies", params: { gameType, squadId: selectedSquadId } } as never);
      } else {
        router.replace("/(tabs)/games");
      }
    });
  }, [gameType, roomDeparture, selectedSquadId]);

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
            <Text style={styles.secondaryText}>{roomDeparture.departing ? t("game.leavingRoom") : t("games.joinCode.leaveLobby")}</Text>
          </Pressable>
          {roomDeparture.departureError ? (
            <Pressable accessibilityRole="button" onPress={roomDeparture.retryDeparture}>
              <Text accessibilityLiveRegion="polite" style={styles.errorText}>{t("game.departureFailedBody")} {t("common.retry")}</Text>
            </Pressable>
          ) : null}
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
  errorText: {
    color: "#B42318",
    fontFamily: Typography.bodySemiBold,
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
