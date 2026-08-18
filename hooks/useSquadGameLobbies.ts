import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

import {
  listGameLobbies,
  readGameJoinCodeFailureReason,
  type GameJoinCodeFailureReason,
  type GameLobbySummary,
} from "@/services/gameJoinCodeService";
import { measureDevelopmentPerformance } from "@/utils/performanceDiagnostics";

type LobbyDirectoryState = "idle" | "loading" | "ready" | "permission-error" | "network-error";

type UseSquadGameLobbiesInput = {
  enabled: boolean;
  squadId: string | null;
};

const ACTIVE_LOBBY_REFRESH_MS = 15_000;

export function useSquadGameLobbies({ enabled, squadId }: UseSquadGameLobbiesInput) {
  const [lobbies, setLobbies] = useState<GameLobbySummary[]>([]);
  const [state, setState] = useState<LobbyDirectoryState>("idle");
  const [failureReason, setFailureReason] = useState<GameJoinCodeFailureReason | null>(null);
  const requestVersionRef = useRef(0);

  const refresh = useCallback(async (background = false) => {
    if (!enabled || !squadId) {
      requestVersionRef.current += 1;
      setLobbies([]);
      setFailureReason(null);
      setState("idle");
      return;
    }

    const requestVersion = ++requestVersionRef.current;
    if (!background) setState("loading");
    try {
      const result = await measureDevelopmentPerformance(
        "games.lobby-directory",
        () => listGameLobbies({ squadId }),
      );
      if (requestVersion !== requestVersionRef.current) return;
      setLobbies(result.lobbies);
      setFailureReason(null);
      setState("ready");
    } catch (error) {
      if (requestVersion !== requestVersionRef.current) return;
      const reason = readGameJoinCodeFailureReason(error);
      setFailureReason(reason);
      setState(reason === "not_authorized" ? "permission-error" : "network-error");
    }
  }, [enabled, squadId]);

  useEffect(() => {
    if (!enabled || !squadId) void refresh();
  }, [enabled, refresh, squadId]);

  useFocusEffect(useCallback(() => {
    if (!enabled || !squadId) return undefined;
    void refresh();
    const interval = setInterval(() => void refresh(true), ACTIVE_LOBBY_REFRESH_MS);
    return () => clearInterval(interval);
  }, [enabled, refresh, squadId]));

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && previousState !== "active") void refresh(true);
      previousState = nextState;
    });
    return () => subscription.remove();
  }, [refresh]);

  return { failureReason, lobbies, refresh, state };
}

export type { LobbyDirectoryState };
