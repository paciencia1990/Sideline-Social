import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { VerifiedCoachAiSubscription } from './coachAiSubscriptionCore';

export type BillingEnvironment = 'production' | 'sandbox';
export type VerifiedBillingSnapshot = {
  checkedAtMs: number;
  subscription: VerifiedCoachAiSubscription | null;
  originalPurchaseAtMs: number | null;
  customerExists: boolean;
};

export function billingDocumentId(environment: BillingEnvironment, uid: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('invalid_billing_identity');
  return `${environment}_${createHash('sha256').update(uid).digest('hex')}`;
}

export function billingRequestId(environment: BillingEnvironment, uid: string, requestId: string) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new Error('invalid_request_id');
  return createHash('sha256').update(`${environment}:${uid}:${requestId}`).digest('hex');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_revenuecat_response');
  return value as Record<string, unknown>;
}
/** Monthly UTC anniversaries; annual purchases receive one window at a time. */
export function coachAiMonthlyWindow(anchorMs: number, nowMs: number) {
  if (![anchorMs, nowMs].every((value) => Number.isSafeInteger(value) && value > 0 && value <= 8.64e15)
    || nowMs < anchorMs) throw new Error('invalid_allowance_anchor');
  const anchor = new Date(anchorMs);
  const now = new Date(nowMs);
  function boundary(offset: number) {
    const month = anchor.getUTCMonth() + offset;
    const year = anchor.getUTCFullYear() + Math.floor(month / 12);
    const normalizedMonth = ((month % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(year, normalizedMonth + 1, 0)).getUTCDate();
    return Date.UTC(year, normalizedMonth, Math.min(anchor.getUTCDate(), lastDay),
      anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds());
  }
  let index = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + now.getUTCMonth() - anchor.getUTCMonth();
  if (boundary(index) > nowMs) index -= 1;
  const startsAtMs = boundary(index);
  const resetsAtMs = boundary(index + 1);
  if (index < 0 || !Number.isSafeInteger(resetsAtMs)) throw new Error('invalid_allowance_anchor');
  return { id: `${anchorMs}_${index}`, startsAtMs, resetsAtMs };
}

export function verifyRevenueCatWebhook(rawBody: Buffer, header: string | undefined, secret: string, nowMs: number) {
  if (!Buffer.isBuffer(rawBody) || typeof header !== 'string' || typeof secret !== 'string'
    || secret.length < 32 || rawBody.length > 128 * 1024 || !Number.isSafeInteger(nowMs) || nowMs <= 0) return false;
  const match = /^t=(\d{10}),v1=([a-f0-9]{64})$/.exec(header);
  if (!match || Math.abs(nowMs / 1000 - Number(match[1])) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${match[1]}.`).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(match[2], 'hex'));
}

export function parseBillingWebhook(body: unknown, environment: BillingEnvironment, allowedAppIds: string[]) {
  const event = record(record(body).event);
  if (typeof event.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(event.id)) throw new Error('invalid_webhook_id');
  if (typeof event.type !== 'string' || !/^[A-Z_]{1,64}$/.test(event.type)) throw new Error('invalid_webhook_type');
  if (event.environment !== environment.toUpperCase() || typeof event.app_id !== 'string'
    || !allowedAppIds.includes(event.app_id)) throw new Error('webhook_scope_mismatch');
  if (event.type === 'TEST') return { id: event.id, uids: [] as string[], type: 'TEST' };
  const uids = event.type === 'TRANSFER'
    ? [...(Array.isArray(event.transferred_from) ? event.transferred_from : []), ...(Array.isArray(event.transferred_to) ? event.transferred_to : [])]
    : [event.app_user_id];
  if (uids.length === 0 || uids.length > 10 || uids.some((uid) => typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid))) throw new Error('invalid_webhook_identity');
  return { id: event.id, uids: [...new Set(uids as string[])], type: typeof event.type === 'string' ? event.type.slice(0, 64) : 'unknown' };
}
