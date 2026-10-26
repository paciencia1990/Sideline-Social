'use strict';
// One offline fixture for the new Firebase boundary. No compiler, listener,
// emulator, credentials or real network. Existing workflow suites are not run.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'internal/coach-ai-cleanup/firebase');
const config = require(path.join(directory, 'config.cjs'));
const {bufferedFirebaseRequest} = require(path.join(directory, 'request.cjs'));
const {createFirebaseConsole} = require(path.join(directory, 'console.cjs'));
const {createFirebaseObserver} = require(path.join(directory, 'observer.cjs'));
const out = process.argv[2];
assert.ok(out, 'an exclusive local evidence directory is required');
fs.mkdirSync(out, {recursive: true});
fs.writeFileSync(path.join(out, 'attempt-1.json'), JSON.stringify({startedAt: new Date().toISOString(),
  offlineOnly: true, build: false, liveRequests: 0, retries: 0}) + '\n', {flag: 'wx'});
const result = {passed: false, cases: [], liveRequests: 0, networkAttempts: 0,
  builds: 0, deployments: 0, moderationChanges: 0, retries: 0};
let currentCase;
const networkDenied = () => {result.networkAttempts++; throw Error('offline_network_denied');};
// Fail on unexpected outgoing traffic even if a factory is wired incorrectly.
for (const name of ['node:http', 'node:https']) {
  const module = require(name);
  module.request = networkDenied; module.get = networkDenied;
}
global.fetch = networkDenied;

function environment(patch = {}) {
  return {GCLOUD_PROJECT: config.PROJECT, FIREBASE_CONFIG: JSON.stringify({projectId: config.PROJECT}),
    CLEANUP_PROJECT_ID: config.PROJECT, CLEANUP_HOSTING_SITE: config.SITE, CLEANUP_ORIGIN: config.ORIGIN,
    CLEANUP_LOGIN_ENABLED: 'false', CLEANUP_READS_ENABLED: 'false', CLEANUP_MUTATIONS_ENABLED: 'false',
    CLEANUP_OBSERVER_ENABLED: 'false', ...patch};
}
function readingEnvironment(patch = {}) {
  return environment({CLEANUP_READS_ENABLED: 'true', CLEANUP_PRIMARY_UID: 'synthetic-primary',
    CLEANUP_BACKUP_UID: 'synthetic-backup', REVENUECAT_VERIFICATION_KEY: 'synthetic-verification-only', ...patch});
}
function request({method = 'POST', url = '/internal/coach-ai-cleanup', bytes = Buffer.from('{"action":"list"}'),
  headers = {}, rawHeaders, parsedBody} = {}) {
  const req = new EventEmitter();
  const head = method === 'POST' ? {'content-type': 'application/json', origin: config.ORIGIN,
    authorization: 'Bearer synthetic-operator-token', ...headers} : {...headers};
  Object.assign(req, {method, url, originalUrl: url, rawBody: bytes, body: parsedBody, headers: head,
    rawHeaders: rawHeaders ?? Object.entries(head).flatMap(([key, value]) => [key, value]), complete: true, aborted: false});
  return req;
}
function response() {
  const res = new EventEmitter();
  Object.assign(res, {destroyed: false, writableEnded: false,
    writeHead(status, headers) {this.status = status; this.headers = headers;},
    end(body) {this.body = body; this.writableEnded = true;}});
  return res;
}
async function invoke(handler, input) {
  const req = request(input), res = response();
  await handler(req, res);
  assert.equal(req.listenerCount('aborted'), 0, 'original request listeners are removed');
  return res;
}
async function test(name, action) {currentCase = name; await action(); result.cases.push({name, status: 'PASS'});}
function consoleFixture({answer = async () => ({status: 200, body: {records: []}}), env = readingEnvironment()} = {}) {
  let loads = 0, calls = 0, captured;
  const handler = createFirebaseConsole(env, {requestImpl: networkDenied, load() {
    loads++;
    return {Timestamp: class {}, createAdapter: () => async value => {calls++; captured = value; return answer(value);}};
  }});
  return {handler, loads: () => loads, calls: () => calls, captured: () => captured};
}

