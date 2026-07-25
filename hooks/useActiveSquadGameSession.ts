import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

import {
  fetchActiveSquadSession,
  subscribeToSession,
  type ActiveGameSession,
} from "@/services/gameService";
import {
  createActiveSessionLoadCoordinator,
  type ActiveSessionLoadState,
} from "@/utils/activeSessionLoadState";

type Input = {
  enabled: boolean;
  squadId: string | null;
  userId: string | null;
  diagnosticLabel: string;
};

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export function useActiveSquadGameSession({
  enabled,
  squadId,
  userId,
  diagnosticLabel,
}: Input) {
  const [state, setState] = useState<ActiveSessionLoadState<ActiveGameSession>>({ status: "idle" });
  const coordinatorRef = useRef<ReturnType<typeof createActiveSessionLoadCoordinator<ActiveGameSession>> | null>(null);

  useEffect(() => {
    const coordinator = createActiveSessionLoadCoordinator<ActiveGameSession>({
      fetchSession: fetchActiveSquadSession,
      onDiagnostic: (status) => {
        if (__DEV__) console.info(`[${diagnosticLabel}] active session lookup`, { status });
      },
      onStateChange: setState,
    });
    coordinatorRef.current = coordinator;
    return () => {
      coordinator.dispose();
      if (coordinatorRef.current === coordinator) coordinatorRef.current = null;
    };
  }, [diagnosticLabel]);

  useEffect(() => {
    void coordinatorRef.current?.setContext({ enabled, squadId, userId });
  }, [enabled, squadId, userId]);

  const retry = useCallback(() => {
    return coordinatorRef.current?.retry() ?? Promise.resolve();
  }, []);

  useFocusEffect(useCallback(() => {
    if (enabled && squadId && userId) void retry();
  }, [enabled, retry, squadId, userId]));

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && previousState !== "active" && enabled && squadId && userId) {
        void retry();
      }
      previousState = nextState;
    });
    return () => subscription.remove();
  }, [enabled, retry, squadId, userId]);

  const session = "session" in state ? state.session : null;

  const clearAndRefresh = useCallback((expectedSession: ActiveGameSession) => {
    const cleared = coordinatorRef.current?.clearSession(expectedSession) === true;
    if (cleared) void retry();
  }, [retry]);

  useEffect(() => {
    if (!session) return;
    const delay = session.expiresAtLocalMs - Date.now();
    if (delay <= 0) {
      clearAndRefresh(session);
      return;
    }
    const timer = setTimeout(() => clearAndRefresh(session), delay);
    return () => clearTimeout(timer);
  }, [clearAndRefresh, session]);

  useEffect(() => {
    if (!session?.callerIsParticipant) return;
    return subscribeToSession(session.sessionId, (nextSession) => {
      if (!nextSession || TERMINAL_STATUSES.has(nextSession.status)) {
        clearAndRefresh(session);
      }
    });
  }, [clearAndRefresh, session]);

  return { retry, session, state };
}
