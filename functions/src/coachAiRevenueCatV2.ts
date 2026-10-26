import { COACH_AI_PRODUCT_CATALOG, type CoachAiBillingStore, type VerifiedCoachAiSubscription } from './coachAiSubscriptionCore';
import type { BillingEnvironment, VerifiedBillingSnapshot } from './coachAiBillingCore';

export const REVENUECAT_V2_PROJECT_ID = 'projec5f2a61';
export const REVENUECAT_VERIFICATION_SECRET = 'REVENUECAT_VERIFICATION_KEY';
export const REVENUECAT_ERASURE_SECRET = 'REVENUECAT_ERASURE_KEY';
export const EXISTING_ACCOUNT_DELETION_RUNTIME = 'sideline-account-delete@sideline-social-staging-2026.iam.gserviceaccount.com';
export const COACH_AI_DEDICATED_RUNTIME_DEFAULTS = {
  reader: 'coach-ai-billing-reader@sideline-social-staging-2026.iam.gserviceaccount.com',
  generator: 'coach-ai-paid-generator@sideline-social-staging-2026.iam.gserviceaccount.com',
  webhook: 'coach-ai-billing-webhook@sideline-social-staging-2026.iam.gserviceaccount.com',
  erasure: EXISTING_ACCOUNT_DELETION_RUNTIME,
} as const;
const API_ORIGIN = 'https://api.revenuecat.com';
const LOOKUP_BUDGET_MS = 12_000;
const VERIFICATION_LEASE_MS = 300_000;
const MAX_BYTES = 1024 * 1024;
const MAX_PAGES = 5;
const MAX_REQUESTS = 16;
const TEST_STORE_PRODUCTS = new Set(['prod500ba84f76', 'prod3d86f6e294']);
const TEST_STORE_APP = 'appb0ed43cb1c';
type JsonRecord = Record<string, unknown>;
export type RevenueCatV2Product = { revenueCatProductId: string; productId: string; store: CoachAiBillingStore; appId: string };
export type RevenueCatV2Config = {
  apiProjectId: typeof REVENUECAT_V2_PROJECT_ID; entitlementId: string;
  environment: BillingEnvironment; products: RevenueCatV2Product[];
};

function object(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_billing_v2_response');
  return value as JsonRecord;
}
function identifier(value: unknown, prefix = ''): value is string {
  return typeof value === 'string' && new RegExp(`^${prefix}[A-Za-z0-9_-]{1,128}$`).test(value);
}
function time(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > 8.64e15) throw new Error('invalid_billing_v2_date');
  return Number(value);
}
function identity(uid: string) {
  if (!identifier(uid)) throw new Error('invalid_billing_identity');
}
function key(value: string) {
  if (!/^sk_[A-Za-z0-9_-]{12,}$/.test(value)) throw new Error('billing_unavailable');
}

/** Server-owned product IDs are reviewed after REAL native products exist. */
export function parseRevenueCatV2Config(value: unknown, environment: BillingEnvironment, appIds: string[]): RevenueCatV2Config | null {
  try {
    const data = object(value);
    if (data.apiVersion !== 2 || data.apiProjectId !== REVENUECAT_V2_PROJECT_ID
      || data.credentialPolicy !== 'separate_v2'
      || (environment === 'production' ? data.v2StoreLifecycleVerified !== true : data.v2SandboxTestingApproved !== true)
      || data.runtimeSecretIsolationVerified !== true || !identifier(data.entitlementId, 'entl')
      || appIds.length !== 2 || new Set(appIds).size !== 2
      || appIds.some(id => !identifier(id, 'app') || id === TEST_STORE_APP)
      || !Array.isArray(data.productMappings) || data.productMappings.length !== 4) return null;
    const products: RevenueCatV2Product[] = [];
    for (const item of data.productMappings) {
      const entry = object(item);
      const store = entry.store;
      if (store !== 'app_store' && store !== 'play_store') return null;
      if (!identifier(entry.revenueCatProductId, 'prod') || TEST_STORE_PRODUCTS.has(entry.revenueCatProductId)
        || typeof entry.productId !== 'string' || !(Object.values(COACH_AI_PRODUCT_CATALOG[store]) as string[]).includes(entry.productId)
        || typeof entry.appId !== 'string' || !appIds.includes(entry.appId)) return null;
      products.push({ revenueCatProductId: entry.revenueCatProductId, productId: entry.productId, store, appId: entry.appId });
    }
    if (new Set(products.map(p => p.revenueCatProductId)).size !== 4 || new Set(products.map(p => p.productId)).size !== 4) return null;
    const appleApps = new Set(products.filter(p => p.store === 'app_store').map(p => p.appId));
    const googleApps = new Set(products.filter(p => p.store === 'play_store').map(p => p.appId));
    if (appleApps.size !== 1 || googleApps.size !== 1 || [...appleApps][0] === [...googleApps][0]) return null;
    return { apiProjectId: REVENUECAT_V2_PROJECT_ID, entitlementId: data.entitlementId, environment, products };
  } catch { return null; }
}

