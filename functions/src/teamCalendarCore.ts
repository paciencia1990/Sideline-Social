import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export const MAX_ICS_BYTES = 512 * 1024;
export const MAX_ICS_EVENTS = 200;
export const MAX_FEED_URL_LENGTH = 2048;

export type ExternalCalendarEvent = {
  key: string;
  uid: string;
  recurrenceId: string | null;
  title: string;
  startAtMillis: number;
  endAtMillis: number;
  timezone: string;
  isAllDay: boolean;
  location: string | null;
  description: string | null;
  status: 'scheduled' | 'cancelled';
  sequence: number;
  lastModifiedMillis: number | null;
  sourceHash: string;
  type: 'game' | 'practice' | 'teamEvent';
};

export type ParsedCalendar = {
  events: ExternalCalendarEvent[];
  rejectedCount: number;
  warnings: string[];
};

type Property = { name: string; params: Record<string, string>; value: string };
type ParsedDate = {
  millis: number;
  timezone: string;
  allDay: boolean;
  localDate: string;
  localTime: string;
  canonical: string;
};

type RawEvent = {
  uid: string;
  recurrenceId: string | null;
  start: ParsedDate;
  end: ParsedDate;
  title: string;
  location: string | null;
  description: string | null;
  status: 'scheduled' | 'cancelled';
  sequence: number;
  lastModifiedMillis: number | null;
  rrule: string | null;
  rdates: ParsedDate[];
  exdates: Set<string>;
};

export function parseTeamCalendarIcs(text: string): ParsedCalendar {
  if (Buffer.byteLength(text, 'utf8') > MAX_ICS_BYTES) throw calendarCoreError('ics_file_too_large');
  if (/\u0000/u.test(text) || !/BEGIN:VCALENDAR/i.test(text)) throw calendarCoreError('ics_invalid_calendar');
  const lines = unfoldLines(text);
  const blocks: Property[][] = [];
  let current: Property[] | null = null;
  for (const line of lines) {
    if (line.toUpperCase() === 'BEGIN:VEVENT') {
      if (current) throw calendarCoreError('ics_invalid_calendar');
      current = [];
      continue;
    }
    if (line.toUpperCase() === 'END:VEVENT') {
      if (!current) throw calendarCoreError('ics_invalid_calendar');
      blocks.push(current);
      current = null;
      if (blocks.length > MAX_ICS_EVENTS * 3) throw calendarCoreError('ics_event_limit');
      continue;
    }
    if (current) {
      const property = parseProperty(line);
      if (property) current.push(property);
    }
  }
  if (current) throw calendarCoreError('ics_invalid_calendar');

  const warnings = new Set<string>();
  let rejectedCount = 0;
  const raw: RawEvent[] = [];
  for (const block of blocks) {
    try {
      raw.push(normalizeEventBlock(block));
    } catch (error) {
      rejectedCount += 1;
      warnings.add(safeReason(error));
    }
  }

  const overrides = new Map<string, RawEvent>();
  const masters = new Map<string, RawEvent>();
  raw.forEach((event) => {
    const destination = event.recurrenceId ? overrides : masters;
    const key = event.recurrenceId ? `${event.uid}|${event.recurrenceId}` : event.uid;
    const existing = destination.get(key);
    if (!existing || compareVersion(event, existing) > 0) destination.set(key, event);
    else rejectedCount += 1;
  });

  const expanded: RawEvent[] = [];
  masters.forEach((master) => {
    try {
      const occurrences = expandRecurringEvent(master);
      occurrences.forEach((occurrence) => {
        const override = occurrence.recurrenceId
          ? overrides.get(`${occurrence.uid}|${occurrence.recurrenceId}`)
          : undefined;
        expanded.push(override ?? occurrence);
        if (override) overrides.delete(`${occurrence.uid}|${occurrence.recurrenceId}`);
      });
    }
    catch (error) {
      rejectedCount += 1;
      warnings.add(safeReason(error));
    }
  });
  overrides.forEach((override) => expanded.push(override));
  if (expanded.length > MAX_ICS_EVENTS) throw calendarCoreError('ics_event_limit');

  const byKey = new Map<string, ExternalCalendarEvent>();
  expanded.forEach((event) => {
    const normalized = externalEvent(event);
    const existing = byKey.get(normalized.key);
    if (!existing || normalized.sequence > existing.sequence) byKey.set(normalized.key, normalized);
    else rejectedCount += 1;
  });
  return {
    events: Array.from(byKey.values()).sort((a, b) => a.startAtMillis - b.startAtMillis || a.key.localeCompare(b.key)),
    rejectedCount,
    warnings: Array.from(warnings),
  };
}

