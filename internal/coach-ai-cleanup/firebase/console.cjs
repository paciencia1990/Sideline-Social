'use strict';
const path = require('node:path');
const {createCleanupApplication} = require('../host/application.cjs');
const {readFirebaseConsoleConfig} = require('./config.cjs');
const {bufferedFirebaseRequest, replyStopped} = require('./request.cjs');

function loadConsoleCore() {
  // A future isolated package preserves this layout. Never load index.js,
  // compile code, start a listener or find credentials through a CLI.
  const root = path.resolve(__dirname, '../../..');
  const core = require(path.join(root, 'functions/lib/coachAiCleanupInterface.js'));
  return {createAdapter: core.createCoachAiCleanupInterface, createActionAdapter: core.createCoachAiCleanupActionInterface,
    Timestamp: require('firebase-admin/firestore').Timestamp};
}

function createFirebaseConsole(env, {load = loadConsoleCore, requestImpl} = {}) {
  const config = readFirebaseConsoleConfig(env);
  const dependencies = config.readsEnabled ? load() : {};
  if (config.readsEnabled && (typeof dependencies.createAdapter !== 'function' || typeof dependencies.Timestamp !== 'function')) {
    throw Error('cleanup_packaged_dependencies');
  }
  if (config.operatorActionsEnabled && typeof dependencies.createActionAdapter !== 'function') throw Error('cleanup_packaged_dependencies');
  const handler = createCleanupApplication({...config, ...dependencies, requestImpl});
  return async (req, res) => {
    let adapted;
    try {
      adapted = bufferedFirebaseRequest(req, {kind: 'console'});
      await handler(adapted.request, res);
    } catch (error) {replyStopped(res, error);}
    finally {adapted?.dispose();}
  };
}

module.exports = {createFirebaseConsole};
