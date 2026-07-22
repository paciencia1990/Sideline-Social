const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadCoordinator() {
  const source = fs.readFileSync(path.join(process.cwd(), 'utils', 'activeSessionLoadState.ts'), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', output)(module, module.exports);
  return module.exports.createActiveSessionLoadCoordinator;
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

async function run() {
  const createCoordinator = loadCoordinator();
  const states = [];
  const diagnostics = [];
  let calls = 0;
  const permissionCoordinator = createCoordinator({
    fetchSession: async () => {
      calls += 1;
      return { status: 'permission-error' };
    },
    onDiagnostic: (status) => diagnostics.push(status),
    onStateChange: (state) => states.push(state),
  });
  await permissionCoordinator.setContext({ enabled: false, squadId: 'squad-a', userId: 'user-a' });
  assert.equal(calls, 0, 'authentication and membership resolution gate the request');
  await permissionCoordinator.setContext({ enabled: true, squadId: 'squad-a', userId: 'user-a' });
  assert.equal(calls, 1);
  assert.equal(permissionCoordinator.getState().status, 'permission-error');
  assert.equal(diagnostics.length, 1, 'one denied request writes one bounded diagnostic');
  await permissionCoordinator.setContext({ enabled: true, squadId: 'squad-a', userId: 'user-a' });
  assert.equal(calls, 1, 'render/context repetition does not retry a denied request');
  assert.equal(states.filter((state) => state.status === 'loading').length, 1);
  await permissionCoordinator.retry();
  assert.equal(calls, 2, 'Retry issues exactly one new request');
  assert.equal(permissionCoordinator.getState().status, 'permission-error');

  const pending = deferred();
  let concurrentCalls = 0;
  const concurrent = createCoordinator({
    fetchSession: () => {
      concurrentCalls += 1;
      return pending.promise;
    },
    onStateChange() {},
  });
  const first = concurrent.setContext({ enabled: true, squadId: 'squad-a', userId: 'user-a' });
  const duplicate = concurrent.setContext({ enabled: true, squadId: 'squad-a', userId: 'user-a' });
  assert.equal(concurrentCalls, 1, 'route refocus cannot overlap the same meaningful request');
  pending.resolve({ status: 'ready', session: null });
  await Promise.all([first, duplicate]);

  const squadA = deferred();
  const squadB = deferred();
  const selectedStates = [];
  const selected = createCoordinator({
    fetchSession: (squadId) => squadId === 'squad-a' ? squadA.promise : squadB.promise,
    onStateChange: (state) => selectedStates.push(state),
  });
  const oldRequest = selected.setContext({ enabled: true, squadId: 'squad-a', userId: 'user-a' });
  const newRequest = selected.setContext({ enabled: true, squadId: 'squad-b', userId: 'user-a' });
  squadB.resolve({ status: 'ready', session: { sessionId: 'new-session' } });
  await newRequest;
  squadA.resolve({ status: 'ready', session: { sessionId: 'stale-session' } });
  await oldRequest;
  assert.equal(selected.getState().session.sessionId, 'new-session', 'a stale response cannot replace the selected Squad result');

  const unmountPending = deferred();
  const afterUnmount = [];
  const unmounted = createCoordinator({
    fetchSession: () => unmountPending.promise,
    onStateChange: (state) => afterUnmount.push(state),
  });
  const unmountRequest = unmounted.setContext({ enabled: true, squadId: 'squad-a', userId: 'user-a' });
  const stateCountAtUnmount = afterUnmount.length;
  unmounted.dispose();
  unmountPending.resolve({ status: 'ready', session: { sessionId: 'ignored' } });
  await unmountRequest;
  assert.equal(afterUnmount.length, stateCountAtUnmount, 'unmount ignores stale responses');

  const gamesSource = fs.readFileSync(path.join(process.cwd(), 'app', '(tabs)', 'games.tsx'), 'utf8');
  const serviceSource = fs.readFileSync(path.join(process.cwd(), 'services', 'gameService.ts'), 'utf8');
  assert.match(gamesSource, /servicesUnavailable/);
  assert.match(gamesSource, /retryActiveSession/);
  assert.match(gamesSource, /!authLoading && !membershipLoading/);
  assert.match(gamesSource, /GAME_CARDS\.map/, 'game cards stay rendered during service errors');
  assert.match(gamesSource, /joinInput/, 'Join Code input stays available');
  assert.doesNotMatch(gamesSource, /active session error:/);
  assert.doesNotMatch(serviceSource, /orderByChild\("squadId"\)|equalTo\(squadId\)/, 'the client no longer queries all RTDB sessions by Squad');
  assert.match(serviceSource, /getActiveSquadGameSession/);

  console.log('Games active-session permission stability, deduplication, retry, stale-response, UI, and trusted-callable tests passed.');
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});