/** No project/default/moderation identity is silently selected for paid access. */
export function revenueCatRuntimeIdentities(environment: NodeJS.ProcessEnv = process.env) {
  const reader = environment.COACH_AI_BILLING_READER_SERVICE_ACCOUNT ?? '';
  const generator = environment.COACH_AI_BILLING_GENERATOR_SERVICE_ACCOUNT ?? '';
  const webhook = environment.COACH_AI_BILLING_WEBHOOK_SERVICE_ACCOUNT ?? '';
  const erasure = environment.COACH_AI_BILLING_ERASURE_SERVICE_ACCOUNT ?? '';
  const pattern = /^[a-z][a-z0-9-]{5,29}@sideline-social-staging-2026\.iam\.gserviceaccount\.com$/;
  const identities = [reader, generator, webhook, erasure];
  return identities.every(value => pattern.test(value)) && new Set(identities).size === 4
    ? { reader, generator, webhook, erasure } : null;
}

/** Keep the deployed deletion identity while the paid identity set is incomplete. */
export function coachAiErasureRuntimeIdentity(environment: NodeJS.ProcessEnv = process.env) {
  return coachAiRuntimeIdentity('erasure', environment);
}

/** Undeployed identities must be prepared before deployment; never use default. */
export function coachAiRuntimeIdentity(role: keyof typeof COACH_AI_DEDICATED_RUNTIME_DEFAULTS, environment: NodeJS.ProcessEnv = process.env) {
  return revenueCatRuntimeIdentities(environment)?.[role] ?? COACH_AI_DEDICATED_RUNTIME_DEFAULTS[role];
}

async function json(response: Response, signal: AbortSignal): Promise<JsonRecord> {
  const length = response.headers.get('content-length');
  if (length != null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new Error('billing_response_too_large');
  if (!response.body) throw new Error('invalid_billing_v2_response');
  const reader = response.body.getReader();
  const chunks: Buffer[] = []; let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error('billing_response_too_large'); }
      chunks.push(Buffer.from(part.value));
    }
    signal.throwIfAborted();
    return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } finally { reader.releaseLock(); }
}

function client(secret: string, fetcher: typeof fetch, now: () => number, attemptSignal?: AbortSignal) {
  key(secret);
  const startedAtMs = time(now());
  const timeoutSignal = AbortSignal.timeout(LOOKUP_BUDGET_MS);
  const signal = attemptSignal ? AbortSignal.any([timeoutSignal, attemptSignal]) : timeoutSignal;
  let requests = 0;
  async function get(path: string, allowMissingCustomer = false): Promise<JsonRecord | null> {
    signal.throwIfAborted();
    if (++requests > MAX_REQUESTS || now() < startedAtMs || now() - startedAtMs > LOOKUP_BUDGET_MS) throw new Error('billing_v2_lookup_budget');
    const response = await fetcher(`${API_ORIGIN}${path}`, { method: 'GET', redirect: 'error',
      headers: { authorization: `Bearer ${secret}`, accept: 'application/json' }, signal });
    if (response.status === 404 && allowMissingCustomer) {
      const missing = await json(response, signal);
      if (missing.object === 'error' && missing.type === 'resource_missing'
        && (missing.param == null || missing.param === 'customer_id')) return null;
    }
    if (response.status !== 200) throw new Error('billing_verification_unavailable');
    const result = await json(response, signal);
    if (now() < startedAtMs || now() - startedAtMs > LOOKUP_BUDGET_MS) throw new Error('billing_v2_lookup_budget');
    return result;
  }
  return { get, startedAtMs };
}

