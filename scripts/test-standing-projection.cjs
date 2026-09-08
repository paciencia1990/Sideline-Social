'use strict';
const assert = require('node:assert/strict'), test = require('node:test');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('../functions/node_modules/typescript');
const projection = require('../functions/lib/standingProjection');
function extract(file, names) {
  const source = fs.readFileSync(path.join(__dirname, '../functions/src', file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const nodes = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text) ||
    ts.isVariableStatement(n) && n.declarationList.declarations.some(d => names.includes(d.name.getText(ast))));
  assert.equal(nodes.length, names.length);
  return nodes.map(n => n.getText(ast)).join('\n');
}
const code = ts.transpileModule(extract('accountStanding.ts', ['onAccountStandingChanged', 'timestampValue', 'readPublicReasonCode']) + '\n' +
  extract('permanentAuth.ts', ['resolveAccountStandingData', 'timestampMillis']), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
const barrier = () => { let release; return { promise: new Promise(r => { release = r; }), release: () => release() }; };
function runtime() {
  const records = new Map(); let realtime = null, pause = false;
  const entered = barrier(), released = barrier();
  class Timestamp { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } static now() { return new Timestamp(1); } }
  const reference = name => ({ path: name });
  const snapshot = name => { const row = records.get(name); return { exists: !!row, data: () => row?.data,
    updateTime: row ? { seconds: 100, nanoseconds: row.version } : undefined }; };
  const firestore = { collection: name => ({ doc: id => reference(name + '/' + id) }), runTransaction: async work => work({
    get: async ref => snapshot(ref.path), set: (ref, data) => records.set(ref.path, { data, version: 1 }), delete: ref => records.delete(ref.path),
  }) };
  const context = { exports: {}, ...projection, ...require('../functions/lib/standingObservation'), Timestamp, FieldValue: { serverTimestamp: () => 0 },
    PUBLIC_REASON_CODES: new Set(['communityGuidelines']),
    firebaseFunctions: { region: () => ({ firestore: { document: () => ({ onWrite: handler => handler }) } }) },
    admin: { firestore: () => firestore, database: () => ({ ref: name => {
      assert.equal(name, 'accountStanding/synthetic-target'); return { transaction: async update => {
        if (pause) { pause = false; entered.release(); await released.promise; }
        const next = update(realtime); if (next !== undefined) realtime = next;
      } };
    } }), auth: () => ({ revokeRefreshTokens: async () => {} }) }, cancelRestrictedArtifacts: async () => {},
  };
  vm.runInNewContext(code, context);
  const set = (revision, version, restricted = false) => records.set('accountStanding/synthetic-target', {
    data: { revision, status: 'active', messagingRestricted: restricted, expiresAt: null }, version,
  });
  const invoke = (deletedRevision = 1, deletedVersion = 1) => context.exports.onAccountStandingChanged({
    after: { exists: false, data: () => ({ revision: 999, messagingRestricted: true }) },
    before: { data: () => ({ revision: deletedRevision }), updateTime: { seconds: 100, nanoseconds: deletedVersion } },
  }, { eventId: 'synthetic-event', params: { uid: 'synthetic-target' } });
  return { records, set, invoke, entered, released, pause: () => { pause = true; },
    get realtime() { return realtime; }, close: () => { realtime = projection.deleteStandingProjection(realtime, 2, '100:2'); } };
}

test('actual handler reads current canonical standing despite stale delete/update event data', async () => {
  const r = runtime(); r.set(2, 2); await r.invoke(); await r.invoke();
  assert.equal(r.realtime.revision, 2); assert.equal(r.realtime.messagingRestricted, false);
  assert.equal(r.records.get('accountStandingPublic/synthetic-target').data.revision, 2);
});
test('actual delayed handler cannot overwrite a reversal in either projection', async () => {
  const r = runtime(); r.set(1, 1, true); r.pause(); const old = r.invoke(); await r.entered.promise;
  r.set(2, 2); await r.invoke(); r.released.release(); await old;
  assert.equal(r.realtime.version, '100:2'); assert.equal(r.realtime.messagingRestricted, false);
  assert.equal(r.records.get('accountStandingPublic/synthetic-target').data.revision, 2);
});
test('actual delayed handler cannot resurrect an old projection after cleanup deletion', async () => {
  const r = runtime(); r.set(1, 1, true); r.pause(); const old = r.invoke(); await r.entered.promise;
  r.set(2, 2); await r.invoke(); r.records.delete('accountStanding/synthetic-target'); await r.invoke(2, 2);
  r.released.release(); await old;
  assert.equal(r.realtime.deleted, true); assert.equal(r.realtime.messagingRestricted, false);
  assert.equal(r.records.has('accountStandingPublic/synthetic-target'), false);
});
test('deletion marker rejects late deletion across a new canonical generation', async () => {
  const r = runtime(); r.set(2, 2); await r.invoke(); r.records.delete('accountStanding/synthetic-target');
  r.pause(); const oldDelete = r.invoke(2, 2); await r.entered.promise;
  r.set(1, 3, true); await r.invoke(); r.released.release(); await oldDelete;
  assert.equal(r.realtime.version, '100:3'); assert.equal(r.realtime.messagingRestricted, true);
  assert.equal(r.realtime.deleted, undefined);
});

test('current canonical generation replaces an older public projection even when its revision restarts', async () => {
  const r = runtime(); r.set(3, 3); await r.invoke();
  r.records.delete('accountStanding/synthetic-target'); r.set(1, 4, true);
  await r.invoke(3, 3);
  assert.equal(r.realtime.version, '100:4');
  assert.equal(r.records.get('accountStandingPublic/synthetic-target').data.revision, 1);
  assert.equal(r.records.get('accountStandingPublic/synthetic-target').data.status, 'messagingRestricted');
});
