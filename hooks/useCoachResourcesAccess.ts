import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { getCurrentUserTeamMemberships, type TeamMembership } from "@/services/teamService";
import {
  createCoachResourcesAccessRequestGuard,
  resolveCoachResourcesAccess,
  type CoachResourcesAccessLoadState,
} from "@/utils/coachResourcesAccess";

export function useCoachResourcesAccess() {
  const { activeMode, modeHydrated } = useApp();
  const { loading: authLoading, user } = useAuth();
  const [loadState, setLoadState] = useState<CoachResourcesAccessLoadState>("loading");
  const [memberships, setMemberships] = useState<TeamMembership[]>([]);
  const requestGuard = useRef(createCoachResourcesAccessRequestGuard());
  const contextKey = `${user?.uid ?? "signed-out"}:${modeHydrated ? activeMode : "mode-loading"}`;
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;

  const refresh = useCallback(async () => {
    const requestContextKey = contextKey;
    const request = requestGuard.current.begin(requestContextKey);

    if (authLoading || !modeHydrated) {
      setMemberships([]);
      setLoadState("loading");
      return;
    }
    if (!user?.uid || activeMode !== "coach") {
      setMemberships([]);
      setLoadState("loaded");
      return;
    }

    setMemberships([]);
    setLoadState("loading");
    try {
      const nextMemberships = await getCurrentUserTeamMemberships({
        requireComplete: true,
        throwOnError: true,
      });
      if (!requestGuard.current.isCurrent(request, contextKeyRef.current)) return;
      setMemberships(nextMemberships);
      setLoadState("loaded");
    } catch (error) {
      if (!requestGuard.current.isCurrent(request, contextKeyRef.current)) return;
      console.info("[CoachResourcesAccess] eligibility unavailable", { code: getErrorCode(error) });
      setMemberships([]);
      setLoadState("error");
    }
  }, [activeMode, authLoading, contextKey, modeHydrated, user?.uid]);

  useFocusEffect(useCallback(() => {
    void refresh();
    return () => {
      requestGuard.current.invalidate();
    };
  }, [refresh]));

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const status = useMemo(() => resolveCoachResourcesAccess({
    activeMode: modeHydrated ? activeMode : null,
    authenticatedUserId: user?.uid,
    loadState: authLoading ? "loading" : loadState,
    memberships,
  }), [activeMode, authLoading, loadState, memberships, modeHydrated, user?.uid]);

  return { refresh, status };
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}
