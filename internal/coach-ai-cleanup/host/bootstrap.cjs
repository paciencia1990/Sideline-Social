'use strict';
const http = require('node:http');
const path = require('node:path');
const {createRequire} = require('node:module');
const {readConsoleConfig, readObserverConfig} = require('./config.cjs');
const {createCleanupApplication} = require('./application.cjs');
const {createObserverHost} = require('../observer/server.cjs');
const {createObserverRuntime} = require('../observer/runtime.cjs');
// Fixed, separately packaged module paths. Never load the Functions index (which
// exports live app/moderation handlers), transpile source, or accept an env path.
function loadPackaged(kind) {
  const root = path.resolve(__dirname, '../../..');
  if (kind === 'observer') return require(path.join(root, 'functions/lib/coachAiCleanupQueueMonitor.js'));
  const workflow = require(path.join(root, 'functions/lib/coachAiCleanupInterface.js'));
  const backendRequire = createRequire(path.join(root, 'functions/package.json'));
  return {createAdapter:workflow.createCoachAiCleanupInterface, Timestamp:backendRequire('firebase-admin/firestore').Timestamp};
}
function prepareCleanupHost(kind, env, {load = loadPackaged, requestImpl, log, now} = {}) {
  if (kind === 'console') {
    const config = readConsoleConfig(env);
    const dependencies = config.readsEnabled ? load(kind) : {};
    if (config.readsEnabled && (typeof dependencies.createAdapter !== 'function' || typeof dependencies.Timestamp !== 'function')) throw Error('cleanup_packaged_dependencies');
    return {port:config.port, handler:createCleanupApplication({...config, ...dependencies, requestImpl})};
  }
  if (kind === 'observer') {
    const config = readObserverConfig(env);
    const core = config.enabled ? load(kind) : null;
    if (config.enabled && (!core || typeof core.createCleanupQueueMonitor !== 'function'
      || typeof core.CLEANUP_COLLECTIONS !== 'object' || !Array.isArray(core.CLEANUP_FIELDS))) throw Error('cleanup_packaged_dependencies');
    return {port:config.port, handler:createObserverHost({enabled:config.enabled,
      createRuntime:config.enabled ? createObserverRuntime({config, core, requestImpl, now}) : undefined, log, now})};
  }
  throw Error('cleanup_host_kind');
}
function startCleanupHost(kind, env = process.env, {serverFactory = http.createServer, ...dependencies} = {}) {
  const prepared = prepareCleanupHost(kind, env, dependencies);
  const server = serverFactory({maxHeaderSize:16384, requestTimeout:30000, headersTimeout:10000, keepAliveTimeout:1000}, prepared.handler);
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => {if (!settled) {settled = true; reject(Error('cleanup_listener_stopped'));}};
    server.on('error', fail);
    // Both containers use the Cloud Run PORT contract; importing never listens.
    try {server.listen(prepared.port, '0.0.0.0', () => {if (!settled) {settled = true; resolve(server);}});} catch {fail();}
  });
}
if (require.main === module) {
  startCleanupHost(process.argv[2]).then(server => {
    process.stdout.write(JSON.stringify({component:'coach_ai_cleanup_host', status:'listening'}) + '\n');
    const stop = () => {server.close(); server.closeIdleConnections?.(); setTimeout(() => {server.closeAllConnections?.();}, 5000).unref();};
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
  }).catch(() => {process.stderr.write('cleanup_startup_stopped\n'); process.exitCode = 1;});
}
module.exports = {prepareCleanupHost, startCleanupHost};
