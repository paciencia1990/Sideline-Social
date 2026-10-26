'use strict';
// New bounded profile-observation behavior only; fictional snapshots, no SDK imports.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const groups = [];
const snapshot = (fromCache = false, hasPendingWrites = false) => ({
  metadata: { fromCache, hasPendingWrites }, data: () => ({ marker: 'fictional-profile' }),
});
const sessionError = () => Object.assign(new Error('fictional session changed'), { code: 'team-read/session-unconfirmed' });
function signalFixture() {
  const listeners = new Set();
  const signal = { aborted: false, adds: 0, removes: 0,
    addEventListener(event, callback) { assert.equal(event, 'abort'); this.adds++; listeners.add(callback); },
    removeEventListener(event, callback) { assert.equal(event, 'abort'); this.removes++; listeners.delete(callback); },
  };
  return { signal, listeners, abort() { signal.aborted = true; [...listeners].forEach(callback => callback()); } };
}
function fixture({ initial, badSession = false, diagnosticThrows = false, subscribeThrows = false } = {}) {
  const timers = new Map(), abort = signalFixture(), unconfirmed = [];
  let sequence = 0, subscriptions = 0, stops = 0, sessionChecks = 0, current = !badSession;
  let next, error;
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'utils/confirmedProfileRead.ts'), 'utf8'), {
    fileName: 'utils/confirmedProfileRead.ts', reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  assert.deepEqual((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error), []);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', compiled.outputText)(
    name => { throw Error('unexpected live dependency: ' + name); }, module, module.exports,
    (callback, ms) => { const id = ++sequence; timers.set(id, { callback, ms }); return id; }, id => timers.delete(id),
  );
  return {
    timers, abort, unconfirmed,
    start(extra = {}) {
      return module.exports.waitForConfirmedProfile({
        signal: abort.signal,
        assertSession() { sessionChecks++; if (!current) throw sessionError(); },
        subscribe(onNext, onError) {
          subscriptions++; next = onNext; error = onError;
          if (subscribeThrows) throw Object.assign(new Error('fictional subscribe failure'), { code: 'unavailable' });
          initial?.(onNext, onError);
          return () => { stops++; };
        },
        onUnconfirmed(metadata) { unconfirmed.push(metadata); if (diagnosticThrows) throw Error('fictional diagnostic failure'); },
        ...extra,
      });
    },
    emit(value) { next(value); }, reject(value) { error(value); },
    changeSession() { current = false; },
    timeout() { const pending = [...timers.values()]; timers.clear(); pending.forEach(timer => timer.callback()); },
    counts: () => ({ subscriptions, stops, sessionChecks }),
  };
}
function clean(f, subscribed = 1) {
  assert.equal(f.counts().subscriptions, subscribed);
  assert.equal(f.counts().stops, subscribed);
  assert.equal(f.timers.size, 0);
  assert.equal(f.abort.listeners.size, 0);
  assert.equal(f.abort.signal.removes, f.abort.signal.adds);
}
async function test(name, run) { await run(); groups.push(name); }
async function main() {
  await test('one_observer_waits_through_cache_and_pending_writes', async () => {
    const f = fixture(); let accepted = false;
    const pending = f.start().then(value => { accepted = true; return value; });
    f.emit(snapshot(true, false)); f.emit(snapshot(false, true)); f.emit(snapshot(true, true));
    await Promise.resolve(); assert.equal(accepted, false); assert.equal(f.counts().subscriptions, 1);
    assert.equal(f.unconfirmed.length, 3);
    const confirmed = snapshot(); f.emit(confirmed); assert.equal(await pending, confirmed); clean(f);
  });
  await test('nonboolean_metadata_cannot_confirm_profile', async () => {
    const f = fixture(); let accepted = false; const pending = f.start().then(value => { accepted = true; return value; });
    f.emit({ metadata: { fromCache: false } }); f.emit({ metadata: { fromCache: 'false', hasPendingWrites: false } });
    await Promise.resolve(); assert.equal(accepted, false); assert.equal(f.unconfirmed.length, 0);
    f.emit(snapshot()); await pending; clean(f);
  });
  await test('session_must_match_before_observation', async () => {
    const f = fixture({ badSession: true }); await assert.rejects(f.start(), error => error.code === 'team-read/session-unconfirmed');
    clean(f, 0);
  });
  await test('changed_session_rejects_even_authoritative_metadata', async () => {
    const f = fixture(), pending = f.start();
    const rejected = assert.rejects(pending, error => error.code === 'team-read/session-unconfirmed');
    f.changeSession(); f.emit(snapshot()); await rejected; clean(f);
  });
  await test('bounded_timeout_stops_once_without_resubscription', async () => {
    const f = fixture(), pending = f.start();
    assert.equal([...f.timers.values()][0].ms, 15000);
    const rejected = assert.rejects(pending, error => error.code === 'deadline-exceeded');
    f.emit(snapshot(false, true)); f.timeout(); await rejected;
    const before = f.counts().sessionChecks; f.emit(snapshot()); f.abort.abort();
    assert.equal(f.counts().sessionChecks, before); clean(f);
  });
  await test('permission_failure_is_preserved_without_fallback', async () => {
    const f = fixture(), pending = f.start(), failure = Object.assign(new Error('fictional denied'), { code: 'permission-denied' });
    const rejected = assert.rejects(pending, error => error === failure);
    f.reject(failure); await rejected; f.emit(snapshot()); clean(f);
  });
  await test('preaborted_navigation_never_subscribes', async () => {
    const f = fixture(); f.abort.abort();
    await assert.rejects(f.start(), error => error.code === 'cancelled'); clean(f, 0);
  });
  await test('navigation_abort_cleans_wait_and_ignores_late_results', async () => {
    const f = fixture(), pending = f.start(); const rejected = assert.rejects(pending, error => error.code === 'cancelled');
    f.emit(snapshot(false, true)); f.abort.abort(); await rejected; f.emit(snapshot()); f.reject(Error('late fictional failure')); clean(f);
  });
  await test('synchronous_confirmation_still_unsubscribes_once', async () => {
    const value = snapshot(), f = fixture({ initial: next => next(value) });
    assert.equal(await f.start(), value); f.abort.abort(); clean(f);
  });
  await test('synchronous_error_still_unsubscribes_once', async () => {
    const failure = Object.assign(new Error('fictional error'), { code: 'unauthenticated' });
    const f = fixture({ initial: (_next, error) => error(failure) });
    await assert.rejects(f.start(), error => error === failure); clean(f);
  });
  await test('subscription_setup_failure_cleans_timer_and_abort_listener', async () => {
    const f = fixture({ subscribeThrows: true });
    await assert.rejects(f.start(), error => error.code === 'unavailable');
    assert.equal(f.counts().subscriptions, 1); assert.equal(f.counts().stops, 0);
    assert.equal(f.timers.size, 0); assert.equal(f.abort.listeners.size, 0);
  });
  await test('diagnostic_failure_has_no_authorization_effect', async () => {
    const f = fixture({ diagnosticThrows: true }), pending = f.start();
    f.emit(snapshot(false, true)); f.emit(snapshot()); await pending; clean(f);
  });
  await test('invalid_deadline_fails_before_subscription', async () => {
    for (const timeoutMs of [0, -1, Infinity, NaN]) {
      const f = fixture(); await assert.rejects(f.start({ timeoutMs }), error => error.code === 'failed-precondition'); clean(f, 0);
    }
  });
  console.log(JSON.stringify({ status: 'PROFILE_CONFIRMATION_CORE_PASSED', groups, groupCount: groups.length, networkRequests: 0, sdkImports: 0 }));
}
main().catch(error => { console.error(JSON.stringify({ status: 'PROFILE_CONFIRMATION_CORE_STOPPED', groups, error: String(error?.message || error) })); process.exitCode = 1; });
