export type SquadWeatherLink = {
  venueName: string;
  providerName: string;
  environment: 'outdoor' | 'both';
  url: string;
};

export function isPublicWeatherUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    // Public web pages only. Never fetch the destination on the server.
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      url.hostname.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname) &&
      !/(^|\.)(localhost|local|internal|invalid|test|example)$/i.test(url.hostname);
  } catch { return false; }
}

export function parseSquadWeatherLink(value: unknown): SquadWeatherLink | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const label = (v: unknown, limit: number) => typeof v === 'string' && !/[\u0000-\u001f\u007f]/.test(v) &&
    v.trim().length >= 2 && v.trim().length <= limit ? v.trim().replace(/\s+/g, ' ') : null;
  const venueName = label(input.venueName, 120), providerName = label(input.providerName, 80);
  if (!venueName || !providerName || !isPublicWeatherUrl(input.url) ||
    (input.environment !== 'outdoor' && input.environment !== 'both')) return null;
  return { venueName, providerName, environment: input.environment, url: input.url };
}

export function squadWeatherView(squadId: string, squad: Record<string, unknown>) {
  const revision = squad.weatherLinkRevision ?? 0;
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) throw new Error('INVALID_WEATHER_REVISION');
  const configured = Object.prototype.hasOwnProperty.call(squad, 'weatherLink');
  const link = parseSquadWeatherLink(squad.weatherLink);
  return { squadId, venueId: typeof squad.venueId === 'string' ? squad.venueId : null, revision: revision as number,
    mode: configured ? link ? 'custom' as const : 'disabled' as const : 'default' as const, link };
}
