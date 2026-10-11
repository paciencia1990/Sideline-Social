import { APPROVED_VENUE_LIGHTNING_SOURCES, type ApprovedVenueLightningSource } from '@/constants/venueLightning';
import { isValidVenueLightningUrl, resolveVenueLightningSource, type VenueLightningBinding } from '@/utils/venueLightning';

export function resolveApprovedLightningMessageUrl(
  url: string,
  sources: readonly ApprovedVenueLightningSource[] = APPROVED_VENUE_LIGHTNING_SOURCES,
): ApprovedVenueLightningSource | null {
  const matches = sources.filter((source) => source.enabled &&
    (source.environment === 'outdoor' || source.environment === 'both') &&
    isValidVenueLightningUrl(source.url) && source.url === url);
  return matches.length === 1 ? matches[0] : null;
}

export type LightningMessageSegment = { text: string; source: ApprovedVenueLightningSource | null };

// Match complete URL tokens, not substrings inside an altered address. Keep the
// announcement text intact, including punctuation and unapproved plain-text URLs.
export function getLightningMessageSegments(message: string): LightningMessageSegment[] {
  const segments: LightningMessageSegment[] = [];
  let cursor = 0;
  for (const match of message.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const url = match[0].replace(/[),.;!?]+$/, '');
    const source = resolveApprovedLightningMessageUrl(url);
    if (!source) continue;
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ text: message.slice(cursor, start), source: null });
    segments.push({ text: url, source });
    cursor = start + url.length;
  }
  if (cursor < message.length || segments.length === 0) segments.push({ text: message.slice(cursor), source: null });
  return segments;
}

export function composeWeatherDelayMessage(input: {
  templateId: string;
  binding: VenueLightningBinding;
  confirmedVenue: boolean;
  message: string;
  linkLabel: string;
  safetyNote: string;
}): string {
  const source = input.templateId === 'weather-delay' && input.confirmedVenue
    ? resolveVenueLightningSource(input.binding)
    : null;
  if (!source || getLightningMessageSegments(input.message).some((segment) => segment.source?.id === source.id)) {
    return input.message;
  }
  return `${input.message.trimEnd()}\n\n${input.linkLabel}\n${source.url}\n${input.safetyNote}`;
}
