'use strict';
const assert = require('node:assert/strict');
const { createHash, createHmac } = require('node:crypto');
const { createRequire } = require('node:module');
const { join } = require('node:path');
const { createSourceLoader, root } = require('./coach-ai-test-loader.cjs');
const { createMemoryFirestore } = require('./coach-ai-memory-firestore.cjs');
const fixture = require('./coach-ai-revenuecat-v2-fixture.cjs');
const realFetch = global.fetch, realTimeout = global.setTimeout, realClear = global.clearTimeout;
const token = 'a1'.repeat(32), signingSecret = 'offline-fixture-hmac-never-a-real-secret'.repeat(2);
const timers = new Map();
let timerId = 0, assertions = 0;
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
// Exercise the actual 45-second handler callback without a wait or network.
global.setTimeout = (callback, delay, ...args) => {
  assert.equal(delay, 45000); const id = ++timerId; timers.set(id, () => callback(...args)); return id;
};
global.clearTimeout = id => timers.delete(id);
function deadline() { assert.equal(timers.size, 1); [...timers.values()][0](); }

async function harness(mode = 'signed', paid = 'true', settings = {}) {
  fixture.installFixtureEnvironment();
  Object.assign(process.env, { COACH_AI_WEBHOOK_MODE: mode, COACH_AI_PAID_ENABLED: paid,
    COACH_AI_BILLING_ENVIRONMENT: 'production', REVENUECAT_WEBHOOK_AUTH_TOKEN: token,
    REVENUECAT_WEBHOOK_SIGNING_SECRET: signingSecret });
  const memory = createMemoryFirestore(), logs = [], reads = [], calls = [], fixtureNow = Date.now();
  await memory.db.doc('coachAiInternalConfig/billing').set(fixture.configuration());
  for (const uid of ['webhook_fixture_a', 'webhook_fixture_b', 'webhook_fixture_c']) await memory.db.doc(`users/${uid}`).set({ activeMode: 'coach' });
  const db = { ...memory.db, doc: path => {
    const ref = memory.db.doc(path);
    return { ...ref, get: async () => { reads.push(path); return settings.get ? settings.get(path, ref) : ref.get(); } };
  } };
  const firestore = { ...memory.overrides['firebase-admin/firestore'], getFirestore: () => db };
  const functions = createRequire(join(root, 'functions/package.json'))('firebase-functions/v1');
  const load = createSourceLoader({ ...memory.overrides, 'firebase-admin/firestore': firestore,
    'firebase-functions/v1': { ...functions, logger: { ...functions.logger, error: (...values) => logs.push(values) } } });
  const billing = load('functions/src/coachAiBilling.ts');
  global.fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.revenuecat.com'); assert.equal(options.method, 'GET');
    assert.match(url.pathname, /^\/v2\/projects\/projec5f2a61\//); assert.equal(options.redirect, 'error');
    calls.push(url.pathname);
    if (settings.fetch) return settings.fetch(url, options, calls);
    const uid = decodeURIComponent(url.pathname.match(/\/customers\/([^/]+)/)?.[1] ?? settings.currentUid ?? 'webhook_fixture_a');
    const values = fixture.fixtures(uid, fixtureNow);
    let body;
    if (url.pathname.endsWith(`/customers/${uid}`)) body = values.customer;
    else if (url.pathname.endsWith('/subscriptions') && url.pathname.includes('/customers/')) body = fixture.list([values.subscription]);
    else if (url.pathname.endsWith('/subscriptions/subfixturecoachai')) body = values.subscription;
    else if (url.pathname.endsWith('/active_entitlements')) body = values.active;
    else throw new Error('unexpected_fixture_endpoint');
    return new Response(JSON.stringify(body));
  };
  async function deliver(overrides = {}, event = {}) {
    const payload = { api_version: '1.0', event: { id: 'webhook_fixture_event', type: 'RENEWAL', environment: 'PRODUCTION',
      app_id: fixture.appIds[0], app_user_id: 'webhook_fixture_a', ...event } };
    const rawBody = overrides.rawBody ?? Buffer.from(JSON.stringify(payload));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = Buffer.isBuffer(rawBody) ? `t=${timestamp},v1=${createHmac('sha256', signingSecret).update(`${timestamp}.`).update(rawBody).digest('hex')}` : '';
    const headers = { authorization: `Bearer ${token}`, 'x-revenuecat-webhook-signature': signature, ...overrides.headers };
    const request = { method: 'POST', rawBody, body: payload, get: name => headers[name], ...overrides, headers: undefined };
    const reply = { statusCode: 0, body: null, replies: 0, set() {}, status(code) { this.statusCode = code; return this; },
      json(body) { this.replies++; assert.equal(this.replies, 1); this.body = body; } };
    const completion = billing.coachAiRevenueCatWebhook(request, reply);
    return { reply, completion };
  }
  function eventRef(id = 'webhook_fixture_event') { return memory.db.doc(`coachAiBillingEvents/${createHash('sha256').update(`production:${id}`).digest('hex')}`); }
  return { billing, memory, calls, logs, reads, deliver, eventRef };
}
async function result(h, overrides, event) { const r = await h.deliver(overrides, event); await r.completion; return r.reply; }