async function main() {
  await test('disabled_hosts_never_load_workflow_or_credentials', async () => {
    const neverLoad = () => {throw Error('disabled_module_loaded');};
    const consoleHandler = createFirebaseConsole(environment(), {load: neverLoad, requestImpl: networkDenied});
    assert.equal((await invoke(consoleHandler, {method: 'GET', url: '/healthz', bytes: Buffer.alloc(0)})).status, 200);
    assert.equal((await invoke(consoleHandler)).status, 503);
    const observer = createFirebaseObserver(environment(), {load: neverLoad, requestImpl: networkDenied});
    assert.equal((await invoke(observer, {method: 'GET', url: '/healthz', bytes: Buffer.alloc(0)})).status, 200);
    assert.equal((await invoke(observer, {url: '/', bytes: Buffer.from('{"mode":"health"}')})).status, 503);
  });
  await test('firebase_raw_bytes_take_precedence_over_parsed_body', async () => {
    const fixture = consoleFixture();
    const res = await invoke(fixture.handler, {parsedBody: {action: 'execute'}});
    assert.equal(res.status, 200); assert.equal(fixture.calls(), 1);
    assert.deepEqual(fixture.captured().body, {action: 'list'});
    assert.equal(fixture.captured().authorization, 'Bearer synthetic-operator-token');
    assert.equal(res.headers['Cache-Control'], 'no-store');
  });
  await test('parsed_body_without_raw_bytes_is_denied', async () => {
    const fixture = consoleFixture();
    const req = request({parsedBody: {action: 'list'}}); delete req.rawBody;
    const res = response(); await fixture.handler(req, res);
    assert.equal(res.status, 400); assert.equal(fixture.calls(), 0);
  });
  await test('mutation_gate_survives_the_firebase_adapter', async () => {
    const fixture = consoleFixture();
    assert.equal((await invoke(fixture.handler, {bytes: Buffer.from('{"action":"execute"}')})).status, 403);
    assert.equal(fixture.calls(), 0);
  });
  await test('foreign_origin_and_unreviewed_paths_are_denied', async () => {
    const fixture = consoleFixture();
    assert.equal((await invoke(fixture.handler, {headers: {origin: 'https://untrusted.invalid'}})).status, 403);
    for (const url of ['/internal/coach-ai-cleanup?x=1', '//untrusted.invalid/internal/coach-ai-cleanup',
      '/internal/coach-ai-cleanup/', '/host/runtime.cjs']) {
      assert.equal((await invoke(fixture.handler, {url})).status, 404);
    }
    assert.equal(fixture.calls(), 0);
  });
  await test('critical_header_duplicates_encodings_and_false_lengths_are_denied', async () => {
    const fixture = consoleFixture();
    const good = request().rawHeaders;
    assert.equal((await invoke(fixture.handler, {rawHeaders: [...good, 'Authorization', 'Bearer other']})).status, 403);
    for (const headers of [{'content-encoding': 'gzip'}, {'content-length': '1'}, {'authorization': ['one', 'two']},
      {'x-serverless-authorization': 'Bearer other'}]) {
      assert.equal((await invoke(fixture.handler, {headers})).status, 403);
    }
    assert.equal(fixture.calls(), 0);
  });
  await test('raw_byte_limits_apply_before_business_logic', async () => {
    const fixture = consoleFixture();
    assert.equal((await invoke(fixture.handler, {bytes: Buffer.alloc(16385)})).status, 413);
    assert.equal(fixture.calls(), 0);
    assert.throws(() => bufferedFirebaseRequest(request({url: '/', bytes: Buffer.alloc(257)}), {kind: 'observer'}),
      error => error.status === 413);
  });
  await test('operator_request_failure_stops_without_resubmission', async () => {
    const fixture = consoleFixture({answer: async () => {throw Error('synthetic-uncertain-commit');}});
    const res = await invoke(fixture.handler);
    assert.equal(res.status, 409); assert.equal(fixture.calls(), 1);
    assert.equal(res.body.includes('synthetic-uncertain-commit'), false);
    assert.equal(res.body.includes('synthetic-verification-only'), false);
  });
  await test('runtime_project_identity_and_capability_pins_fail_closed', () => {
    for (const patch of [{GCLOUD_PROJECT: 'other'}, {FIREBASE_CONFIG: '{}'}, {FIREBASE_CONFIG: '{'},
      {FUNCTION_TARGET: 'wrong'}, {FUNCTION_NAME: 'wrong'}, {CLEANUP_HOSTING_SITE: 'other'},
      {CLEANUP_ORIGIN: config.ORIGIN + '/'}, {CLEANUP_MUTATIONS_ENABLED: 'true'}, {CLEANUP_READS_ENABLED: 'yes'}]) {
      assert.throws(() => config.readFirebaseConsoleConfig(environment(patch)));
    }
    assert.throws(() => config.readFirebaseConsoleConfig(environment({GCLOUD_PROJECT: '', FIREBASE_CONFIG: undefined})));
    assert.throws(() => config.readFirebaseConsoleConfig(readingEnvironment({CLEANUP_BACKUP_UID: 'synthetic-primary'})));
  });
  await test('observer_uses_exact_function_audience_and_preserves_signed_headers', async () => {
    const env = environment({CLEANUP_OBSERVER_ENABLED: 'true', CLEANUP_OBSERVER_AUDIENCE: config.OBSERVER_URL,
      CLEANUP_SCHEDULER_SUBJECT_ID: '123456789012345678901'});
    assert.equal(config.readFirebaseObserverConfig(env).audience, config.OBSERVER_URL);
    for (const audience of ['https://example.run.app', config.OBSERVER_URL + '/observe', config.OBSERVER_URL + '?x=1']) {
      assert.throws(() => config.readFirebaseObserverConfig({...env, CLEANUP_OBSERVER_AUDIENCE: audience}));
    }
    const token = 'Bearer synthetic.signed.token';
    const req = request({url: '/', bytes: Buffer.from('{"mode":"health"}'), headers: {
      authorization: token, 'x-cloudscheduler-jobname': 'synthetic-job', 'x-cloudscheduler-scheduletime': 'synthetic-time'}});
    const adapted = bufferedFirebaseRequest(req, {kind: 'observer'});
    assert.equal(adapted.request.url, '/observe');
    assert.equal(adapted.request.headers.authorization, token);
    assert.equal(adapted.request.headers['x-cloudscheduler-scheduletime'], 'synthetic-time');
    const bytes = []; for await (const chunk of adapted.request) bytes.push(chunk);
    assert.equal(Buffer.concat(bytes).toString(), '{"mode":"health"}');
    adapted.dispose(); assert.equal(req.listenerCount('aborted'), 0);
    assert.throws(() => bufferedFirebaseRequest(request({url: '/observe'}), {kind: 'observer'}), error => error.status === 404);
  });
  await test('new_entrypoints_are_private_scoped_and_cache_failed_initialization', async () => {
    for (const [name, exported, account] of [['console', config.CONSOLE, 'coach-ai-cleanup-operator'],
      ['observer', config.OBSERVER, 'coach-ai-cleanup-observer']]) {
      let attempts = 0, options, region;
      const fakeSdk = {logger: {info: () => {}}, region(value) {region = value; return {runWith(value) {
        options = value; return {https: {onRequest: handler => handler}};
      }};}};
      const filename = path.join(directory, name + '-entry.cjs'), exportedModule = {};
      const expectedFactory = name === 'console' ? 'createFirebaseConsole' : 'createFirebaseObserver';
      const dependencies = {'firebase-functions/v1': fakeSdk, './config.cjs': config,
        './request.cjs': require(path.join(directory, 'request.cjs')),
        ['./' + name + '.cjs']: {[expectedFactory]: () => {attempts++; throw Error('synthetic-init-failure');}}};
      new vm.Script(fs.readFileSync(filename, 'utf8'), {filename}).runInNewContext({exports: exportedModule,
        require(id) {assert.ok(Object.hasOwn(dependencies, id)); return dependencies[id];}, process: {env: {}}});
      assert.deepEqual(Object.keys(exportedModule), [exported]);
      assert.equal(region, config.REGION); assert.equal(options.invoker, 'private'); assert.equal(options.maxInstances, 1);
      assert.equal(options.serviceAccount, account + '@' + config.PROJECT + '.iam.gserviceaccount.com');
      assert.equal(options.secrets, undefined);
      for (let n = 0; n < 2; n++) assert.equal((await invoke(exportedModule[exported])).status, 503);
      assert.equal(attempts, 1, 'a rejected initialization stays rejected across explicit requests');
    }
  });
  assert.equal(result.networkAttempts, 0);
  result.passed = true;
}
main().catch(error => {result.failedCase = currentCase;
  result.error = error.code === 'ERR_ASSERTION' ? 'assertion_failed' : 'fixture_stopped'; process.exitCode = 1;
}).finally(() => {result.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, 'result-1.json'), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify(result));});