/** Rebuild continuation reads from a validated cursor, never forward a secret to a supplied URL. */
function continuation(value: unknown, path: string, environment?: BillingEnvironment): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > 5000) throw new Error('invalid_billing_v2_pagination');
  const url = new URL(value, API_ORIGIN);
  if (url.origin !== API_ORIGIN || url.username || url.password || url.hash || url.pathname !== path) throw new Error('invalid_billing_v2_pagination');
  for (const name of url.searchParams.keys()) {
    if (!['starting_after', 'limit', ...(environment ? ['environment'] : []), ...(path.endsWith('/entitlements') ? ['status'] : [])].includes(name)
      || url.searchParams.getAll(name).length !== 1) throw new Error('invalid_billing_v2_pagination');
  }
  const cursor = url.searchParams.get('starting_after');
  if (!identifier(cursor) || (url.searchParams.has('limit') && !/^(?:[1-9]\d?|100)$/.test(url.searchParams.get('limit')!))
    || (url.searchParams.has('environment') && url.searchParams.get('environment') !== environment)
    || (url.searchParams.has('status') && url.searchParams.get('status') !== 'active')) throw new Error('invalid_billing_v2_pagination');
  const query = new URLSearchParams({ limit: '100', starting_after: cursor });
  if (environment) query.set('environment', environment);
  if (url.searchParams.has('status')) query.set('status', 'active');
  return `${path}?${query}`;
}

async function list(get: (path: string) => Promise<JsonRecord | null>, path: string, environment?: BillingEnvironment, first?: unknown) {
  const items: JsonRecord[] = [], seenPages = new Set<string>(), seenItems = new Set<string>();
  let next: string | null = `${path}?limit=100${environment ? `&environment=${environment}` : ''}`;
  let initial = first;
  for (let page = 0; next != null; page++) {
    if (page >= MAX_PAGES || seenPages.has(next)) throw new Error('billing_v2_incomplete_snapshot');
    seenPages.add(next);
    const body = object(initial ?? await get(next)); initial = undefined;
    if (body.object !== 'list' || !Array.isArray(body.items) || body.items.length > 100) throw new Error('invalid_billing_v2_response');
    for (const item of body.items) {
      const entry = object(item), id = entry.id ?? entry.entitlement_id;
      if (!identifier(id) || seenItems.has(id)) throw new Error('invalid_billing_v2_response');
      seenItems.add(id); items.push(entry);
    }
    next = continuation(body.next_page, path, environment);
  }
  return items;
}

function ownedSubscription(value: JsonRecord, uid: string, config: RevenueCatV2Config, nowMs: number) {
  if (value.object !== 'subscription' || !identifier(value.id, 'sub') || value.environment !== config.environment) throw new Error('invalid_billing_v2_response');
  const product = config.products.find(p => p.revenueCatProductId === value.product_id && p.store === value.store);
  if (!product || value.ownership !== 'purchased') return null;
  if (value.customer_id !== uid || value.original_customer_id !== uid) throw new Error('billing_account_mismatch');
  const startsAt = time(value.starts_at);
  if (typeof value.gives_access !== 'boolean' || typeof value.pending_payment !== 'boolean'
    || typeof value.status !== 'string' || typeof value.auto_renewal_status !== 'string') throw new Error('invalid_billing_v2_response');
  const paidStatus = ['active', 'in_grace_period', 'expired', 'in_billing_retry', 'paused'].includes(value.status);
  return { value, product, startsAt, paidStatus, eligible: startsAt <= nowMs && value.gives_access === true
    && ['active', 'in_grace_period'].includes(value.status) };
}

function storeIdentifier(value: unknown): string {
  // The schema declares strings, while official examples also show safe integers.
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[\u0000-\u001f\u007f]/.test(value)) return value;
  throw new Error('invalid_billing_v2_response');
}