async function run() {
  let h = await harness('bootstrap', 'false');
  assert.deepEqual(h.billing.coachAiRevenueCatWebhook.__endpoint.secretEnvironmentVariables.map(v => v.key), ['REVENUECAT_WEBHOOK_AUTH_TOKEN']);
  assert.equal(h.billing.coachAiRevenueCatWebhook.__endpoint.timeoutSeconds, 60);
  assert.deepEqual((await result(h, { headers: { 'x-revenuecat-webhook-signature': undefined } })).body, { received: true, disabled: true });
  assert.equal(h.reads.length, 0); assert.equal(h.calls.length, 0);
  process.env.COACH_AI_PAID_ENABLED = 'true'; assert.equal((await result(h)).statusCode, 401);
  delete process.env.COACH_AI_PAID_ENABLED; assert.equal((await result(h)).statusCode, 401);
  assertions += 6;

  h = await harness('signed', 'false');
  assert.deepEqual(h.billing.coachAiRevenueCatWebhook.__endpoint.secretEnvironmentVariables.map(v => v.key),
    ['REVENUECAT_WEBHOOK_AUTH_TOKEN', 'REVENUECAT_WEBHOOK_SIGNING_SECRET', 'REVENUECAT_VERIFICATION_KEY']);
  assert.equal((await result(h)).body.disabled, true);
  for (const overrides of [
    { method: 'GET' }, { rawBody: {} }, { rawBody: Buffer.alloc(128 * 1024 + 1) },
    { headers: { authorization: undefined } }, { headers: { authorization: 'Bearer incorrect' } },
    { headers: { 'x-revenuecat-webhook-signature': undefined } },
    { headers: { 'x-revenuecat-webhook-signature': 't=1000000000,v1=' + '0'.repeat(64) } },
  ]) assert.equal((await result(h, overrides)).statusCode, 401);
  process.env.COACH_AI_WEBHOOK_MODE = 'unknown'; assert.equal((await result(h)).statusCode, 401);
  assert.equal(h.reads.length, 0); assert.equal(h.calls.length, 0);
  const core = createSourceLoader()('functions/src/coachAiBillingCore.ts');
  assert.equal(core.verifyRevenueCatWebhook(Buffer.from('{}'), 't=1000000000,v1=' + '0'.repeat(64), signingSecret, NaN), false);
  assertions += 13;

  h = await harness();
  // The signed raw bytes are authoritative, even if a parsed-body field differs.
  const reply = await result(h, { body: { event: { app_user_id: 'spoofed_parsed_body' } } });
  assert.equal(reply.statusCode, 200); assert.equal(h.calls.length, 4);
  assert.equal((await h.eventRef().get()).data().status, 'completed');
  assert.equal((await result(h)).body.duplicate, true); assert.equal(h.calls.length, 4);
  assert.ok(h.calls.every(path => !path.includes('spoofed')));
  assertions += 6;

  h = await harness();
  const concurrent = await Promise.all([h.deliver(), h.deliver()]); await Promise.all(concurrent.map(r => r.completion));
  assert.equal(h.calls.length, 4, 'One claim wins; the contention failure never replays the transaction');
  assert.equal((await h.eventRef().get()).data().status, 'completed');
  assert.ok(concurrent.every(r => r.reply.statusCode === 200));
  assertions += 3;

  h = await harness('signed', 'true', { fetch: async () => new Response('{}', { status: 503 }) });
  assert.equal((await result(h)).body.needsReview, true); assert.equal(h.calls.length, 1);
  assert.equal((await h.eventRef().get()).data().status, 'needs_review');
  assert.equal((await result(h)).body.duplicate, true); assert.equal(h.calls.length, 1);
  assertions += 5;

  h = await harness();
  for (const [overrides, event] of [[{}, { app_id: 'appunapproved' }], [{ rawBody: Buffer.from('{bad json') }, {}], [{}, { type: '' }]]) {
    const r = await result(h, overrides, event); assert.equal(r.statusCode, 200); assert.equal(r.body.ignored, true);
  }
  assert.equal(h.calls.length, 0); assert.equal((await h.eventRef().get()).exists, false);
  assert.equal((await result(h, {}, { type: 'TEST', app_user_id: undefined })).statusCode, 200); assert.equal(h.calls.length, 0);
  assertions += 10;

  h = await harness('signed', 'true', { get: async () => { throw Error('private-provider-details-must-not-be-logged'); } });
  assert.equal((await result(h)).body.needsReview, true); assert.equal(h.calls.length, 0);
  assert.ok(!JSON.stringify(h.logs).includes('private-provider')); assertions += 3;

  const held = deferred(), entered = deferred();
  h = await harness('signed', 'true', { get: async (path, ref) => {
    if (path === 'coachAiInternalConfig/billing') { entered.resolve(); await held.promise; }
    return ref.get();
  } });
  let pending = await h.deliver(); await entered.promise; deadline();
  assert.equal(pending.reply.body.needsReview, true); assert.equal(pending.reply.replies, 1);
  held.resolve(); await pending.completion;
  assert.equal(h.calls.length, 0); assert.equal((await h.eventRef().get()).exists, false);
  assertions += 4;

  const fetching = deferred(); let signals = [];
  h = await harness('signed', 'true', { fetch: (url, options) => {
    signals.push(options.signal); fetching.resolve();
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  } });
  pending = await h.deliver({}, { type: 'TRANSFER', transferred_from: ['webhook_fixture_a'], transferred_to: ['webhook_fixture_b', 'webhook_fixture_c'] });
  await fetching.promise; deadline(); await pending.completion;
  assert.equal(pending.reply.statusCode, 200); assert.equal(pending.reply.body.needsReview, true);
  assert.equal(h.calls.length, 1); assert.ok(signals.every(signal => signal.aborted));
  assert.equal((await h.eventRef().get()).data().status, 'needs_review');
  assert.ok(!h.reads.includes('users/webhook_fixture_b')); assert.ok(!h.reads.includes('users/webhook_fixture_c'));
  assert.equal((await result(h, {}, { type: 'TRANSFER', transferred_from: ['webhook_fixture_a'], transferred_to: ['webhook_fixture_b', 'webhook_fixture_c'] })).body.duplicate, true);
  assert.equal(h.calls.length, 1); assertions += 9;

  const adapter = createSourceLoader()('functions/src/coachAiRevenueCatV2.ts'), abort = new AbortController(); abort.abort();
  let attempts = 0;
  await assert.rejects(adapter.lookupRevenueCatV2('webhook_fixture_a', adapter.parseRevenueCatV2Config(fixture.configuration(), 'production', fixture.appIds),
    process.env.REVENUECAT_VERIFICATION_KEY, { signal: abort.signal, fetcher: async () => { attempts++; throw Error('should_not_start'); } }));
  assert.equal(attempts, 0); assert.equal(timers.size, 0); assertions += 2;
  for (const value of h.logs) {
    assert.ok(!JSON.stringify(value).includes(token)); assert.ok(!JSON.stringify(value).includes(signingSecret));
    assert.ok(!JSON.stringify(value).includes('webhook_fixture_a'));
  }
  console.log(`Webhook local fixtures passed (${assertions} checks): bootstrap isolation, dual authentication, signed raw bytes, scope, concurrent deduplication, review recovery, 45-second abort and zero replay. No live network, emulator, build or deployment.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  global.fetch = realFetch; global.setTimeout = realTimeout; global.clearTimeout = realClear;
});
