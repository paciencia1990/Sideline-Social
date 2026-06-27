import React, { createContext, useCallback, useContext, useState, ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  AppConfig,
  CreateSquadInput,
  Squad,
  createSquad as createSquadRecord,
  fetchAppConfig,
  fetchNearbySquads,
  fetchUserSquadIds,
  joinSquad as joinSquadRecord,
  leaveSquad as leaveSquadRecord,
  updateMemberLastActive,
} from "@/services/squadService";

interface SquadContextType {
  nearbySquads: Squad[];
  mySquadIds: string[];
  currentSquad: Squad | null;
  loading: boolean;
  error: string | null;
  appConfig: AppConfig;
  fetchSquads: (lat: number, lng: number) => Promise<void>;
  joinSquad: (squadId: string) => Promise<void>;
  createSquad: (data: CreateSquadInput) => Promise<string>;
  leaveSquad: (squadId: string) => Promise<void>;
  setCurrentSquad: (squad: Squad | null) => void;
  refreshLastActive: () => Promise<void>;
}

const DEFAULT_CONFIG: AppConfig = { squadRadiusMiles: 2, maxSquadsPerUser: 10 };

const SquadContext = createContext<SquadContextType>({
  nearbySquads: [],
  mySquadIds: [],
  currentSquad: null,
  loading: false,
  error: null,
  appConfig: DEFAULT_CONFIG,
  fetchSquads: async () => {},
  joinSquad: async () => {},
  createSquad: async () => "",
  leaveSquad: async () => {},
  setCurrentSquad: () => {},
  refreshLastActive: async () => {},
});

export function SquadProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [nearbySquads, setNearbySquads] = useState<Squad[]>([]);
  const [mySquadIds, setMySquadIds] = useState<string[]>([]);
  const [currentSquad, setCurrentSquad] = useState<Squad | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig>(DEFAULT_CONFIG);

  const fetchSquads = useCallback(async (lat: number, lng: number) => {
    setLoading(true);
    setError(null);
    try {
      const config = await fetchAppConfig();
      setAppConfig(config);
      if (user?.uid) {
        setMySquadIds(await fetchUserSquadIds(user.uid));
      }
      setNearbySquads(await fetchNearbySquads(lat, lng, config.squadRadiusMiles));
    } catch (nextError) {
      console.warn("[SquadContext] fetchSquads error:", nextError);
      setError("Could not load nearby squads.");
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  const joinSquad = useCallback(async (squadId: string) => {
    if (!user?.uid) return;
    await joinSquadRecord(user.uid, squadId, mySquadIds.length === 0);
    setMySquadIds((current) => current.includes(squadId) ? current : [...current, squadId]);
  }, [mySquadIds.length, user?.uid]);

  const createSquad = useCallback(async (data: CreateSquadInput) => {
    if (!user?.uid) throw new Error("Sign in to create a squad.");
    const squadId = await createSquadRecord(data, user.uid);
    setMySquadIds((current) => current.includes(squadId) ? current : [...current, squadId]);
    return squadId;
  }, [user?.uid]);

  const leaveSquad = useCallback(async (squadId: string) => {
    if (!user?.uid) return;
    await leaveSquadRecord(user.uid, squadId);
    setMySquadIds((current) => current.filter((id) => id !== squadId));
    setNearbySquads((current) => current.map((squad) => squad.squadId === squadId
      ? { ...squad, memberIds: squad.memberIds.filter((id) => id !== user.uid) }
      : squad
    ));
  }, [user?.uid]);

  const refreshLastActive = useCallback(async () => {
    if (user?.uid) await updateMemberLastActive(user.uid);
  }, [user?.uid]);

  return (
    <SquadContext.Provider value={{
      nearbySquads,
      mySquadIds,
      currentSquad,
      loading,
      error,
      appConfig,
      fetchSquads,
      joinSquad,
      createSquad,
      leaveSquad,
      setCurrentSquad,
      refreshLastActive,
    }}>
      {children}
    </SquadContext.Provider>
  );
}

export function useSquad() {
  return useContext(SquadContext);
}