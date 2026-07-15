import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/context/AuthContext";
import {
  type AppConfig,
  type CreateSquadInput,
  type FindOrCreateSquadResult,
  type Squad,
  fetchAppConfig,
  fetchNearbySquads,
  fetchSquadsByIds,
  fetchUserSquadState,
  findOrCreateSquad,
  joinSquad as joinSquadRecord,
  leaveSquad as leaveSquadRecord,
  persistSelectedSquad,
  searchVenueSquads,
  updateMemberLastActive,
} from "@/services/squadService";

interface SquadContextType {
  nearbySquads: Squad[];
  mySquadIds: string[];
  mySquads: Squad[];
  selectedSquadId: string | null;
  currentSquad: Squad | null;
  loading: boolean;
  membershipLoading: boolean;
  error: string | null;
  appConfig: AppConfig;
  fetchSquads: (lat: number, lng: number, radiusMiles?: number) => Promise<void>;
  searchSquads: (queryText: string) => Promise<void>;
  joinSquad: (squadId: string) => Promise<void>;
  createSquad: (data: CreateSquadInput) => Promise<FindOrCreateSquadResult>;
  leaveSquad: (squadId: string) => Promise<void>;
  selectSquad: (squadId: string | null) => Promise<void>;
  reloadMemberships: () => Promise<void>;
  refreshLastActive: () => Promise<void>;
}

const DEFAULT_CONFIG: AppConfig = { squadRadiusMiles: 2, maxSquadsPerUser: 10 };

const SquadContext = createContext<SquadContextType>({
  nearbySquads: [],
  mySquadIds: [],
  mySquads: [],
  selectedSquadId: null,
  currentSquad: null,
  loading: false,
  membershipLoading: true,
  error: null,
  appConfig: DEFAULT_CONFIG,
  fetchSquads: async () => {},
  searchSquads: async () => {},
  joinSquad: async () => {},
  createSquad: async () => ({ squadId: "", status: "created" }),
  leaveSquad: async () => {},
  selectSquad: async () => {},
  reloadMemberships: async () => {},
  refreshLastActive: async () => {},
});

export function SquadProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [nearbySquads, setNearbySquads] = useState<Squad[]>([]);
  const [mySquadIds, setMySquadIds] = useState<string[]>([]);
  const [mySquads, setMySquads] = useState<Squad[]>([]);
  const [selectedSquadId, setSelectedSquadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [membershipLoading, setMembershipLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const activeUserId = useRef(user?.uid);
  const membershipRequestId = useRef(0);

  const reloadMemberships = useCallback(async () => {
    const requestUserId = user?.uid;
    const requestId = ++membershipRequestId.current;
    if (!requestUserId) {
      setMySquadIds([]);
      setMySquads([]);
      setSelectedSquadId(null);
      setMembershipLoading(false);
      return;
    }

    setMembershipLoading(true);
    try {
      const state = await fetchUserSquadState(requestUserId);
      const squads = await fetchSquadsByIds(state.squadIds);
      if (activeUserId.current !== requestUserId || requestId !== membershipRequestId.current) return;

      const validIds = squads.map((squad) => squad.squadId);
      let nextSelected = state.selectedSquadId && validIds.includes(state.selectedSquadId)
        ? state.selectedSquadId
        : validIds[0] ?? null;

      setMySquadIds(validIds);
      setMySquads(squads);
      setSelectedSquadId(nextSelected);

      if (nextSelected !== state.selectedSquadId) {
        try {
          await persistSelectedSquad(requestUserId, nextSelected);
        } catch (selectionError) {
          logContextDiagnostic("repair-selection", selectionError);
        }
      }
    } catch (nextError) {
      if (activeUserId.current === requestUserId) {
        logContextDiagnostic("load-memberships", nextError);
        setMySquadIds([]);
        setMySquads([]);
        setSelectedSquadId(null);
      }
    } finally {
      if (activeUserId.current === requestUserId && requestId === membershipRequestId.current) {
        setMembershipLoading(false);
      }
    }
  }, [user?.uid]);

  useEffect(() => {
    activeUserId.current = user?.uid;
    membershipRequestId.current += 1;
    setNearbySquads([]);
    setError(null);
    void reloadMemberships();
  }, [reloadMemberships, user?.uid]);

  useEffect(() => {
    void fetchAppConfig().then(setAppConfig);
  }, []);

  const fetchSquads = useCallback(async (lat: number, lng: number, radiusMiles?: number) => {
    setLoading(true);
    setError(null);
    try {
      const results = await fetchNearbySquads(lat, lng, radiusMiles ?? appConfig.squadRadiusMiles);
      setNearbySquads(results);
    } catch (nextError) {
      logContextDiagnostic("nearby-search", nextError);
      setNearbySquads([]);
      setError("nearby_load_failed");
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, [appConfig.squadRadiusMiles]);

  const searchSquads = useCallback(async (queryText: string) => {
    setLoading(true);
    setError(null);
    try {
      setNearbySquads(await searchVenueSquads(queryText));
    } catch (nextError) {
      logContextDiagnostic("venue-search", nextError);
      setNearbySquads([]);
      setError("nearby_load_failed");
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, []);

  const joinSquad = useCallback(async (squadId: string) => {
    if (!user?.uid) throw new Error("auth_required");
    await joinSquadRecord(squadId);
    await reloadMemberships();
  }, [reloadMemberships, user?.uid]);

  const createSquad = useCallback(async (data: CreateSquadInput) => {
    if (!user?.uid) throw new Error("auth_required");
    return findOrCreateSquad(data);
  }, [user?.uid]);

  const leaveSquad = useCallback(async (squadId: string) => {
    if (!user?.uid) throw new Error("auth_required");
    await leaveSquadRecord(squadId);
    await reloadMemberships();
  }, [reloadMemberships, user?.uid]);

  const selectSquad = useCallback(async (squadId: string | null) => {
    if (!user?.uid) return;
    if (squadId && !mySquadIds.includes(squadId)) throw new Error("invalid_selection");
    const previous = selectedSquadId;
    setSelectedSquadId(squadId);
    try {
      await persistSelectedSquad(user.uid, squadId);
    } catch (nextError) {
      setSelectedSquadId(previous);
      throw nextError;
    }
  }, [mySquadIds, selectedSquadId, user?.uid]);

  const refreshLastActive = useCallback(async () => {
    if (user?.uid && mySquadIds.length > 0) await updateMemberLastActive();
  }, [mySquadIds.length, user?.uid]);

  const currentSquad = useMemo(
    () => mySquads.find((squad) => squad.squadId === selectedSquadId) ?? null,
    [mySquads, selectedSquadId],
  );

  return (
    <SquadContext.Provider value={{
      nearbySquads,
      mySquadIds,
      mySquads,
      selectedSquadId,
      currentSquad,
      loading,
      membershipLoading,
      error,
      appConfig,
      fetchSquads,
      searchSquads,
      joinSquad,
      createSquad,
      leaveSquad,
      selectSquad,
      reloadMemberships,
      refreshLastActive,
    }}>
      {children}
    </SquadContext.Provider>
  );
}

export function useSquad() {
  return useContext(SquadContext);
}

function logContextDiagnostic(operation: string, error: unknown) {
  if (!__DEV__) return;
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  console.info("[SquadContext]", { operation, code });
}
