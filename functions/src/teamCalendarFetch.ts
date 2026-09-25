import { lookup } from 'node:dns/promises';
import * as https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

import {
  isBlockedCalendarAddress,
  isBlockedCalendarHostname,
  MAX_ICS_BYTES,
  normalizeCalendarFeedUrl,
} from './teamCalendarCore';

export type CalendarConditionalHeaders = { etag?: string; lastModified?: string };
export type CalendarFetchResult = {
  body: string | null;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
};
type ResolvedAddress = { address: string; family: number };
type PinnedResponse = {
  status: number;
  body: string;
  contentType: string;
  etag: string | null;
  lastModified: string | null;
  redirect: string | null;
};
export type CalendarFetchDependencies = {
  resolve: (hostname: string) => Promise<ResolvedAddress[]>;
  request: (url: URL, address: string, family: number, conditional: CalendarConditionalHeaders) => Promise<PinnedResponse>;
};

const MAX_REDIRECTS = 2;
const REQUEST_TIMEOUT_MS = 10_000;
const defaultDependencies: CalendarFetchDependencies = {
  resolve: (hostname) => lookup(hostname, { all: true, verbatim: true }),
  request: requestPinned,
};

export async function fetchPublicCalendar(
  initialUrl: URL,
  conditional: CalendarConditionalHeaders,
  dependencies: CalendarFetchDependencies = defaultDependencies,
  redirects = 0,
): Promise<CalendarFetchResult> {
  const normalized = normalizeCalendarFeedUrl(initialUrl.href);
  if (isBlockedCalendarHostname(normalized.hostname)) throw calendarFetchError('feed_address_blocked');
  const addresses = await dependencies.resolve(normalized.hostname).catch(() => {
    throw calendarFetchError('feed_dns_failed');
  });
  if (addresses.length === 0 || addresses.some((entry) => isBlockedCalendarAddress(entry.address))) {
    throw calendarFetchError('feed_address_blocked');
  }

  const pinned = addresses[0];
  let result: PinnedResponse;
  try {
    result = await dependencies.request(normalized.url, pinned.address, pinned.family, conditional);
  }
  catch (error) {
    throw calendarFetchError(classifyCalendarTransportError(error));
  }

  if (result.redirect) {
    if (redirects >= MAX_REDIRECTS) throw calendarFetchError('feed_redirect_limit');
    let redirected: ReturnType<typeof normalizeCalendarFeedUrl>;
    try {
      redirected = normalizeCalendarFeedUrl(new URL(result.redirect, normalized.url).href);
    }
    catch {
      throw calendarFetchError('feed_redirect_invalid');
    }
    const nextConditional = redirected.url.origin === normalized.url.origin ? conditional : {};
    return fetchPublicCalendar(redirected.url, nextConditional, dependencies, redirects + 1);
  }
  if (result.status === 304) {
    return { body: null, etag: result.etag, lastModified: result.lastModified, notModified: true };
  }
  if (result.status < 200 || result.status >= 300) throw calendarFetchError('feed_http_error');
  const contentType = result.contentType.toLocaleLowerCase('en-US');
  if (!contentType.includes('text/calendar') &&
      !contentType.includes('application/ics') &&
      !/^\s*BEGIN:VCALENDAR/iu.test(result.body)) {
    throw calendarFetchError('feed_content_type_invalid');
  }
  return { body: result.body, etag: result.etag, lastModified: result.lastModified, notModified: false };
}

