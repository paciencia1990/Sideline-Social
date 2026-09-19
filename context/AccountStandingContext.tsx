import React, {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import { useAuth } from "@/context/AuthContext";
import {
  fetchMyAccountStanding,
  subscribeToMyAccountStanding,
} from "@/services/accountStandingService";
import {
  clearProtectedMediaMemoryState,
  clearRestrictedUserLocalState,
} from "@/services/localUserStateService";
import type { AccountStanding } from "@/types/accountStanding";
import {
  createAccountRefreshCoordinator,
  needsAppealEligibilityRefresh,
  standingRefreshIdentity,
  startBoundedAppealEligibilityRefresh,
} from "@/context/accountStandingRefreshCore";

type AccountStandingContextValue = {
  acknowledgedRevision: number | null;
  acknowledge: () => void;
  error: boolean;
  loading: boolean;
  refresh: () => Promise<AccountStanding | null>;
  refreshError: boolean;
  refreshing: boolean;
  standing: AccountStanding | null;
};

const AccountStandingContext = createContext<AccountStandingContextValue | null>(null);

export function AccountStandingProvider({ children }: { children: ReactNode }) {
  const { firebaseUser, loading: authLoading } = useAuth();
  const [standing, setStanding] = useState<AccountStanding | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [acknowledgedRevision, setAcknowledgedRevision] = useState<number | null>(null);
  const clearedRestriction = useRef<string | null>(null);
  const standingRef = useRef<AccountStanding | null>(null);
  const identityRef = useRef<{ generation: number; uid: string | null }>({ generation: 0, uid: null });
  const mounted = useRef(true);
  const coordinator = useRef(createAccountRefreshCoordinator<AccountStanding>({
    fetch: async () => fetchMyAccountStanding(),
    currentIdentity: () => identityRef.current.uid
      ? `${identityRef.current.uid}:${identityRef.current.generation}`
      : null,
    onStart: () => {
      if (!mounted.current) return;
      if (!standingRef.current) setLoading(true);
      setRefreshing(true);
      setRefreshError(false);
    },
    onApply: (next) => {
      if (!mounted.current) return;
      standingRef.current = next;
      setStanding(next);
      setError(false);
      setRefreshError(false);
    },
    onFailure: (refreshFailure) => {
      if (!mounted.current) return;
      console.warn("[AccountStanding] refresh unavailable", {
        code: errorCode(refreshFailure),
      });
      setRefreshError(true);
      if (!standingRef.current) setError(true);
    },
    onSettled: () => {
      if (!mounted.current) return;
      setLoading(false);
      setRefreshing(false);
    },
  }));

  useEffect(() => () => {
    mounted.current = false;
    identityRef.current = { generation: identityRef.current.generation + 1, uid: null };
  }, []);

  const refresh = useCallback(async () => {
    const authenticatedUser = firebaseUser;
    const uid = authenticatedUser?.uid ?? null;
    if (!authenticatedUser || !uid || identityRef.current.uid !== uid) {
      standingRef.current = null;
      setStanding(null);
      setError(false);
      setRefreshError(false);
      setLoading(false);
      setRefreshing(false);
      return null;
    }
    const identity = `${uid}:${identityRef.current.generation}`;
    const next = await coordinator.current.run(identity);
    if (!next || identityRef.current.uid !== uid || `${identityRef.current.uid}:${identityRef.current.generation}` !== identity) return next;
    if (
      next.status === "messagingRestricted" ||
      next.status === "suspended" ||
      next.status === "banned"
    ) {
      const restrictionKey = `${uid}:${next.status}:${next.revision}`;
      if (clearedRestriction.current !== restrictionKey) {
        clearedRestriction.current = restrictionKey;
        if (next.status === "messagingRestricted") await clearProtectedMediaMemoryState();
        else await clearRestrictedUserLocalState();
      }
    } else {
      clearedRestriction.current = null;
      // Read the server-owned standing with the currently valid ID token first.
      // A serious moderation action revokes refresh tokens; forcing a refresh
      // before this read would hide the restriction/appeal shell behind a
      // generic authentication error. Active accounts can safely refresh here.
      await authenticatedUser.getIdToken(true);
    }
    return next;
  }, [firebaseUser]);

  useEffect(() => {
    identityRef.current = {
      generation: identityRef.current.generation + 1,
      uid: firebaseUser?.uid ?? null,
    };
    standingRef.current = null;
    setStanding(null);
    setAcknowledgedRevision(null);
    setError(false);
    setRefreshError(false);
    if (authLoading) {
      setLoading(true);
      return;
    }
    void refresh();
  }, [authLoading, firebaseUser?.uid, refresh]);

  useEffect(() => {
    const uid = firebaseUser?.uid;
    if (!uid || !needsAppealEligibilityRefresh(standing)) return;
    const identity = standingRefreshIdentity(uid, standing);
    if (!identity) return;
    return startBoundedAppealEligibilityRefresh({
      identity,
      currentIdentity: () => standingRefreshIdentity(identityRef.current.uid ?? "", standingRef.current),
      refresh,
    });
  }, [firebaseUser?.uid, refresh, standing?.appeal.available, standing?.appeal.status, standing?.revision, standing?.status]);

  useEffect(() => {
    if (!firebaseUser) return;
    return subscribeToMyAccountStanding(
      firebaseUser.uid,
      () => void refresh(),
      () => setError(true),
    );
  }, [firebaseUser, refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && firebaseUser) void refresh();
    });
    return () => subscription.remove();
  }, [firebaseUser, refresh]);

  useEffect(() => {
    if (!standing?.expiresAt) return;
    const delay = new Date(standing.expiresAt).getTime() - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) {
      void refresh();
      return;
    }
    const timer = setTimeout(() => void refresh(), Math.min(delay + 1_000, 2_147_000_000));
    return () => clearTimeout(timer);
  }, [refresh, standing?.expiresAt]);

  const value = useMemo<AccountStandingContextValue>(() => ({
    acknowledgedRevision,
    acknowledge: () => setAcknowledgedRevision(standing?.revision ?? null),
    error,
    loading,
    refresh,
    refreshError,
    refreshing,
    standing,
  }), [acknowledgedRevision, error, loading, refresh, refreshError, refreshing, standing]);

  return (
    <AccountStandingContext.Provider value={value}>
      {children}
    </AccountStandingContext.Provider>
  );
}

export function useAccountStanding() {
  const value = useContext(AccountStandingContext);
  if (!value) {
    throw new Error("useAccountStanding must be used within AccountStandingProvider");
  }
  return value;
}

function errorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error
    ? String(error.code)
    : "unknown";
}
