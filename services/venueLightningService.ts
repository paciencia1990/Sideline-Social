import * as WebBrowser from 'expo-web-browser';

import { Colors } from '@/constants/theme';
import { resolveVenueLightningSource, type VenueLightningBinding } from '@/utils/venueLightning';
import { resolveApprovedLightningMessageUrl } from '@/utils/weatherDelayLightning';
import type { ApprovedVenueLightningSource } from '@/constants/venueLightning';

let opening: { sourceId: string; request: Promise<void> } | null = null;

export function openVenueLightningStatus(binding: VenueLightningBinding): Promise<void> {
  // Resolve again at the launch boundary; callers cannot supply an arbitrary URL.
  const source = resolveVenueLightningSource(binding);
  if (!source) return Promise.reject(new Error('VENUE_LIGHTNING_UNAVAILABLE'));
  return openSource(source);
}

export function openApprovedLightningMessageUrl(url: string): Promise<void> {
  const source = resolveApprovedLightningMessageUrl(url);
  if (!source) return Promise.reject(new Error('VENUE_LIGHTNING_UNAVAILABLE'));
  return openSource(source);
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
