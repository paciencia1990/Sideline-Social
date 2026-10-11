import {
  APPROVED_VENUE_LIGHTNING_SOURCES,
  type ApprovedVenueLightningSource,
} from '@/constants/venueLightning';
import { isPublicWeatherUrl } from '@/functions/src/squadWeatherCore';

export type VenueLightningBinding = {
  venueId?: string | null;
  squadId?: string | null;
};

export function isValidVenueLightningUrl(value: string): boolean {
  return isPublicWeatherUrl(value);
}

export function resolveVenueLightningSource(
  binding: VenueLightningBinding,
  sources: readonly ApprovedVenueLightningSource[] = APPROVED_VENUE_LIGHTNING_SOURCES,
): ApprovedVenueLightningSource | null {
  const squadId = binding.squadId?.trim() ?? '';
  // Field-limited legacy detail responses omit venueId. Their canonical Squad ID
  // still identifies the venue, without widening the public server projection.
  const suppliedVenueId = binding.venueId?.trim() ?? '';
  const venueId = suppliedVenueId.startsWith('legacy_') ? '' : suppliedVenueId;
  const separator = squadId.indexOf('__');
  const canonicalVenueId = separator > 0 && /^[a-z-]+$/.test(squadId.slice(separator + 2))
    ? squadId.slice(0, separator)
    : '';
  if (venueId && canonicalVenueId && venueId !== canonicalVenueId) return null;
  const matches = sources.filter((source) => source.enabled &&
    (source.environment === 'outdoor' || source.environment === 'both') &&
    isValidVenueLightningUrl(source.url) &&
    (venueId
      ? source.venueIds.includes(venueId)
      : source.squadIds.includes(squadId) ||
        Boolean(canonicalVenueId && source.venueIds.includes(canonicalVenueId))));
  // Ambiguous registry entries must not choose a facility on the user's behalf.
  return matches.length === 1 ? matches[0] : null;
}
