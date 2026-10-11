import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { getSquadWeather, resolveSquadWeatherSource, subscribeSquadWeather, type SquadWeatherView } from '@/services/squadWeatherService';
import type { VenueLightningBinding } from '@/utils/venueLightning';

export function useSquadWeather({ squadId, venueId, teamId }: VenueLightningBinding & { teamId?: string | null }) {
  const { user } = useAuth();
  const identity = JSON.stringify([user?.uid, squadId, venueId, teamId]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const generation = useRef(0);
  const [state, setState] = useState<{ identity: string; view: SquadWeatherView | null; loading: boolean; failed: boolean }>({ identity, view: null, loading: false, failed: false });
  const reload = useCallback(async () => {
    const request = ++generation.current;
    if (!squadId || !user?.uid) { setState({ identity, view: null, loading: false, failed: false }); return; }
    // Hide stale links until fresh venue settings arrive, including removals.
    setState({ identity, view: null, loading: true, failed: false });
    try {
      const view = await getSquadWeather(squadId, teamId);
      if (request === generation.current && identity === currentIdentity.current) setState({ identity, view, loading: false, failed: false });
    } catch {
      if (request === generation.current && identity === currentIdentity.current) setState({ identity, view: null, loading: false, failed: true });
    }
  }, [identity, squadId, teamId, user?.uid]);
  useFocusEffect(useCallback(() => { void reload(); return () => { generation.current += 1; }; }, [reload]));
  useEffect(() => {
    const unsubscribe = subscribeSquadWeather((uid, view) => {
      if (uid !== user?.uid || view.squadId !== squadId || currentIdentity.current !== identity) return;
      generation.current += 1;
      setState({ identity, view, loading: false, failed: false });
    });
    const appState = AppState.addEventListener('change', next => { if (next === 'active') void reload(); });
    return () => { unsubscribe(); appState.remove(); };
  }, [identity, reload, squadId, user?.uid]);
  const matching = state.identity === identity;
  const view = matching ? state.view : null;
  return { view, source: resolveSquadWeatherSource(view, { squadId, venueId }), loading: !matching || state.loading, failed: matching && state.failed, reload };
}