export function normalizeCalendarFeedUrl(input: unknown) {
  if (typeof input !== 'string') throw calendarCoreError('feed_url_invalid');
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_FEED_URL_LENGTH) throw calendarCoreError('feed_url_invalid');
  const httpsValue = /^webcal:\/\//iu.test(trimmed) ? `https://${trimmed.slice('webcal://'.length)}` : trimmed;
  let url: URL;
  try {
    url = new URL(httpsValue);
  } catch {
    throw calendarCoreError('feed_url_invalid');
  }
  if (url.protocol !== 'https:') throw calendarCoreError('feed_https_required');
  if (url.username || url.password) throw calendarCoreError('feed_embedded_credentials');
  if (url.port && url.port !== '443') throw calendarCoreError('feed_port_unsupported');
  if (url.hash) throw calendarCoreError('feed_fragment_unsupported');
  const hostname = url.hostname.toLocaleLowerCase('en-US').replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
  if (!hostname || hostname.length > 253 || url.href.length > MAX_FEED_URL_LENGTH) throw calendarCoreError('feed_url_invalid');
  return {
    url,
    hostname,
    fingerprint: createHash('sha256').update(url.href).digest('hex'),
  };
}

export function isBlockedCalendarHostname(hostname: string) {
  const normalized = hostname.trim().toLocaleLowerCase('en-US').replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
  if (!normalized) return true;
  if (isIP(normalized)) return isBlockedCalendarAddress(normalized);
  if (!normalized.includes('.')) return true;
  return normalized === 'metadata.google.internal' ||
    normalized === 'metadata.azure.internal' ||
    normalized === 'instance-data.ec2.internal' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.home.arpa') ||
    normalized.endsWith('.onion') ||
    normalized.endsWith('.invalid') ||
    normalized.endsWith('.test') ||
    normalized.endsWith('.example');
}

export function isBlockedCalendarAddress(address: string) {
  const normalized = address.trim().toLocaleLowerCase('en-US').replace(/^\[|\]$/gu, '');
  if (!normalized) return true;
  const version = isIP(normalized);
  if (version === 4) {
    const parts = normalized.split('.').map(Number);
    const [a, b, c] = parts;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113);
  }
  if (version === 6) {
    const words = ipv6Words(normalized);
    if (!words) return true;
    const allZero = words.every((word) => word === 0);
    const loopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
    const mappedIpv4 = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
    if (mappedIpv4) {
      return isBlockedCalendarAddress(`${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`);
    }
    return allZero || loopback ||
      (words[0] & 0xfe00) === 0xfc00 ||
      (words[0] & 0xffc0) === 0xfe80 ||
      (words[0] & 0xffc0) === 0xfec0 ||
      (words[0] & 0xff00) === 0xff00 ||
      (words[0] === 0x0064 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0)) ||
      (words[0] === 0x0100 && words.slice(1, 4).every((word) => word === 0)) ||
      (words[0] === 0x2001 && (words[1] === 0 || words[1] === 2 || words[1] === 0x0db8 ||
        (words[1] & 0xfff0) === 0x0010 || (words[1] & 0xfff0) === 0x0020)) ||
      words[0] === 0x2002;
  }
  return true;
}

