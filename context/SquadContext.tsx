import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  Squad,
  CreateSquadInput,
  AppConfig,
  fetchAppConfig,
  fetchNearbySquads,
  joinSquad as serviceJoinSquad,
  createSquad as serviceCreateSquad,
  leaveSquad as serviceLeaveSquad,
  updateMemberLastActive,
} from '@/services/squadService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  createSquad: async () => '',
  leaveSquad: async () => {},
  setCurrentSquad: () => {},
  refreshLastActive: async () => {},
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function SquadProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const [nearbySquads, setNearbySquads] = useState<Squad[]>([]);
  const [mySquadIds, setMySquadIds] = useState<string[]>([]);
  const [currentSquad, setCurrentSquad] = useState<Squad | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Load appConfig once on first fetch
  const ensureConfig = useCallback(async (): Promise<AppConfig> => {
    if (configLoaded) return appConfig;
    const config = await fetchAppConfig();
    setAppConfig(config);
    setConfigLoaded(true);
    return config;
  }, [configLoaded, appConfig]);

  // Load user's existing squad IDs from Firestore
  const loadMySquadIds = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const firestore = (await import('@react-native-firebase/firestore')).default;
      const doc = await firestore().collection('users').doc(user.uid).get();
      if (doc.exists) {
        const data = doc.data();
        setMySquadIds(data?.squadIds ?? []);
      }
    } catch (err) {
      console.warn('[SquadContext] loadMySquadIds error:', err);
    }
  }, [user?.uid]);

  const fetchSquads = useCallback(
    async (lat: number, lng: number) => {
      setLoading(true);
      setError(null);
      try {
        const config = await ensureConfig();
        await loadMySquadIds();
        const squads = await fetchNearbySquads(lat, lng, config.squadRadiusMiles);
        setNearbySquads(squads);
      } catch (err) {
        console.warn('[SquadContext] fetchSquads error:', err);
        setError('Could not load nearby squads.');
      } finally {
        setLoading(false);
      }
    },
    [ensureConfig, loadMySquadIds]
  );

  const joinSquad = useCallback(
    async (squadId: string) => {
      if (!user?.uid) return;
      const isFirstSquadEver = mySquadIds.length === 0;
      await serviceJoinSquad(user.uid, squadId, isFirstSquadEver);
      setMySquadIds((prev) => (prev.includes(squadId) ? prev : [...prev, squadId]));
    },
    [user?.uid, mySquadIds]
  );

  const createSquad = useCallback(
    async (data: CreateSquadInput): Promise<string> => {
      if (!user?.uid) throw new Error('Not authenticated');
      const squadId = await serviceCreateSquad(data, user.uid);
      setMySquadIds((prev) => [...prev, squadId]);
      return squadId;
    },
    [user?.uid]
  );

  const leaveSquad = useCallback(
    async (squadId: string) => {
      if (!user?.uid) return;
      await serviceLeaveSquad(user.uid, squadId);
      setMySquadIds((prev) => prev.filter((id) => id !== squadId));
      setNearbySquads((prev) =>
        prev.map((s) =>
          s.squadId === squadId
            ? { ...s, memberIds: s.memberIds.filter((id) => id !== user.uid) }
            : s
        )
      );
    },
    [user?.uid]
  );

  const refreshLastActive = useCallback(async () => {
    if (!user?.uid) return;
    await updateMemberLastActive(user.uid);
  }, [user?.uid]);

  return (
    <SquadContext.Provider
      value={{
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
      }}
    >
      {children}
    </SquadContext.Provider>
  );
}

export function useSquad() {
  return useContext(SquadContext);
}