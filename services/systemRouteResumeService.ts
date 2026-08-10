import AsyncStorage from '@react-native-async-storage/async-storage';

const SYSTEM_ROUTE_RESUME_KEY = 'sidelineSocial.systemRouteResume';
const SYSTEM_ROUTE_RESUME_TTL_MS = 10 * 60 * 1000;

export const SQUAD_SYSTEM_RETURN_ROUTE = '/(tabs)/squad' as const;

type StoredSystemRouteResume = {
  route: typeof SQUAD_SYSTEM_RETURN_ROUTE;
  createdAt: number;
};

export async function rememberSquadSystemReturn() {
  const value: StoredSystemRouteResume = {
    route: SQUAD_SYSTEM_RETURN_ROUTE,
    createdAt: Date.now(),
  };
  await AsyncStorage.setItem(SYSTEM_ROUTE_RESUME_KEY, JSON.stringify(value));
}

export async function clearSquadSystemReturn() {
  await AsyncStorage.removeItem(SYSTEM_ROUTE_RESUME_KEY);
}

export async function consumeSystemReturnRoute(now = Date.now()) {
  const raw = await AsyncStorage.getItem(SYSTEM_ROUTE_RESUME_KEY);
  if (!raw) return null;
  await AsyncStorage.removeItem(SYSTEM_ROUTE_RESUME_KEY);
  return parseSystemReturnRoute(raw, now);
}

export function parseSystemReturnRoute(raw: string, now = Date.now()) {
  try {
    const value = JSON.parse(raw) as Partial<StoredSystemRouteResume>;
    if (
      value.route !== SQUAD_SYSTEM_RETURN_ROUTE ||
      typeof value.createdAt !== 'number' ||
      !Number.isFinite(value.createdAt) ||
      value.createdAt > now ||
      now - value.createdAt > SYSTEM_ROUTE_RESUME_TTL_MS
    ) return null;
    return SQUAD_SYSTEM_RETURN_ROUTE;
  } catch {
    return null;
  }
}
