'use strict';
const path = require('node:path');
const {createObserverHost, reportObserverRejection} = require('../observer/server.cjs');
const {createObserverRuntime} = require('../observer/runtime.cjs');
const {readFirebaseObserverConfig} = require('./config.cjs');
const {bufferedFirebaseRequest, replyStopped} = require('./request.cjs');

function loadObserverCore() {
  return require(path.resolve(__dirname, '../../../functions/lib/coachAiCleanupQueueMonitor.js'));
}

function createFirebaseObserver(env, {load = loadObserverCore, requestImpl, log, now} = {}) {
  const config = readFirebaseObserverConfig(env);
  const core = config.enabled ? load() : null;
  if (config.enabled && (!core || typeof core.createCleanupQueueMonitor !== 'function'
    || typeof core.CLEANUP_COLLECTIONS !== 'object' || !Array.isArray(core.CLEANUP_FIELDS))) {
    throw Error('cleanup_packaged_dependencies');
  }
  const handler = createObserverHost({enabled: config.enabled,
    createRuntime: config.enabled ? createObserverRuntime({config, core, requestImpl, now}) : undefined,
    log, now});
  return async (req, res) => {
    let adapted;
    try {
      adapted = bufferedFirebaseRequest(req, {kind: 'observer'});
      await handler(adapted.request, res);
    } catch (error) {
      if (error?.status === 400 && error.message === 'invalid_json') reportObserverRejection(log, 'raw_body_unavailable');
      replyStopped(res, error);
    }
    finally {adapted?.dispose();}
  };
}

module.exports = {createFirebaseObserver};
