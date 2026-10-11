import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useCoalescedRefresh } from "@/hooks/useCoalescedRefresh";
import { useFocusedGameRefresh } from "@/hooks/useFocusedGameRefresh";
import { listGameLobbies, readGameJoinCodeFailureReason, type GameJoinCodeFailureReason,
  type GameJoinCodeType, type GameLobbyDirectoryResult } from "@/services/gameJoinCodeService";
import { measureDevelopmentPerformance } from "@/utils/performanceDiagnostics";

type LobbyDirectoryState = "idle" | "loading" | "ready" | "permission-error" | "network-error";
type Input = { enabled: boolean; squadId: string | null; gameType?: GameJoinCodeType | null };

export function useSquadGameLobbies({ enabled, squadId, gameType }: Input) {
  const { user, firebaseUser } = useAuth();
  const uid = firebaseUser?.uid ?? user?.uid;
  const active = Boolean(enabled && uid && squadId);
  const scope = JSON.stringify([active, uid, squadId, gameType ?? null]);
  const [result, setResult] = useState<{ scope: string; directory: GameLobbyDirectoryResult } | null>(null);
  const [phase, setPhase] = useState<{ scope: string; state: LobbyDirectoryState; reason: GameJoinCodeFailureReason | null } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const runRefresh = useCoalescedRefresh(scope, {
    load: async (background: boolean) => {
      if (!background && result?.scope === scope) setRefreshing(true);
      return active && squadId ? measureDevelopmentPerformance("games.lobby-directory", () => listGameLobbies({ squadId, ...(gameType ? { gameType } : {}) })) : null;
    },
    merge: (a, b) => a && b,
    onStart: () => setPhase({ scope, state: result?.scope === scope ? "ready" : "loading", reason: null }),
    onSuccess: (directory) => {
      setResult(directory ? { scope, directory } : null);
      setPhase({ scope, state: directory ? "ready" : "idle", reason: null });
    },
    onError: (error) => {
      const reason = readGameJoinCodeFailureReason(error);
      if (reason === "not_authorized") setResult(null);
      setPhase({ scope, state: reason === "not_authorized" ? "permission-error" : "network-error", reason });
    },
    onSettled: () => setRefreshing(false),
  });
  const refresh = useCallback((background = false, invalidate = true) => runRefresh(background, invalidate), [runRefresh]);
  const focusedRefresh = useCallback((background: boolean) => refresh(background, false), [refresh]);
  useFocusedGameRefresh(active, focusedRefresh);
  useEffect(() => { if (!active) { setResult(null); setPhase(null); setRefreshing(false); } }, [active, scope]);
  const directory = active && result?.scope === scope ? result.directory : null;
  const state = !active ? "idle" : phase?.scope === scope ? phase.state : "loading";
  return { directory, failureReason: active && phase?.scope === scope ? phase.reason : null,
    lobbies: directory?.lobbies ?? [], refresh, refreshing, state };
}
export type { LobbyDirectoryState };