function stableSubscription(value: JsonRecord) {
  return JSON.stringify(['id', 'customer_id', 'original_customer_id', 'product_id', 'starts_at', 'current_period_starts_at',
    'current_period_ends_at', 'ends_at', 'gives_access', 'pending_payment', 'auto_renewal_status', 'status', 'store',
    'environment', 'ownership', 'store_subscription_identifier'].map(field => field === 'store_subscription_identifier' ? storeIdentifier(value[field]) : value[field]));
}

/** Only server-owned config/UID and the fixed v2 host are accepted. All HTTP attempts are single-shot. */
export async function lookupRevenueCatV2(uid: string, config: RevenueCatV2Config, secret: string,
  options: { fetcher?: typeof fetch; now?: () => number; signal?: AbortSignal } = {}): Promise<VerifiedBillingSnapshot> {
  identity(uid);
  if (config.apiProjectId !== REVENUECAT_V2_PROJECT_ID) throw new Error('billing_unavailable');
  const now = options.now ?? Date.now, transport = client(secret, options.fetcher ?? fetch, now, options.signal);
  const prefix = `/v2/projects/${REVENUECAT_V2_PROJECT_ID}`, customerPath = `${prefix}/customers/${encodeURIComponent(uid)}`;
  const empty = (customerExists: boolean, anchor: number | null = null): VerifiedBillingSnapshot => ({
    checkedAtMs: transport.startedAtMs, subscription: null, originalPurchaseAtMs: anchor, customerExists,
  });
  const customer = await transport.get(customerPath, true);
  if (!customer) return empty(false);
  if (customer.object !== 'customer' || customer.id !== uid || customer.project_id !== REVENUECAT_V2_PROJECT_ID) throw new Error('billing_account_mismatch');
  const subscriptions = await list(transport.get, `${customerPath}/subscriptions`, config.environment);
  const owned = subscriptions.map(entry => ownedSubscription(entry, uid, config, now())).filter(value => value != null);
  const paidStarts = owned.filter(entry => entry.paidStatus && entry.startsAt <= now()).map(entry => entry.startsAt);
  const anchor = paidStarts.length ? Math.min(...paidStarts) : null;
  const eligible = owned.filter(entry => entry.eligible);
  if (!eligible.length) return empty(true, anchor);
  if (eligible.length !== 1) throw new Error('billing_multiple_subscriptions');
  const candidate = eligible[0];
  const subscriptionPath = `${prefix}/subscriptions/${candidate.value.id}`;
  const fresh = object(await transport.get(subscriptionPath));
  if (stableSubscription(fresh) !== stableSubscription(candidate.value)) throw new Error('billing_v2_snapshot_changed');
  const selected = ownedSubscription(fresh, uid, config, now());
  if (!selected?.eligible) return empty(true, anchor);
  const entitlements = await list(transport.get, `${subscriptionPath}/entitlements`, undefined, fresh.entitlements);
  const entitlement = entitlements.find(entry => entry.id === config.entitlementId && entry.lookup_key === 'coach_ai' && entry.state === 'active');
  if (!entitlement) return empty(true, anchor);
  if (entitlement.project_id !== REVENUECAT_V2_PROJECT_ID) throw new Error('billing_product_mismatch');
  // The reviewed ID map is authoritative; cross-check an inline product when supplied.
  if (entitlement.products != null) {
    const inline = object(entitlement.products);
    if (!Array.isArray(inline.items)) throw new Error('invalid_billing_v2_response');
    const mapped = inline.items.map(object).find(entry => entry.id === selected.product.revenueCatProductId);
    if (mapped && (mapped.app_id !== selected.product.appId || mapped.store_identifier !== selected.product.productId || mapped.type !== 'subscription')) throw new Error('billing_product_mismatch');
  }
  const active = await list(transport.get, `${customerPath}/active_entitlements`);
  if (!active.some(entry => entry.object === 'customer.active_entitlement' && entry.entitlement_id === config.entitlementId)) return empty(true, anchor);
  const periodStart = time(fresh.current_period_starts_at);
  if (periodStart < selected.startsAt || periodStart > transport.startedAtMs) throw new Error('invalid_billing_v2_response');
  storeIdentifier(fresh.store_subscription_identifier);
  const renewal = fresh.auto_renewal_status;
  if (!['will_renew', 'will_not_renew', 'will_change_product', 'will_pause', 'requires_price_increase_consent', 'has_already_renewed'].includes(String(renewal))) throw new Error('invalid_billing_v2_response');
  let paidThroughMs: number | null = null;
  let accessUntilMs = transport.startedAtMs + VERIFICATION_LEASE_MS;
  if (fresh.status === 'active') {
    const periodEnd = time(fresh.current_period_ends_at), endsAt = time(fresh.ends_at);
    if (periodEnd <= periodStart || endsAt <= transport.startedAtMs || endsAt < periodEnd || (endsAt !== periodEnd && renewal !== 'has_already_renewed')) throw new Error('invalid_billing_v2_date');
    paidThroughMs = endsAt; accessUntilMs = Math.min(accessUntilMs, endsAt);
  } else {
    // gives_access supplies grace access. No grace deadline is fabricated from a normal period end.
    if (fresh.current_period_ends_at != null && time(fresh.current_period_ends_at) > transport.startedAtMs) throw new Error('invalid_billing_v2_date');
  }
  if (now() < transport.startedAtMs || now() - transport.startedAtMs > LOOKUP_BUDGET_MS || accessUntilMs <= now()) throw new Error('billing_v2_lookup_budget');
  const subscription: VerifiedCoachAiSubscription = {
    accountUid: uid, entitlementId: 'coach_ai', productId: selected.product.productId, store: selected.product.store,
    environment: config.environment, status: fresh.status === 'active' ? 'active' : 'grace_period',
    verifiedAtMs: transport.startedAtMs, accessUntilMs, paidThroughMs,
    autoRenews: ['will_renew', 'will_change_product', 'has_already_renewed'].includes(String(renewal)),
  };
  return { checkedAtMs: transport.startedAtMs, subscription, originalPurchaseAtMs: anchor, customerExists: true };
}

