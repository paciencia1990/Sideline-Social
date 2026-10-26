import React, { useMemo, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { SquadWeatherContext, squadWeatherQuery, useSquadWeather } from '@/hooks/useSquadWeather';
import type { VenueLightningBinding } from '@/utils/venueLightning';

export function SquadWeatherProvider({ children, ...binding }: VenueLightningBinding & { teamId?: string | null; children: ReactNode }) {
  const { user } = useAuth();
  const { view, loading, failed, reload } = useSquadWeather(binding);
  const query = squadWeatherQuery(user?.uid, binding.squadId, binding.teamId);
  const value = useMemo(() => ({ query, view, loading, failed, reload }), [query, view, loading, failed, reload]);
  return <SquadWeatherContext.Provider value={value}>{children}</SquadWeatherContext.Provider>;
}
