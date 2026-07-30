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
import { clearRestrictedUserLocalState } from "@/services/localUserStateService";
import type { AccountStanding } from "@/types/accountStanding";

type AccountStandingContextValue = {
  acknowledgedRevision: number | null;
  acknowledge: () => void;
  error: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  standing: AccountStanding | null;
};

const AccountStandingContext = createContext<AccountStandingContextValue | null>(null);

export function AccountStandingProvider({ children }: { children: ReactNode }) {
  const { firebaseUser, loading: authLoading } = useAuth();
  const [standing, setStanding] = useState<AccountStanding | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [acknowledgedRevision, setAcknowledgedRevision] = useState<number | null>(null);
  const clearedRestriction = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!firebaseUser) {
      setStanding(null);
      setError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await fetchMyAccountStanding();
      setStanding(next);
      setError(false);
      if (
        next.status === "suspended" ||
        next.status === "banned"
      ) {
        const restrictionKey = `${firebaseUser.uid}:${next.revision}`;
        if (clearedRestriction.current !== restrictionKey) {
          await clearRestrictedUserLocalState();
          clearedRestriction.current = restrictionKey;
        }
      } else {
        // Read the server-owned standing with the currently valid ID token first.
        // A serious moderation action revokes refresh tokens; forcing a refresh
        // before this read would hide the restriction/appeal shell behind a
        // generic authentication error. Active accounts can safely refresh here.
        await firebaseUser.getIdToken(true);
      }
    } catch (refreshError) {
      console.warn("[AccountStanding] refresh unavailable", {
        code: errorCode(refreshError),
      });
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [firebaseUser]);

  useEffect(() => {
    setStanding(null);
    setAcknowledgedRevision(null);
    if (authLoading) {
      setLoading(true);
      return;
    }
    void refresh();
  }, [authLoading, firebaseUser?.uid, refresh]);

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
    standing,
  }), [acknowledgedRevision, error, loading, refresh, standing]);

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