export function decodeCalendarPayload(payload: Buffer, contentEncodingValue: string | undefined) {
  if (payload.byteLength > MAX_ICS_BYTES) throw calendarFetchError('feed_response_too_large');
  const encoding = (contentEncodingValue ?? '').split(',').map((value) => value.trim().toLocaleLowerCase('en-US')).filter(Boolean);
  if (encoding.length > 1) throw calendarFetchError('feed_content_encoding_unsupported');
  const value = encoding[0] ?? 'identity';
  let decoded: Buffer;
  try {
    if (value === 'identity') decoded = payload;
    else if (value === 'gzip' || value === 'x-gzip') decoded = gunzipSync(payload, { maxOutputLength: MAX_ICS_BYTES + 1 });
    else if (value === 'deflate') decoded = inflateSync(payload, { maxOutputLength: MAX_ICS_BYTES + 1 });
    else if (value === 'br') decoded = brotliDecompressSync(payload, { maxOutputLength: MAX_ICS_BYTES + 1 });
    else throw calendarFetchError('feed_content_encoding_unsupported');
  }
  catch (error) {
    if (calendarFetchReason(error) === 'feed_content_encoding_unsupported') throw error;
    if (isOutputLimitError(error)) throw calendarFetchError('feed_response_too_large');
    throw calendarFetchError('feed_content_encoding_invalid');
  }
  if (decoded.byteLength > MAX_ICS_BYTES) throw calendarFetchError('feed_response_too_large');
  return decoded.toString('utf8');
}

function requestPinned(
  url: URL,
  address: string,
  family: number,
  conditional: CalendarConditionalHeaders,
): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      operation();
    };
    const canonicalHostname = url.hostname.replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
    const request = https.request({
      protocol: 'https:',
      hostname: url.hostname,
      ...(isIP(canonicalHostname) === 0 ? { servername: canonicalHostname } : {}),
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        Accept: 'text/calendar, application/ics;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': 'Sideline-Social-Calendar/1.0',
        ...(conditional.etag ? { 'If-None-Match': conditional.etag } : {}),
        ...(conditional.lastModified ? { 'If-Modified-Since': conditional.lastModified } : {}),
      },
      lookup: createPinnedLookup(address, family),
      maxHeaderSize: 16 * 1024,
    }, (response) => {
      const status = response.statusCode ?? 0;
      const redirect = safeHeader(response.headers.location) || null;
      const headers = {
        contentType: safeHeader(response.headers['content-type']),
        etag: safeHeader(response.headers.etag) || null,
        lastModified: safeHeader(response.headers['last-modified']) || null,
      };
      if (status >= 300 && status < 400 && redirect) {
        response.resume();
        finish(() => resolve({ status, body: '', ...headers, redirect }));
        return;
      }
      const declaredLength = Number.parseInt(safeHeader(response.headers['content-length']), 10);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_ICS_BYTES) {
        response.resume();
        finish(() => reject(calendarFetchError('feed_response_too_large')));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        if (settled) return;
        bytes += chunk.byteLength;
        if (bytes > MAX_ICS_BYTES) {
          response.destroy();
          finish(() => reject(calendarFetchError('feed_response_too_large')));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(() => {
        try {
          const body = decodeCalendarPayload(Buffer.concat(chunks), safeHeader(response.headers['content-encoding']));
          resolve({ status, body, ...headers, redirect: null });
        }
        catch (error) { reject(error); }
      }));
      response.on('error', (error) => finish(() => reject(error)));
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(calendarFetchError('feed_timeout')));
    request.on('error', (error) => finish(() => reject(error)));
    request.end();
  });
}

export function createPinnedLookup(address: string, family: number): LookupFunction {
  const pinned = { address, family: family === 6 ? 6 as const : 4 as const };
  return (_hostname, options, callback) => {
    if (typeof options === 'object' && options.all === true) {
      callback(null, [pinned]);
      return;
    }
    callback(null, pinned.address, pinned.family);
  };
}

export function classifyCalendarTransportError(error: unknown) {
  const existing = calendarFetchReason(error);
  if (existing) return existing;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'feed_dns_failed';
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'feed_timeout';
  if (code === 'ERR_INVALID_IP_ADDRESS') return 'feed_transport_configuration';
  if (/CERT|TLS|SSL|UNABLE_TO_VERIFY/iu.test(code)) return 'feed_tls_invalid';
  return 'feed_unreachable';
}

export function calendarFetchReason(error: unknown) {
  const value = error instanceof Error ? error.message : '';
  return /^feed_[a-z_]+$/u.test(value) ? value : null;
}

function isOutputLimitError(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : '';
  return code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|output size/iu.test(message);
}

function calendarFetchError(code: string) {
  const error = new Error(code);
  (error as { code?: string }).code = code;
  return error;
}

function safeHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}
