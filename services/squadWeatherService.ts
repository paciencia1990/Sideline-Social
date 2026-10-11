import { httpsCallable } from 'firebase/functions';
import { auth, firebaseAppCheckReady, functions } from '@/config/firebase';
import { parseSquadWeatherLink, type SquadWeatherLink } from '@/functions/src/squadWeatherCore';
import { resolveVenueLightningSource, type VenueLightningBinding } from '@/utils/venueLightning';
import type { ApprovedVenueLightningSource } from '@/constants/venueLightning';

export type { SquadWeatherLink } from '@/functions/src/squadWeatherCore';
export type SquadWeatherView = {
  squadId: string;
  venueId: string | null;
  revision: number;
  mode: 'default' | 'custom' | 'disabled';
  link: SquadWeatherLink | null;
};
const pendingReads = new Map<string, Promise<SquadWeatherView>>();
const listeners = new Set<(uid: string, view: SquadWeatherView) => void>();
export function subscribeSquadWeather(listener: (uid: string, view: SquadWeatherView) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function validateView(view: SquadWeatherView, squadId: string): SquadWeatherView {
  if (!view || view.squadId !== squadId || !Number.isSafeInteger(view.revision) || view.revision < 0 ||
    (view.venueId !== null && typeof view.venueId !== 'string') || !['default', 'custom', 'disabled'].includes(view.mode) ||
    (view.mode === 'custom' ? !parseSquadWeatherLink(view.link) : view.link !== null)) throw Error('Unconfirmed venue settings');
  return { ...view, link: view.mode === 'custom' ? parseSquadWeatherLink(view.link) : null };
}
export async function getSquadWeather(squadId: string, teamId?: string | null): Promise<SquadWeatherView> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw Error('Sign-in required');
  const key = JSON.stringify([uid, squadId, teamId ?? null]);
  const existing = pendingReads.get(key);
  if (existing) return existing;
  const read = (async () => {
    await firebaseAppCheckReady;
    if (auth.currentUser?.uid !== uid) throw Error('Account changed');
    const callable = httpsCallable<{ squadId: string; teamId?: string }, SquadWeatherView>(functions, 'getSquadWeather', { timeout: 25_000 });
    const result = validateView((await callable({ squadId, ...(teamId ? { teamId } : {}) })).data, squadId);
    if (auth.currentUser?.uid !== uid) throw Error('Account changed');
    return result;
  })();
  pendingReads.set(key, read);
  void read.then(() => { if (pendingReads.get(key) === read) pendingReads.delete(key); },
    () => { if (pendingReads.get(key) === read) pendingReads.delete(key); });
  return read;
}
export async function updateSquadWeather(squadId: string, link: SquadWeatherLink | null, expectedRevision: number, confirmedVenue: boolean): Promise<SquadWeatherView> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw Error('Sign-in required');
  const normalized = link === null ? null : parseSquadWeatherLink(link);
  if (link !== null && (!normalized || !confirmedVenue)) throw Error('Invalid venue link');
  await firebaseAppCheckReady;
  if (auth.currentUser?.uid !== uid) throw Error('Account changed');
  const callable = httpsCallable<{ squadId: string; link: SquadWeatherLink | null; expectedRevision: number; confirmedVenue: boolean }, SquadWeatherView>(functions, 'updateSquadWeather', { timeout: 25_000 });
  const result = validateView((await callable({ squadId, link: normalized, expectedRevision, confirmedVenue })).data, squadId);
  if (auth.currentUser?.uid !== uid || result.revision < expectedRevision || result.revision > expectedRevision + 1 ||
    result.mode !== (normalized ? 'custom' : 'disabled') || JSON.stringify(result.link) !== JSON.stringify(normalized)) throw Error('Unconfirmed venue update');
  for (const key of pendingReads.keys()) {
    const [readUid, readSquad] = JSON.parse(key);
    if (readUid === uid && readSquad === squadId) pendingReads.delete(key);
  }
  listeners.forEach(listener => listener(uid, result));
  return result;
}
export function resolveSquadWeatherSource(view: SquadWeatherView | null, binding: VenueLightningBinding): ApprovedVenueLightningSource | null {
  if (!view || view.squadId !== binding.squadId || (binding.venueId && !binding.venueId.startsWith('legacy_') && view.venueId && binding.venueId !== view.venueId)) return null;
  if (view.mode === 'default') return resolveVenueLightningSource({ squadId: view.squadId, venueId: view.venueId ?? binding.venueId });
  const link = view.mode === 'custom' ? parseSquadWeatherLink(view.link) : null;
  return link ? { ...link, id: `squad-weather:${view.squadId}:${view.revision}`, enabled: true, venueIds: [], squadIds: [view.squadId] } : null;
}
