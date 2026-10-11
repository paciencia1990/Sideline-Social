import * as WebBrowser from 'expo-web-browser';

import { Colors } from '@/constants/theme';
import { resolveVenueLightningSource, type VenueLightningBinding } from '@/utils/venueLightning';
import { resolveApprovedLightningMessageUrl } from '@/utils/weatherDelayLightning';
import type { ApprovedVenueLightningSource } from '@/constants/venueLightning';
import { isPublicWeatherUrl } from '@/functions/src/squadWeatherCore';

let opening: { sourceId: string; request: Promise<void> } | null = null;

export function openVenueLightningStatus(binding: VenueLightningBinding, savedSource?: ApprovedVenueLightningSource): Promise<void> {
  // Resolve again at launch using the exact Squad-bound server projection or
  // the owner registry. Never turn a message's arbitrary URL into a weather link.
  const matchesBinding = savedSource && (savedSource.squadIds.includes(binding.squadId ?? '') ||
    resolveVenueLightningSource(binding, [savedSource]));
  const source = savedSource
    ? matchesBinding ? resolveApprovedLightningMessageUrl(savedSource.url, [savedSource]) : null
    : resolveVenueLightningSource(binding);
  if (!source) return Promise.reject(new Error('VENUE_LIGHTNING_UNAVAILABLE'));
  return openSource(source);
}

export function openApprovedLightningMessageUrl(url: string, sources?: readonly ApprovedVenueLightningSource[]): Promise<void> {
  const source = resolveApprovedLightningMessageUrl(url, sources);
  if (!source) return Promise.reject(new Error('VENUE_LIGHTNING_UNAVAILABLE'));
  return openSource(source);
}

export function openSquadWeatherPreview(url: string): Promise<void> {
  if (!isPublicWeatherUrl(url)) return Promise.reject(new Error('VENUE_LIGHTNING_UNAVAILABLE'));
  return openSource({ id: `preview:${url}`, url, enabled: true, environment: 'outdoor', venueName: '', providerName: '', venueIds: [], squadIds: [] });
}

function openSource(source: ApprovedVenueLightningSource): Promise<void> {
  if (opening) return opening.sourceId === source.id
    ? opening.request
    : Promise.reject(new Error('VENUE_LIGHTNING_BROWSER_BUSY'));
  const request = Promise.resolve().then(async () => {
    const result = await WebBrowser.openBrowserAsync(source.url, {
      toolbarColor: Colors.surface,
      controlsColor: Colors.primary,
      showTitle: true,
      dismissButtonStyle: 'close',
      enableBarCollapsing: false,
      createTask: false,
    });
    if (result.type === WebBrowser.WebBrowserResultType.LOCKED) {
      throw new Error('VENUE_LIGHTNING_BROWSER_BUSY');
    }
  });
  opening = { sourceId: source.id, request };
  // Observe both outcomes without leaving a rejected cleanup promise unhandled.
  void request.then(
    () => { if (opening?.request === request) opening = null; },
    () => { if (opening?.request === request) opening = null; },
  );
  return request;
}