/** Read-only erasure-completion check; never treats a project/auth error as absence. */
export async function verifyRevenueCatCustomerAbsent(uid: string, secret: string,
  options: { fetcher?: typeof fetch; now?: () => number } = {}): Promise<boolean> {
  identity(uid);
  const transport = client(secret, options.fetcher ?? fetch, options.now ?? Date.now);
  const path = `/v2/projects/${REVENUECAT_V2_PROJECT_ID}/customers`;
  // Positive project-scoped permission probe before interpreting customer 404.
  // No pagination is required: this is an access check, not a customer inventory.
  const probe = object(await transport.get(path + '?limit=1'));
  if (probe.object !== 'list' || !Array.isArray(probe.items) || probe.items.length > 1
    || probe.url !== path) throw Error('billing_project_access_unverified');
  const customer = await transport.get(path + '/' + encodeURIComponent(uid), true);
  if (customer === null) return true;
  if (customer.object !== 'customer' || customer.id !== uid || customer.project_id !== REVENUECAT_V2_PROJECT_ID) {
    throw Error('billing_account_mismatch');
  }
  return false;
}

/** One erasure attempt; not-found and uncertain outcomes are deliberately left for manual review. */
export async function requestRevenueCatV2Erasure(uid: string, apiProjectId: string, secret: string,
  options: { fetcher?: typeof fetch; now?: () => number } = {}): Promise<'deletion_requested' | 'needs_review'> {
  try {
    identity(uid); key(secret);
    if (apiProjectId !== REVENUECAT_V2_PROJECT_ID) return 'needs_review';
    const now = options.now ?? Date.now, signal = AbortSignal.timeout(LOOKUP_BUDGET_MS);
    const started = time(now());
    const response = await (options.fetcher ?? fetch)(`${API_ORIGIN}/v2/projects/${apiProjectId}/customers/${encodeURIComponent(uid)}`, {
      method: 'DELETE', redirect: 'error', headers: { authorization: `Bearer ${secret}`, accept: 'application/json' }, signal,
    });
    if (response.status !== 200) return 'needs_review';
    const body = await json(response, signal);
    if (body.object !== 'customer' || body.id !== uid || time(body.deleted_at) > now() + 30_000
      || now() < started || now() - started > LOOKUP_BUDGET_MS) return 'needs_review';
    return 'deletion_requested'; // Accepted asynchronous work, not verified final erasure.
  } catch { return 'needs_review'; }
}
