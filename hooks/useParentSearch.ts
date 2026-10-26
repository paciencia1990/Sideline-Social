import { useEffect, useRef, useState } from "react";
import { searchParentsByName, type FriendSearchResult } from "@/services/friendsService";
import { invalidatePublicUserSearchRequests } from "@/services/publicProfileService";
import { getPublicUserSearchRetryAt, isPublicUserSearchQueryReady } from "@/utils/publicUserSearchRequests";

export const PARENT_SEARCH_DEBOUNCE_MS = 600;
type SearchState = {
  userId: string | undefined;
  results: FriendSearchResult[];
  searching: boolean;
  completed: boolean;
  error: "rate_limited" | "unavailable" | null;
  retryAtMs: number;
  canRetry: boolean;
};

function emptyState(userId: string | undefined): SearchState {
  return { userId, results: [], searching: false, completed: false, error: null, retryAtMs: 0, canRetry: true };
}

export function useParentSearch(userId: string | undefined, query: string, active: boolean, refreshVersion: number) {
  const [state, setState] = useState<SearchState>(() => emptyState(userId));
  const current = useRef({ userId, query, active });
  current.current = { userId, query, active };
  const sequence = useRef(0);
  const previousRefresh = useRef({ userId, refreshVersion });
  const pause = useRef<{ userId: string; retryAtMs: number; refreshVersion: number } | null>(null);

  useEffect(() => {
    const requestSequence = ++sequence.current;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const isCurrent = () => sequence.current === requestSequence && current.current.active &&
      current.current.userId === userId && current.current.query === query;
    if (userId && previousRefresh.current.userId === userId && previousRefresh.current.refreshVersion !== refreshVersion) {
      invalidatePublicUserSearchRequests();
    }
    previousRefresh.current = { userId, refreshVersion };
    if (pause.current?.userId !== userId) pause.current = null;
    const blocked = pause.current;
    if (blocked && Date.now() < blocked.retryAtMs) blocked.refreshVersion = refreshVersion;
    const requiresManualSearch = blocked &&
      (Date.now() < blocked.retryAtMs || refreshVersion === blocked.refreshVersion);
    setState(requiresManualSearch ? {
      ...emptyState(userId), completed: true, error: "rate_limited", retryAtMs: blocked.retryAtMs,
      canRetry: Date.now() >= blocked.retryAtMs,
    } : emptyState(userId));

    if (active && userId && isPublicUserSearchQueryReady(query) && !requiresManualSearch) {
      pause.current = null;
      timeout = setTimeout(async () => {
        if (!isCurrent()) return;
        setState({ ...emptyState(userId), searching: true });
        try {
          const results = await searchParentsByName(query);
          if (!isCurrent()) return;
          setState({ ...emptyState(userId), results, completed: true });
        } catch (error) {
          if (!isCurrent()) return;
          const retryAtMs = getPublicUserSearchRetryAt(error);
          if (retryAtMs !== null) pause.current = { userId, retryAtMs, refreshVersion };
          setState({ ...emptyState(userId), completed: true, error: retryAtMs === null ? "unavailable" : "rate_limited",
            retryAtMs: retryAtMs ?? 0, canRetry: retryAtMs === null || Date.now() >= retryAtMs });
        }
      }, PARENT_SEARCH_DEBOUNCE_MS);
    }
    return () => {
      clearTimeout(timeout);
      if (sequence.current === requestSequence) sequence.current += 1;
    };
  }, [userId, query, active, refreshVersion]);

  // Expiry only enables the button. It never resends a request automatically.
  useEffect(() => {
    if (!active || state.userId !== userId || state.error !== "rate_limited" || state.canRetry) return;
    const timeout = setTimeout(() => setState(previous => previous.userId === userId &&
      previous.error === "rate_limited" && previous.retryAtMs === state.retryAtMs
      ? { ...previous, canRetry: true } : previous), Math.max(0, state.retryAtMs - Date.now()));
    return () => clearTimeout(timeout);
  }, [active, userId, state.userId, state.error, state.retryAtMs, state.canRetry]);

  return state.userId === userId ? state : emptyState(userId);
}