export function serializeTeamScheduleIcs(input: {
  calendarName: string;
  events: Array<{
    id: string;
    title: string;
    startAtMillis: number;
    endAtMillis: number;
    timezone: string;
    isAllDay: boolean;
    location?: string | null;
    notes?: string | null;
    status?: string;
    revision?: number;
    updatedAtMillis?: number | null;
  }>;
  domain: string;
}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sideline Social//Team Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(input.calendarName)}`,
  ];
  input.events.forEach((event) => {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeIcs(`${event.id}@${input.domain}`)}`);
    lines.push(`DTSTAMP:${utcIcs(event.updatedAtMillis ?? Date.now())}`);
    lines.push(`SEQUENCE:${Math.max(0, Number(event.revision) || 0)}`);
    if (event.isAllDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateInZone(event.startAtMillis, event.timezone).replace(/-/gu, '')}`);
      lines.push(`DTEND;VALUE=DATE:${dateInZone(event.endAtMillis, event.timezone).replace(/-/gu, '')}`);
    } else {
      lines.push(`DTSTART:${utcIcs(event.startAtMillis)}`);
      lines.push(`DTEND:${utcIcs(event.endAtMillis)}`);
    }
    lines.push(`SUMMARY:${escapeIcs(event.title)}`);
    if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
    if (event.notes) lines.push(`DESCRIPTION:${escapeIcs(event.notes)}`);
    if (event.status === 'cancelled') lines.push('STATUS:CANCELLED');
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

function normalizeEventBlock(properties: Property[]): RawEvent {
  const uid = cleanText(first(properties, 'UID')?.value ?? '', 512);
  const startProperty = first(properties, 'DTSTART');
  if (!uid || !startProperty) throw calendarCoreError('ics_event_missing_required');
  const start = parseIcsDate(startProperty);
  const dtend = first(properties, 'DTEND');
  const duration = first(properties, 'DURATION')?.value;
  const end = dtend ? parseIcsDate(dtend) : duration
    ? { ...start, millis: start.millis + parseDuration(duration) }
    : { ...start, millis: start.millis + (start.allDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000) };
  if (end.millis <= start.millis) throw calendarCoreError('ics_invalid_date');
  const recurrenceProperty = first(properties, 'RECURRENCE-ID');
  const recurrence = recurrenceProperty ? parseIcsDate(recurrenceProperty) : null;
  const title = cleanText(unescapeIcs(first(properties, 'SUMMARY')?.value ?? ''), 120) || 'Team event';
  const location = cleanText(unescapeIcs(first(properties, 'LOCATION')?.value ?? ''), 480);
  const description = cleanText(unescapeIcs(first(properties, 'DESCRIPTION')?.value ?? ''), 2000);
  const status = first(properties, 'STATUS')?.value.toUpperCase() === 'CANCELLED' ? 'cancelled' : 'scheduled';
  const sequenceValue = Number.parseInt(first(properties, 'SEQUENCE')?.value ?? '0', 10);
  const lastModifiedProperty = first(properties, 'LAST-MODIFIED');
  const rdates = all(properties, 'RDATE').flatMap((property) => property.value.split(',').map((value) => parseIcsDate({ ...property, value })));
  const exdates = new Set(all(properties, 'EXDATE').flatMap((property) => property.value.split(',').map((value) => parseIcsDate({ ...property, value }).canonical)));
  return {
    uid,
    recurrenceId: recurrence?.canonical ?? null,
    start,
    end,
    title,
    location,
    description,
    status,
    sequence: Number.isInteger(sequenceValue) && sequenceValue >= 0 ? sequenceValue : 0,
    lastModifiedMillis: lastModifiedProperty ? parseIcsDate(lastModifiedProperty).millis : null,
    rrule: cleanText(first(properties, 'RRULE')?.value ?? '', 1024),
    rdates,
    exdates,
  };
}

