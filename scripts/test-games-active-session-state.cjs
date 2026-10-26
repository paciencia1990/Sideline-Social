'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const loaded = { exports: {} };
const code = ts.transpileModule(read('utils/coalescedRefresh.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function('module', 'exports', code)(loaded, loaded.exports);
const { createCoalescedRefresh } = loaded.exports;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

async function run() {
  const gate = deferred(), failures = []; let calls = 0;
  const controller = createCoalescedRefresh({
    load: () => { calls++; return gate.promise; },
    merge: (a, b) => a && b, onSuccess() {}, onError: error => failures.push(error),
  });
  const first = controller.refresh(false, false);
  assert.equal(controller.refresh(false, false), first, 'Concurrent focus reads share one request');
  await tick(); assert.equal(calls, 1);
  gate.reject(Object.assign(Error('denied'), { code: 'not_authorized' }));
  await first; await tick();
  assert.equal(calls, 1, 'A denied read is not automatically repeated');
  assert.equal(failures.length, 1);
  controller.dispose();

  const stale = deferred(), fresh = deferred(), results = []; let requests = 0;
  const scoped = createCoalescedRefresh({
    load: () => ++requests === 1 ? stale.promise : fresh.promise,
    merge: (a, b) => a && b, onSuccess: result => results.push(result), onError() {},
  });
  const old = scoped.refresh(false, false); await tick(); scoped.dispose();
  stale.resolve('old-account'); await old;
  assert.deepEqual(results, [], 'Disposed scope cannot publish a stale result');
  scoped.activate(); const next = scoped.refresh(false, false); await tick();
  fresh.resolve('current-account'); await next;
  assert.deepEqual(results, ['current-account']); scoped.dispose();

  const directory = read('hooks/useSquadGameLobbies.ts');
  const focused = read('hooks/useFocusedGameRefresh.ts');
  const games = read('app/(tabs)/games.tsx');
  assert.match(directory, /Boolean\(enabled && uid && squadId\)/);
  assert.match(directory, /JSON\.stringify\(\[active, uid, squadId/);
  assert.match(directory, /useCoalescedRefresh\(scope/);
  assert.match(directory, /listGameLobbies\(\{ squadId/);
  assert.match(directory, /reason === "not_authorized"\) setResult\(null\)/);
  assert.match(directory, /useFocusedGameRefresh\(active, focusedRefresh\)/);
  assert.match(focused, /useFocusEffect/);
  assert.match(focused, /if \(!enabled\) return/);
  assert.match(focused, /AppState\.addEventListener/);
  assert.match(focused, /next !== "active"\) stop\(\)/);
  assert.match(focused, /stop\(\); subscription\.remove\(\)/);
  assert.match(games, /useSquadGameLobbies/);
  assert.doesNotMatch(games, /useActiveSquadGameSession/);
  assert.match(games, /!authLoading && !membershipLoading/);
  assert.match(games, /GAME_CARDS\.map/);
  assert.match(games, /joinInput/);
  console.log('Current game-directory coalescing, denial, scope disposal, membership gating and focus cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
