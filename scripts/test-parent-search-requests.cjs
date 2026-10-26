'use strict';
// Offline only: compile in memory; all services, clocks and timers are fake.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'docs/parent-search-local-20261023');
const result = { startedAt: new Date().toISOString(), groups: [], networkRequests: 0, builds: 0, retries: 0 };
function save(name, value) { fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function load(file, modules = {}, globals = {}) {
  const compiled = ts.transpileModule(read(file), { reportDiagnostics: true, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  } });
  assert.equal((compiled.diagnostics || []).length, 0, file + ' syntax');
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', 'Date', '__DEV__', compiled.outputText)(
    name => { assert.ok(Object.hasOwn(modules, name), 'Unexpected dependency: ' + name); return modules[name]; },
    module, module.exports, globals.setTimeout || setTimeout, globals.clearTimeout || clearTimeout, globals.Date || Date, false);
  return module.exports;
}
const core = load('utils/publicUserSearchRequests.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const serverLimited = () => Object.assign(new Error('mock limit'), { code: 'functions/resource-exhausted', details: { reason: 'rate_limited' } });
async function limitError(now) {
  const search = core.createPublicUserSearchRequests({ currentSession: () => session, now: () => now,
    load: async () => { throw serverLimited(); } });
  const session = { uid: 'synthetic-viewer' };
  try { await search('Example'); } catch (error) { return error; }
  throw Error('Expected mocked rate limit');
}
function clock() {
  let now = 100_000, id = 0; const tasks = new Map();
  return { now: () => now, Date: { now: () => now },
    setTimeout(fn, delay = 0) { const handle = ++id; tasks.set(handle, { fn, at: now + delay }); return handle; },
    clearTimeout(handle) { tasks.delete(handle); },
    async advance(ms) {
      const end = now + ms; let steps = 0;
      while (true) {
        const next = [...tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        assert.ok(++steps < 1000, 'Timers must remain bounded'); tasks.delete(next[0]); now = next[1].at;
        next[1].fn(); await tick();
      }
      now = end; await tick();
    },
  };
}
function hookHarness(handler) {
  const time = clock(), slots = [], calls = []; let cursor = 0, effects = [], dirty = false, mounted = true, late = 0, invalidations = 0;
  let props = { userId: 'viewer', query: 'Alpha', active: true, refreshVersion: 0 }, value;
  const changed = (slot, deps) => !slot || deps.some((item, index) => !Object.is(item, slot.deps[index]));
  const React = {
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, update => { if (!mounted) { late++; return; } const next = typeof update === 'function' ? update(slots[index].value) : update;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect, deps) { const index = cursor++, previous = slots[index]; if (changed(previous, deps)) effects.push(() => {
      previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() };
    }); },
  };
  const hook = load('hooks/useParentSearch.ts', { react: React,
    '@/services/friendsService': { searchParentsByName: query => { calls.push(query); return handler(query); } },
    '@/services/publicProfileService': { invalidatePublicUserSearchRequests: () => { invalidations++; } },
    '@/utils/publicUserSearchRequests': core,
  }, time).useParentSearch;
  return { time, calls,
    render(update = {}) { props = { ...props, ...update }; let passes = 0;
      do { assert.ok(++passes < 15, 'Hook must settle without a render loop'); dirty = false; cursor = 0; effects = [];
        value = hook(props.userId, props.query, props.active, props.refreshVersion); effects.forEach(effect => effect());
      } while (dirty); return value;
    },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); mounted = false; },
    lateWrites: () => late, invalidations: () => invalidations,
  };
}
async function group(name, run) { await run(); result.groups.push(name); console.log('PASS ' + name); }
async function main() {
  fs.mkdirSync(out, { recursive: true }); save('focused-attempt', { at: result.startedAt, offlineOnly: true, retries: 0 });
  await group('Identical pending searches share one request; limit and query remain separate', async () => {
    const session = { uid: 'viewer' }, gate = deferred(), calls = [];
    const search = core.createPublicUserSearchRequests({ currentSession: () => session, load: (query, limit) => { calls.push({ query, limit }); return gate.promise; } });
    const first = search('  Alpha   Beta '), same = search('alpha beta'); assert.equal(first, same);
    const different = search('Alpha Beta', 10); assert.notEqual(first, different); await tick();
    assert.deepEqual(calls, [{ query: 'Alpha Beta', limit: 20 }, { query: 'Alpha Beta', limit: 10 }]);
    gate.resolve(['synthetic']); await Promise.all([first, different]);
  });
  await group('Settled results are not cached; explicit relationship refresh invalidates pending work', async () => {
    const session = { uid: 'viewer' }; let count = 0;
    const search = core.createPublicUserSearchRequests({ currentSession: () => session, load: async () => ++count });
    assert.equal(await search('Alpha'), 1); assert.equal(await search('Alpha'), 2);
    const before = search('Beta'); search.invalidatePending(); const after = search('Beta');
    assert.notEqual(before, after); assert.deepEqual(await Promise.all([before, after]), [3, 4]);
  });
  await group('Account switches and same-account new sessions cannot receive old results', async () => {
    let session = { uid: 'a' }; const gates = [], calls = [];
    const search = core.createPublicUserSearchRequests({ currentSession: () => session, load: query => { const gate = deferred(); gates.push(gate); calls.push(query); return gate.promise; } });
    const old = search('Alpha'), rejected = assert.rejects(old, { code: 'public-search/session-changed' }); await tick();
    session = { uid: 'b' }; const next = search('Alpha'); await tick(); gates[0].resolve('old'); gates[1].resolve('new');
    await rejected; assert.equal(await next, 'new');
    const previous = search('Beta'), againRejected = assert.rejects(previous, { code: 'public-search/session-changed' }); await tick();
    session = { uid: 'b' }; const again = search('Beta'); await tick(); gates[2].resolve('old-session'); gates[3].resolve('current-session');
    await againRejected; assert.equal(await again, 'current-session'); assert.equal(calls.length, 4);
  });
  await group('Invalid and signed-out searches never reach the service', async () => {
    let session = { uid: 'viewer' }, calls = 0;
    const search = core.createPublicUserSearchRequests({ currentSession: () => session, load: async () => ++calls });
    for (const query of ['', 'a', '12', 'a'.repeat(81)]) await assert.rejects(search(query), { code: 'public-search/invalid-query' });
    await assert.rejects(search('Alpha', 21)); session = null; await assert.rejects(search('Alpha'), { code: 'public-search/unauthenticated' });
    assert.equal(calls, 0);
  });
  await group('Server rate limits pause every query; invalidation and timer expiry never retry', async () => {
    const session = { uid: 'viewer' }; let now = 1000, calls = 0;
    const search = core.createPublicUserSearchRequests({ currentSession: () => session, now: () => now,
      load: async () => { calls++; if (calls === 1) throw serverLimited(); return 'ok'; } });
    let failure; try { await search('Alpha'); } catch (error) { failure = error; }
    assert.equal(core.getPublicUserSearchRetryAt(failure), 62000);
    search.invalidatePending(); await assert.rejects(search('Beta'), error => core.getPublicUserSearchRetryAt(error) === 62000);
    now = 62001; await tick(); assert.equal(calls, 1); assert.equal(await search('Beta'), 'ok');
  });
  await group('The local rolling budget blocks the 31st request without a backend call', async () => {
    const session = { uid: 'viewer' }; let now = 1000, calls = 0;
    const search = core.createPublicUserSearchRequests({ currentSession: () => session, now: () => now, load: async () => ++calls });
    await Promise.all(Array.from({ length: 30 }, (_, index) => search('Example ' + index)));
    search.invalidatePending(); await assert.rejects(search('Other'), error => core.getPublicUserSearchRetryAt(error) === 62000);
    assert.equal(calls, 30); now = 62001; assert.equal(await search('Other'), 31);
  });
  await group('A different account has its own budget; backend resource failures stay generic', async () => {
    let session = { uid: 'a' }, calls = 0;
    const search = core.createPublicUserSearchRequests({ currentSession: () => session, load: async () => { calls++; if (session.uid === 'a') throw serverLimited(); return 'account-b'; } });
    await assert.rejects(search('Alpha')); session = { uid: 'b' }; assert.equal(await search('Alpha'), 'account-b'); assert.equal(calls, 2);
    const failure = Object.assign(new Error('mock resource error'), { code: 'functions/resource-exhausted', details: { reason: 'backend_resource_exhausted' } });
    const generic = core.createPublicUserSearchRequests({ currentSession: () => session, load: async () => { throw failure; } });
    await assert.rejects(generic('Alpha'), error => error === failure && core.getPublicUserSearchRetryAt(error) === null);
  });
  await group('Rapid edits dispatch only the final query after 600 milliseconds', async () => {
    const ui = hookHarness(async query => [query]); ui.render({ query: 'Al' }); await ui.time.advance(200);
    ui.render({ query: 'Alp' }); await ui.time.advance(200); ui.render({ query: 'Alpha' }); await ui.time.advance(599);
    assert.deepEqual(ui.calls, []); await ui.time.advance(1); assert.deepEqual(ui.calls, ['Alpha']);
    assert.deepEqual(ui.render().results, ['Alpha']); ui.unmount();
  });
  await group('Hidden screens and background transitions cancel scheduled searches and stale results', async () => {
    const gate = deferred(), ui = hookHarness(() => gate.promise);
    ui.render({ active: false }); await ui.time.advance(1000); assert.equal(ui.calls.length, 0);
    ui.render({ active: true }); await ui.time.advance(599); ui.render({ active: false }); await ui.time.advance(1000); assert.equal(ui.calls.length, 0);
    ui.render({ active: true }); await ui.time.advance(600); ui.render({ active: false }); gate.resolve(['hidden']); await tick();
    assert.deepEqual(ui.render().results, []); ui.unmount(); assert.equal(ui.lateWrites(), 0);
  });
  await group('Ordinary rerenders do not resend a search; explicit refresh requests fresh work', async () => {
    const ui = hookHarness(async query => [query]); ui.render(); await ui.time.advance(600); ui.render();
    for (let index = 0; index < 20; index++) ui.render({ unrelatedProfileObject: {}, unrelatedLanguageFunction: () => 'translated' });
    await ui.time.advance(5000); assert.equal(ui.calls.length, 1);
    ui.render({ refreshVersion: 1 }); await ui.time.advance(600); assert.equal(ui.calls.length, 2); assert.equal(ui.invalidations(), 1); ui.unmount();
  });
  await group('Out-of-order queries, account changes and unmount cannot publish stale data', async () => {
    const gates = [], ui = hookHarness(() => { const gate = deferred(); gates.push(gate); return gate.promise; });
    ui.render(); await ui.time.advance(600); ui.render({ query: 'Beta' }); await ui.time.advance(600);
    gates[1].resolve(['new-query']); await tick(); assert.deepEqual(ui.render().results, ['new-query']);
    gates[0].resolve(['old-query']); await tick(); assert.deepEqual(ui.render().results, ['new-query']);
    assert.deepEqual(ui.render({ userId: 'other' }).results, []); await ui.time.advance(600);
    ui.unmount(); gates[2].resolve(['after-unmount']); await tick(); assert.equal(ui.lateWrites(), 0);
  });
  await group('Rate-limit expiry only enables the manual search button, including after refocus', async () => {
    const failure = await limitError(100000); let count = 0;
    const ui = hookHarness(async () => { if (++count === 1) throw failure; return ['fresh']; });
    ui.render(); await ui.time.advance(600); let state = ui.render(); assert.equal(state.error, 'rate_limited'); assert.equal(state.canRetry, false);
    ui.render({ query: 'Beta' }); await ui.time.advance(1000); assert.equal(ui.calls.length, 1);
    ui.render({ refreshVersion: 1 }); await ui.time.advance(1000); assert.equal(ui.calls.length, 1);
    ui.render({ active: false }); await ui.time.advance(61000); state = ui.render({ active: true });
    assert.equal(state.canRetry, true); assert.equal(state.error, 'rate_limited'); await ui.time.advance(1000); assert.equal(ui.calls.length, 1);
    ui.render({ refreshVersion: 2 }); await ui.time.advance(600); assert.equal(ui.calls.length, 2); assert.deepEqual(ui.render().results, ['fresh']); ui.unmount();
  });
  await group('The visible wait timer enables the button without any automatic search', async () => {
    const failure = await limitError(100000), ui = hookHarness(async () => { throw failure; });
    ui.render(); await ui.time.advance(600); ui.render(); await ui.time.advance(61000);
    const state = ui.render(); assert.equal(state.canRetry, true); assert.equal(state.error, 'rate_limited'); assert.equal(ui.calls.length, 1); ui.unmount();
  });
  await group('Generic failures stay generic and do not retry on ordinary rerenders', async () => {
    const ui = hookHarness(async () => { throw Error('mock unavailable'); }); ui.render(); await ui.time.advance(600);
    const state = ui.render(); assert.equal(state.error, 'unavailable'); assert.equal(state.canRetry, true);
    await ui.time.advance(60000); ui.render(); assert.equal(ui.calls.length, 1); ui.unmount();
  });
  await group('The real service preserves callable payload and profile privacy filtering', async () => {
    const auth = { currentUser: { uid: 'viewer' } }, gate = deferred(), calls = [];
    const service = load('services/publicProfileService.ts', {
      'firebase/functions': { httpsCallable: (_functions, name) => body => { calls.push({ name, body }); return gate.promise; } },
      '@/config/firebase': { auth, functions: {} }, '@/utils/friendRequestMapping': load('utils/friendRequestMapping.ts'),
      '@/utils/friendPrivacy': load('utils/friendPrivacy.ts'), '@/utils/publicUserSearchRequests': core,
    });
    const first = service.searchPublicUserProfiles(' Alpha '), same = service.searchPublicUserProfiles('alpha'); assert.equal(first, same); await tick();
    assert.deepEqual(calls, [{ name: 'searchPublicUserProfiles', body: { query: 'Alpha', limit: 20 } }]);
    gate.resolve({ data: { results: [
      { userId: 'synthetic-peer', displayName: 'Alpha Example', relationship: 'none', email: 'private@example.test' },
      { userId: 'synthetic-hidden', displayName: 'Hidden Example', relationship: 'none', profileState: 'deleted' },
      { userId: 'synthetic-private', displayName: 'private@example.test', relationship: 'none' },
      { userId: 'synthetic-invalid', displayName: 'Invalid Example', relationship: 'unrecognized' },
    ] } });
    const rows = await first; assert.equal(rows.length, 1); assert.equal(rows[0].userId, 'synthetic-peer');
    assert.equal(JSON.stringify(rows).includes('private@example.test'), false); await same;
  });
  await group('English/Spanish waiting copy and focused UID-based screen wiring are present', async () => {
    const ast = ts.createSourceFile('i18n/index.ts', read('i18n/index.ts'), ts.ScriptTarget.Latest, true), blocks = [];
    function visit(node) { if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'friends' && ts.isObjectLiteralExpression(node.initializer)) blocks.push(node.initializer); ts.forEachChild(node, visit); }
    visit(ast); assert.equal(blocks.length, 2);
    for (const key of ['searchRateLimitedTitle', 'searchRateLimitedBody', 'searchRateLimitReadyBody', 'searchAgain', 'searchWait']) {
      const values = blocks.map(block => block.properties.filter(p => ts.isPropertyAssignment(p) && p.name.getText(ast) === key));
      for (const value of values) { assert.equal(value.length, 1); assert.ok(ts.isStringLiteral(value[0].initializer) && value[0].initializer.text.length > 0); }
      assert.notEqual(values[0][0].initializer.text, values[1][0].initializer.text);
    }
    const screen = read('app/(tabs)/friends.tsx');
    assert.ok(screen.includes('useParentSearch(user?.uid, normalizedSearchText, searchActive && !authLoading, searchRefreshVersion)'));
    assert.ok(screen.includes('setSearchActive(nextState === "active")'));
    assert.ok(screen.includes('focused.current = false; setSearchActive(false)'));
    assert.ok(screen.includes('disabled={!canRetry}')); assert.ok(screen.includes('accessibilityState={{ disabled: !canRetry }}'));
    assert.ok(screen.includes('accessibilityLiveRegion="polite"')); assert.ok(screen.includes('maxLength={80}'));
  });
  result.state = 'SIXTEEN_FOCUSED_OFFLINE_GROUPS_PASSED';
}
main().catch(error => { result.state = 'STOPPED_NO_RETRY'; result.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => { result.completedAt = new Date().toISOString(); save('focused-result', result); console.log(JSON.stringify(result)); });
