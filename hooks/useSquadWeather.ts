import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { getSquadWeather, resolveSquadWeatherSource, subscribeSquadWeather, type SquadWeatherView } from '@/services/squadWeatherService';
import type { VenueLightningBinding } from '@/utils/venueLightning';

type WeatherState = { view: SquadWeatherView | null; loading: boolean; failed: boolean; reload: () => Promise<void> };
export const SquadWeatherContext = createContext<(WeatherState & { query: string }) | null>(null);
export const squadWeatherQuery = (uid?: string | null, squadId?: string | null, teamId?: string | null) =>
  JSON.stringify([uid ?? null, squadId ?? null, teamId ?? null]);

export function useSquadWeather({ squadId, venueId, teamId }: VenueLightningBinding & { teamId?: string | null }) {
  const { user } = useAuth();
  const query = squadWeatherQuery(user?.uid, squadId, teamId);
  const shared = useContext(SquadWeatherContext);
  const inherited = shared?.query === query ? shared : null;
  const ownsRefresh = !inherited && !!squadId && !!user?.uid;
  const identity = JSON.stringify([query, venueId ?? null, ownsRefresh]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const generation = useRef(0);
  const focused = useRef(false);
  const foreground = useRef(false);
  const [state, setState] = useState<{ identity: string; generation: number; view: SquadWeatherView | null; loading: boolean; failed: boolean }>({
    identity, generation: 0, view: null, loading: false, failed: false,
  });
  const reload = useCallback(async () => {
    if (!ownsRefresh || !focused.current || !foreground.current || identity !== currentIdentity.current || !squadId || !user?.uid) return;
    const request = ++generation.current;
    // Invalidate actionable links immediately, including while refreshing a removal.
    setState({ identity, generation: request, view: null, loading: true, failed: false });
    try {
      const view = await getSquadWeather(squadId, teamId);
      if (request === generation.current && identity === currentIdentity.current && focused.current && foreground.current) {
        setState({ identity, generation: request, view, loading: false, failed: false });
      }
    } catch {
      if (request === generation.current && identity === currentIdentity.current && focused.current && foreground.current) {
        setState({ identity, generation: request, view: null, loading: false, failed: true });
      }
    }
  }, [identity, ownsRefresh, squadId, teamId, user?.uid]);
  useFocusEffect(useCallback(() => {
    if (!ownsRefresh) return;
    focused.current = true;
    foreground.current = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    const unsubscribe = subscribeSquadWeather((uid, view) => {
      if (!focused.current || !foreground.current || uid !== user?.uid || view.squadId !== squadId || currentIdentity.current !== identity) return;
      const request = ++generation.current;
      setState({ identity, generation: request, view, loading: false, failed: false });
    });
    const appState = AppState.addEventListener('change', next => {
      if (!focused.current || identity !== currentIdentity.current) return;
      const wasForeground = foreground.current;
      foreground.current = next === 'active';
      if (foreground.current === wasForeground) return;
      if (foreground.current) void reload();
      else {
        const request = ++generation.current;
        setState({ identity, generation: request, view: null, loading: false, failed: false });
      }
    });
    if (foreground.current) void reload();
    return () => {
      focused.current = false;
      foreground.current = false;
      generation.current += 1;
      unsubscribe();
      appState.remove();
    };
  }, [identity, ownsRefresh, reload, squadId, user?.uid]));
  const matching = state.identity === identity && state.generation === generation.current && focused.current && foreground.current;
  const owned = {
    view: matching ? state.view : null,
    loading: ownsRefresh && (!matching || state.loading),
    failed: matching && state.failed,
    reload,
  };
  const result = inherited ?? owned;
  return { ...result, source: resolveSquadWeatherSource(result.view, { squadId, venueId }) };
}