function expandRecurringEvent(master: RawEvent) {
  if (!master.rrule && master.rdates.length === 0) return [master];
  const duration = master.end.millis - master.start.millis;
  const occurrences = new Map<string, RawEvent>();
  const addOccurrence = (start: ParsedDate) => {
    if (master.exdates.has(start.canonical)) return;
    occurrences.set(start.canonical, {
      ...master,
      recurrenceId: start.canonical,
      start,
      end: { ...start, millis: start.millis + duration },
      rrule: null,
      rdates: [],
      exdates: new Set(),
    });
  };
  addOccurrence(master.start);
  master.rdates.forEach(addOccurrence);
  if (master.rrule) {
    const rule = Object.fromEntries(master.rrule.split(';').map((part) => {
      const [key, ...rest] = part.split('=');
      return [key?.toUpperCase(), rest.join('=')];
    }));
    const supportedParts = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'WKST']);
    if (Object.keys(rule).some((key) => !supportedParts.has(key))) throw calendarCoreError('ics_recurrence_unsupported');
    const frequency = rule.FREQ?.toUpperCase();
    if (frequency !== 'DAILY' && frequency !== 'WEEKLY') throw calendarCoreError('ics_recurrence_unsupported');
    const interval = strictBoundedInteger(rule.INTERVAL, 1, 52, 1);
    const count = strictBoundedInteger(rule.COUNT, 1, MAX_ICS_EVENTS, MAX_ICS_EVENTS);
    const until = rule.UNTIL ? parseIcsDate({ name: 'UNTIL', params: {}, value: rule.UNTIL }).millis : master.start.millis + 366 * 2 * 24 * 60 * 60 * 1000;
    const byDayValues = (rule.BYDAY ?? '').split(',').filter(Boolean);
    if (byDayValues.some((value) => !/^(SU|MO|TU|WE|TH|FR|SA)$/u.test(value.toUpperCase()))) {
      throw calendarCoreError('ics_recurrence_unsupported');
    }
    const byDays = new Set(byDayValues.map(weekdayNumber));
    const weekStart = rule.WKST ? weekdayNumber(rule.WKST) : 1;
    if (weekStart < 0) throw calendarCoreError('ics_recurrence_unsupported');
    const startDate = utcDate(master.start.localDate);
    const startWeekOffset = (startDate.getUTCDay() - weekStart + 7) % 7;
    let emitted = 1;
    for (let offset = 1; emitted < count && offset <= 366 * 2 && occurrences.size <= MAX_ICS_EVENTS; offset += 1) {
      const candidateDate = new Date(startDate.getTime());
      candidateDate.setUTCDate(candidateDate.getUTCDate() + offset);
      const weeks = Math.floor((startWeekOffset + offset) / 7);
      const matchesFrequency = frequency === 'DAILY'
        ? offset % interval === 0 && (byDays.size === 0 || byDays.has(candidateDate.getUTCDay()))
        : weeks % interval === 0 && (byDays.size === 0 ? candidateDate.getUTCDay() === startDate.getUTCDay() : byDays.has(candidateDate.getUTCDay()));
      if (!matchesFrequency) continue;
      const localDate = isoDate(candidateDate);
      const millis = master.start.allDay
        ? zonedMillis(localDate, '00:00', master.start.timezone)
        : zonedMillis(localDate, master.start.localTime, master.start.timezone);
      if (millis > until) break;
      addOccurrence({ ...master.start, millis, localDate, canonical: master.start.allDay ? localDate.replace(/-/gu, '') : `${localDate.replace(/-/gu, '')}T${master.start.localTime.replace(':', '')}00` });
      emitted += 1;
    }
  }
  if (occurrences.size > MAX_ICS_EVENTS) throw calendarCoreError('ics_event_limit');
  return Array.from(occurrences.values());
}

