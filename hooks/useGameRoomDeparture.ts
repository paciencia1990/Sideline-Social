import { useCallback, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { useNavigationContainerRef } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useTranslation } from "react-i18next";

import {
  leaveGameLobby,
  readGameJoinCodeFailureReason,
  type GameJoinCodeFailureReason,
} from "@/services/gameJoinCodeService";
import {
  createGameRoomDepartureNavigationController,
  type GameRoomDepartureNavigationController,
  type GameRoomDepartureNavigationState,
  type RetainedGameRoomNavigationParams,
} from "@/utils/gameRoomDeparture";

type NavigationCallback = () => void;
type RetainedNavigationCallback = (params: RetainedGameRoomNavigationParams) => void;

type UseGameRoomDepartureOptions = {
  enabled: boolean;
  lobbyId: string;
  presentFailureAlert?: boolean;
};

const INITIAL_DEPARTURE_STATE: GameRoomDepartureNavigationState<GameJoinCodeFailureReason> = {
  departed: false,
  departing: false,
  error: null,
  hasPendingNavigation: false,
};

export function useGameRoomDeparture({
  enabled,
  lobbyId,
  presentFailureAlert = true,
}: UseGameRoomDepartureOptions) {
  const { t } = useTranslation();
  const navigationRef = useNavigationContainerRef();
  const [storedDepartureState, setStoredDepartureState] = useState({
    lobbyId,
    state: INITIAL_DEPARTURE_STATE,
  });
  const departureState = storedDepartureState.lobbyId === lobbyId
    ? storedDepartureState.state
    : INITIAL_DEPARTURE_STATE;
  const controllerRef = useRef<GameRoomDepartureNavigationController<GameJoinCodeFailureReason> | null>(null);
  const coordinatorKeyRef = useRef<string | null>(null);
  const retryRef = useRef<() => void>(() => undefined);
  const failureAlertVisibleRef = useRef(false);

  if (coordinatorKeyRef.current !== lobbyId) {
    coordinatorKeyRef.current = lobbyId;
    controllerRef.current = createGameRoomDepartureNavigationController({
      leaveRoom: async () => {
        if (!lobbyId) throw new Error("game_not_found");
        await leaveGameLobby({ lobbyId });
      },
      classifyError: readGameJoinCodeFailureReason,
      onStateChange: (state) => setStoredDepartureState({ lobbyId, state }),
    });
  }

  const presentFailure = useCallback(() => {
    if (!presentFailureAlert || failureAlertVisibleRef.current) return;
    failureAlertVisibleRef.current = true;
    Alert.alert(
      t("game.departureFailedTitle"),
      t("game.departureFailedBody"),
      [
        {
          text: t("game.stayInRoom"),
          style: "cancel",
          onPress: () => {
            failureAlertVisibleRef.current = false;
          },
        },
        {
          text: t("common.retry"),
          onPress: () => {
            failureAlertVisibleRef.current = false;
            retryRef.current();
          },
        },
      ],
    );
  }, [presentFailureAlert, t]);

  const depart = useCallback(async () => {
    if (!enabled) return true;
    const departed = await controllerRef.current?.depart() ?? false;
    if (!departed) presentFailure();
    return departed;
  }, [enabled, presentFailure]);

  const departAndNavigate = useCallback(async (navigate: NavigationCallback) => {
    if (!enabled) {
      navigate();
      return true;
    }
    const departed = await controllerRef.current?.departAndNavigate(navigate) ?? false;
    if (!departed) presentFailure();
    return departed;
  }, [enabled, presentFailure]);

  const retryDeparture = useCallback(() => {
    void controllerRef.current?.retryDeparture().then((departed) => {
      if (!departed) presentFailure();
    });
  }, [presentFailure]);
  retryRef.current = retryDeparture;

  const continueWithinRoom = useCallback((navigate: RetainedNavigationCallback) => {
    controllerRef.current?.continueWithinRoom(navigate);
  }, []);

  const markDeparted = useCallback(() => {
    controllerRef.current?.markDeparted();
  }, []);
  const getDepartureError = useCallback(() => controllerRef.current?.getState().error ?? null, []);
  const hasPendingNavigation = useCallback(
    () => controllerRef.current?.getState().hasPendingNavigation ?? false,
    [],
  );
  const hasDeparted = useCallback(() => controllerRef.current?.hasDeparted() ?? false, []);

  usePreventRemove(enabled && !(controllerRef.current?.hasDeparted() ?? false), ({ data }) => {
    void controllerRef.current
      // A screen-level dispatch adds its leaf route as `source`. For actions
      // targeting a parent stack, REPLACE then cannot find that leaf and becomes
      // a silent no-op. Resume the exact action at the container, preserving its
      // target, original source and React Navigation's visited-route marker.
      ?.handlePreventedRemoval(data.action, () => navigationRef.dispatch(data.action))
      .then((departed) => {
        if (!departed) presentFailure();
      });
  });

  return useMemo(() => ({
    depart,
    departAndNavigate,
    departing: departureState.departing,
    departureError: departureState.error,
    getDepartureError,
    hasPendingNavigation,
    hasDeparted,
    retryDeparture,
    continueWithinRoom,
    markDeparted,
  }), [
    continueWithinRoom,
    depart,
    departAndNavigate,
    departureState.departing,
    departureState.error,
    getDepartureError,
    hasPendingNavigation,
    hasDeparted,
    markDeparted,
    retryDeparture,
  ]);
}
