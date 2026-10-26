'use strict';
// Actual source functions, mocked reads and fake timers only. No SDK is loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const { createSourceLoader } = require('./coach-ai-test-loader.cjs');
const pure = createSourceLoader();
const { buildParentHomeTeamRows } = pure('utils/parentTeamCore.ts');
const { isAuthorizationFailure } = pure('utils/parentTeamInboxCore.ts');
function declaration(file, name, scope) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const node = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(node, name);
  const compiled = ts.transpileModule(node.getText(source).replace(/^export\s+/, '') + '\nmodule.exports = ' + name + ';', {
    fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  new Function('module', ...Object.keys(scope), compiled)(module, ...Object.values(scope));
  return module.exports;
}
const parentFile = 'services/parentTeamService.ts';
const resolveChildLinksByTeam = declaration(parentFile, 'resolveChildLinksByTeam', {});
const resolveMembershipChildren = declaration(parentFile, 'resolveMembershipChildren', {});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const spin = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const failed = code => Object.assign(new Error('Fictional read failure'), { code });
function fixture() {
  const user = { uid: 'parent_fixture' }, auth = { currentUser: user }, timers = new Map();
  const calls = { ready: 0, membership: 0, profiles: 0, links: 0 };
  const state = {
    memberships: [{ teamId: 'team_fixture', childId: null, childName: 'Legacy Player', team: { id: 'team_fixture', name: 'Fictional Team' } }],
    profiles: [], links: [], membershipError: null, profileError: null, linkError: null,
    profileWait: null, linkWait: null, membershipWait: null,
  };
  const scope = {
    auth, buildParentHomeTeamRows, resolveChildLinksByTeam, resolveMembershipChildren, isAuthorizationFailure,
    requireTeamReadReady: async uid => { calls.ready++; assert.equal(uid, user.uid); return user; },
    getParentTeams: async options => { calls.membership++; assert.equal(options.requireComplete, true); assert.equal(options.throwOnError, true);
      if (state.membershipError) throw state.membershipError;
      if (state.membershipWait) await state.membershipWait.promise;
      return state.memberships; },
    getCurrentUserChildren: async () => { calls.profiles++; if (state.profileError) throw state.profileError;
      if (state.profileWait) return state.profileWait.promise; return state.profiles; },
    loadActiveTeamChildLinkRecords: async () => { calls.links++; if (state.linkError) throw state.linkError;
      if (state.linkWait) return state.linkWait.promise; return state.links; },
    setTimeout: (callback, ms) => { assert.equal(ms, 5000); const id = {}; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
  };
  return { auth, state, calls, timers, run: declaration(parentFile, 'getParentHomeTeamsSummary', scope) };
}
const groups = [];
async function test(name, run) { await run(); groups.push(name); }
async function main() {
  await test('complete_child_links_preserve_each_confirmed_child_team_row', async () => {
    const f = fixture(); f.state.memberships[0].childName = '';
    f.state.profiles = [{ id: 'child_one', displayName: 'Player One' }, { id: 'child_two', displayName: 'Player Two' }];
    f.state.links = [{ teamId: 'team_fixture', childIds: ['child_one', 'child_two'] }];
    const result = await f.run(); assert.equal(result.totalTeams, 1); assert.equal(result.childDetailsAvailable, true);
    assert.deepEqual(result.rows.map(row => row.childName), ['Player One', 'Player Two']);
    assert.deepEqual(f.calls, { ready: 1, membership: 1, profiles: 1, links: 1 });
  });
  await test('transient_child_failure_preserves_membership_team_without_inventing_child', async () => {
    const f = fixture(); f.state.profileError = failed('unavailable');
    const result = await f.run(); assert.equal(result.totalTeams, 1); assert.equal(result.childDetailsAvailable, false);
    assert.equal(result.rows[0].teamName, 'Fictional Team'); assert.equal(result.rows[0].childName, 'Legacy Player');
    const withoutLegacy = fixture(); withoutLegacy.state.memberships[0].childName = ''; withoutLegacy.state.linkError = failed('unavailable');
    const plain = await withoutLegacy.run(); assert.equal(plain.rows[0].childName, null); assert.equal(plain.rows[0].childId, null);
  });
  await test('optional_child_reads_are_bounded_once_and_do_not_retry', async () => {
    const f = fixture(); f.state.profileWait = deferred(); f.state.linkWait = deferred();
    const pending = f.run(); await spin(); assert.equal(f.timers.size, 2);
    for (const callback of [...f.timers.values()]) callback();
    const result = await pending; assert.equal(result.childDetailsAvailable, false); assert.equal(result.totalTeams, 1);
    f.state.profileWait.resolve([]); f.state.linkWait.resolve([]); await spin();
    assert.deepEqual(f.calls, { ready: 1, membership: 1, profiles: 1, links: 1 });
  });
  await test('authorization_failures_never_become_optional_fallback', async () => {
    for (const code of ['permission-denied', 'unauthenticated', 'auth/user-disabled']) {
      const f = fixture(); f.state.profileError = failed(code); await assert.rejects(f.run(), error => error.code === code);
    }
    const f = fixture(); f.state.linkError = failed('permission-denied');
    await assert.rejects(f.run(), error => error.code === 'permission-denied');
  });
  await test('membership_failure_and_account_change_fail_closed', async () => {
    const denied = fixture(); denied.state.membershipError = failed('permission-denied');
    await assert.rejects(denied.run(), error => error.code === 'permission-denied'); assert.equal(denied.calls.profiles, 0);
    const switched = fixture(); switched.state.profileWait = deferred();
    const pending = switched.run(); await spin(); switched.auth.currentUser = { uid: 'another_parent' }; switched.state.profileWait.resolve([]);
    await assert.rejects(pending, error => error.code === 'auth/user-mismatch');
  });
  await test('confirmed_empty_membership_does_not_read_child_collections', async () => {
    const f = fixture(); f.state.memberships = [];
    assert.deepEqual(await f.run(), { rows: [], totalTeams: 0, childDetailsAvailable: true });
    assert.equal(f.calls.profiles, 0); assert.equal(f.calls.links, 0);
  });
  await test('child_getter_ignores_legacy_name_index_without_any_write', async () => {
    const user = { uid: 'parent_fixture' }, auth = { currentUser: user }; let writes = 0;
    const normalizeChildProfile = declaration('services/childService.ts', 'normalizeChildProfile', {
      readString: value => typeof value === 'string' ? value.trim() : '',
    });
    const run = declaration('services/childService.ts', 'getCurrentUserChildren', {
      auth, db: {}, collection: (...parts) => parts, normalizeChildProfile,
      getDocs: async () => ({ docs: [{ id: 'child_fixture', data: () => ({ displayName: ' Player ', normalizedName: 'player' }) }] }),
      updateDoc: async () => { writes++; }, deleteField: () => { writes++; }, serverTimestamp: () => { writes++; },
    });
    const children = await run(); assert.equal(children[0].displayName, 'Player'); assert.equal(writes, 0);
    assert.equal(Object.hasOwn(children[0], 'normalizedName'), false);
  });
  await test('child_getter_rejects_old_account_results', async () => {
    const user = { uid: 'parent_fixture' }, auth = { currentUser: user }, wait = deferred();
    const run = declaration('services/childService.ts', 'getCurrentUserChildren', {
      auth, db: {}, collection: (...parts) => parts, normalizeChildProfile: () => { throw Error('old_account_data_must_not_normalize'); },
      getDocs: () => wait.promise,
    });
    const pending = run(); auth.currentUser = { uid: 'another_parent' }; wait.resolve({ docs: [] });
    await assert.rejects(pending, error => error.code === 'auth/user-mismatch');
  });
  console.log(JSON.stringify({ status: 'PASS', groups: groups.length, names: groups, networkRequests: 0, writes: 0, builds: 0, retries: 0 }));
}
main().catch(error => { console.error(JSON.stringify({ status: 'FAIL', completed: groups, message: error.message })); process.exitCode = 1; });