function externalEvent(event: RawEvent): ExternalCalendarEvent {
  const key = `${event.uid}|${event.recurrenceId ?? ''}`;
  const canonical = JSON.stringify({
    key,
    title: event.title,
    start: event.start.millis,
    end: event.end.millis,
    zone: event.start.timezone,
    allDay: event.start.allDay,
    location: event.location,
    description: event.description,
    status: event.status,
    sequence: event.sequence,
  });
  return {
    key,
    uid: event.uid,
    recurrenceId: event.recurrenceId,
    title: event.title,
    startAtMillis: event.start.millis,
    endAtMillis: event.end.millis,
    timezone: event.start.timezone,
    isAllDay: event.start.allDay,
    location: event.location,
    description: event.description,
    status: event.status,
    sequence: event.sequence,
    lastModifiedMillis: event.lastModifiedMillis,
    sourceHash: createHash('sha256').update(canonical).digest('hex'),
    type: inferEventType(event.title),
  };
}

function parseIcsDate(property: Property): ParsedDate {
  const value = property.value.trim();
  const timezone = property.params.TZID || (value.endsWith('Z') ? 'UTC' : 'UTC');
  if (property.params.VALUE === 'DATE' || /^\d{8}$/u.test(value)) {
    const localDate = compactDate(value);
    return { millis: zonedMillis(localDate, '00:00', timezone), timezone, allDay: true, localDate, localTime: '00:00', canonical: value.slice(0, 8) };
  }
  const match = /^(\d{8})T(\d{2})(\d{2})(\d{2})?(Z)?$/u.exec(value);
  if (!match) throw calendarCoreError('ics_invalid_date');
  const localDate = compactDate(match[1]);
  const localTime = `${match[2]}:${match[3]}`;
  const millis = match[5]
    ? Date.UTC(Number(match[1].slice(0, 4)), Number(match[1].slice(4, 6)) - 1, Number(match[1].slice(6, 8)), Number(match[2]), Number(match[3]), Number(match[4] ?? 0))
    : zonedMillis(localDate, localTime, timezone);
  if (!Number.isFinite(millis)) throw calendarCoreError('ics_invalid_date');
  return { millis, timezone, allDay: false, localDate, localTime, canonical: value.replace(/Z$/u, '') };
}

function unfoldLines(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').reduce<string[]>((result, line) => {
    if (/^[ \t]/u.test(line) && result.length > 0) result[result.length - 1] += line.slice(1);
    else result.push(line);
    return result;
  }, []);
}

function parseProperty(line: string): Property | null {
  const colon = line.indexOf(':');
  if (colon < 1) return null;
  const [rawName, ...rawParams] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  rawParams.forEach((part) => {
    const equal = part.indexOf('=');
    if (equal > 0) params[part.slice(0, equal).toUpperCase()] = part.slice(equal + 1).replace(/^"|"$/gu, '');
  });
  return { name: rawName.toUpperCase(), params, value: line.slice(colon + 1) };
}

function first(properties: Property[], name: string) { return properties.find((property) => property.name === name); }
function all(properties: Property[], name: string) { return properties.filter((property) => property.name === name); }

function parseDuration(value: string) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/u.exec(value);
  if (!match) throw calendarCoreError('ics_invalid_duration');
  const millis = (Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0)) * 1000;
  if (millis <= 0 || millis > 31 * 24 * 60 * 60 * 1000) throw calendarCoreError('ics_invalid_duration');
  return millis;
}

function zonedMillis(date: string, time: string, timezone: string) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0); } catch { throw calendarCoreError('ics_invalid_timezone'); }
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = dateParts(new Date(guess), timezone);
    const rendered = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const difference = target - rendered;
    if (difference === 0) break;
    guess += difference;
  }
  const checked = dateParts(new Date(guess), timezone);
  if (checked.year !== year || checked.month !== month || checked.day !== day || checked.hour !== hour || checked.minute !== minute) throw calendarCoreError('ics_invalid_date');
  return guess;
}

function dateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute };
}

function ipv6Words(value: string): number[] | null {
  if (value.includes('%') || value.split('::').length > 2) return null;
  let normalized = value;
  const ipv4Match = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(normalized);
  if (ipv4Match) {
    const bytes = ipv4Match[1].split('.').map(Number);
    if (bytes.length !== 4 || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) return null;
    normalized = `${normalized.slice(0, normalized.length - ipv4Match[1].length)}${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const [leftValue, rightValue = ''] = normalized.split('::');
  const left = leftValue ? leftValue.split(':') : [];
  const right = rightValue ? rightValue.split(':') : [];
  if (left.some((part) => !/^[0-9a-f]{1,4}$/iu.test(part)) || right.some((part) => !/^[0-9a-f]{1,4}$/iu.test(part))) return null;
  const omitted = 8 - left.length - right.length;
  if ((normalized.includes('::') && omitted < 1) || (!normalized.includes('::') && omitted !== 0)) return null;
  return [...left, ...Array.from({ length: omitted }, () => '0'), ...right].map((part) => Number.parseInt(part, 16));
}

function compareVersion(a: RawEvent, b: RawEvent) { return a.sequence - b.sequence || (a.lastModifiedMillis ?? 0) - (b.lastModifiedMillis ?? 0); }
function cleanText(value: string, maximum: number) { const cleaned = value.trim().replace(/\s+/gu, ' '); return cleaned ? cleaned.slice(0, maximum) : null; }
function unescapeIcs(value: string) { return value.replace(/\\n/giu, '\n').replace(/\\,/gu, ',').replace(/\\;/gu, ';').replace(/\\\\/gu, '\\'); }
function inferEventType(title: string): 'game' | 'practice' | 'teamEvent' { const value = title.toLocaleLowerCase('en-US'); return /\b(practice|training)\b/u.test(value) ? 'practice' : /\b(game|match|vs\.?|at)\b/u.test(value) ? 'game' : 'teamEvent'; }
function compactDate(value: string) { const result = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`; if (isoDate(utcDate(result)) !== result) throw calendarCoreError('ics_invalid_date'); return result; }
function utcDate(value: string) { const [year, month, day] = value.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day)); }
function isoDate(value: Date) { return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`; }
function weekdayNumber(value: string) { return ({ SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 } as Record<string, number>)[value.slice(-2).toUpperCase()] ?? -1; }
function strictBoundedInteger(value: string | undefined, minimum: number, maximum: number, fallback: number) { if (value === undefined || value === '') return fallback; const parsed = Number.parseInt(value, 10); if (!Number.isInteger(parsed) || String(parsed) !== value || parsed < minimum || parsed > maximum) throw calendarCoreError('ics_recurrence_unsupported'); return parsed; }
function safeReason(error: unknown) { return error instanceof Error && /^ics_[a-z_]+$/u.test(error.message) ? error.message : 'ics_event_invalid'; }
function calendarCoreError(code: string) { const error = new Error(code); (error as { code?: string }).code = code; return error; }
function escapeIcs(value: string) { return value.replace(/\\/gu, '\\\\').replace(/\r?\n/gu, '\\n').replace(/,/gu, '\\,').replace(/;/gu, '\\;'); }
function utcIcs(value: number) { return new Date(value).toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z'); }
function dateInZone(value: number, timezone: string) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)); const map = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${map.year}-${map.month}-${map.day}`; }
function foldIcsLine(line: string) { if (Buffer.byteLength(line, 'utf8') <= 75) return line; const chunks: string[] = []; let current = ''; for (const character of line) { if (Buffer.byteLength(current + character, 'utf8') > (chunks.length === 0 ? 75 : 74)) { chunks.push(current); current = character; } else current += character; } chunks.push(current); return chunks.join('\r\n '); }
